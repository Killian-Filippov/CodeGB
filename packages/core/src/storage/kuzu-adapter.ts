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
  close?: () => void;
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

type DbBackend = 'auto' | 'native' | 'wasm';

const DB_BACKEND_ENV_KEY = 'CODEGB_DB_BACKEND';
let hasPrintedAutoFallbackDiagnostic = false;

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
  dbBackend?: DbBackend;
}

export class KuzuAdapter {
  private readonly storagePath: string;
  private readonly mode: KuzuAdapterMode;
  private readonly backend: DbBackend;
  private readonly workerClient?: KuzuWorkerClient;
  private readonly loadKuzuRuntime: () => KuzuRuntime | null;
  private autoNativeFallbackActivated = false;

  constructor(storagePath: string, options: KuzuAdapterOptions = {}) {
    this.storagePath = storagePath;
    this.mode = options.mode ?? 'auto';
    this.backend = resolveDbBackend(options.dbBackend);
    this.workerClient = options.workerClient;
    this.loadKuzuRuntime = options.loadKuzuRuntime ?? (this.backend === 'wasm' ? () => null : tryLoadKuzu);
  }

  private get kuzuPath(): string {
    return path.join(this.storagePath, KUZU_DB_FILE);
  }

  private async withConnection<T>(runtime: KuzuRuntime, handler: (connection: KuzuConnection) => Promise<T>): Promise<T> {
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
        const queryResult = await connection.query(query);
        this.closeQueryResults(queryResult);
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
      try {
        rows.push(...(await this.resultToRows(result)));
      } finally {
        result.close?.();
      }
    }
    return rows;
  }

  private async resultToRows(result: KuzuQueryResult): Promise<Array<Record<string, unknown>>> {
    return result.getAll();
  }

  private async clearGraph(connection: KuzuConnection): Promise<void> {
    const queryResult = await connection.query('MATCH (n:Symbol) DETACH DELETE n');
    this.closeQueryResults(queryResult);
  }

  private closeQueryResults(result: KuzuQueryResult | KuzuQueryResult[]): void {
    if (Array.isArray(result)) {
      for (const item of result) {
        item.close?.();
      }
      return;
    }
    result.close?.();
  }

  private shouldPreferWasmPath(): boolean {
    if (this.backend === 'wasm') {
      return true;
    }
    if (this.backend === 'auto') {
      return !this.autoNativeFallbackActivated;
    }
    return false;
  }

  private getShouldUseWorkerByMode(): boolean {
    if (this.mode === 'worker') {
      return true;
    }
    if (this.mode === 'node') {
      return false;
    }
    if (this.shouldPreferWasmPath()) {
      return true;
    }
    return false;
  }

  private getBackendMode(): 'worker' | 'node' {
    if (this.getShouldUseWorkerByMode()) {
      if (!this.workerClient) {
        if (this.mode === 'worker') {
          throw new Error('Worker mode requires a worker client');
        }
        return 'node';
      }
      return 'worker';
    }
    return 'node';
  }

  private getWorkerClient(): KuzuWorkerClient {
    if (!this.workerClient) {
      throw new Error('Worker mode requires a worker client');
    }
    return this.workerClient;
  }

  private getNativeRuntimeOrThrow(): KuzuRuntime {
    if (this.backend === 'wasm') {
      throw new Error('Native kuzu backend is disabled by CODEGB_DB_BACKEND=wasm');
    }
    const runtime = this.loadKuzuRuntime();
    if (runtime) {
      return runtime;
    }
    if (this.backend === 'native') {
      throw new Error('Native kuzu backend is unavailable');
    }
    this.activateAutoFallback('native runtime is unavailable');
    throw new Error('Native kuzu backend is unavailable');
  }

  private activateAutoFallback(reason: unknown): void {
    if (this.backend !== 'auto' || this.autoNativeFallbackActivated) {
      return;
    }
    this.autoNativeFallbackActivated = true;
    if (!hasPrintedAutoFallbackDiagnostic) {
      hasPrintedAutoFallbackDiagnostic = true;
      const detail = reason instanceof Error ? reason.message : String(reason);
      console.warn(
        `[CodeGB] ${DB_BACKEND_ENV_KEY}=auto: wasm backend failed, falling back to native backend (${detail}).`,
      );
    }
  }

  async init(): Promise<void> {
    if (this.getBackendMode() === 'worker') {
      try {
        await this.getWorkerClient().init?.();
        return;
      } catch (error) {
        if (this.backend !== 'auto') {
          throw error;
        }
        this.activateAutoFallback(error);
      }
    }

    await fs.mkdir(this.storagePath, { recursive: true });
    await fs.writeFile(path.join(this.storagePath, SCHEMA_FILE), `${JAVA_SCHEMA_QUERIES.join('\n\n')}\n`, 'utf8');
    if (this.shouldPreferWasmPath()) {
      return;
    }

    try {
      const runtime = this.getNativeRuntimeOrThrow();
      await this.withConnection(runtime, async (connection) => {
        await this.ensureSchema(connection);
      });
    } catch (error) {
      if (this.backend !== 'auto') {
        throw error;
      }
      this.activateAutoFallback(error);
      if (this.getBackendMode() === 'worker') {
        await this.getWorkerClient().init?.();
      }
    }
  }

  async persistGraph(graph: KnowledgeGraph): Promise<void> {
    if (this.getBackendMode() === 'worker') {
      try {
        await this.getWorkerClient().persistGraph(graph);
        return;
      } catch (error) {
        if (this.backend !== 'auto') {
          throw error;
        }
        this.activateAutoFallback(error);
      }
    }

    const payload: PersistedGraph = {
      nodes: graph.nodes,
      relationships: graph.relationships,
    };
    await fs.writeFile(path.join(this.storagePath, GRAPH_FILE), JSON.stringify(payload, null, 2), 'utf8');

    if (this.shouldPreferWasmPath()) {
      return;
    }
    try {
      const runtime = this.getNativeRuntimeOrThrow();
      await this.withConnection(runtime, async (connection) => {
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
          const executeResult = await connection.execute(createSymbol, {
            id: node.id,
            label: node.label,
            name: node.properties.name,
            qualifiedName: node.properties.qualifiedName ?? '',
            filePath: node.properties.filePath,
            payload: JSON.stringify(node.properties),
          });
          this.closeQueryResults(executeResult);
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
          const executeResult = await connection.execute(createRelation, {
            id: rel.id,
            sourceId: rel.sourceId,
            targetId: rel.targetId,
            type: rel.type,
            confidence: rel.confidence,
            reason: rel.reason,
            line: rel.line ?? null,
          });
          this.closeQueryResults(executeResult);
        }
      });
    } catch (error) {
      if (this.backend !== 'auto') {
        throw error;
      }
      this.activateAutoFallback(error);
      if (this.getBackendMode() === 'worker') {
        await this.getWorkerClient().persistGraph(graph);
      }
    }
  }

  async loadGraph(): Promise<KnowledgeGraph> {
    if (this.getBackendMode() === 'worker') {
      try {
        return await this.getWorkerClient().loadGraph();
      } catch (error) {
        if (this.backend !== 'auto') {
          throw error;
        }
        this.activateAutoFallback(error);
      }
    }

    const graph = createKnowledgeGraph();
    if (!this.shouldPreferWasmPath()) {
      try {
        const runtime = this.getNativeRuntimeOrThrow();
        await this.withConnection(runtime, async (connection) => {
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
      } catch (error) {
        if (this.backend === 'native') {
          throw error;
        }
        this.activateAutoFallback(error);
        if (this.getBackendMode() === 'worker') {
          return this.getWorkerClient().loadGraph();
        }
        // Fall through to JSON fallback for backward compatibility.
      }
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
      try {
        return await this.getWorkerClient().executeCypher(query);
      } catch (error) {
        if (this.backend !== 'auto') {
          throw error;
        }
        this.activateAutoFallback(error);
      }
    }

    if (!this.shouldPreferWasmPath()) {
      try {
        const runtime = this.getNativeRuntimeOrThrow();
        return (await this.withConnection(runtime, async (connection) => this.queryAll(connection, query))) as Array<
          Record<string, unknown>
        >;
      } catch (error) {
        if (this.backend === 'native') {
          throw error;
        }
        this.activateAutoFallback(error);
        if (this.getBackendMode() === 'worker') {
          return this.getWorkerClient().executeCypher(query);
        }
      }
    }

    const activeGraph = graph ?? (await this.loadGraph());
    return executeCypherInMemory(activeGraph, query);
  }

  async close(): Promise<void> {
    if (this.getBackendMode() === 'worker') {
      await this.getWorkerClient().close?.();
    }
  }
}

const resolveDbBackend = (value: string | undefined): DbBackend => {
  const normalized = (value ?? process.env[DB_BACKEND_ENV_KEY] ?? 'wasm').trim().toLowerCase();
  if (normalized === 'native' || normalized === 'wasm' || normalized === 'auto') {
    return normalized;
  }
  return 'auto';
};

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
