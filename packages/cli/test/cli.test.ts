import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runCli } from '../src/index.ts';

async function makeRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'javakg-cli-repo-'));
  const srcPath = path.join(repoPath, 'src');
  await fs.mkdir(srcPath, { recursive: true });

  await fs.writeFile(path.join(srcPath, 'PaymentProcessor.java'), `
package com.acme;
public class PaymentProcessor {
  public void chargePayment() {}
}
`);

  return repoPath;
}

test('CLI supports init/index/query commands', async () => {
  const repoPath = await makeRepo();
  const storagePath = path.join(repoPath, '.javakg');

  const initResult = await runCli(['init', repoPath, '--storage', storagePath]);
  assert.equal(initResult.exitCode, 0);

  const indexResult = await runCli(['index', repoPath, '--storage', storagePath]);
  assert.equal(indexResult.exitCode, 0);
  assert.match(indexResult.stdout, /Indexed files:/);

  const queryResult = await runCli(['query', 'charge payment', '--storage', storagePath, '--limit', '3']);
  assert.equal(queryResult.exitCode, 0);
  assert.match(queryResult.stdout, /chargePayment/);
});

test('CLI returns structured usage errors', async () => {
  const result = await runCli(['unknown-command']);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');

  const payload = JSON.parse(result.stderr) as { code?: string; message?: string };
  assert.equal(payload.code, 'E_USAGE');
  assert.match(payload.message ?? '', /Unknown command/i);
});

test('CLI startup check returns structured storage permission error', async () => {
  const repoPath = await makeRepo();
  const storagePath = '/dev/null/codegb-storage';

  const result = await runCli(['init', repoPath, '--storage', storagePath]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');

  const payload = JSON.parse(result.stderr) as { code?: string; message?: string };
  assert.equal(payload.code, 'E_STORAGE_PERM');
  assert.match(payload.message ?? '', /Storage directory is not writable/i);
});
