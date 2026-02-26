import { createKnowledgeGraph } from '../graph/graph';
import type { KnowledgeGraph } from '../types/graph';
import type { KuzuWorkerClient, PersistedGraph } from './kuzu-adapter';

export type WorkerAction = 'init' | 'persistGraph' | 'loadGraph' | 'executeCypher';

interface WorkerRequestMessage {
  type: 'request';
  id: number;
  action: WorkerAction;
  payload?: unknown;
}

interface WorkerSuccessMessage {
  type: 'response';
  id: number;
  ok: true;
  result?: unknown;
}

interface WorkerErrorMessage {
  type: 'response';
  id: number;
  ok: false;
  error: string;
}

type WorkerResponseMessage = WorkerSuccessMessage | WorkerErrorMessage;

type WorkerMessageEvent = { data: unknown };
type WorkerErrorEvent = { message?: string };

export interface WorkerLike {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: 'message' | 'error',
    listener: (event: WorkerMessageEvent | WorkerErrorEvent) => void,
  ) => void;
  removeEventListener: (
    type: 'message' | 'error',
    listener: (event: WorkerMessageEvent | WorkerErrorEvent) => void,
  ) => void;
  terminate?: () => void;
}

export interface WebWorkerKuzuClientOptions {
  worker: WorkerLike;
  requestTimeoutMs?: number;
  terminateOnClose?: boolean;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout?: ReturnType<typeof setTimeout>;
};

const isResponseMessage = (value: unknown): value is WorkerResponseMessage => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<WorkerResponseMessage>;
  return candidate.type === 'response' && typeof candidate.id === 'number' && typeof candidate.ok === 'boolean';
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

export class WebWorkerKuzuClient implements KuzuWorkerClient {
  private readonly worker: WorkerLike;
  private readonly requestTimeoutMs: number;
  private readonly terminateOnClose: boolean;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private closed = false;

  constructor(options: WebWorkerKuzuClientOptions) {
    this.worker = options.worker;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.terminateOnClose = options.terminateOnClose ?? true;
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
  }

  private readonly handleMessage = (event: WorkerMessageEvent | WorkerErrorEvent): void => {
    const data = (event as WorkerMessageEvent).data;
    if (!isResponseMessage(data)) {
      return;
    }

    const request = this.pending.get(data.id);
    if (!request) {
      return;
    }

    this.pending.delete(data.id);
    if (request.timeout) {
      clearTimeout(request.timeout);
    }

    if (data.ok) {
      request.resolve(data.result);
      return;
    }
    request.reject(new Error(data.error || 'Worker request failed'));
  };

  private readonly handleError = (event: WorkerMessageEvent | WorkerErrorEvent): void => {
    const message = (event as WorkerErrorEvent).message ?? 'Worker error';
    this.rejectPending(new Error(message));
  };

  private rejectPending(error: Error): void {
    for (const [id, request] of this.pending) {
      if (request.timeout) {
        clearTimeout(request.timeout);
      }
      request.reject(error);
      this.pending.delete(id);
    }
  }

  private async request(action: WorkerAction, payload?: unknown): Promise<unknown> {
    if (this.closed) {
      throw new Error('WebWorkerKuzuClient is closed');
    }

    const id = this.nextId++;
    const message: WorkerRequestMessage = {
      type: 'request',
      id,
      action,
      payload,
    };

    return new Promise((resolve, reject) => {
      const timeout =
        this.requestTimeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Worker request timed out: ${action}`));
            }, this.requestTimeoutMs)
          : undefined;

      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage(message);
    });
  }

  async init(): Promise<void> {
    await this.request('init');
  }

  async persistGraph(graph: KnowledgeGraph): Promise<void> {
    await this.request('persistGraph', toPersistedGraph(graph));
  }

  async loadGraph(): Promise<KnowledgeGraph> {
    const result = await this.request('loadGraph');
    return toKnowledgeGraph((result ?? { nodes: [], relationships: [] }) as PersistedGraph);
  }

  async executeCypher(query: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.request('executeCypher', { query });
    return (result ?? []) as Array<Record<string, unknown>>;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleError);
    this.rejectPending(new Error('WebWorkerKuzuClient is closed'));
    if (this.terminateOnClose) {
      this.worker.terminate?.();
    }
  }
}
