import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createKnowledgeGraph } from '../src/graph/graph.ts';
import {
  WebWorkerKuzuClient,
  type WorkerLike,
} from '../src/storage/web-worker-kuzu-client.ts';

type FakeMessage = { type: 'request'; id: number; action: string; payload?: unknown };

class FakeWorker implements WorkerLike {
  sent: FakeMessage[] = [];
  private messageListeners = new Set<(event: { data: unknown }) => void>();
  private errorListeners = new Set<(event: { message?: string }) => void>();
  terminated = false;

  postMessage(message: unknown): void {
    this.sent.push(message as FakeMessage);
  }

  addEventListener(
    type: 'message' | 'error',
    listener: ((event: { data: unknown }) => void) | ((event: { message?: string }) => void),
  ): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (event: { data: unknown }) => void);
      return;
    }
    this.errorListeners.add(listener as (event: { message?: string }) => void);
  }

  removeEventListener(
    type: 'message' | 'error',
    listener: ((event: { data: unknown }) => void) | ((event: { message?: string }) => void),
  ): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (event: { data: unknown }) => void);
      return;
    }
    this.errorListeners.delete(listener as (event: { message?: string }) => void);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitResponse(data: unknown): void {
    for (const listener of this.messageListeners) {
      listener({ data });
    }
  }

  emitError(message: string): void {
    for (const listener of this.errorListeners) {
      listener({ message });
    }
  }
}

test('routes out-of-order worker responses to matching pending requests', async () => {
  const worker = new FakeWorker();
  const client = new WebWorkerKuzuClient({ worker, requestTimeoutMs: 1000 });

  const first = client.executeCypher('MATCH (a) RETURN a LIMIT 1');
  const second = client.executeCypher('MATCH (b) RETURN b LIMIT 1');

  const firstId = worker.sent[0]?.id;
  const secondId = worker.sent[1]?.id;
  assert.equal(typeof firstId, 'number');
  assert.equal(typeof secondId, 'number');

  worker.emitResponse({ type: 'response', id: secondId, ok: true, result: [{ id: 'second' }] });
  worker.emitResponse({ type: 'response', id: firstId, ok: true, result: [{ id: 'first' }] });

  assert.deepEqual(await first, [{ id: 'first' }]);
  assert.deepEqual(await second, [{ id: 'second' }]);
});

test('converts loadGraph payload into KnowledgeGraph instance', async () => {
  const worker = new FakeWorker();
  const client = new WebWorkerKuzuClient({ worker, requestTimeoutMs: 1000 });

  const loadPromise = client.loadGraph();
  const request = worker.sent[0];
  assert.equal(request?.action, 'loadGraph');

  worker.emitResponse({
    type: 'response',
    id: request?.id,
    ok: true,
    result: {
      nodes: [
        {
          id: 'class:PaymentService',
          label: 'Class',
          properties: { name: 'PaymentService', filePath: 'src/PaymentService.java' },
        },
      ],
      relationships: [],
    },
  });

  const graph = await loadPromise;
  assert.equal(graph.nodeCount, 1);
  assert.equal(graph.nodes[0]?.properties.name, 'PaymentService');
});

test('propagates worker errors and close tears down pending requests', async () => {
  const worker = new FakeWorker();
  const client = new WebWorkerKuzuClient({ worker, requestTimeoutMs: 1000 });

  const rejected = client.executeCypher('MATCH (n) RETURN n LIMIT 1');
  const request = worker.sent[0];
  worker.emitResponse({ type: 'response', id: request?.id, ok: false, error: 'bad query' });
  await assert.rejects(rejected, /bad query/i);

  const pending = client.init();
  await client.close();
  await assert.rejects(pending, /closed/i);
  await assert.rejects(client.init(), /closed/i);
  assert.equal(worker.terminated, true);
});

test('persistGraph sends serialized graph payload', async () => {
  const worker = new FakeWorker();
  const client = new WebWorkerKuzuClient({ worker, requestTimeoutMs: 1000 });
  const graph = createKnowledgeGraph();
  graph.addNode({
    id: 'method:pay',
    label: 'Method',
    properties: {
      name: 'pay',
      filePath: 'src/PaymentService.java',
      qualifiedName: 'PaymentService.pay',
    },
  });

  const persisting = client.persistGraph(graph);
  const request = worker.sent[0];
  assert.equal(request?.action, 'persistGraph');
  assert.equal((request?.payload as { nodes: unknown[] })?.nodes.length, 1);

  worker.emitResponse({ type: 'response', id: request?.id, ok: true, result: null });
  await persisting;
});
