import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createKuzuWasmWorkerBackend,
  createInMemoryKuzuWorkerBackend,
  installKuzuWorker,
  type WorkerHostLike,
  type WorkerMessageEventLike,
} from '../src/storage/kuzu-worker.ts';

type RequestMessage = {
  type: 'request';
  id: number;
  action: 'init' | 'persistGraph' | 'loadGraph' | 'executeCypher';
  payload?: unknown;
};

class FakeWorkerHost implements WorkerHostLike {
  responses: unknown[] = [];
  private messageHandler?: (event: WorkerMessageEventLike) => void;

  addEventListener(type: 'message', listener: (event: WorkerMessageEventLike) => void): void {
    if (type === 'message') {
      this.messageHandler = listener;
    }
  }

  removeEventListener(): void {
    this.messageHandler = undefined;
  }

  postMessage(message: unknown): void {
    this.responses.push(message);
  }

  async send(message: RequestMessage): Promise<void> {
    await this.messageHandler?.({ data: message });
  }
}

test('worker backend handles init/persist/load/execute lifecycle', async () => {
  const host = new FakeWorkerHost();
  const dispose = installKuzuWorker(host, createInMemoryKuzuWorkerBackend());

  await host.send({ type: 'request', id: 1, action: 'init' });
  await host.send({
    type: 'request',
    id: 2,
    action: 'persistGraph',
    payload: {
      nodes: [
        {
          id: 'class:OrderService',
          label: 'Class',
          properties: { name: 'OrderService', filePath: 'src/OrderService.java' },
        },
      ],
      relationships: [],
    },
  });
  await host.send({ type: 'request', id: 3, action: 'loadGraph' });
  await host.send({
    type: 'request',
    id: 4,
    action: 'executeCypher',
    payload: { query: 'MATCH (n:Class) RETURN n.name LIMIT 5' },
  });

  assert.deepEqual(host.responses[0], { type: 'response', id: 1, ok: true, result: null });
  assert.deepEqual(host.responses[1], { type: 'response', id: 2, ok: true, result: null });
  assert.deepEqual(host.responses[2], {
    type: 'response',
    id: 3,
    ok: true,
    result: {
      nodes: [
        {
          id: 'class:OrderService',
          label: 'Class',
          properties: { name: 'OrderService', filePath: 'src/OrderService.java' },
        },
      ],
      relationships: [],
    },
  });
  assert.deepEqual(host.responses[3], {
    type: 'response',
    id: 4,
    ok: true,
    result: [{ 'n.name': 'OrderService' }],
  });

  dispose();
});

test('worker returns protocol errors for invalid message and unknown action', async () => {
  const host = new FakeWorkerHost();
  const dispose = installKuzuWorker(host, createInMemoryKuzuWorkerBackend());

  await host.send({ type: 'request', id: 10, action: 'init' });
  await host.send({ type: 'request', id: 11, action: 'executeCypher', payload: {} });
  await host.send({ type: 'request', id: 12, action: 'loadGraph' });
  await host.send({ type: 'request', id: 13, action: 'init', payload: { bad: true } });
  await host.send({ type: 'request', id: 14, action: 'init' });
  await host.send({ type: 'request', id: 15, action: 'persistGraph', payload: null });

  await host.send({ type: 'request', id: 16, action: 'init' as any });
  await host.send({ type: 'request', id: 17, action: 'unknown' as any });
  await host.send({ type: 'request', id: 18, action: 'executeCypher', payload: { query: 123 } as any });

  const unknown = host.responses.find((item: any) => item.id === 17) as any;
  assert.equal(unknown.ok, false);
  assert.match(String(unknown.error), /unknown action/i);

  const invalidQuery = host.responses.find((item: any) => item.id === 18) as any;
  assert.equal(invalidQuery.ok, false);
  assert.match(String(invalidQuery.error), /query string/i);

  dispose();
});

test('kuzu-wasm backend persists and loads graph via module APIs', async () => {
  const executedQueries: string[] = [];

  const fakeResult = (rows: Array<Record<string, unknown>>) => ({
    getAllObjects: async () => rows,
    close: async () => undefined,
  });

  const fakeModule = {
    init: async () => undefined,
    setWorkerPath: (_path: string) => undefined,
    Database: class {
      async init() {
        return undefined;
      }
      async close() {
        return undefined;
      }
    },
    Connection: class {
      constructor(_db: unknown) {}
      async init() {
        return undefined;
      }
      async close() {
        return undefined;
      }
      async query(query: string) {
        executedQueries.push(query);
        if (/MATCH \(s:Symbol\) RETURN s/i.test(query)) {
          return fakeResult([
            {
              s: {
                id: 'class:OrderService',
                label: 'Class',
                payload: JSON.stringify({
                  name: 'OrderService',
                  qualifiedName: 'com.demo.OrderService',
                  filePath: 'src/OrderService.java',
                }),
              },
            },
          ]);
        }
        if (/MATCH \(source:Symbol\)-\[r:CodeRelation\]->\(target:Symbol\)/i.test(query)) {
          return fakeResult([
            {
              sourceId: 'class:OrderService',
              targetId: 'method:createOrder',
              id: 'rel:contains',
              type: 'CONTAINS',
              confidence: 1,
              reason: 'contains',
              line: 12,
            },
          ]);
        }
        if (/RETURN n\.name/i.test(query)) {
          return fakeResult([{ 'n.name': 'OrderService' }]);
        }
        return fakeResult([]);
      }
      async prepare(_query: string) {
        return {
          isSuccess: () => true,
          getErrorMessage: async () => '',
          close: async () => undefined,
        };
      }
      async execute() {
        return fakeResult([]);
      }
    },
    FS: {
      mkdir: async (_path: string) => undefined,
      mountIdbfs: async (_path: string) => undefined,
      syncfs: async (_populate: boolean) => undefined,
    },
  };

  const backend = await createKuzuWasmWorkerBackend({
    loadModule: async () => fakeModule as any,
    databasePath: '/codegb/kuzu.db',
  });
  await backend.init();
  await backend.persistGraph({
    nodes: [
      {
        id: 'class:OrderService',
        label: 'Class',
        properties: {
          name: 'OrderService',
          qualifiedName: 'com.demo.OrderService',
          filePath: 'src/OrderService.java',
        },
      },
      {
        id: 'method:createOrder',
        label: 'Method',
        properties: {
          name: 'createOrder',
          qualifiedName: 'com.demo.OrderService.createOrder',
          filePath: 'src/OrderService.java',
        },
      },
    ],
    relationships: [
      {
        id: 'rel:contains',
        sourceId: 'class:OrderService',
        targetId: 'method:createOrder',
        type: 'CONTAINS',
        confidence: 1,
        reason: 'contains',
        line: 12,
      },
    ],
  });
  const loaded = await backend.loadGraph();
  const rows = await backend.executeCypher('MATCH (n:Class) RETURN n.name LIMIT 5');

  assert.equal(loaded.nodes.length, 1);
  assert.equal(loaded.relationships.length, 1);
  assert.deepEqual(rows, [{ 'n.name': 'OrderService' }]);
  assert.ok(executedQueries.some((query) => /MATCH \(n:Symbol\) DETACH DELETE n/i.test(query)));
});
