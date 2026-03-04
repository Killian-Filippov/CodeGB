import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createKnowledgeGraph } from '../src/graph/graph.ts';
import {
  KuzuAdapter,
  __resetKuzuAdapterDiagnosticsForTests,
  type KuzuWorkerClient,
} from '../src/storage/kuzu-adapter.ts';

const withEnv = async <T>(key: string, value: string | undefined, run: () => Promise<T>): Promise<T> => {
  const previous = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
};

function buildGraph() {
  const graph = createKnowledgeGraph();
  graph.addNode({
    id: 'class:UserService',
    label: 'Class',
    properties: {
      name: 'UserService',
      qualifiedName: 'com.demo.UserService',
      filePath: 'src/main/java/com/demo/UserService.java',
    },
  });
  graph.addNode({
    id: 'method:getUser',
    label: 'Method',
    properties: {
      name: 'getUser',
      qualifiedName: 'com.demo.UserService.getUser',
      filePath: 'src/main/java/com/demo/UserService.java',
    },
  });
  graph.addRelationship({
    id: 'rel:contains',
    sourceId: 'class:UserService',
    targetId: 'method:getUser',
    type: 'CONTAINS',
    confidence: 1,
    reason: 'class contains method',
  });
  return graph;
}

test('wasm backend prefers worker when worker client is provided', async () => {
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'kuzu-worker-auto-'));
  const graph = buildGraph();

  let initialized = false;
  let persisted = false;
  let queried = false;
  let graphInWorker = createKnowledgeGraph();

  const workerClient: KuzuWorkerClient = {
    async init() {
      initialized = true;
    },
    async persistGraph(next) {
      persisted = true;
      graphInWorker = next;
    },
    async loadGraph() {
      return graphInWorker;
    },
    async executeCypher(query) {
      queried = true;
      assert.match(query, /MATCH/i);
      return [{ source: 'worker' }];
    },
  };

  const adapter = new KuzuAdapter(storagePath, {
    mode: 'auto',
    dbBackend: 'wasm',
    workerClient,
    loadKuzuRuntime: () => null,
  });

  await adapter.init();
  await adapter.persistGraph(graph);
  const loaded = await adapter.loadGraph();
  const rows = await adapter.executeCypher('MATCH (s:Class) RETURN s LIMIT 1');

  assert.equal(initialized, true);
  assert.equal(persisted, true);
  assert.equal(queried, true);
  assert.equal(loaded.nodeCount, graph.nodeCount);
  assert.deepEqual(rows, [{ source: 'worker' }]);
});

test('node mode keeps compatibility shell when kuzu runtime is unavailable', async () => {
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'kuzu-node-shell-'));
  const graph = buildGraph();

  const adapter = new KuzuAdapter(storagePath, {
    mode: 'node',
    dbBackend: 'wasm',
    loadKuzuRuntime: () => null,
  });

  await adapter.init();
  await adapter.persistGraph(graph);
  const loaded = await adapter.loadGraph();
  const rows = await adapter.executeCypher('MATCH (n:Class) RETURN n.name LIMIT 5');

  assert.equal(loaded.nodeCount, graph.nodeCount);
  assert.equal(loaded.relationshipCount, graph.relationshipCount);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.['n.name'], 'UserService');
});

test('worker mode without worker client fails fast', async () => {
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'kuzu-worker-required-'));
  const adapter = new KuzuAdapter(storagePath, { mode: 'worker' });

  await assert.rejects(adapter.init(), /worker client/i);
});

test('CODEGB_DB_BACKEND=wasm forces worker backend when worker client is provided', async () => {
  await withEnv('CODEGB_DB_BACKEND', 'wasm', async () => {
    const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'kuzu-backend-wasm-'));
    const graph = buildGraph();
    let nativeLoadCount = 0;
    let workerPersisted = false;

    const workerClient: KuzuWorkerClient = {
      async persistGraph() {
        workerPersisted = true;
      },
      async loadGraph() {
        return graph;
      },
      async executeCypher() {
        return [{ source: 'worker' }];
      },
    };

    const adapter = new KuzuAdapter(storagePath, {
      workerClient,
      loadKuzuRuntime: () => {
        nativeLoadCount += 1;
        return null;
      },
    });

    await adapter.init();
    await adapter.persistGraph(graph);
    const rows = await adapter.executeCypher('MATCH (s:Class) RETURN s LIMIT 1');

    assert.equal(nativeLoadCount, 0);
    assert.equal(workerPersisted, true);
    assert.deepEqual(rows, [{ source: 'worker' }]);
  });
});

test('CODEGB_DB_BACKEND=auto prefers native and falls back once with one-time diagnostic', async () => {
  await withEnv('CODEGB_DB_BACKEND', 'auto', async () => {
    __resetKuzuAdapterDiagnosticsForTests();
    const warnMessages: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
      warnMessages.push(String(message ?? ''));
    };

    try {
      const graph = buildGraph();
      let workerInitCalls = 0;

      const makeWorker = (): KuzuWorkerClient => ({
        async init() {
          workerInitCalls += 1;
        },
        async persistGraph() {
          return;
        },
        async loadGraph() {
          return graph;
        },
        async executeCypher() {
          return [{ source: 'worker' }];
        },
      });

      const storagePath1 = await fs.mkdtemp(path.join(os.tmpdir(), 'kuzu-backend-auto-1-'));
      const adapter1 = new KuzuAdapter(storagePath1, {
        workerClient: makeWorker(),
        loadKuzuRuntime: () => null,
      });
      await adapter1.init();
      const rows1 = await adapter1.executeCypher('MATCH (s:Class) RETURN s LIMIT 1');

      const storagePath2 = await fs.mkdtemp(path.join(os.tmpdir(), 'kuzu-backend-auto-2-'));
      const adapter2 = new KuzuAdapter(storagePath2, {
        workerClient: makeWorker(),
        loadKuzuRuntime: () => null,
      });
      await adapter2.init();
      const rows2 = await adapter2.executeCypher('MATCH (s:Class) RETURN s LIMIT 1');

      assert.equal(workerInitCalls, 2);
      assert.deepEqual(rows1, [{ source: 'worker' }]);
      assert.deepEqual(rows2, [{ source: 'worker' }]);
      assert.equal(warnMessages.length, 1);
      assert.match(warnMessages[0] ?? '', /CODEGB_DB_BACKEND=auto/i);
      assert.match(warnMessages[0] ?? '', /falling back to wasm/i);
    } finally {
      console.warn = originalWarn;
    }
  });
});
