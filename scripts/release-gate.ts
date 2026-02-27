import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

interface PackageJson {
  version?: string;
}

const ROOT = process.cwd();
const BENCHMARK_FILE = path.join(ROOT, 'benchmark.md');
const RELEASE_NOTES_FILE = path.join(ROOT, 'docs', 'release-notes.md');

const runCommand = (command: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}`));
    });
  });

const readCurrentVersion = async (): Promise<string> => {
  const pkgPath = path.join(ROOT, 'package.json');
  const raw = await fs.readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as PackageJson;
  if (!pkg.version || !pkg.version.trim()) {
    throw new Error('Root package.json is missing a valid version.');
  }
  return pkg.version.trim();
};

const ensureFileExists = async (filePath: string, errorMessage: string): Promise<void> => {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(errorMessage);
  }
};

const ensureReleaseNoteForVersion = async (version: string): Promise<void> => {
  const releaseNotes = await fs.readFile(RELEASE_NOTES_FILE, 'utf8');
  const versionHeading = `## v${version}`;
  if (!releaseNotes.includes(versionHeading)) {
    throw new Error(
      `Documentation gate failed: missing "${versionHeading}" entry in docs/release-notes.md.`,
    );
  }
};

const main = async (): Promise<void> => {
  const version = await readCurrentVersion();

  process.stdout.write('[release-gate] 1/3 Run core e2e suite (pnpm test:e2e:phase1)\n');
  await runCommand('pnpm', ['test:e2e:phase1']);

  process.stdout.write('[release-gate] 2/3 Check benchmark report (benchmark.md)\n');
  await ensureFileExists(
    BENCHMARK_FILE,
    'Benchmark gate failed: benchmark.md does not exist at repository root.',
  );

  process.stdout.write('[release-gate] 3/3 Check release documentation update\n');
  await ensureFileExists(
    RELEASE_NOTES_FILE,
    'Documentation gate failed: docs/release-notes.md is missing.',
  );
  await ensureReleaseNoteForVersion(version);

  process.stdout.write(`[release-gate] PASS for v${version}\n`);
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[release-gate] FAIL: ${message}\n`);
  process.exitCode = 1;
});
