import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createKnowledgeGraph } from '../src/graph/graph.ts';
import {
  KuzuAdapter,
  type KuzuWorkerClient,
} from '../src/storage/kuzu-adapter.ts';

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

test('auto mode prefers worker backend when worker client is provided', async () => {
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
