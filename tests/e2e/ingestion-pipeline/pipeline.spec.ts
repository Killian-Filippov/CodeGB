import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runPipelineFromRepo } from '../../../packages/core/src/ingestion/pipeline.ts';
import { KuzuAdapter } from '../../../packages/core/src/storage/kuzu-adapter.ts';

const tempPaths: string[] = [];

const trackTempPath = (value: string): string => {
  tempPaths.push(value);
  return value;
};

const writeJavaRepo = async (): Promise<{ repoPath: string; storagePath: string; processorFile: string }> => {
  const repoPath = trackTempPath(await fs.mkdtemp(path.join(os.tmpdir(), 'codegb-pipeline-repo-')));
  const storagePath = trackTempPath(await fs.mkdtemp(path.join(os.tmpdir(), 'codegb-pipeline-db-')));
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

  const processorFile = path.join(root, 'PaymentProcessor.java');
  await fs.writeFile(processorFile, `
package com.acme.service;

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

  return { repoPath, storagePath, processorFile };
};

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })),
  );
});

describe('ingestion pipeline e2e', () => {
  it('indexes a Java repository through runPipelineFromRepo and persists the graph', async () => {
    const { repoPath, storagePath } = await writeJavaRepo();

    const result = await runPipelineFromRepo({
      repoPath,
      storagePath,
      projectName: 'pipeline-e2e',
    });

    assert.equal(result.filesIndexed, 3);
    assert.ok(result.persisted);

    const adapter = new KuzuAdapter(storagePath);
    await adapter.init();
    const graph = await adapter.loadGraph();
    await adapter.close();

    const typeNames = graph.nodes
      .filter((node) => ['Class', 'Interface'].includes(node.label))
      .map((node) => node.properties.name);
    assert.ok(typeNames.includes('Auditable'));
    assert.ok(typeNames.includes('BaseService'));
    assert.ok(typeNames.includes('PaymentProcessor'));
    assert.ok(typeNames.includes('Runnable'));

    const callTargets = graph.relationships
      .filter((rel) => rel.type === 'CALLS')
      .map((rel) => graph.getNode(rel.targetId)?.properties.name)
      .filter((value): value is string => Boolean(value))
      .sort();
    assert.deepEqual(callTargets, ['BaseService', 'BaseService', 'PaymentProcessor', 'charge', 'logCharge', 'processPayment']);

    const implementsEdge = graph.relationships.find((rel) => {
      if (rel.type !== 'IMPLEMENTS') {
        return false;
      }
      return graph.getNode(rel.sourceId)?.properties.name === 'PaymentProcessor';
    });
    assert.ok(implementsEdge);
  });

  it('reindexes changed files incrementally through the real pipeline entrypoint', async () => {
    const { repoPath, storagePath, processorFile } = await writeJavaRepo();

    await runPipelineFromRepo({
      repoPath,
      storagePath,
      projectName: 'pipeline-e2e',
    });

    await fs.writeFile(processorFile, `
package com.acme.service;

import com.acme.model.Invoice;

public class PaymentProcessor extends BaseService implements Runnable, Auditable {
  private String gateway;

  public void charge(Invoice invoice) {
    processPayment();
    notifyOps();
  }

  private void notifyOps() {}

  @Override
  public void run() {
    charge(null);
  }

  @Override
  public void audit() {}
}
`);

    const result = await runPipelineFromRepo({
      repoPath,
      storagePath,
      projectName: 'pipeline-e2e',
      incremental: true,
      includeFilePaths: [processorFile],
      changedFilePaths: [processorFile],
    });

    assert.equal(result.filesIndexed, 1);

    const adapter = new KuzuAdapter(storagePath);
    await adapter.init();
    const graph = await adapter.loadGraph();
    await adapter.close();
    const methodNames = graph.nodes
      .filter(
        (node) =>
          ['Method', 'Constructor'].includes(node.label) &&
          node.properties.className === 'PaymentProcessor',
      )
      .map((node) => node.properties.name)
      .sort();

    assert.ok(methodNames.includes('notifyOps'));
    assert.ok(!methodNames.includes('logCharge'));
  });
});
