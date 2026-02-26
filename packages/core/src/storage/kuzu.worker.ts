import { createKuzuWasmWorkerBackend, installKuzuWorker, type WorkerHostLike } from './kuzu-worker';

const maybeWorkerHost = globalThis as unknown as Partial<WorkerHostLike>;

if (
  typeof maybeWorkerHost.addEventListener === 'function' &&
  typeof maybeWorkerHost.removeEventListener === 'function' &&
  typeof maybeWorkerHost.postMessage === 'function'
) {
  void (async () => {
    try {
      const backend = await createKuzuWasmWorkerBackend();
      installKuzuWorker(maybeWorkerHost as WorkerHostLike, backend);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      installKuzuWorker(maybeWorkerHost as WorkerHostLike, {
        init: async () => {
          throw new Error(message);
        },
        persistGraph: async () => {
          throw new Error(message);
        },
        loadGraph: async () => {
          throw new Error(message);
        },
        executeCypher: async () => {
          throw new Error(message);
        },
      });
    }
  })();
}
