# [Bug] macOS ARM64: Node process crashes on exit in native addon finalizer (NodeQueryResult / QueryResult destructor)

## Summary

When using `kuzu` native backend on macOS ARM64, Node process may crash with `SIGSEGV (EXC_BAD_ACCESS)` during process cleanup/finalization, even after business logic completes successfully.

The crash appears in `kuzujs.node` finalizer path:
- `NodeQueryResult::~NodeQueryResult()`
- `kuzu::main::QueryResult::~QueryResult()`
- `kuzu::processor::FactorizedTable::~FactorizedTable()`

## Environment

- OS: macOS 14.2.1 (23C71)
- CPU: Apple Silicon (ARM64)
- Node.js: reproducible on Node 24; previously also observed on Node 20
- kuzu npm package: `0.11.3`
- Package manager: pnpm `10.30.2`

## Expected Behavior

Process exits cleanly after all queries complete.

## Actual Behavior

Process exits with code `139` (`SIGSEGV`) during Node environment cleanup.

## Crash Signature

- Exception: `EXC_BAD_ACCESS (SIGSEGV)`
- Faulting address: `0x0000000000000008`
- Faulting binary: `kuzujs.node`
- Stack contains:
  - `kuzu::processor::FactorizedTable::~FactorizedTable()`
  - `kuzu::main::QueryResult::~QueryResult()`
  - `NodeQueryResult::~NodeQueryResult()`
  - `Napi::ObjectWrap<NodeQueryResult>::FinalizeCallback(...)`
  - `node_napi_env__::CallFinalizer(...)`

## Minimal Reproduction

### 1) Install deps

```bash
pnpm install
```

### 2) Run a script that uses native backend and exits

```ts
import { runPipelineFromRepo } from '...';
process.env.CODEGB_DB_BACKEND = 'native';
await runPipelineFromRepo(...);
console.log('done'); // may print successfully
// process may still crash during exit/finalize
```

### 3) Observe exit code

```bash
echo $?
# 139 (intermittent / scenario-dependent)
```

## Additional Notes

- Crash frequency increases with repeated query-result creation patterns.
- In our app, explicitly closing query result handles reduced/removed crashes in our repro:
  - close result objects returned from `connection.query(...)`
  - close result objects returned from `connection.execute(...)`
- This suggests a potential lifetime/finalizer issue in native query-result object destruction.

## Artifacts

- macOS crash report (`.ips`) attached.
- Relevant frame excerpt:
  - `NodeQueryResult::~NodeQueryResult()`
  - `Napi::ObjectWrap<NodeQueryResult>::FinalizeCallback(...)`

## Questions

1. Is this a known issue in `kuzu@0.11.3` Node binding on macOS ARM64?
2. Is explicit `QueryResult.close()` required for all query/execute paths to avoid finalize-time crash?
3. Is there a patch/newer version that fixes destructor/finalizer safety?

