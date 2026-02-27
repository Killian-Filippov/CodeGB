import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { traverseImpact } from '../../core/src/graph/traversal';
import { createKnowledgeGraph } from '../../core/src/graph/graph';
import { collectChangedJavaFiles } from '../../core/src/ingestion/git-changed-files';
import { runPipelineFromRepo } from '../../core/src/ingestion/pipeline';
import { searchByKeyword } from '../../core/src/search/keyword-search';
import { executeCypherInMemory, KuzuAdapter } from '../../core/src/storage/kuzu-adapter';
import type { JavaGraphNode, KnowledgeGraph } from '../../core/src/types/graph';
import { buildToolCacheKey, PersistentToolCache, TtlLruCache } from './tool-cache';

const execFileAsync = promisify(execFile);

const MIN_NODE_MAJOR = 18;
type StartupErrorCode = 'E_NODE_VERSION' | 'E_STORAGE_PERM' | 'E_WORKER_UNAVAILABLE' | 'E_BACKEND_INIT' | 'E_INTERNAL';

class StartupError extends Error {
  readonly code: StartupErrorCode;

  constructor(code: StartupErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const toStartupError = (error: unknown): StartupError => {
  if (error instanceof StartupError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const maybeSystem = error as Partial<{ code: string }>;
  if (maybeSystem.code === 'EACCES' || maybeSystem.code === 'EPERM' || maybeSystem.code === 'EROFS') {
    return new StartupError('E_STORAGE_PERM', 'Storage directory is not writable.');
  }
  return new StartupError('E_INTERNAL', message || 'Unexpected startup error.');
};

const renderStartupError = (error: unknown): string =>
  JSON.stringify({
    code: toStartupError(error).code,
    message: toStartupError(error).message,
  });

const ensureNodeVersion = (): void => {
  const major = Number(process.versions.node.split('.')[0] ?? 0);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    throw new StartupError(
      'E_NODE_VERSION',
      `Node.js ${MIN_NODE_MAJOR}+ is required (current: ${process.versions.node}).`,
    );
  }
};

const ensureStorageWritable = async (storagePath: string): Promise<void> => {
  try {
    await fs.mkdir(storagePath, { recursive: true });
    const probePath = path.join(storagePath, `.codegb-write-check-${process.pid}-${Date.now()}.tmp`);
    await fs.writeFile(probePath, 'ok', 'utf8');
    await fs.unlink(probePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StartupError('E_STORAGE_PERM', `Storage directory is not writable: ${storagePath}. ${message}`);
  }
};

const ensureWorkerAvailable = async (): Promise<void> => {
  const hasGlobalWorker = typeof (globalThis as { Worker?: unknown }).Worker === 'function';
  if (hasGlobalWorker) {
    return;
  }
  try {
    const workerThreads = await import('node:worker_threads');
    if (typeof workerThreads.Worker === 'function') {
      return;
    }
  } catch {
    // Fall through to startup error.
  }
  throw new StartupError('E_WORKER_UNAVAILABLE', 'Worker runtime is unavailable in current environment.');
};

const ensureBackendInitialized = async (adapter: KuzuAdapter): Promise<void> => {
  try {
    await adapter.init();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StartupError('E_BACKEND_INIT', `Backend initialization failed. ${message}`);
  }
};

const runStartupChecks = async (storagePath: string, adapter: KuzuAdapter): Promise<void> => {
  ensureNodeVersion();
  await ensureStorageWritable(storagePath);
  await ensureWorkerAvailable();
  await ensureBackendInitialized(adapter);
};

const toSymbol = (node: JavaGraphNode) => ({
  id: node.id,
  name: node.properties.name,
  type: node.label,
  qualifiedName: node.properties.qualifiedName,
  file: node.properties.filePath,
  returnType: node.properties.returnType,
  parameters: node.properties.parameters,
  fieldType: node.properties.type,
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

const AUTO_INDEX_INTERVAL_ENV_KEY = 'CODEGB_AUTO_INDEX_INTERVAL_MS';
const DEFAULT_AUTO_INDEX_INTERVAL_MS = 3000;
const CACHE_TTL_ENV_KEY = 'CODEGB_MCP_CACHE_TTL_MS';
const CACHE_L1_CAPACITY_ENV_KEY = 'CODEGB_MCP_CACHE_L1_MAX_ENTRIES';
const CACHE_L2_CAPACITY_ENV_KEY = 'CODEGB_MCP_CACHE_L2_MAX_ENTRIES';
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_L1_CAPACITY = 256;
const DEFAULT_CACHE_L2_CAPACITY = 4096;
const CACHED_TOOLS = new Set(['query', 'context']);
const CACHE_FILE_NAME = 'mcp-tool-cache.v1.json';
const REPO_COMMIT_TTL_MS = 3_000;

const resolveAutoIndexIntervalMs = (): number => {
  const raw = process.env[AUTO_INDEX_INTERVAL_ENV_KEY];
  if (!raw) {
    return DEFAULT_AUTO_INDEX_INTERVAL_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.max(1000, Math.floor(parsed));
};

const resolveNonNegativeIntEnv = (envKey: string, fallback: number): number => {
  const raw = process.env[envKey];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const resolveCacheConfig = (): { ttlMs: number; l1Capacity: number; l2Capacity: number } => {
  return {
    ttlMs: resolveNonNegativeIntEnv(CACHE_TTL_ENV_KEY, DEFAULT_CACHE_TTL_MS),
    l1Capacity: resolveNonNegativeIntEnv(CACHE_L1_CAPACITY_ENV_KEY, DEFAULT_CACHE_L1_CAPACITY),
    l2Capacity: resolveNonNegativeIntEnv(CACHE_L2_CAPACITY_ENV_KEY, DEFAULT_CACHE_L2_CAPACITY),
  };
};

const createCommitResolver = () => {
  const commitCache = new Map<string, { commit: string; expiresAt: number }>();

  return async (repoPath: string): Promise<string> => {
    const now = Date.now();
    const cached = commitCache.get(repoPath);
    if (cached && cached.expiresAt > now) {
      return cached.commit;
    }

    let commit = 'NO_GIT_HEAD';
    try {
      const output = await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
      const resolved = String(output.stdout ?? '').trim();
      if (resolved) {
        commit = resolved;
      }
    } catch {
      // Ignore git errors and keep fallback commit marker.
    }

    commitCache.set(repoPath, { commit, expiresAt: now + REPO_COMMIT_TTL_MS });
    return commit;
  };
};

const startAutoIncrementalIndexing = (options: {
  storagePath: string;
  repoPath: string;
  repoName: string;
  intervalMs: number;
}): void => {
  const { storagePath, repoPath, repoName, intervalMs } = options;
  let running = false;
  let disabled = false;

  const runOnce = async (): Promise<void> => {
    if (running || disabled) {
      return;
    }
    running = true;
    try {
      const changedFiles = await collectChangedJavaFiles(repoPath);
      if (changedFiles.filesToInvalidate.length === 0) {
        return;
      }

      const result = await runPipelineFromRepo({
        repoPath,
        storagePath,
        projectName: repoName,
        includeFilePaths: changedFiles.filesToIndex,
        changedFilePaths: changedFiles.filesToInvalidate,
        incremental: true,
      });
      process.stderr.write(`[CodeGB] auto incremental index updated (${result.filesIndexed} files).\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[CodeGB] auto incremental index failed: ${message}\n`);
      if (/requires a git repository|not a git repository/i.test(message)) {
        disabled = true;
        process.stderr.write('[CodeGB] auto incremental index is disabled for non-git workspace.\n');
      }
    } finally {
      running = false;
    }
  };

  void runOnce();
  const timer = setInterval(() => {
    void runOnce();
  }, intervalMs);
  timer.unref?.();
};

const runCypherFallback = (query: string, graph: KnowledgeGraph): Array<Record<string, unknown>> => {
  const q = query.replace(/\s+/g, ' ').trim();

  // Minimal backward compatibility fallback for common legacy client queries.
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
    /^MATCH \(c1:Class\)-\[r\]->\(c2:Class\) RETURN c1\.name as from, type\(r\) as rel, c2\.name as to LIMIT \d+$/i.test(
      q,
    )
  ) {
    const limit = Number(q.match(/LIMIT (\d+)/i)?.[1] ?? 10);
    const rows: Array<Record<string, unknown>> = [];
    for (const rel of graph.relationships) {
      const source = graph.getNode(rel.sourceId);
      const target = graph.getNode(rel.targetId);
      if (!source || !target || source.label !== 'Class' || target.label !== 'Class') {
        continue;
      }
      rows.push({
        from: source.properties.name,
        rel: rel.type,
        to: target.properties.name,
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

  return executeCypherInMemory(graph, query);
};

const shouldFallbackOnLegacyShape = (query: string, rows: Array<Record<string, unknown>>): boolean => {
  const q = query.replace(/\s+/g, ' ').trim();
  if (
    /^MATCH \(c:Class\)-\[:CONTAINS\]->\(m:Method\) RETURN c\.name as className, count\(m\) as methodCount ORDER BY methodCount DESC$/i.test(
      q,
    )
  ) {
    if (rows.length === 0) {
      return false;
    }
    const first = rows[0] ?? {};
    return typeof first['className'] !== 'string' || typeof first['methodCount'] !== 'number';
  }
  return false;
};

const main = async (): Promise<void> => {
  const storagePath = process.env.JAVA_KG_DB_PATH ?? path.resolve('.javakg');
  const adapter = new KuzuAdapter(storagePath);
  await runStartupChecks(storagePath, adapter);
  const repoConfig = await readRepoConfig(storagePath);
  const cacheConfig = resolveCacheConfig();
  const l1Cache = new TtlLruCache<Record<string, unknown>>(cacheConfig.ttlMs, cacheConfig.l1Capacity);
  const l2Cache = new PersistentToolCache<Record<string, unknown>>({
    filePath: path.join(storagePath, CACHE_FILE_NAME),
    ttlMs: cacheConfig.ttlMs,
    maxEntries: cacheConfig.l2Capacity,
  });
  const resolveCommit = createCommitResolver();

  const safeLoadGraph = async (): Promise<KnowledgeGraph> => {
    try {
      return await adapter.loadGraph();
    } catch {
      return createKnowledgeGraph();
    }
  };

  const runWithToolCache = async (
    toolName: string,
    rawArgs: Record<string, unknown>,
    compute: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> => {
    if (!CACHED_TOOLS.has(toolName)) {
      return compute();
    }

    const repoFromArgs = typeof rawArgs.repo === 'string' && rawArgs.repo.trim() ? rawArgs.repo.trim() : null;
    const repoIdentity = repoFromArgs ?? repoConfig.repoPath;
    const commitRepoPath = repoFromArgs && path.isAbsolute(repoFromArgs) ? repoFromArgs : repoConfig.repoPath;

    let cacheKey: string | null = null;
    try {
      const commit = await resolveCommit(commitRepoPath);
      cacheKey = buildToolCacheKey({
        repo: repoIdentity,
        commit,
        tool: toolName,
        args: rawArgs,
      });

      const inMemory = l1Cache.get(cacheKey);
      if (inMemory) {
        return inMemory;
      }

      const persisted = await l2Cache.get(cacheKey);
      if (persisted) {
        l1Cache.set(cacheKey, persisted);
        return persisted;
      }
    } catch {
      cacheKey = null;
    }

    const fresh = await compute();
    if (!cacheKey) {
      return fresh;
    }

    l1Cache.set(cacheKey, fresh);
    try {
      await l2Cache.set(cacheKey, fresh);
    } catch {
      // Ignore persistence errors and continue with in-memory cache.
    }
    return fresh;
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
    { name: 'java-knowledge-graph', version: '0.2.0-beta.1' },
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

    let graphPromise: Promise<KnowledgeGraph> | null = null;
    const loadGraph = async (): Promise<KnowledgeGraph> => {
      if (!graphPromise) {
        graphPromise = safeLoadGraph();
      }
      return graphPromise;
    };

    if (name === 'query') {
      const query = String(args.query ?? '').trim();
      const limit = Number(args.limit ?? 10);
      const normalizedArgs = {
        query,
        limit,
        repo: typeof args.repo === 'string' ? args.repo.trim() : '',
      };

      const payload = await runWithToolCache('query', normalizedArgs, async () => {
        const graph = await loadGraph();
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
        return { results };
      });

      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    }

    if (name === 'context') {
      const symbolName = String(args.symbol ?? '');
      const includeCalls = args.include_calls !== false;
      const normalizedArgs = {
        symbol: symbolName,
        include_calls: includeCalls,
        repo: typeof args.repo === 'string' ? args.repo.trim() : '',
      };

      const payload = await runWithToolCache('context', normalizedArgs, async () => {
        const graph = await loadGraph();
        const symbolNode =
          graph.nodes.find((n) => n.properties.name === symbolName || n.properties.qualifiedName === symbolName) ??
          null;
        if (!symbolNode) {
          return { symbol: null, methods: [], fields: [], calls: [] };
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
          .map((n) => ({ ...toSymbol(n), type: n.label, fieldType: n.properties.type }));

        const calls = includeCalls
          ? graph.relationships
              .filter((r) => r.sourceId === symbolNode.id && r.type === 'CALLS')
              .map((r) => graph.getNode(r.targetId))
              .filter((n): n is JavaGraphNode => !!n)
              .map(toSymbol)
          : [];

        return {
          symbol: toSymbol(symbolNode),
          methods,
          fields,
          calls,
        };
      });

      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    }

    if (name === 'impact') {
      const graph = await loadGraph();
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
      let results: Array<Record<string, unknown>>;
      try {
        results = await adapter.executeCypher(query);
        if (shouldFallbackOnLegacyShape(query, results)) {
          const latestGraph = await safeLoadGraph();
          results = runCypherFallback(query, latestGraph);
        }
      } catch {
        // Fallback only when backend path is unrecoverable.
        const latestGraph = await safeLoadGraph();
        results = runCypherFallback(query, latestGraph);
      }
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  const autoIndexIntervalMs = resolveAutoIndexIntervalMs();
  if (autoIndexIntervalMs > 0) {
    startAutoIncrementalIndexing({
      storagePath,
      repoPath: repoConfig.repoPath,
      repoName: repoConfig.repoName,
      intervalMs: autoIndexIntervalMs,
    });
  }

  await server.connect(new StdioServerTransport());
};

main().catch((error) => {
  process.stderr.write(`${renderStartupError(error)}\n`);
  process.exit(1);
});
