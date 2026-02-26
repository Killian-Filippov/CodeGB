declare module 'kuzu-wasm' {
  import type { KuzuWasmModule } from './kuzu-worker';

  const kuzuWasm: KuzuWasmModule;
  export default kuzuWasm;
}
