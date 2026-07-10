# LaminaBench fixture manifests

Benchmark fixtures compose layers from this directory and from `evals/fixtures/` (via `evals:` prefix).

## Manifests

| Name | Use | Realism |
|------|-----|---------|
| `greenfield-with-init` | Greenfield tasks with business context | N/A (no OSS repo) |
| `commerce-with-init` | Vercel Commerce + brownfield init | **Full vendored codebase** |
| `commerce-audit-ready` | Commerce + personas + flows inventory | **Full vendored codebase** |
| `plane-with-init` | Plane product context | **Stub only** — not a Plane clone |
| `outline-with-init` | Outline product context | **Stub only** — not an Outline clone |

Plane and Outline tasks are still valuable for product-behavior reasoning against a documented product surface, but they must **not** be described as full-repo OSS audits. Prefer “OSS-context feature/audit (stub fixture)” in external writing.

## Pin policy

OSS commit SHAs for Commerce are recorded in `benchmarks/release.yaml` and per-task `task.yaml`. Re-vendor on a quarterly schedule or when a task's context becomes stale.

## Stage manually

```bash
node benchmarks/scripts/stage-bench-fixture.mjs commerce-with-init --out /tmp/bench-fixture
```

## Refresh Commerce base

Commerce layers reference the evals fixture vendored by:

```bash
npm run fixtures:vendor
```
