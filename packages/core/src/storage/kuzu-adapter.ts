import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
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
const KUZU_DB_FILE = 'kuzu.db';
const require = createRequire(import.meta.url);

type KuzuQueryResult = {
  getAll: () => Promise<Array<Record<string, unknown>>>;
};

type KuzuPreparedStatement = {
  isSuccess: () => boolean;
  getErrorMessage: () => string;
};

type KuzuConnection = {
  init: () => Promise<void>;
  close: () => Promise<void>;
  query: (statement: string) => Promise<KuzuQueryResult | KuzuQueryResult[]>;
  prepare: (statement: string) => Promise<KuzuPreparedStatement>;
  execute: (
    prepared: KuzuPreparedStatement,
    params?: Record<string, unknown>,
  ) => Promise<KuzuQueryResult | KuzuQueryResult[]>;
};

type KuzuDatabase = {
  init: () => Promise<void>;
  close: () => Promise<void>;
};

type KuzuRuntime = {
  Database: new (databasePath?: string) => KuzuDatabase;
  Connection: new (database: KuzuDatabase, numThreads?: number) => KuzuConnection;
};

const tryLoadKuzu = (): KuzuRuntime | null => {
  const candidates = ['kuzu', 'kuzu/kuzu-source/tools/nodejs_api/src_js/index.js'];
  for (const candidate of candidates) {
    try {
      return require(candidate) as KuzuRuntime;
    } catch {
      // Try next candidate.
    }
  }
  return null;
};

export interface RepoRecord {
  name: string;
  path: string;
}

export interface PersistedGraph {
  nodes: JavaGraphNode[];
  relationships: JavaGraphRelationship[];
}

export type KuzuAdapterMode = 'auto' | 'worker' | 'node';

export interface KuzuWorkerClient {
  init?: () => Promise<void>;
  persistGraph: (graph: KnowledgeGraph) => Promise<void>;
  loadGraph: () => Promise<KnowledgeGraph>;
  executeCypher: (query: string) => Promise<Array<Record<string, unknown>>>;
  close?: () => Promise<void>;
}

export interface KuzuAdapterOptions {
  mode?: KuzuAdapterMode;
  workerClient?: KuzuWorkerClient;
  loadKuzuRuntime?: () => KuzuRuntime | null;
  enableNativeKuzu?: boolean;
}

export class KuzuAdapter {
  private readonly storagePath: string;
  private readonly mode: KuzuAdapterMode;
  private readonly workerClient?: KuzuWorkerClient;
  private readonly loadKuzuRuntime: () => KuzuRuntime | null;

  constructor(storagePath: string, options: KuzuAdapterOptions = {}) {
    this.storagePath = storagePath;
    this.mode = options.mode ?? 'auto';
    this.workerClient = options.workerClient;
    const nativeEnabled = options.enableNativeKuzu ?? process.env.CODEGB_ENABLE_NATIVE_KUZU === '1';
    this.loadKuzuRuntime = options.loadKuzuRuntime ?? (nativeEnabled ? tryLoadKuzu : () => null);
  }

  private get kuzuPath(): string {
    return path.join(this.storagePath, KUZU_DB_FILE);
  }

  private async withConnection<T>(handler: (connection: KuzuConnection) => Promise<T>): Promise<T> {
    const runtime = this.loadKuzuRuntime();
    if (!runtime) {
      throw new Error('Kuzu runtime is not available');
    }
    const db = new runtime.Database(this.kuzuPath);
    const connection = new runtime.Connection(db);
    try {
      await db.init();
      await connection.init();
      return await handler(connection);
    } finally {
      await connection.close().catch(() => undefined);
      await db.close().catch(() => undefined);
    }
  }

  private async ensureSchema(connection: KuzuConnection): Promise<void> {
    for (const query of JAVA_SCHEMA_QUERIES) {
      try {
        await connection.query(query);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already exists/i.test(message)) {
          throw error;
        }
      }
    }
  }

  private async queryAll(connection: KuzuConnection, query: string): Promise<Array<Record<string, unknown>>> {
    const queryResult = await connection.query(query);
    const results = Array.isArray(queryResult) ? queryResult : [queryResult];
    const rows: Array<Record<string, unknown>> = [];
    for (const result of results) {
      rows.push(...(await this.resultToRows(result)));
    }
    return rows;
  }

  private async resultToRows(result: KuzuQueryResult): Promise<Array<Record<string, unknown>>> {
    return result.getAll();
  }

  private async clearGraph(connection: KuzuConnection): Promise<void> {
    await connection.query('MATCH (n:Symbol) DETACH DELETE n');
  }

  private getBackendMode(): 'worker' | 'node' {
    if (this.mode === 'worker') {
      if (!this.workerClient) {
        throw new Error('Worker mode requires a worker client');
      }
      return 'worker';
    }
    if (this.mode === 'node') {
      return 'node';
    }
    return this.workerClient ? 'worker' : 'node';
  }

  private getWorkerClient(): KuzuWorkerClient {
    if (!this.workerClient) {
      throw new Error('Worker mode requires a worker client');
    }
    return this.workerClient;
  }

  async init(): Promise<void> {
    if (this.getBackendMode() === 'worker') {
      await this.getWorkerClient().init?.();
      return;
    }

    await fs.mkdir(this.storagePath, { recursive: true });
    await fs.writeFile(path.join(this.storagePath, SCHEMA_FILE), `${JAVA_SCHEMA_QUERIES.join('\n\n')}\n`, 'utf8');
    if (this.loadKuzuRuntime()) {
      await this.withConnection(async (connection) => {
        await this.ensureSchema(connection);
      });
    }
  }

  async persistGraph(graph: KnowledgeGraph): Promise<void> {
    if (this.getBackendMode() === 'worker') {
      await this.getWorkerClient().persistGraph(graph);
      return;
    }

    const payload: PersistedGraph = {
      nodes: graph.nodes,
      relationships: graph.relationships,
    };
    await fs.writeFile(path.join(this.storagePath, GRAPH_FILE), JSON.stringify(payload, null, 2), 'utf8');

    if (!this.loadKuzuRuntime()) {
      return;
    }
    await this.withConnection(async (connection) => {
      await this.ensureSchema(connection);
      await this.clearGraph(connection);

      const createSymbol = await connection.prepare(
        `
          CREATE (s:Symbol {
            id: $id,
            label: $label,
            name: $name,
            qualifiedName: $qualifiedName,
            filePath: $filePath,
            payload: $payload
          })
        `,
      );
      if (!createSymbol.isSuccess()) {
        throw new Error(createSymbol.getErrorMessage());
      }

      for (const node of graph.nodes) {
        await connection.execute(createSymbol, {
          id: node.id,
          label: node.label,
          name: node.properties.name,
          qualifiedName: node.properties.qualifiedName ?? '',
          filePath: node.properties.filePath,
          payload: JSON.stringify(node.properties),
        });
      }

      const createRelation = await connection.prepare(
        `
          MATCH (source:Symbol {id: $sourceId}), (target:Symbol {id: $targetId})
          CREATE (source)-[:CodeRelation {
            id: $id,
            type: $type,
            confidence: $confidence,
            reason: $reason,
            line: $line
          }]->(target)
        `,
      );
      if (!createRelation.isSuccess()) {
        throw new Error(createRelation.getErrorMessage());
      }

      for (const rel of graph.relationships) {
        await connection.execute(createRelation, {
          id: rel.id,
          sourceId: rel.sourceId,
          targetId: rel.targetId,
          type: rel.type,
          confidence: rel.confidence,
          reason: rel.reason,
          line: rel.line ?? null,
        });
      }
    });
  }

  async loadGraph(): Promise<KnowledgeGraph> {
    if (this.getBackendMode() === 'worker') {
      return this.getWorkerClient().loadGraph();
    }

    const graph = createKnowledgeGraph();
    try {
      await this.withConnection(async (connection) => {
        await this.ensureSchema(connection);

        const nodeRows = await this.queryAll(connection, 'MATCH (s:Symbol) RETURN s');
        for (const row of nodeRows) {
          const raw = row.s as Record<string, unknown> | undefined;
          if (!raw) {
            continue;
          }
          const parsedProps =
            typeof raw.payload === 'string'
              ? (JSON.parse(raw.payload) as JavaGraphNode['properties'])
              : ({ name: String(raw.name ?? ''), filePath: String(raw.filePath ?? '') } as JavaGraphNode['properties']);
          graph.addNode({
            id: String(raw.id),
            label: String(raw.label) as JavaGraphNode['label'],
            properties: parsedProps,
          });
        }

        const relRows = await this.queryAll(
          connection,
          `
            MATCH (source:Symbol)-[r:CodeRelation]->(target:Symbol)
            RETURN
              source.id as sourceId,
              target.id as targetId,
              r.id as id,
              r.type as type,
              r.confidence as confidence,
              r.reason as reason,
              r.line as line
          `,
        );
        for (const row of relRows) {
          graph.addRelationship({
            id: String(row.id),
            sourceId: String(row.sourceId),
            targetId: String(row.targetId),
            type: String(row.type) as JavaGraphRelationship['type'],
            confidence: Number(row.confidence ?? 1),
            reason: String(row.reason ?? ''),
            line: typeof row.line === 'number' ? row.line : undefined,
          });
        }
      });
      if (graph.nodeCount > 0 || graph.relationshipCount > 0) {
        return graph;
      }
    } catch {
      // Fall through to JSON fallback for backward compatibility.
    }

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
    if (this.getBackendMode() === 'worker') {
      return this.getWorkerClient().executeCypher(query);
    }

    try {
      return (await this.withConnection(async (connection) => this.queryAll(connection, query))) as Array<
        Record<string, unknown>
      >;
    } catch {
      const activeGraph = graph ?? (await this.loadGraph());
      return executeCypherInMemory(activeGraph, query);
    }
  }

  async close(): Promise<void> {
    if (this.getBackendMode() === 'worker') {
      await this.getWorkerClient().close?.();
    }
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
