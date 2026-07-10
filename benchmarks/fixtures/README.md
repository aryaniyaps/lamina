# LaminaBench fixture manifests

Benchmark fixtures compose layers from this directory and from `evals/fixtures/` (via `evals:` prefix).

## Manifests

| Name | Use | Realism |
|------|-----|---------|
| `greenfield-with-init` | Greenfield tasks with business context | N/A (no OSS repo) |
| `commerce-with-init` | Vercel Commerce + brownfield init | **Full vendored codebase** |
| `commerce-audit-ready` | Commerce + personas + flows inventory | **Full vendored codebase** |
| `plane-with-init` | Plane + brownfield init | **Full vendored codebase** |
| `plane-audit-ready` | Plane + init + personas + flows inventory | **Full vendored codebase** |
| `outline-with-init` | Outline + brownfield init | **Full vendored codebase** |
| `outline-audit-ready` | Outline + init + personas + flows inventory | **Full vendored codebase** |

## Pin policy

OSS commit SHAs are recorded in `benchmarks/release.yaml` and per-task `task.yaml`. Re-vendor on a quarterly schedule or when a task's context becomes stale.

## Stage manually

```bash
node benchmarks/scripts/stage-bench-fixture.mjs commerce-with-init --out /tmp/bench-fixture
node benchmarks/scripts/stage-bench-fixture.mjs plane-with-init --out /tmp/plane-fixture
node benchmarks/scripts/stage-bench-fixture.mjs outline-audit-ready --out /tmp/outline-audit
```

## Refresh OSS bases

All bases are vendored into `evals/fixtures/_base/`:

```bash
npm run fixtures:vendor              # all three
npm run fixtures:vendor:commerce     # vercel/commerce only
npm run fixtures:vendor:plane        # makeplane/plane only
npm run fixtures:vendor:outline      # outline/outline only
```

See `ATTRIBUTION.md` in each `_base/` directory for pinned commits.
