# 1. Purpose

This file summarizes the architecture that is actually implemented in the repository today. It focuses on package boundaries, runtime flow, storage shape, and the architectural constraints that should stay stable unless an intentional design change is made.

# 2. System Shape

- Confirmed repository fact: CodeGB is a local-first TypeScript monorepo with three stable packages: `@codegb/core`, `@codegb/cli`, and `@codegb/mcp-server`.
- Confirmed repository fact: the product exposes two runnable surfaces:
  - a local CLI for `init`, `index`, and `query`,
  - an MCP server over stdio for `query`, `context`, `impact`, `cypher`, and `list_repos`.
- Confirmed repository fact: the operator workflow is storage initialization, repository indexing, then repeated local queries against that stored index.
- Confirmed repository fact: the repository does not currently contain a separate Python ML service, hosted control plane, or additional runtime package beyond the three TypeScript packages.

# 3. Package Boundaries

## `packages/core`

- Owns reusable product logic.
- Current responsibility includes parsing, ingestion, graph construction, traversal, storage adapters, search/context assembly, startup checks, and shared MCP logic.
- This is the only package that should define shared data contracts such as graph node/edge shapes and storage schema.

## `packages/cli`

- Owns CLI wiring only.
- Current commands are `init`, `index`, and `query`.
- It should not become the home for reusable parsing, storage, or search implementation.

## `packages/mcp-server`

- Owns stdio MCP transport, tool registration, runtime startup, and MCP-side caching.
- It composes core functionality rather than re-implementing indexing, graph, or search behavior.
- It should remain the place for transport concerns and server lifecycle behavior, not shared domain logic.

# 4. Runtime Flow

## Indexing path

1. The operator points the CLI at a local repository path and a storage path.
2. `packages/core/src/ingestion/pipeline.ts` orchestrates extraction and graph persistence.
3. Java source is parsed through the tree-sitter-first extractor in `packages/core/src/parser/tree-sitter-extractor.ts`.
4. Core ingestion processors derive symbols, imports, inheritance, and call relations before persistence.

## Query path

1. The CLI or MCP server loads the local index from the configured storage directory.
2. Query-oriented logic runs from core search, graph traversal, and storage modules.
3. The MCP server returns structured JSON payloads over stdio; the CLI returns human-readable command output.

## Auto-refresh path

- Confirmed repository fact: the MCP server can perform timed background incremental indexing using Git-changed Java files when `CODEGB_AUTO_INDEX_INTERVAL_MS` is enabled.
- Confirmed repository fact: non-Git workspaces disable that auto-incremental path after detection rather than hard-failing the server.

# 5. Parsing and Ingestion

- Confirmed repository fact: Java parsing is tree-sitter-first.
- Current implementation reality: `packages/core/src/parser/java-queries.ts` defines the authoritative capture patterns used by the tree-sitter extractor.
- Current implementation reality: legacy regex-based extraction still exists only as a compatibility fallback when tree-sitter runtime setup or single-file parsing fails.
- Confirmed repository fact: recent ingestion work converged the Java pipeline on the tree-sitter extractor and tightened call-resolution behavior, including static-import fallback handling.

# 6. Storage and Graph Model

- Confirmed repository fact: persistence is local and centered on Kuzu-backed storage adapters under `packages/core/src/storage/`.
- Confirmed repository fact: the persisted schema is currently one `Symbol` node table and one `CodeRelation` relation table, defined in `packages/core/src/storage/schema.ts`.
- Confirmed repository fact: backend support currently includes `wasm`, `native`, and `auto` selection behavior, with `README.md` documenting `wasm` as the default and `auto` as fallback-capable.
- Confirmed repository fact: when backend execution is unavailable or incompatible for some Cypher flows, the system can fall back to in-memory graph execution for supported cases.

# 7. Search and Analysis Capabilities

- `query` is keyword-oriented symbol search.
- `context` assembles a compact related-symbol view around one target symbol.
- `impact` traverses dependency relationships from a target symbol and direction.
- `cypher` is supported with phase-limited behavior and fallback constraints; it should not be treated as full graph-database compatibility.
- `list_repos` exposes repository descriptors known to the active storage.

# 8. Stable Invariants

- Keep the package split intact unless there is an intentional architecture change.
- Keep persisted storage contracts coordinated through core, especially `config.json` usage and `packages/core/src/storage/schema.ts`.
- Keep CLI and MCP public surfaces stable unless documentation, tests, and callers are updated together.
- Treat `.ts` sources as authoritative over checked-in emitted artifacts.
- Preserve the local-first model: indexing writes to local storage, and subsequent CLI/MCP queries read from that local index.

# 9. What Does Not Exist Today

- No adopted multi-service production architecture beyond the local CLI and stdio MCP server.
- No formal ADR record set beyond `docs/adr/template.md`.
- No additional first-class package for embeddings, semantic vector search, or remote orchestration.
- No architecture decision in code that makes `native` the universal default backend today.

# 10. Update Triggers

Update this file when any of the following change:

- package ownership boundaries or responsibilities;
- the public CLI or MCP runtime surfaces;
- the persisted graph/storage model;
- the default runtime/backend policy;
- the high-level indexing or query execution path.

Do not update this file for ordinary local bug fixes that stay within the existing architecture.
