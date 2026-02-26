import { createKnowledgeGraph } from '../graph/graph';
import type { KnowledgeGraph } from '../types/graph';
import { executeCypherInMemory, type PersistedGraph } from './kuzu-adapter';
import { JAVA_SCHEMA_QUERIES } from './schema';

export type WorkerAction = 'init' | 'persistGraph' | 'loadGraph' | 'executeCypher';

export type WorkerRequestMessage = {
  type: 'request';
  id: number;
  action: WorkerAction;
  payload?: unknown;
};

export type WorkerResponseMessage =
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: string };

export type WorkerMessageEventLike = { data: unknown };

export interface WorkerHostLike {
  addEventListener: (type: 'message', listener: (event: WorkerMessageEventLike) => void | Promise<void>) => void;
  removeEventListener: (type: 'message', listener: (event: WorkerMessageEventLike) => void | Promise<void>) => void;
  postMessage: (message: WorkerResponseMessage) => void;
}

export interface KuzuWorkerBackend {
  init: () => Promise<void>;
  persistGraph: (graph: PersistedGraph) => Promise<void>;
  loadGraph: () => Promise<PersistedGraph>;
  executeCypher: (query: string) => Promise<Array<Record<string, unknown>>>;
}

type KuzuWasmQueryResult = {
  getAllObjects?: () => Promise<Array<Record<string, unknown>>>;
  getAll?: () => Promise<Array<Record<string, unknown>>>;
  close?: () => Promise<void>;
};

type KuzuWasmPreparedStatement = {
  isSuccess: () => boolean;
  getErrorMessage?: () => Promise<string>;
  close?: () => Promise<void>;
};

type KuzuWasmConnection = {
  init: () => Promise<void>;
  close: () => Promise<void>;
  query: (query: string) => Promise<KuzuWasmQueryResult>;
  prepare: (query: string) => Promise<KuzuWasmPreparedStatement>;
  execute: (
    statement: KuzuWasmPreparedStatement,
    params?: Record<string, unknown>,
  ) => Promise<KuzuWasmQueryResult>;
};

type KuzuWasmDatabase = {
  init: () => Promise<void>;
  close: () => Promise<void>;
};

type KuzuWasmFS = {
  mkdir?: (path: string) => Promise<void>;
  mountIdbfs?: (path: string) => Promise<void>;
  syncfs?: (populate: boolean) => Promise<void>;
};

export interface KuzuWasmModule {
  init: () => Promise<void>;
  setWorkerPath?: (path: string) => void;
  Database: new (
    databasePath?: string,
    bufferPoolSize?: number,
    maxNumThreads?: number,
    enableCompression?: boolean,
    readOnly?: boolean,
    autoCheckpoint?: boolean,
    checkpointThreshold?: number,
  ) => KuzuWasmDatabase;
  Connection: new (database: KuzuWasmDatabase, numThreads?: number | null) => KuzuWasmConnection;
  FS?: KuzuWasmFS;
}

export interface KuzuWasmWorkerBackendOptions {
  loadModule?: () => Promise<KuzuWasmModule>;
  databasePath?: string;
  workerPath?: string;
  idbfsPath?: string;
  useIdbfs?: boolean;
}

const isRequest = (message: unknown): message is WorkerRequestMessage => {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const candidate = message as Partial<WorkerRequestMessage>;
  return candidate.type === 'request' && typeof candidate.id === 'number' && typeof candidate.action === 'string';
};

const toPersistedGraph = (graph: KnowledgeGraph): PersistedGraph => ({
  nodes: graph.nodes,
  relationships: graph.relationships,
});

const toKnowledgeGraph = (persisted: PersistedGraph): KnowledgeGraph => {
  const graph = createKnowledgeGraph();
  persisted.nodes.forEach((node) => graph.addNode(node));
  persisted.relationships.forEach((rel) => graph.addRelationship(rel));
  return graph;
};

const ensurePersistedGraph = (payload: unknown): PersistedGraph => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('persistGraph requires a graph payload');
  }
  const graph = payload as Partial<PersistedGraph>;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.relationships)) {
    throw new Error('persistGraph requires nodes and relationships arrays');
  }
  return {
    nodes: graph.nodes as PersistedGraph['nodes'],
    relationships: graph.relationships as PersistedGraph['relationships'],
  };
};

const ensureCypherQuery = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('executeCypher requires a payload object');
  }
  const query = (payload as { query?: unknown }).query;
  if (typeof query !== 'string' || query.length === 0) {
    throw new Error('executeCypher requires a query string');
  }
  return query;
};

export const createInMemoryKuzuWorkerBackend = (): KuzuWorkerBackend => {
  let graph = createKnowledgeGraph();
  return {
    async init() {
      // No-op for in-memory backend.
    },
    async persistGraph(persistedGraph) {
      graph = toKnowledgeGraph(persistedGraph);
    },
    async loadGraph() {
      return toPersistedGraph(graph);
    },
    async executeCypher(query) {
      return executeCypherInMemory(graph, query);
    },
  };
};

const defaultLoadKuzuWasmModule = async (): Promise<KuzuWasmModule> => {
  const module = (await import('kuzu-wasm')) as { default?: KuzuWasmModule };
  const kuzuWasm = module.default;
  if (!kuzuWasm) {
    throw new Error('Failed to load kuzu-wasm module');
  }
  return kuzuWasm;
};

const closeResult = async (result: KuzuWasmQueryResult): Promise<void> => {
  await result.close?.();
};

const resultToRows = async (result: KuzuWasmQueryResult): Promise<Array<Record<string, unknown>>> => {
  if (result.getAllObjects) {
    return result.getAllObjects();
  }
  if (result.getAll) {
    return result.getAll();
  }
  throw new Error('Unsupported kuzu-wasm query result shape');
};

export const createKuzuWasmWorkerBackend = async (
  options: KuzuWasmWorkerBackendOptions = {},
): Promise<KuzuWorkerBackend> => {
  const loadModule = options.loadModule ?? defaultLoadKuzuWasmModule;
  const databasePath = options.databasePath ?? '/codegb/kuzu.db';
  const idbfsPath = options.idbfsPath ?? '/codegb';
  const useIdbfs = options.useIdbfs ?? true;

  const kuzu = await loadModule();
  if (options.workerPath) {
    kuzu.setWorkerPath?.(options.workerPath);
  }
  await kuzu.init();

  if (useIdbfs && kuzu.FS?.mountIdbfs && kuzu.FS?.syncfs) {
    try {
      await kuzu.FS.mkdir?.(idbfsPath);
    } catch {
      // Directory may already exist.
    }
    await kuzu.FS.mountIdbfs(idbfsPath);
    await kuzu.FS.syncfs(true);
  }

  let database: KuzuWasmDatabase | null = null;
  let connection: KuzuWasmConnection | null = null;
  let initialized = false;

  const getConnection = (): KuzuWasmConnection => {
    if (!connection) {
      throw new Error('kuzu-wasm backend is not initialized');
    }
    return connection;
  };

  const ensureSchema = async (): Promise<void> => {
    const activeConnection = getConnection();
    for (const query of JAVA_SCHEMA_QUERIES) {
      try {
        const result = await activeConnection.query(query);
        await closeResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already exists/i.test(message)) {
          throw error;
        }
      }
    }
  };

  const syncToPersistentStorage = async (): Promise<void> => {
    if (useIdbfs && kuzu.FS?.syncfs) {
      await kuzu.FS.syncfs(false);
    }
  };

  const ensureInitialized = async (): Promise<void> => {
    if (initialized) {
      return;
    }
    database = new kuzu.Database(databasePath);
    connection = new kuzu.Connection(database);
    await database.init();
    await connection.init();
    await ensureSchema();
    initialized = true;
  };

  return {
    async init() {
      await ensureInitialized();
    },
    async persistGraph(graph) {
      await ensureInitialized();
      const activeConnection = getConnection();
      const clearResult = await activeConnection.query('MATCH (n:Symbol) DETACH DELETE n');
      await closeResult(clearResult);

      const createSymbol = await activeConnection.prepare(
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
        const errorMessage = (await createSymbol.getErrorMessage?.()) ?? 'Failed to prepare symbol statement';
        throw new Error(errorMessage);
      }

      for (const node of graph.nodes) {
        const result = await activeConnection.execute(createSymbol, {
          id: node.id,
          label: node.label,
          name: node.properties.name,
          qualifiedName: node.properties.qualifiedName ?? '',
          filePath: node.properties.filePath,
          payload: JSON.stringify(node.properties),
        });
        await closeResult(result);
      }
      await createSymbol.close?.();

      const createRelation = await activeConnection.prepare(
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
        const errorMessage = (await createRelation.getErrorMessage?.()) ?? 'Failed to prepare relation statement';
        throw new Error(errorMessage);
      }

      for (const rel of graph.relationships) {
        const result = await activeConnection.execute(createRelation, {
          id: rel.id,
          sourceId: rel.sourceId,
          targetId: rel.targetId,
          type: rel.type,
          confidence: rel.confidence,
          reason: rel.reason,
          line: rel.line ?? null,
        });
        await closeResult(result);
      }
      await createRelation.close?.();
      await syncToPersistentStorage();
    },
    async loadGraph() {
      await ensureInitialized();
      const activeConnection = getConnection();

      const nodesResult = await activeConnection.query('MATCH (s:Symbol) RETURN s');
      const nodeRows = await resultToRows(nodesResult);
      await closeResult(nodesResult);

      const relationshipsResult = await activeConnection.query(
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
      const relationshipRows = await resultToRows(relationshipsResult);
      await closeResult(relationshipsResult);

      return {
        nodes: nodeRows.flatMap((row) => {
          const raw = row.s as Record<string, unknown> | undefined;
          if (!raw) {
            return [];
          }
          const payload =
            typeof raw.payload === 'string'
              ? (JSON.parse(raw.payload) as PersistedGraph['nodes'][number]['properties'])
              : {
                  name: String(raw.name ?? ''),
                  filePath: String(raw.filePath ?? ''),
                };
          return [
            {
              id: String(raw.id),
              label: String(raw.label) as PersistedGraph['nodes'][number]['label'],
              properties: payload,
            },
          ];
        }),
        relationships: relationshipRows.map((row) => ({
          id: String(row.id),
          sourceId: String(row.sourceId),
          targetId: String(row.targetId),
          type: String(row.type) as PersistedGraph['relationships'][number]['type'],
          confidence: Number(row.confidence ?? 1),
          reason: String(row.reason ?? ''),
          line: typeof row.line === 'number' ? row.line : undefined,
        })),
      };
    },
    async executeCypher(query) {
      await ensureInitialized();
      const result = await getConnection().query(query);
      const rows = await resultToRows(result);
      await closeResult(result);
      return rows;
    },
  };
};

export const installKuzuWorker = (host: WorkerHostLike, backend: KuzuWorkerBackend): (() => void) => {
  const onMessage = async (event: WorkerMessageEventLike): Promise<void> => {
    const message = event.data;
    if (!isRequest(message)) {
      return;
    }

    const respond = (response: WorkerResponseMessage): void => {
      host.postMessage(response);
    };

    try {
      switch (message.action) {
        case 'init':
          await backend.init();
          respond({ type: 'response', id: message.id, ok: true, result: null });
          return;
        case 'persistGraph':
          await backend.persistGraph(ensurePersistedGraph(message.payload));
          respond({ type: 'response', id: message.id, ok: true, result: null });
          return;
        case 'loadGraph':
          respond({ type: 'response', id: message.id, ok: true, result: await backend.loadGraph() });
          return;
        case 'executeCypher':
          respond({
            type: 'response',
            id: message.id,
            ok: true,
            result: await backend.executeCypher(ensureCypherQuery(message.payload)),
          });
          return;
        default:
          respond({
            type: 'response',
            id: message.id,
            ok: false,
            error: `Unknown action: ${String(message.action)}`,
          });
      }
    } catch (error) {
      respond({
        type: 'response',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  host.addEventListener('message', onMessage);
  return () => {
    host.removeEventListener('message', onMessage);
  };
};
