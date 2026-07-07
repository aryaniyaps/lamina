# LaminaBench fixture manifests

Benchmark fixtures compose layers from this directory and from `evals/fixtures/` (via `evals:` prefix).

## Manifests

| Name | Use |
|------|-----|
| `greenfield-with-init` | Greenfield tasks with business context |
| `commerce-with-init` | Vercel Commerce + brownfield init |
| `commerce-audit-ready` | Commerce + personas + flows inventory |
| `plane-with-init` | Plane product context stub |
| `outline-with-init` | Outline product context stub |

## Pin policy

OSS commit SHAs are recorded in `benchmarks/release.yaml` and per-task `task.yaml`. Re-vendor on a quarterly schedule or when a task's context becomes stale.

## Stage manually

```bash
node benchmarks/scripts/stage-bench-fixture.mjs commerce-with-init --out /tmp/bench-fixture
```

## Refresh Commerce base

Commerce layers reference the evals fixture vendored by:

```bash
npm run fixtures:vendor
```

Plane and Outline v1.1 use lightweight context stubs (product description + business context) rather than full repo clones. Audit tasks on Commerce use the full vendored codebase.
