import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { runCli } from '../src/index.ts';

const execFileAsync = promisify(execFile);

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

async function runGit(repoPath: string, args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', repoPath, ...args], { encoding: 'utf8' });
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

test('CLI supports changed-files incremental indexing via git diff', async () => {
  const repoPath = await makeRepo();
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'javakg-cli-storage-'));

  await runGit(repoPath, ['init']);
  await runGit(repoPath, ['config', 'user.name', 'CodeGB Test']);
  await runGit(repoPath, ['config', 'user.email', 'codegb@example.com']);
  await runGit(repoPath, ['add', '.']);
  await runGit(repoPath, ['commit', '-m', 'initial']);

  const initResult = await runCli(['init', repoPath, '--storage', storagePath]);
  assert.equal(initResult.exitCode, 0);

  const firstIndexResult = await runCli(['index', repoPath, '--storage', storagePath]);
  assert.equal(firstIndexResult.exitCode, 0);

  const noChangeResult = await runCli(['index', repoPath, '--storage', storagePath, '--changed-files']);
  assert.equal(noChangeResult.exitCode, 0);
  assert.match(noChangeResult.stdout, /Indexed files:\s*0/);

  const baselineQuery = await runCli(['query', 'PaymentProcessor', '--storage', storagePath, '--limit', '3']);
  assert.equal(baselineQuery.exitCode, 0);
  assert.match(baselineQuery.stdout, /PaymentProcessor/);

  await fs.writeFile(
    path.join(repoPath, 'src', 'AddedService.java'),
    `
package com.acme;
public class AddedService {
  public void doWork() {}
}
`,
  );

  const incrementalResult = await runCli(['index', repoPath, '--storage', storagePath, '--changed-files']);
  assert.equal(incrementalResult.exitCode, 0);
  assert.match(incrementalResult.stdout, /Mode:\s*incremental/i);
  assert.match(incrementalResult.stdout, /Indexed files:\s*1/);

  const queryResult = await runCli(['query', 'AddedService', '--storage', storagePath, '--limit', '3']);
  assert.equal(queryResult.exitCode, 0);
  assert.match(queryResult.stdout, /AddedService/);
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
