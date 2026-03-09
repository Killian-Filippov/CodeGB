## 1. Purpose

This file explains the current repository layout, what each major path is for, and where new files should be placed.

## 2. Top-Level Layout

### Existing paths

- `.claude/` - local tool configuration for this workspace; not product source.
- `.javakg/` - local storage/index directory used by the CLI and MCP workflow; not a source directory.
- `dist/` - repo-level generated build output mirror for package artifacts.
- `docs/` - supplemental documentation, including release notes, benchmark snapshots, design notes, repro notes, and planning notes.
- `node_modules/` - installed dependencies; generated and not a destination for repository-authored files.
- `packages/` - workspace packages: `core`, `cli`, and `mcp-server`.
- `scripts/` - task-oriented utility scripts such as benchmark and release checks.
- `tests/` - repository-level end-to-end test suite and test support code.
- `AGENTS.md` - repository instructions for coding agents.
- `ARCHITECTURE_SUMMARY.md` - root-level current-state architecture summary for package boundaries, runtime flow, and storage model.
- `README.md` - main user-facing setup and usage documentation.
- `benchmark.md` - top-level benchmark document.
- `package.json` - root workspace scripts and shared dev dependencies.
- `pnpm-lock.yaml` - lockfile for workspace dependencies.
- `pnpm-workspace.yaml` - workspace package definition.
- `tsconfig.json` and `tsconfig.base.json` - TypeScript configuration.
- `.eslintrc.cjs` and `.prettierrc.json` - formatting and lint configuration.

### Planned but not yet present paths

- No additional top-level layout is fixed as planned today.
- `DOMAIN.md` exists at the repo root as a business/domain semantics reference.
- `docs/adr/` contains only `template.md`; a real ADR record set is not yet present.
- There is no adopted top-level `src/`, `apps/`, `services/`, or `libs/` directory.

## 3. Current Entrypoints

There is no single canonical production entrypoint. The current runnable surfaces are split between the CLI and the stdio MCP server.

- `packages/cli/src/index.ts` - source entrypoint for the local CLI.
- `packages/cli/src/commands/init.ts` - CLI `init` command.
- `packages/cli/src/commands/index.ts` - CLI `index` command.
- `packages/cli/src/commands/query.ts` - CLI `query` command.
- `packages/mcp-server/src/cli.ts` - stdio MCP server startup path used in `README.md`.
- `package.json` root scripts - repository task runners such as `build`, `test`, and the e2e variants; these are operational commands, not product source entrypoints.

Package manifests also declare built `dist` entrypoints, but the checked-in tree currently contains generated artifacts both beside `src/` files and under build-output directories, so source entrypoints are the clearest navigation anchors.

## 4. Directory Responsibilities

- `packages/` - package-owned product code only. Do not place repo-level docs, e2e fixtures, or release scripts here.
- `packages/core/` - reusable implementation shared by other packages. This is the home for parsing, graph logic, ingestion, storage, search, startup checks, shared MCP logic, and shared types.
- `packages/core/src/api/` - API-facing helpers currently checked into the core package.
- `packages/core/src/graph/` - graph structures and traversal logic.
- `packages/core/src/ingestion/` - indexing and code-ingestion pipeline code.
- `packages/core/src/mcp/` - shared MCP-related logic that belongs in core rather than stdio transport wiring.
- `packages/core/src/parser/` - Tree-sitter parsing and extraction logic.
- `packages/core/src/search/` - search and context-building logic.
- `packages/core/src/startup/` - startup and preflight checks.
- `packages/core/src/storage/` - Kuzu adapters, schema, worker code, and storage-layer implementation.
- `packages/core/src/types/` - core type definitions.
- `packages/cli/` - CLI package only. Do not place reusable parsing/storage/search logic here.
- `packages/cli/src/commands/` - command-specific CLI wiring.
- `packages/mcp-server/` - stdio MCP server package only. Do not place general-purpose core logic here unless it is specific to MCP server transport, caching, or server wiring.
- `packages/mcp-server/src/` - MCP server startup, tool wiring, cache management, and server modules.
- `scripts/` - repository maintenance or one-off operational scripts. Do not place long-lived product features here.
- `tests/e2e/` - repository-level end-to-end specs and their support files.
- `tests/e2e/fixtures/` - test fixtures and temporary-repo setup helpers.
- `tests/e2e/page-objects/` - reusable e2e helper objects.
- `docs/` - supplemental documentation. Do not place runnable product code here.
- `docs/benchmarks/` - benchmark result snapshots and benchmark-specific supporting docs.
- `docs/adr/` - currently only ADR scaffolding via `template.md`; not yet a populated ADR record set.
- `dist/` - generated build output. Do not treat this as the source-of-truth location for edits.
- `.javakg/` - runtime storage artifacts such as schema/config data. Do not place authored source or docs here.
- `node_modules/` - dependency installation output only. Nothing repository-authored belongs here.

## 5. File Placement Rules

- New reusable TypeScript code belongs in the owning package under `packages/<package>/src/`.
- New CLI behavior belongs in `packages/cli/src/` and usually in `packages/cli/src/commands/` when it is command-specific.
- New MCP server transport, server bootstrap, or cache code belongs in `packages/mcp-server/src/`.
- New shared parsing, graph, ingestion, storage, search, or reusable MCP logic belongs in `packages/core/src/`.
- New package-local tests belong in `packages/<package>/test/` using the existing `*.test.ts` pattern.
- New repo-level e2e specs belong in `tests/e2e/<scope>/` using the existing `*.spec.ts` pattern.
- New e2e fixtures and helpers belong in `tests/e2e/fixtures/` or `tests/e2e/page-objects/` when they are shared across e2e specs.
- New task-oriented utility scripts belong in `scripts/`.
- New repo-level supporting docs belong in `docs/` unless they are one of the small set of already-rooted docs such as `README.md` or `benchmark.md`.
- New benchmark result snapshots belong in `docs/benchmarks/`.
- Generated build artifacts belong in package `dist/` output paths or the existing generated mirrors produced by the build; do not hand-edit generated `.js`, `.d.ts`, `.map`, or `dist/` files unless artifact sync is explicitly part of the change.
- Runtime storage output belongs in a storage directory such as `.javakg/`, not in `packages/`, `docs/`, or `tests/`.
- Do not place long-lived product code in `scripts/`, `tests/`, `docs/`, `.javakg/`, `dist/`, or `node_modules/`.
- Do not create a new repo-wide source root such as `src/`, `apps/`, `services/`, or `libs/` unless the repository layout is intentionally changed and this file is updated.
- Do not place package-specific implementation directly at the repository root.
- Do not treat emitted `.js` files beside `src/*.ts` as the preferred edit location; `.ts` remains the source of truth.
- No canonical snapshot root is established today. If a test tool needs snapshots or artifacts, keep them adjacent to the owning test scope instead of inventing a new top-level `snapshots/` directory.

## 6. Test Layout

Current reality:

- Package-level tests already exist in `packages/core/test/`, `packages/cli/test/`, and `packages/mcp-server/test/`.
- Repository-level e2e tests already exist in `tests/e2e/`.
- E2E scopes already present include `cli/`, `ingestion-pipeline/`, `knowledge-graph/`, `mcp-server/`, and `phase1/`.
- Shared e2e helpers already live in `tests/e2e/fixtures/` and `tests/e2e/page-objects/`.

Current limitation:

- There is not one single universal test root for all testing in the repository.
- The practical layout is split between package-local `test/` directories and the repo-level `tests/e2e/` tree.
- No broader canonical snapshot or artifact layout is fixed beyond the directories already present.

Recommendation, not current fact:

- Keep new package-scoped tests under `packages/<package>/test/`.
- Keep new end-to-end coverage under `tests/e2e/`.
- If the repository adopts a different canonical test location or naming scheme, update this file at the same time.

## 7. Documentation Layout

- `README.md` is the main root-level setup and usage document.
- `benchmark.md` is the root-level benchmark and performance document.
- `docs/` is the current home for supplemental repository documentation.
- `docs/release-notes.md` is the current release-note location.
- `docs/benchmarks/` is the current home for benchmark snapshots such as `latest.md`.
- `docs/next-plan.md` and `docs/phase1-issues-repro.md` show that task-specific planning and repro notes currently live under `docs/`.
- Architecture and domain writeups currently belong under `docs/` if they are supplemental. Do not assume a fixed required root file for them.
- `ARCHITECTURE_SUMMARY.md` exists at the root today as a current-state architecture summary.
- `DOMAIN.md` exists at the root today as a current domain/business semantics reference.
- `docs/adr/template.md` exists, but an ADR home is not yet established as mandatory repository policy. Treat `docs/adr/` as scaffolding rather than a fully adopted ADR system.
- Preferred future direction, not current fact: if ADRs become formalized, keep actual ADR records under `docs/adr/` and update this file when the first real ADR is added.

## 8. Change Guidance

Update this file when any of the following change:

- a new top-level directory or root-level key file is added or removed;
- a new package is added under `packages/` or package ownership changes;
- a new stable code location, test location, doc location, or generated-artifact location is adopted;
- a currently planned or not-yet-established path becomes real;
- a placement rule changes, including any newly prohibited locations;
- entrypoint locations move, split, or are consolidated.

Do not update this file for ordinary code changes that leave repository structure, directory ownership, and placement rules unchanged.
