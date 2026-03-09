# CodeGB

CodeGB is a code knowledge graph tool for local developer environments. It provides an MCP Server that runs on your machine and can be called by MCP Clients (such as Claude/Cursor).

## Feature Overview

- Java code parsing and graph construction (classes, methods, fields, calls, inheritance, imports)
- Tree-sitter-first Java extraction, with regex kept only as a compatibility fallback
- MCP tools:
  - `query`
  - `context`
  - `impact`
  - `cypher`
  - `list_repos`
- Local-first storage and querying
- Switchable graph storage backend (WASM / Native)

## Requirements

- Node.js 18+
- pnpm

## Install Dependencies

```bash
pnpm install
```

## Build

```bash
pnpm build
```

## Local Usage (CLI)

```bash
# 1) Initialize the repository index directory
pnpm exec tsx packages/cli/src/index.ts init /path/to/your/repo --storage .javakg

# 2) Build index
pnpm exec tsx packages/cli/src/index.ts index /path/to/your/repo --storage .javakg

# 2.1) Incremental indexing (only process changed Java files in git diff)
pnpm exec tsx packages/cli/src/index.ts index /path/to/your/repo --storage .javakg --changed-files

# 3) Query
pnpm exec tsx packages/cli/src/index.ts query "payment" --storage .javakg --limit 10
```

## Start MCP Server (stdio)

```bash
JAVA_KG_DB_PATH=.javakg pnpm exec tsx packages/mcp-server/src/cli.ts
```

Notes:
- This process communicates with the MCP Client via stdio.
- In your MCP Client, configure this command as the MCP Server startup command.

## MCP Client Config Template (Minimal Working Setup)

Use the following template consistently:
- `command`: `pnpm`
- `args`: `["exec", "tsx", "packages/mcp-server/src/cli.ts"]`
- `env.JAVA_KG_DB_PATH`: your index directory (must match `--storage`)
- `env.CODEGB_AUTO_INDEX_INTERVAL_MS`: polling interval (ms) for MCP background incremental indexing (default `3000`, set to `0` to disable)
- `env.CODEGB_MCP_CACHE_TTL_MS`: cache TTL (ms) for MCP `query/context` (default `60000`, set to `0` to disable)
- `env.CODEGB_MCP_CACHE_L1_MAX_ENTRIES`: in-process L1 cache size (default `256`, set to `0` to disable)
- `env.CODEGB_MCP_CACHE_L2_MAX_ENTRIES`: persistent L2 cache size (default `4096`, set to `0` to disable)

Replace `"/ABS/PATH/TO/CodeGB"` and `"/ABS/PATH/TO/.javakg"` with absolute paths.

### Claude Desktop

The config file (macOS) is usually at `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codegb": {
      "command": "pnpm",
      "args": ["exec", "tsx", "packages/mcp-server/src/cli.ts"],
      "cwd": "/ABS/PATH/TO/CodeGB",
      "env": {
        "JAVA_KG_DB_PATH": "/ABS/PATH/TO/.javakg"
      }
    }
  }
}
```

### Cursor

Workspace file `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "codegb": {
      "command": "pnpm",
      "args": ["exec", "tsx", "packages/mcp-server/src/cli.ts"],
      "cwd": "/ABS/PATH/TO/CodeGB",
      "env": {
        "JAVA_KG_DB_PATH": "/ABS/PATH/TO/.javakg"
      }
    }
  }
}
```

### VS Code

Workspace file `.vscode/mcp.json`:

```json
{
  "servers": {
    "codegb": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["exec", "tsx", "packages/mcp-server/src/cli.ts"],
      "cwd": "/ABS/PATH/TO/CodeGB",
      "env": {
        "JAVA_KG_DB_PATH": "/ABS/PATH/TO/.javakg"
      }
    }
  }
}
```

## First-Time Indexing (Required Before MCP)

MCP only provides queries. For first-time usage, run `init + index` first:

```bash
pnpm exec tsx packages/cli/src/index.ts init /ABS/PATH/TO/REPO --storage /ABS/PATH/TO/.javakg
pnpm exec tsx packages/cli/src/index.ts index /ABS/PATH/TO/REPO --storage /ABS/PATH/TO/.javakg
```

## Java Parser Runtime

- The indexing pipeline uses `tree-sitter` as the primary Java parser and extraction path.
- `JAVA_QUERIES` is the authoritative query template used by the tree-sitter extractor for symbol and relation capture.
- The legacy regex extractor is still present only as a compatibility fallback when the tree-sitter runtime is unavailable or a single-file tree-sitter parse fails during indexing.
- Operationally, you should treat CodeGB as a tree-sitter-based Java indexer, not as a dual-parser system.

## FAQ

- Q: MCP connects successfully, but returns empty results?
  A: Usually initial indexing was not completed, or `JAVA_KG_DB_PATH` does not match index `--storage`.
- Q: Startup fails with JSON error codes?
  A: `E_NODE_VERSION` (Node < 18), `E_STORAGE_PERM` (directory not writable), `E_WORKER_UNAVAILABLE` (worker unavailable), `E_BACKEND_INIT` (backend initialization failed).
- Q: `pnpm` not found?
  A: Ensure `pnpm` is available in the client runtime `PATH`, or use an absolute path to `pnpm`.
- Q: `list_repos` shows old repositories?
  A: Re-run `init + index` for the new repository and update `JAVA_KG_DB_PATH`.

## Fallback Behavior

- Backend fallback: when `CODEGB_DB_BACKEND=auto`, `wasm` is preferred, and if it fails it automatically falls back to `native`, with a one-time diagnostic log.
- Cypher fallback: the `cypher` tool prefers backend execution; when backend is unavailable or returns incompatible results, it automatically falls back to the in-memory graph compatible execution path.
- Data fallback: if the index directory is empty or graph loading fails, the service starts with an empty graph and tools return empty results instead of crashing the process.

## Graph Database Backend Selection

The current implementation supports two paths:

- `kuzu-wasm`: better cross-platform compatibility and installation experience, suitable for default distribution.
- `kuzu` (native): may be faster on some machines, but has higher installation/compatibility cost.

Unified switch:
- `CODEGB_DB_BACKEND=wasm|native|auto`
- Default: `wasm` (compatibility first)
- `auto`: try `wasm` first, automatically fall back to `native` on failure, and print a one-time diagnostic log.

> Note: backend switching has been implemented in the core layer. The concrete runtime strategy can be managed uniformly through startup configuration.

## Tests

```bash
# Core tests
pnpm exec tsx --test packages/core/test/*.test.ts

# E2E tests
pnpm test:e2e
```

## Release Gate

Before publishing a developer-trial version, run:

```bash
pnpm run release:gate
```

Gate conditions:
- Core e2e passes (`pnpm test:e2e:phase1`)
- `benchmark.md` exists
- `docs/release-notes.md` contains the current version heading (`## v<version>`)

## Project Structure

- `packages/core`: parsing, graph models, storage adapters, search, MCP tool logic
- `packages/mcp-server`: MCP Server startup and protocol integration
- `packages/cli`: local init/index/query commands
- `tests/e2e`: end-to-end tests
