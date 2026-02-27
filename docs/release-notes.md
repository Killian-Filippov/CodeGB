# Release Notes

## v0.2.0-beta.1

Date: 2026-02-27

### Release Type
- External developer trial build.

### Gate Checklist
- Core e2e: pass via `pnpm test:e2e:phase1`
- Benchmark report: `benchmark.md` exists
- Docs update: this release note entry exists

### Highlights
- Added a release gate script (`pnpm run release:gate`) that enforces publish readiness.
- Allowed benchmark report tracking by Git (`benchmark.md`).
