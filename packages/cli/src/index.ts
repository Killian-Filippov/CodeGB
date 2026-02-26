import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { KuzuAdapter } from '../../core/src/storage/kuzu-adapter';
import { runIndexCommand } from './commands/index';
import { runInitCommand } from './commands/init';
import { runQueryCommand } from './commands/query';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_STORAGE = '.javakg';
const CLI_VERSION = '0.1.0';
const MIN_NODE_MAJOR = 18;

type CliErrorCode =
  | 'E_NODE_VERSION'
  | 'E_STORAGE_PERM'
  | 'E_WORKER_UNAVAILABLE'
  | 'E_BACKEND_INIT'
  | 'E_USAGE'
  | 'E_INTERNAL';

class CliError extends Error {
  readonly code: CliErrorCode;

  constructor(code: CliErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const toCliError = (error: unknown): CliError => {
  if (error instanceof CliError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const maybeSystem = error as Partial<{ code: string }>;
  if (maybeSystem.code === 'EACCES' || maybeSystem.code === 'EPERM' || maybeSystem.code === 'EROFS') {
    return new CliError('E_STORAGE_PERM', 'Storage directory is not writable.');
  }
  return new CliError('E_INTERNAL', message || 'Unexpected error.');
};

const renderCliError = (error: unknown): string => {
  const cliError = toCliError(error);
  return JSON.stringify({
    code: cliError.code,
    message: cliError.message,
  });
};

const readOption = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
};

const resolveStoragePath = (args: string[]): string => {
  const fromOption = readOption(args, '--storage');
  return path.resolve(fromOption ?? DEFAULT_STORAGE);
};

const ensureNodeVersion = (): void => {
  const major = Number(process.versions.node.split('.')[0] ?? 0);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    throw new CliError(
      'E_NODE_VERSION',
      `Node.js ${MIN_NODE_MAJOR}+ is required (current: ${process.versions.node}).`,
    );
  }
};

const ensureStorageWritable = async (storagePath: string): Promise<void> => {
  try {
    await fs.mkdir(storagePath, { recursive: true });
    const probeName = `.codegb-write-check-${process.pid}-${Date.now()}.tmp`;
    const probePath = path.join(storagePath, probeName);
    await fs.writeFile(probePath, 'ok', 'utf8');
    await fs.unlink(probePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('E_STORAGE_PERM', `Storage directory is not writable: ${storagePath}. ${message}`);
  }
};

const ensureWorkerAvailable = async (): Promise<void> => {
  const hasGlobalWorker = typeof (globalThis as { Worker?: unknown }).Worker === 'function';
  if (hasGlobalWorker) {
    return;
  }

  try {
    const workerThreads = await import('node:worker_threads');
    if (typeof workerThreads.Worker === 'function') {
      return;
    }
  } catch {
    // Fall through to structured startup error.
  }

  throw new CliError('E_WORKER_UNAVAILABLE', 'Worker runtime is unavailable in current environment.');
};

const ensureBackendInitialized = async (storagePath: string): Promise<void> => {
  const adapter = new KuzuAdapter(storagePath);
  try {
    await adapter.init();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('E_BACKEND_INIT', `Backend initialization failed. ${message}`);
  } finally {
    await adapter.close().catch(() => undefined);
  }
};

const runStartupChecks = async (storagePath: string): Promise<void> => {
  ensureNodeVersion();
  await ensureStorageWritable(storagePath);
  await ensureWorkerAvailable();
  await ensureBackendInitialized(storagePath);
};

export const runCli = async (argv: string[]): Promise<CliResult> => {
  const [command, ...rest] = argv;

  try {
    if (!command || command === 'help' || command === '--help') {
      return {
        exitCode: 0,
        stdout: 'Usage: codegb <init|index|query> ...',
        stderr: '',
      };
    }

    if (command === 'version' || command === '--version' || command === '-v') {
      return {
        exitCode: 0,
        stdout: CLI_VERSION,
        stderr: '',
      };
    }

    if (command === 'init') {
      const repoPath = rest[0];
      if (!repoPath) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: renderCliError(new CliError('E_USAGE', 'init requires <repoPath>')),
        };
      }
      const storagePath = resolveStoragePath(rest);
      await runStartupChecks(storagePath);
      const stdout = await runInitCommand({ repoPath, storagePath });
      return { exitCode: 0, stdout, stderr: '' };
    }

    if (command === 'index') {
      const repoPath = rest[0]?.startsWith('--') ? undefined : rest[0];
      const storagePath = resolveStoragePath(rest);
      await runStartupChecks(storagePath);
      const stdout = await runIndexCommand({ repoPath, storagePath });
      return { exitCode: 0, stdout, stderr: '' };
    }

    if (command === 'query') {
      const query = rest[0];
      if (!query) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: renderCliError(new CliError('E_USAGE', 'query requires <query>')),
        };
      }
      const storagePath = resolveStoragePath(rest);
      await runStartupChecks(storagePath);
      const limit = Number(readOption(rest, '--limit') ?? 10);
      const stdout = await runQueryCommand({ query, storagePath, limit });
      return { exitCode: 0, stdout, stderr: '' };
    }

    return {
      exitCode: 1,
      stdout: '',
      stderr: renderCliError(new CliError('E_USAGE', `Unknown command: ${command}`)),
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: renderCliError(error),
    };
  }
};

const isMain = import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  runCli(process.argv.slice(2)).then((result) => {
    if (result.stdout) {
      process.stdout.write(`${result.stdout}\n`);
    }
    if (result.stderr) {
      process.stderr.write(`${result.stderr}\n`);
    }
    process.exitCode = result.exitCode;
  });
}
