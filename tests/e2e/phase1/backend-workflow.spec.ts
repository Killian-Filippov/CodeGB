import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import { createKnowledgeGraph } from '../../../packages/core/src/graph/graph.js';
import { KuzuAdapter, type KuzuWorkerClient } from '../../../packages/core/src/storage/kuzu-adapter.js';
import { getFixture } from '../fixtures/java-fixtures.js';
import { CLIPO } from '../page-objects/cli-po.js';

const DB_BACKEND_ENV_KEY = 'CODEGB_DB_BACKEND';

const createRepoWithFixture = async (fixtureName: Parameters<typeof getFixture>[0]): Promise<string> => {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-backend-repo-'));
  const srcDir = path.join(repoPath, 'src/main/java/com/example');
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, 'UserService.java'), getFixture(fixtureName));
  return repoPath;
};

const runCliWorkflow = async (options: {
  cli: CLIPO;
  repoPath: string;
  dbPath: string;
  backend: 'auto' | 'wasm' | 'native';
  searchTerm: string;
}): Promise<{
  init: Awaited<ReturnType<CLIPO['init']>>;
  index: Awaited<ReturnType<CLIPO['index']>>;
  query: Awaited<ReturnType<CLIPO['query']>>;
}> => {
  const env = { [DB_BACKEND_ENV_KEY]: options.backend };
  const init = await options.cli.init({
    repoPath: options.repoPath,
    dbPath: options.dbPath,
    env,
  });
  const index = await options.cli.index({
    repoPath: options.repoPath,
    dbPath: options.dbPath,
    env,
  });
  const query = await options.cli.query({
    searchTerm: options.searchTerm,
    dbPath: options.dbPath,
    limit: 10,
    env,
  });
  return { init, index, query };
};

describe('Phase 1 Backend E2E', () => {
  const cleanupPaths: string[] = [];

  after(async () => {
    await Promise.all(
      cleanupPaths.map(async (target) => {
        await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
      }),
    );
  });

  it('auto mode falls back to native path when wasm worker init fails', async () => {
    const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'java-kg-auto-fallback-'));
    cleanupPaths.push(storagePath);

    const graph = createKnowledgeGraph();
    graph.addNode({
      id: 'class:UserService',
      label: 'Class',
      properties: {
        name: 'UserService',
        qualifiedName: 'com.example.UserService',
        filePath: 'src/main/java/com/example/UserService.java',
      },
    });

    let workerInitAttempts = 0;
    const workerClient: KuzuWorkerClient = {
      async init() {
        workerInitAttempts += 1;
        throw new Error('simulated wasm init failure');
      },
      async persistGraph() {
        throw new Error('worker should not be used after fallback');
      },
      async loadGraph() {
        throw new Error('worker should not be used after fallback');
      },
      async executeCypher() {
        throw new Error('worker should not be used after fallback');
      },
    };

    const warns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
      warns.push(String(message ?? ''));
    };

    try {
      const adapter = new KuzuAdapter(storagePath, {
        mode: 'auto',
        dbBackend: 'auto',
        workerClient,
        loadKuzuRuntime: () => null,
      });

      await adapter.init();
      await adapter.persistGraph(graph);
      const rows = await adapter.executeCypher('MATCH (n:Class) RETURN n.name LIMIT 5');

      assert.equal(workerInitAttempts, 1);
      assert.ok(warns.some((item) => item.includes('falling back to native backend')));
      assert.deepEqual(rows, [{ 'n.name': 'UserService' }]);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('wasm backend supports full init/index/query workflow', async () => {
    const repoPath = await createRepoWithFixture('serviceClass');
    const dbPath = path.join(os.tmpdir(), `java-kg-wasm-db-${Date.now()}`);
    cleanupPaths.push(repoPath, dbPath);

    const cli = new CLIPO('packages/cli/dist/index.js', dbPath);
    const result = await runCliWorkflow({
      cli,
      repoPath,
      dbPath,
      backend: 'wasm',
      searchTerm: 'UserService',
    });

    assert.equal(result.init.success, true, result.init.stderr);
    assert.equal(result.index.success, true, result.index.stderr);
    assert.equal(result.query.success, true, result.query.stderr);
    assert.match(result.index.stdout, /Indexed files:\s*1/i);

    const parsed = cli.parseQueryResults(result.query.stdout);
    const hasUserService = parsed.some((item) => item.name === 'UserService' && item.type === 'Class');
    assert.equal(hasUserService, true, `Unexpected query output: ${result.query.stdout}`);
  });

  it('core fields stay consistent after switching backend', async () => {
    const repoPath = await createRepoWithFixture('serviceClass');
    const wasmDbPath = path.join(os.tmpdir(), `java-kg-wasm-consistency-${Date.now()}`);
    const nativeDbPath = path.join(os.tmpdir(), `java-kg-native-consistency-${Date.now()}`);
    cleanupPaths.push(repoPath, wasmDbPath, nativeDbPath);

    const cli = new CLIPO('packages/cli/dist/index.js');
    const queryTerm = 'Service';

    const wasmRun = await runCliWorkflow({
      cli,
      repoPath,
      dbPath: wasmDbPath,
      backend: 'wasm',
      searchTerm: queryTerm,
    });
    assert.equal(wasmRun.init.success, true, wasmRun.init.stderr);
    assert.equal(wasmRun.index.success, true, wasmRun.index.stderr);
    assert.equal(wasmRun.query.success, true, wasmRun.query.stderr);

    const nativeRun = await runCliWorkflow({
      cli,
      repoPath,
      dbPath: nativeDbPath,
      backend: 'native',
      searchTerm: queryTerm,
    });
    assert.equal(nativeRun.init.success, true, nativeRun.init.stderr);
    assert.equal(nativeRun.index.success, true, nativeRun.index.stderr);
    assert.equal(nativeRun.query.success, true, nativeRun.query.stderr);

    const normalize = (stdout: string): string[] =>
      cli
        .parseQueryResults(stdout)
        .map((item) => `${item.name}|${item.type}|${item.file ?? ''}`)
        .sort();

    const wasmCoreFields = normalize(wasmRun.query.stdout);
    const nativeCoreFields = normalize(nativeRun.query.stdout);

    assert.ok(wasmCoreFields.length > 0, 'wasm query should return at least one result');
    assert.deepEqual(nativeCoreFields, wasmCoreFields);
  });
});
