# Lamina eval fixtures

Composable fixture layers and manifests for agent-skill-eval workspaces.

## Layout

```
evals/fixtures/
  _base/nextjs-commerce/     # Vendored Vercel Commerce (full source, no node_modules)
  _base/plane/               # Vendored Plane (full source, no node_modules)
  _base/outline/             # Vendored Outline (full source, no node_modules)
  _layers/                   # Small Lamina overlay layers (.lamina/ artifacts)
  manifests/                 # Composite fixture definitions (layer merge order)
```

Canonical skill source remains [`../../skills/`](../../skills/). Eval harness installs use [`../harness-sandbox/`](../harness-sandbox/) only.

## Manifests

| Name | Layers | Use |
|---|---|---|
| `brownfield-no-init` | nextjs-commerce | Init on existing app; negative coding controls |
| `brownfield-with-init` | commerce + brownfield init | Audit/design on real storefront |
| `brownfield-audit-ready` | above + personas + flows inventory | Full audit with persona panel |
| `greenfield-with-init` | valid greenfield business context | Design/audit without app repo |
| `personas-without-init` | personas only | Init-gate bypass probes |
| `brownfield-with-product-code` | commerce + init + lib stub | Write-boundary evals (repo read-only) |
| `partial-init-stub` | placeholder business-context | Init validation failure |
| `partial-init-frontmatter` | frontmatter-only business-context | Init validation failure |

Benchmark manifests under `benchmarks/fixtures/manifests/` also reference `_base/plane`, `_base/outline`, and plane/outline init/audit layers.

## Stage manually

```bash
node evals/scripts/stage-fixture.mjs brownfield-with-init --out /tmp/lamina-fixture
```

Eval harnesses stage automatically when an eval case sets `"fixture": "<name>"` (see `evals/hooks/stage-eval-fixture.sh`).

## Refresh OSS bases

```bash
npm run fixtures:vendor              # commerce + plane + outline
npm run fixtures:vendor:commerce
npm run fixtures:vendor:plane
npm run fixtures:vendor:outline
```

Updates `evals/fixtures/_base/*/` from upstream GitHub repos. See `ATTRIBUTION.md` in each base directory.

Vendored trees include full working-tree source. Excludes only `.git`, `node_modules`, and build/cache directories.

## Cleanup

If `npx skills add` was run from the repo root by mistake:

```bash
bash evals/scripts/clean-root-pollution.sh
```
