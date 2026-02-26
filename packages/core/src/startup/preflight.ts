import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export type StartupErrorCode =
  | 'E_NODE_VERSION'
  | 'E_STORAGE_PERM'
  | 'E_WORKER_UNAVAILABLE'
  | 'E_BACKEND_INIT'
  | 'E_USAGE'
  | 'E_INTERNAL';

export class StartupError extends Error {
  readonly code: StartupErrorCode;

  constructor(code: StartupErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface StartupChecksOptions {
  storagePath: string;
  initBackend: () => Promise<void>;
  closeBackend?: () => Promise<void>;
  minNodeMajor?: number;
}

export const normalizeStartupError = (error: unknown): StartupError => {
  if (error instanceof StartupError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const maybeSystem = error as Partial<{ code: string }>;
  if (maybeSystem.code === 'EACCES' || maybeSystem.code === 'EPERM' || maybeSystem.code === 'EROFS') {
    return new StartupError('E_STORAGE_PERM', 'Storage directory is not writable.');
  }
  return new StartupError('E_INTERNAL', message || 'Unexpected error.');
};

export const renderStartupError = (error: unknown): string => {
  const startupError = normalizeStartupError(error);
  return JSON.stringify({ code: startupError.code, message: startupError.message });
};

export const ensureNodeVersion = (minNodeMajor = 18): void => {
  const major = Number(process.versions.node.split('.')[0] ?? 0);
  if (!Number.isFinite(major) || major < minNodeMajor) {
    throw new StartupError(
      'E_NODE_VERSION',
      `Node.js ${minNodeMajor}+ is required (current: ${process.versions.node}).`,
    );
  }
};

export const ensureStorageWritable = async (storagePath: string): Promise<void> => {
  try {
    await fs.mkdir(storagePath, { recursive: true });
    const probePath = path.join(storagePath, `.codegb-write-check-${process.pid}-${Date.now()}.tmp`);
    await fs.writeFile(probePath, 'ok', 'utf8');
    await fs.unlink(probePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StartupError('E_STORAGE_PERM', `Storage directory is not writable: ${storagePath}. ${message}`);
  }
};

export const ensureWorkerAvailable = async (): Promise<void> => {
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
  throw new StartupError('E_WORKER_UNAVAILABLE', 'Worker runtime is unavailable in current environment.');
};

export const runStartupChecks = async (options: StartupChecksOptions): Promise<void> => {
  ensureNodeVersion(options.minNodeMajor ?? 18);
  await ensureStorageWritable(options.storagePath);
  await ensureWorkerAvailable();
  try {
    await options.initBackend();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StartupError('E_BACKEND_INIT', `Backend initialization failed. ${message}`);
  } finally {
    await options.closeBackend?.().catch(() => undefined);
  }
};
