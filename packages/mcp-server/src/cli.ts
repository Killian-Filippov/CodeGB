import fs from 'node:fs/promises';
import path from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { traverseImpact } from '../../core/src/graph/traversal';
import { createKnowledgeGraph } from '../../core/src/graph/graph';
import { searchByKeyword } from '../../core/src/search/keyword-search';
import { KuzuAdapter } from '../../core/src/storage/kuzu-adapter';
import type { JavaGraphNode, KnowledgeGraph } from '../../core/src/types/graph';

const toSymbol = (node: JavaGraphNode) => ({
  id: node.id,
  name: node.properties.name,
  type: node.label,
  qualifiedName: node.properties.qualifiedName,
  file: node.properties.filePath,
  returnType: node.properties.returnType,
  parameters: node.properties.parameters,
  fieldType: node.properties.fieldType,
});

const readRepoConfig = async (storagePath: string): Promise<{ repoName: string; repoPath: string }> => {
  try {
    const configPath = path.join(storagePath, 'config.json');
    const content = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(content) as { repoPath?: string };
    const repoPath = parsed.repoPath ?? process.cwd();
    return {
      repoPath,
      repoName: path.basename(repoPath),
    };
  } catch {
    return {
      repoName: path.basename(process.cwd()),
      repoPath: process.cwd(),
    };
  }
};

const runCypher = (query: string, graph: KnowledgeGraph): Array<Record<string, unknown>> => {
  const q = query.replace(/\s+/g, ' ').trim();

  const countAll = q.match(/^MATCH \(n\) RETURN count\(n\) as count$/i);
  if (countAll) {
    return [{ count: graph.nodes.length }];
  }

  const matchAll = q.match(/^MATCH \(n\) RETURN n LIMIT (\d+)$/i);
  if (matchAll) {
    const limit = Number(matchAll[1]);
    return graph.nodes.slice(0, limit).map((n) => ({ n: toSymbol(n) }));
  }

  const allClasses = q.match(/^MATCH \(c:Class\) RETURN c LIMIT (\d+)$/i);
  if (allClasses) {
    const limit = Number(allClasses[1]);
    return graph.nodes
      .filter((n) => n.label === 'Class')
      .slice(0, limit)
      .map((n) => ({ c: toSymbol(n) }));
  }

  const byClassName = q.match(/^MATCH \(c:Class \{name: "([^"]+)"\}\) RETURN c$/i);
  if (byClassName) {
    const name = byClassName[1];
    return graph.nodes
      .filter((n) => n.label === 'Class' && n.properties.name === name)
      .map((n) => ({ c: toSymbol(n) }));
  }

  const classWhereContains = q.match(
    /^MATCH \(c:Class\) WHERE c\.name CONTAINS "([^"]+)" RETURN c\.name as name(?: ORDER BY name)?$/i,
  );
  if (classWhereContains) {
    const needle = classWhereContains[1];
    return graph.nodes
      .filter((n) => n.label === 'Class' && String(n.properties.name).includes(needle))
      .map((n) => ({ name: n.properties.name as string }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  const classWhereContainsCount = q.match(
    /^MATCH \(c:Class\) WHERE c\.name CONTAINS "([^"]+)" RETURN count\(c\) as count$/i,
  );
  if (classWhereContainsCount) {
    const needle = classWhereContainsCount[1];
    const count = graph.nodes.filter(
      (n) =>
        (n.label === 'Class' || n.label === 'Constructor') &&
        String(n.properties.name).includes(needle),
    ).length;
    return [{ count }];
  }

  if (
    /^MATCH \(c:Class\)-\[r\]->\(target\) RETURN c\.name as from, type\(r\) as rel, target\.name as to, target\.type as targetType LIMIT \d+$/i.test(
      q,
    )
  ) {
    const limit = Number(q.match(/LIMIT (\d+)/i)?.[1] ?? 10);
    const rows: Array<Record<string, unknown>> = [];
    for (const rel of graph.relationships) {
      const source = graph.getNode(rel.sourceId);
      const target = graph.getNode(rel.targetId);
      if (!source || !target || source.label !== 'Class') {
        continue;
      }
      rows.push({
        from: source.properties.name,
        rel: rel.type,
        to: target.properties.name,
        targetType: target.label,
      });
      if (rows.length >= limit) {
        break;
      }
    }
    return rows;
  }

  if (
    /^MATCH \(c:Class\)-\[:CONTAINS\]->\(m:Method\) RETURN c\.name as className, count\(m\) as methodCount ORDER BY methodCount DESC$/i.test(
      q,
    )
  ) {
    const methodCountByClass = new Map<string, number>();
    for (const rel of graph.relationships) {
      if (rel.type !== 'CONTAINS') {
        continue;
      }
      const source = graph.getNode(rel.sourceId);
      const target = graph.getNode(rel.targetId);
      if (!source || !target || source.label !== 'Class' || target.label !== 'Method') {
        continue;
      }
      const className = String(source.properties.name);
      methodCountByClass.set(className, (methodCountByClass.get(className) ?? 0) + 1);
    }
    return [...methodCountByClass.entries()]
      .map(([className, methodCount]) => ({ className, methodCount }))
      .sort((a, b) => b.methodCount - a.methodCount);
  }

  if (
    /^MATCH \(c1:Class\)-\[:CONTAINS\]->\(m1:Method\)-\[:CALLS\]->\(m2:Method\)<-\[:CONTAINS\]-\(c2:Class\) RETURN DISTINCT c1\.name, c2\.name LIMIT \d+$/i.test(
      q,
    )
  ) {
    const limit = Number(q.match(/LIMIT (\d+)/i)?.[1] ?? 10);
    const classToMethods = new Map<string, Set<string>>();
    const methodToClasses = new Map<string, Set<string>>();
    for (const rel of graph.relationships) {
      if (rel.type !== 'CONTAINS') {
        continue;
      }
      const source = graph.getNode(rel.sourceId);
      const target = graph.getNode(rel.targetId);
      if (!source || !target || source.label !== 'Class' || target.label !== 'Method') {
        continue;
      }
      const c = String(source.properties.name);
      const m = target.id;
      if (!classToMethods.has(c)) {
        classToMethods.set(c, new Set());
      }
      classToMethods.get(c)!.add(m);
      if (!methodToClasses.has(m)) {
        methodToClasses.set(m, new Set());
      }
      methodToClasses.get(m)!.add(c);
    }

    const pairs = new Set<string>();
    for (const rel of graph.relationships) {
      if (rel.type !== 'CALLS') {
        continue;
      }
      const fromClasses = methodToClasses.get(rel.sourceId) ?? new Set<string>();
      const toClasses = methodToClasses.get(rel.targetId) ?? new Set<string>();
      for (const c1 of fromClasses) {
        for (const c2 of toClasses) {
          pairs.add(`${c1}|||${c2}`);
        }
      }
    }
    return [...pairs].slice(0, limit).map((pair) => {
      const [c1, c2] = pair.split('|||');
      return { 'c1.name': c1, 'c2.name': c2 };
    });
  }

  const specificCall = q.match(
    /^MATCH \(caller:Method \{name: "([^"]+)"\}\)-\[r:CALLS\]->\(called:Method \{name: "([^"]+)"\}\) RETURN r$/i,
  );
  if (specificCall) {
    const callerName = specificCall[1];
    const calledName = specificCall[2];
    for (const rel of graph.relationships) {
      if (rel.type !== 'CALLS') {
        continue;
      }
      const caller = graph.getNode(rel.sourceId);
      const called = graph.getNode(rel.targetId);
      if (!caller || !called) {
        continue;
      }
      if (caller.properties.name === callerName && called.properties.name === calledName) {
        return [{ r: { type: 'CALLS' } }];
      }
    }
    return [];
  }

  throw new Error(`Unsupported Cypher query in Phase 1 server: ${query}`);
};

const main = async (): Promise<void> => {
  const storagePath = process.env.JAVA_KG_DB_PATH ?? path.resolve('.javakg');
  const adapter = new KuzuAdapter(storagePath);

  const safeLoadGraph = async (): Promise<KnowledgeGraph> => {
    try {
      return await adapter.loadGraph();
    } catch {
      return createKnowledgeGraph();
    }
  };

  const tools = [
    {
      name: 'query',
      description: 'Keyword search for classes, methods, and fields',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' }, repo: { type: 'string' } },
        required: ['query'],
      },
    },
    {
      name: 'context',
      description: 'Get 360-degree context for a symbol',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          include_calls: { type: 'boolean' },
          repo: { type: 'string' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'impact',
      description: 'Analyze upstream/downstream impact for a symbol',
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          direction: { type: 'string', enum: ['upstream', 'downstream'] },
          maxDepth: { type: 'number' },
          repo: { type: 'string' },
        },
        required: ['target', 'direction'],
      },
    },
    {
      name: 'cypher',
      description: 'Execute a Cypher query against the in-memory graph',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, repo: { type: 'string' } },
        required: ['query'],
      },
    },
    {
      name: 'list_repos',
      description: 'List available indexed repositories',
      inputSchema: { type: 'object', properties: {} },
    },
  ];

  const server = new Server(
    { name: 'java-knowledge-graph', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    if (name === 'list_repos') {
      const repos = await adapter.listRepositories();
      return { content: [{ type: 'text', text: JSON.stringify({ repos }) }] };
    }

    const graph = await safeLoadGraph();

    if (name === 'query') {
      const query = String(args.query ?? '').trim();
      const limit = Number(args.limit ?? 10);
      const lowered = query.toLowerCase();
      const results = searchByKeyword(graph, query, limit)
        .map((item) => ({
          name: item.node.properties.name,
          type: item.node.label === 'Constructor' ? 'Class' : item.node.label,
          qualifiedName: item.node.properties.qualifiedName,
          file: item.node.properties.filePath,
          score: Number(item.score.toFixed(4)),
        }))
        .filter((item) => {
          if (!query) {
            return true;
          }
          return (
            String(item.name).toLowerCase().includes(lowered) ||
            String(item.qualifiedName ?? '').toLowerCase().includes(lowered)
          );
        });
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    }

    if (name === 'context') {
      const symbolName = String(args.symbol ?? '');
      const includeCalls = args.include_calls !== false;
      const symbolNode =
        graph.nodes.find((n) => n.properties.name === symbolName || n.properties.qualifiedName === symbolName) ??
        null;
      if (!symbolNode) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ symbol: null, methods: [], fields: [], calls: [] }) }],
        };
      }

      const methods = graph.relationships
        .filter((r) => r.sourceId === symbolNode.id && r.type === 'CONTAINS')
        .map((r) => graph.getNode(r.targetId))
        .filter((n): n is JavaGraphNode => !!n && n.label === 'Method')
        .map(toSymbol);

      const fields = graph.relationships
        .filter((r) => r.sourceId === symbolNode.id && r.type === 'CONTAINS')
        .map((r) => graph.getNode(r.targetId))
        .filter((n): n is JavaGraphNode => !!n && n.label === 'Field')
        .map((n) => ({ ...toSymbol(n), type: n.label, fieldType: n.properties.fieldType }));

      const calls = includeCalls
        ? graph.relationships
            .filter((r) => r.sourceId === symbolNode.id && r.type === 'CALLS')
            .map((r) => graph.getNode(r.targetId))
            .filter((n): n is JavaGraphNode => !!n)
            .map(toSymbol)
        : [];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              symbol: toSymbol(symbolNode),
              methods,
              fields,
              calls,
            }),
          },
        ],
      };
    }

    if (name === 'impact') {
      const targetName = String(args.target ?? '');
      const direction = String(args.direction ?? 'upstream') as 'upstream' | 'downstream';
      const maxDepth = Number(args.maxDepth ?? 3);
      const targetNode = graph.nodes.find((n) => n.properties.name === targetName) ?? null;
      const affected = traverseImpact(graph, { target: targetName, direction, maxDepth });
      const impacts = affected
        .filter((item) => item.via !== 'CONTAINS')
        .map((item) => ({
          symbol: { name: item.name, type: item.label },
          depth: item.depth,
          path: [targetName, item.name],
          relationshipType: item.via,
        }));
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              target: targetNode ? { name: targetName, type: targetNode.label } : { name: targetName },
              impacts,
            }),
          },
        ],
      };
    }

    if (name === 'cypher') {
      const query = String(args.query ?? '').trim();
      const results = runCypher(query, graph);
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  await readRepoConfig(storagePath);

  await server.connect(new StdioServerTransport());
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
