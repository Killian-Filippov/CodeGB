# 1. Tech Stack

- Confirmed repository fact: TypeScript monorepo on Node.js 18+ with `pnpm` workspaces and ESM packages.
- Confirmed repository fact: runtime entrypoints are a local CLI (`init`, `index`, `query`) and an MCP server over stdio.
- Confirmed repository fact: key libraries in active use are `@modelcontextprotocol/sdk`, `tree-sitter`, `tree-sitter-java`, `kuzu`, `kuzu-wasm`, `commander`, and `tsx`.
- Confirmed repository fact: storage is local-first and persisted to a repository-specific storage directory such as `.javakg`.
- Not yet fixed: a single repository-wide lint/typecheck workflow is not standardized at the root even though ESLint/Prettier config files exist.

# 2. Commands

- Canonical repository command: `pnpm build`
- Canonical repository command: `pnpm test`
- Canonical repository command: `pnpm test:core`
- Canonical repository command: `pnpm test:cli`
- Canonical repository command: `pnpm test:e2e`
- Canonical repository command: `pnpm test:e2e:mcp`
- Canonical repository command: `pnpm test:e2e:pipeline`
- Canonical repository command: `pnpm test:e2e:search`
- Canonical repository command: `pnpm test:e2e:cli`
- Canonical repository command: `pnpm test:e2e:phase1`
- Canonical repository command: `pnpm test:e2e:phase1:workflow`
- Canonical repository command: `pnpm test:e2e:phase1:mcp`
- Canonical repository command: `pnpm test:e2e:phase1:cli`
- Canonical repository command: `pnpm run benchmark:mcp`
- Canonical repository command: `pnpm run release:gate`
- Confirmed repository fact: package-level commands also exist in `packages/core`, `packages/cli`, and `packages/mcp-server`; use them when validating only one package.
- Not yet fixed: there is no canonical root `lint`, `format`, or repo-wide `type-check` script. Agents must not invent one and must not describe any lint command as repository standard unless it is added to package manifests.
- If no canonical validation command matches the change, use the narrowest repo-grounded validation available and state the limitation explicitly.
- Confirmed repository fact: some e2e flows target `packages/*/dist`, so `pnpm build` may be a prerequisite for those scopes.

# 3. Coding Conventions

- Follow the existing TypeScript-first implementation style and keep `strict`-compatible code.
- Match the repository formatting config: single quotes, semicolons, trailing commas, and 100-column wrap.
- Keep package responsibilities intact: reusable parsing, graph, storage, search, and shared tool logic in `packages/core`; CLI command wiring in `packages/cli`; MCP transport/server wiring in `packages/mcp-server`.
- Preserve machine-readable startup and usage failures for CLI and MCP entrypoints; do not replace structured error payloads with ad hoc text.
- Add or update tests in the existing `node:test` / `tsx --test` style used by the touched scope.
- Confirmed repository fact: checked-in emitted `.js`, `.d.ts`, `.map`, and `dist/` artifacts exist beside TypeScript sources.
- Not yet fixed: the repository does not define one authoritative regeneration workflow for all checked-in emitted artifacts. Treat `.ts` as the source of truth and avoid hand-editing emitted mirrors unless the task explicitly requires artifact sync.

# 4. Boundaries

- Do not casually change the public CLI surface: `init`, `index`, and `query`.
- Do not casually change the public MCP tool names: `query`, `context`, `impact`, `cypher`, and `list_repos`.
- Do not casually change storage/config contracts used across packages: the storage directory, `config.json`, and the Kuzu schema defined in `packages/core/src/storage/schema.ts`.
- Do not casually change external environment-variable contracts: `JAVA_KG_DB_PATH`, `CODEGB_AUTO_INDEX_INTERVAL_MS`, `CODEGB_MCP_CACHE_TTL_MS`, `CODEGB_MCP_CACHE_L1_MAX_ENTRIES`, `CODEGB_MCP_CACHE_L2_MAX_ENTRIES`, and `CODEGB_DB_BACKEND`.
- Preserve the operator workflow assumption that first-time usage requires CLI initialization and indexing before MCP queries return meaningful results.
- When code, tests, and README disagree, treat code plus runnable tests as the implementation authority and update documentation deliberately rather than silently changing contracts.

# 5. Development Workflow

- Check repository facts before implementing: inspect the owning package, its scripts, nearby tests, and any user-facing docs touched by the change.
- Default to the smallest owning scope. Change `packages/core` for parsing, graph, storage, search, and shared MCP logic; change `packages/cli` for CLI behavior; change `packages/mcp-server` for stdio/MCP server behavior.
- Treat `scripts/` as task-oriented utilities, not as a place to introduce long-lived product logic unless the task is explicitly script-scoped.
- Test-first behavior applies only when the affected scope already has a defined test location and runnable validation path.
- For package-local changes, run the narrowest relevant package or root test command first.
- For e2e or release-gated changes, run the specific e2e command that covers the touched workflow; build first when the test path depends on `dist/`.
- If no runnable validation path exists for the touched scope, state that explicitly instead of inventing a repository-standard workflow.

# 6. Architecture Governance (ADR)

- Confirmed repository fact: `docs/adr/template.md` exists as ADR scaffolding, but a populated ADR record set and mandatory ADR workflow are not yet established repository policy.
- An ADR is required before landing changes that redefine package ownership boundaries, public CLI/MCP contracts, persisted storage schema, or repository-wide backend policy.
- Recommended future direction: if ADRs become formalized, keep actual ADR records under `docs/adr/` and reference them from user-facing docs when they alter external behavior.
- If no ADR trigger is hit, proceed without adding architecture-process overhead.

# 7. Architecture Invariants

- Confirmed repository fact: the stable package split is `@codegb/core`, `@codegb/cli`, and `@codegb/mcp-server`.
- Confirmed repository fact: the system is local-first. Indexing persists a graph to local storage, and the MCP server serves that local index over stdio.
- Confirmed repository fact: current graph persistence is centered on one `Symbol` node table and one `CodeRelation` relation table.
- Confirmed repository fact: current Cypher support includes fallback behavior and phase-oriented limitations; do not assume full general-purpose graph-database compatibility unless the task proves it.
- Confirmed repository fact: backend support currently includes both `wasm` and `native`.
- Current implementation reality: README documents `wasm` as the default backend with `auto` fallback behavior.
- Recommended future direction: `benchmark.md` currently recommends `native` as the default backend. Treat that as guidance, not as already-landed repository behavior.

# 8. Agent Guidance

- Do not fabricate commands, workflows, architecture layers, or compatibility guarantees that are not present in repository evidence.
- Do not silently expand task scope from one workflow to all packages.
- Do not introduce generalized platforms, plugin systems, compatibility layers, or cross-workflow abstractions unless the task explicitly requires them.
- Local extraction is allowed when it clarifies one workflow or one package boundary.
- Prefer direct edits near the owning behavior over speculative reuse abstractions.
- When repository evidence is mixed or incomplete, say what is confirmed, what is not yet fixed, and what assumption you are making.
- Always report validation actually performed; do not imply broader coverage than was run.

# 9. Documentation Maintenance

- Update `README.md` when user-facing CLI commands, MCP startup/configuration, environment variables, storage setup, or first-run workflow change.
- Update `docs/release-notes.md` when a release-preparation change alters the shipped version or release-gated user-visible behavior.
- Update `benchmark.md` and `docs/benchmarks/latest.md` when benchmark results are regenerated or when backend-decision guidance changes.
- `ARCHITECTURE_SUMMARY.md`, `REPO_MAP.md`, and `DOMAIN.md` exist at the repository root as supplemental governance/context docs. Update them only when repository structure, architecture boundaries, or domain semantics materially change.
- Do not create or update governance/summary docs for purely local refactors that do not change externally relevant behavior, package boundaries, ownership boundaries, or architectural decisions.
