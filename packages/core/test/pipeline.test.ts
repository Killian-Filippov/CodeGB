import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runPipelineFromRepo } from '../src/ingestion/pipeline.ts';
import {
  __resetJavaParserRuntimeForTests,
  __setJavaParserRuntimeForTests,
} from '../src/parser/parser-loader.ts';

async function makeRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'javakg-repo-'));
  const root = path.join(repoPath, 'src', 'main', 'java', 'com', 'acme', 'service');
  await fs.mkdir(root, { recursive: true });

  await fs.writeFile(path.join(root, 'Auditable.java'), `
package com.acme.service;
public interface Auditable {
  void audit();
}
`);

  await fs.writeFile(path.join(root, 'BaseService.java'), `
package com.acme.service;
public class BaseService {
  public BaseService() {}
  public BaseService(int seed) {}
  protected void processPayment() {}
}
`);

  await fs.writeFile(path.join(root, 'PaymentProcessor.java'), `
package com.acme.service;
import java.util.List;
import com.acme.model.Invoice;
public class PaymentProcessor extends BaseService implements Runnable, Auditable {
  private String gateway;
  public PaymentProcessor() {
    this(1);
  }
  public PaymentProcessor(int seed) {
    super(seed);
    BaseService helper = new BaseService(seed);
  }
  public void charge(Invoice invoice) {
    processPayment();
    logCharge();
  }
  private void logCharge() {}
  @Override
  public void run() {
    charge(null);
  }
  @Override
  public void audit() {}
}
`);

  return repoPath;
}

test('runPipelineFromRepo builds Java graph with key relations', async () => {
  const repoPath = await makeRepo();
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'javakg-db-'));

  const result = await runPipelineFromRepo({
    repoPath,
    storagePath,
    projectName: 'demo',
  });

  const labels = new Set(result.graph.nodes.map((node) => node.label));
  assert.ok(labels.has('Project'));
  assert.ok(labels.has('Package'));
  assert.ok(labels.has('File'));
  assert.ok(labels.has('Class'));
  assert.ok(labels.has('Interface'));
  assert.ok(labels.has('Method'));
  assert.ok(labels.has('Field'));

  const relTypes = new Set(result.graph.relationships.map((rel) => rel.type));
  assert.ok(relTypes.has('CONTAINS'));
  assert.ok(relTypes.has('IMPORTS'));
  assert.ok(relTypes.has('EXTENDS'));
  assert.ok(relTypes.has('IMPLEMENTS'));
  assert.ok(relTypes.has('CALLS'));

  const classNames = result.graph.nodes
    .filter((node) => node.label === 'Class' || node.label === 'Interface')
    .map((node) => node.properties.name);

  assert.ok(classNames.includes('PaymentProcessor'));
  assert.ok(classNames.includes('BaseService'));
  assert.ok(classNames.includes('Auditable'));

  const callEdges = result.graph.relationships.filter((rel) => rel.type === 'CALLS');
  assert.ok(callEdges.length > 0);
  assert.ok(callEdges.every((rel) => rel.confidence !== 0.9));
  assert.ok(callEdges.every((rel) => rel.reason.includes('strategy=')));
  assert.ok(callEdges.every((rel) => Number.isInteger(rel.line)));
  const constructorCallEdges = callEdges.filter((rel) => {
    const target = result.graph.getNode(rel.targetId);
    return target?.label === 'Constructor';
  });
  assert.ok(constructorCallEdges.length >= 2);

  assert.ok(result.persisted);
});

test('runPipelineFromRepo falls back to regex extraction when tree-sitter parsing fails', async (t) => {
  t.after(() => {
    __resetJavaParserRuntimeForTests();
  });

  const repoPath = await makeRepo();
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'javakg-db-fallback-'));

  __setJavaParserRuntimeForTests({
    engine: 'tree-sitter',
    available: true,
    language: {},
    createParser: () => ({
      setLanguage: () => undefined,
      parse: () => {
        throw new Error('synthetic tree-sitter failure');
      },
    }),
    createQuery: () => ({
      captures: () => [],
    }),
  });

  const result = await runPipelineFromRepo({
    repoPath,
    storagePath,
    projectName: 'fallback-demo',
  });

  const paymentProcessor = result.graph.nodes.find(
    (node) => node.label === 'Class' && node.properties.name === 'PaymentProcessor',
  );
  assert.ok(paymentProcessor);

  const callEdges = result.graph.relationships.filter((rel) => rel.type === 'CALLS');
  assert.ok(callEdges.length > 0);
});
