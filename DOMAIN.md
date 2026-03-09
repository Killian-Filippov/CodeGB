# 1. Purpose

This file captures the business semantics needed for implementation: what problem the system currently solves, what its inputs and outputs mean, what a successful operator workflow is, and which business interpretations are still unconfirmed.

# 2. Domain Scope

## Confirmed business fact

- CodeGB currently serves local developers who want a searchable knowledge graph of a Java codebase.
- The current supported business workflow is:
  - initialize storage for a repository,
  - index Java source code from that repository,
  - query the indexed repository through a local CLI or an MCP server.
- The current business value is repository understanding, not source-code modification. The system helps a developer find symbols, inspect context, and estimate impact before changing code.
- The repository explicitly describes current coverage around Java classes, methods, fields, calls, inheritance, and imports.
- The MCP tool surface currently exposed to operators is `query`, `context`, `impact`, `cypher`, and `list_repos`.

## Operational assumption

- The primary operator is an engineer using an MCP-capable client such as Claude, Cursor, or VS Code, or using the CLI directly on the same machine as the indexed repository.
- The intended usage is local-first and repository-specific rather than a shared multi-tenant hosted service.

## Unresolved business question

- Whether the long-term product is primarily “Java repository understanding” or “general code knowledge graph across languages” is not yet confirmed.
- Whether the product is meant to support one active repository at a time or a durable multi-repository workspace is not yet fully defined in business terms.

# 3. Core Concepts

## Confirmed business fact

- **Repository**: the source code collection the operator wants to understand.
- **Indexed repository**: a repository whose Java source has been parsed and stored so it can be searched and analyzed.
- **Storage**: the persistent local index used to answer later questions. The user-facing examples refer to a directory such as `.javakg`.
- **Symbol**: a named code entity the operator cares about, such as a class, interface, method, field, constructor, enum, or annotation.
- **Query**: a user request to find relevant symbols by name or keyword.
- **Context**: the surrounding information for one symbol, including its own identity and directly related members or relationships.
- **Impact**: the upstream or downstream dependency spread from a target symbol.
- **Repository list**: the set of repositories currently known to the indexed storage.
- **Operator**: the person running init, indexing, and subsequent lookups.

## Operational assumption

- A “result” is usually one symbol-level match, not one file-level match.
- “Context” is meant to be a compact developer view, not a full AST dump or full-file reproduction.
- “Impact” is intended to support change planning, review, and dependency reasoning rather than formal correctness proofs.

## Unresolved business question

- The exact business distinction between a “symbol”, a “node”, and a “record” is not formally documented for user-facing terminology.
- It is not yet confirmed whether repository identity should be treated as repository name, absolute path, logical project key, or all three.

# 4. Workflow Semantics

## Confirmed business fact

- The operator’s goal is to make a codebase interrogable after an initial indexing step.
- A successful first-time workflow means:
  - the repository is initialized against a storage location,
  - Java files are indexed,
  - later queries return either relevant results or an explicit empty result instead of failing.
- A successful lookup workflow means the operator can ask one of these question types:
  - “Find the symbol I am looking for.”
  - “Show me the context of this symbol.”
  - “Show me the likely impact of changing this symbol.”
  - “Run a supported Cypher query over the indexed graph.”
  - “Tell me which indexed repositories are available.”
- One successful indexing run represents one refresh of the local repository model.
- One successful query or MCP tool call represents one business question answered against the current local index.

## Operational assumption

- The expected operator sequence is `init` then `index` before relying on CLI query or MCP answers.
- Incremental indexing is intended to reduce reprocessing when only a subset of Java files changed.

## Unresolved business question

- The business meaning of “fresh enough” indexing is not yet specified. The repository supports background and incremental update behavior, but the acceptable staleness window is not a confirmed business rule.
- It is not yet confirmed whether operators should expect indexing to cover only committed code, working tree changes, or both as the primary business model.

# 5. Inputs

## Confirmed business fact

- The core business input is a local Java repository path.
- The operator also supplies a storage path that identifies where the local index should be created or loaded.
- The current query inputs are:
  - free-text query terms for symbol search,
  - a symbol name or qualified name for context,
  - a target symbol plus direction and optional depth for impact,
  - a Cypher statement for direct graph queries,
  - an optional repository selector field on MCP tools.
- The current documented operator-facing source of truth for usage examples is `README.md`.
- `docs/phase1-issues-repro.md` is an authoritative source for currently known mismatches between expected and actual tool behavior in Phase 1.

## Operational assumption

- Input repositories are expected to contain Java code that follows common repository layouts closely enough to be discovered by the current indexing flow.
- Search input is intended to be natural developer terminology such as symbol names, partial names, or short phrases.
- The optional `repo` MCP parameter appears intended for multi-repository use, even though the business behavior of multi-repository selection is not yet fully nailed down.
- The `--changed-files` workflow assumes Git is the business source of change detection for incremental indexing.

## Unresolved business question

- The accepted business definition of “supported Java repository” is not fully documented. It is unclear whether build-system conventions, generated code, test-only repositories, or partial checkouts are officially in scope.
- The expected behavior when multiple symbols share the same simple name is not fully specified at the business level.
- The migration/compatibility expectation for legacy input names such as `--db-path` is unresolved; current repro documentation shows this is not behaving as desired.

# 6. Outputs

## Confirmed business fact

- CLI outputs are user-visible status or search results:
  - `init` reports that storage was initialized,
  - `index` reports indexing mode plus file, node, and relationship counts,
  - `query` returns ranked symbol matches or `No results.`.
- MCP outputs are structured JSON payloads embedded in MCP text responses.
- Current MCP result semantics are:
  - `query` returns a `results` array of symbol matches with name, type, location, and score.
  - `context` returns the selected symbol plus related methods, fields, and optional calls.
  - `impact` returns a target plus impact entries describing affected symbols, relationship type, and depth.
  - `cypher` returns query result rows.
  - `list_repos` returns repository descriptors.
- Startup and usage failures are surfaced as structured error payloads with machine-readable codes such as `E_USAGE`, `E_STORAGE_PERM`, `E_NODE_VERSION`, `E_WORKER_UNAVAILABLE`, and `E_BACKEND_INIT`.

## Operational assumption

- Output is designed to be consumed both directly by a human operator and indirectly by an MCP client that will parse the JSON text payload.
- Empty result sets are intended to be valid business outcomes, not exceptional failures.

## Unresolved business question

- The final user-facing contract for result ranking, tie-breaking, and result explanation is not formally documented.
- The desired business presentation for ambiguous symbol matches is not yet confirmed.

# 7. Business Rules

## Confirmed business fact

- First-time meaningful querying depends on prior initialization and indexing.
- The current Phase 1 search behavior is keyword-based and returns relevant symbols rather than raw files.
- Context lookup is keyed by symbol identity and is intended to show a 360-degree view of that symbol.
- Impact analysis requires a target plus a direction of analysis.
- The system is expected to fail with structured errors rather than raw stack traces for common startup and usage problems.
- The system is expected to return empty results rather than crash when no matching symbols are found.
- `list_repos` is part of the exposed business surface and therefore indexed repository discovery is part of the product behavior, not just a debug helper.

## Operational assumption

- Qualified names are the safer user input when simple names are ambiguous.
- Incremental indexing should preserve business continuity by updating the stored repository view without a full rebuild when only changed Java files matter.
- Cypher support is a power-user path rather than the primary business interface for most operators.

## Unresolved business question

- The supported Cypher subset is not yet a stable business contract. Current docs and repro notes show capability gaps around `WHERE ... CONTAINS`, aggregates such as `count(n)`, and node-return shapes.
- The business rule for repository scoping when a `repo` argument is provided is not yet explicit.
- The authoritative default backend choice is not settled in business terms: `README.md` documents `wasm` as the default, while benchmark guidance recommends `native`.

# 8. Success Criteria

## Confirmed business fact

- A developer can point the tool at a local Java repository, build an index, and retrieve useful symbol-level answers.
- The system can answer the core question types of search, context, impact, repository listing, and limited graph querying.
- The operator receives structured failure information when setup or runtime prerequisites are missing.
- The release notes define the current shipped version as an external developer trial build, so practical usability by external developers is part of current success.

## Operational assumption

- “Successful business completion” means the operator can use the system to understand a codebase well enough to navigate it, locate relevant symbols, and reason about likely change impact.
- Low-latency repeat querying and incremental refresh are part of perceived product quality even when not strictly required for functional correctness.

## Unresolved business question

- There is no confirmed business SLA for indexing speed, query speed, or index freshness.
- There is no confirmed minimum answer quality threshold for relevance, recall, or impact completeness.

# 9. Known Risks / Edge Cases

## Confirmed business fact

- A mismatched storage path and MCP environment path can produce empty-looking behavior even when indexing succeeded elsewhere; `README.md` explicitly calls this out.
- Incremental indexing via changed files requires a Git repository.
- Empty repositories or repositories with no relevant Java files are handled, but they naturally produce little or no business value.
- Current Phase 1 repro notes document Cypher capability and result-shape failures that can mislead operators expecting broader query support.
- Current repro notes also document an unresolved legacy parameter problem around `--db-path`.

## Operational assumption

- Name collisions across classes, methods, or repositories can create ambiguous business results if the operator uses short symbol names.
- Developers may incorrectly interpret “repository indexed successfully” as “all code relationships are complete,” even though current extraction is phase-limited.
- Operators may over-trust `impact` results as exhaustive dependency analysis when they are better treated as directional guidance.

## Unresolved business question

- The product meaning of “impact completeness” is not specified.
- It is not yet confirmed how generated code, vendored code, test fixtures, or partially parseable Java files should affect business-visible answers.
- It is not yet clear whether stale repository entries in `list_repos` are acceptable history, a bug, or a product feature.

# 10. Open Questions

- What is the official business scope for language support beyond Java, if any?
- Is the product fundamentally single-repository-per-storage, or should multi-repository querying be treated as a first-class business scenario?
- When a `repo` parameter is supplied to MCP tools, what exact business behavior should follow if the named repository is missing, duplicated, or stale?
- What is the intended business contract for ambiguous symbol names: first match, disambiguation list, or hard error?
- What level of Cypher compatibility should be treated as supported product behavior versus experimental power-user behavior?
- Should legacy inputs such as `--db-path` be supported, rejected with a migration message, or removed without compatibility handling?
- Which backend should be treated as the official default in user-facing business terms: `wasm`, `native`, or `auto`?
- What repository content is officially in scope for indexing: main source only, tests, generated sources, vendored code, or all Java files under the repository root?
- What freshness guarantee should operators expect after code changes: manual re-index only, Git-based incremental refresh, timed background refresh, or some combination?
- What minimum relevance or completeness bar should `query`, `context`, and `impact` meet before answers are considered business-successful?
