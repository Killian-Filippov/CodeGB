import fs from 'node:fs/promises';
import path from 'node:path';

import { createKnowledgeGraph } from '../graph/graph';
import type {
  JavaGraphNode,
  JavaGraphRelationship,
  KnowledgeGraph,
} from '../types/graph';
import { JAVA_SCHEMA_QUERIES } from './schema';

const GRAPH_FILE = 'graph.json';
const SCHEMA_FILE = 'schema.sql';
const REPOS_FILE = 'repos.json';

export interface RepoRecord {
  name: string;
  path: string;
}

export interface PersistedGraph {
  nodes: JavaGraphNode[];
  relationships: JavaGraphRelationship[];
}

export class KuzuAdapter {
  private readonly storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true });
    await fs.writeFile(path.join(this.storagePath, SCHEMA_FILE), `${JAVA_SCHEMA_QUERIES.join('\n\n')}\n`, 'utf8');
  }

  async persistGraph(graph: KnowledgeGraph): Promise<void> {
    const payload: PersistedGraph = {
      nodes: graph.nodes,
      relationships: graph.relationships,
    };
    await fs.writeFile(path.join(this.storagePath, GRAPH_FILE), JSON.stringify(payload, null, 2), 'utf8');
  }

  async loadGraph(): Promise<KnowledgeGraph> {
    const graph = createKnowledgeGraph();
    const content = await fs.readFile(path.join(this.storagePath, GRAPH_FILE), 'utf8');
    const payload = JSON.parse(content) as PersistedGraph;
    payload.nodes.forEach((node) => graph.addNode(node));
    payload.relationships.forEach((rel) => graph.addRelationship(rel));
    return graph;
  }

  async saveRepository(repo: RepoRecord): Promise<void> {
    const current = await this.listRepositories();
    const withoutDup = current.filter((item) => item.name !== repo.name);
    withoutDup.push(repo);
    await fs.writeFile(path.join(this.storagePath, REPOS_FILE), JSON.stringify(withoutDup, null, 2), 'utf8');
  }

  async listRepositories(): Promise<RepoRecord[]> {
    try {
      const content = await fs.readFile(path.join(this.storagePath, REPOS_FILE), 'utf8');
      return JSON.parse(content) as RepoRecord[];
    } catch {
      return [];
    }
  }

  async executeCypher(query: string, graph?: KnowledgeGraph): Promise<Array<Record<string, unknown>>> {
    const activeGraph = graph ?? (await this.loadGraph());
    return executeCypherInMemory(activeGraph, query);
  }
}

const extractLimit = (query: string): number => {
  const match = query.match(/LIMIT\s+(\d+)/i);
  if (!match) {
    return 20;
  }
  return Number.parseInt(match[1] ?? '20', 10);
};

const selectReturnColumns = (
  row: Record<string, unknown>,
  returnClause: string,
): Record<string, unknown> => {
  const columns = returnClause
    .replace(/LIMIT\s+\d+/gi, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (columns.length === 1 && columns[0] === '*') {
    return row;
  }

  const output: Record<string, unknown> = {};
  for (const column of columns) {
    const propertyMatch = column.match(/^(\w+)\.(\w+)$/);
    if (propertyMatch) {
      const alias = propertyMatch[1] ?? '';
      const property = propertyMatch[2] ?? '';
      const base = row[alias] as Record<string, unknown> | undefined;
      output[column] = base?.[property];
      continue;
    }
    output[column] = row[column];
  }
  return output;
};

export const executeCypherInMemory = (
  graph: KnowledgeGraph,
  query: string,
): Array<Record<string, unknown>> => {
  const limit = extractLimit(query);

  const relMatch = query.match(
    /MATCH\s*\((\w+):(\w+)\)\s*-\[\s*(\w+)?(?:\s*:\s*\w+)?(?:\s*\{\s*type\s*:\s*'([A-Z_]+)'\s*\})?\s*\]\s*->\s*\((\w+):(\w+)\)\s*RETURN\s+([\s\S]+)/i,
  );

  if (relMatch) {
    const sourceAlias = relMatch[1] ?? 'a';
    const sourceLabel = relMatch[2] ?? '';
    const relAlias = relMatch[3] ?? 'r';
    const relType = relMatch[4];
    const targetAlias = relMatch[5] ?? 'b';
    const targetLabel = relMatch[6] ?? '';
    const returnClause = relMatch[7] ?? '*';

    const rows: Array<Record<string, unknown>> = [];
    for (const rel of graph.relationships) {
      if (relType && rel.type !== relType) {
        continue;
      }
      const source = graph.getNode(rel.sourceId);
      const target = graph.getNode(rel.targetId);
      if (!source || !target) {
        continue;
      }
      if (source.label !== sourceLabel || target.label !== targetLabel) {
        continue;
      }

      rows.push(
        selectReturnColumns(
          {
            [sourceAlias]: source.properties,
            [targetAlias]: target.properties,
            [relAlias]: rel,
          },
          returnClause,
        ),
      );
      if (rows.length >= limit) {
        break;
      }
    }
    return rows;
  }

  const nodeMatch = query.match(/MATCH\s*\((\w+):(\w+)\)\s*RETURN\s+([\s\S]+)/i);
  if (nodeMatch) {
    const alias = nodeMatch[1] ?? 'n';
    const label = nodeMatch[2] ?? '';
    const returnClause = nodeMatch[3] ?? '*';

    return graph.nodes
      .filter((node) => node.label === label)
      .slice(0, limit)
      .map((node) => selectReturnColumns({ [alias]: node.properties }, returnClause));
  }

  throw new Error(`Unsupported Cypher query in Phase 1 adapter: ${query}`);
};
