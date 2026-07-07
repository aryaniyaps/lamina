# Lamina eval fixtures

Composable fixture layers and manifests for agent-skill-eval workspaces.

## Layout

```
evals/fixtures/
  _base/nextjs-commerce/     # Vendored Vercel Commerce (trimmed, no node_modules)
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
| `partial-init-stub` | placeholder business-context | Init validation failure |
| `partial-init-frontmatter` | frontmatter-only business-context | Init validation failure |

## Stage manually

```bash
node evals/scripts/stage-fixture.mjs brownfield-with-init --out /tmp/lamina-fixture
```

Eval harnesses stage automatically when an eval case sets `"fixture": "<name>"` (see `evals/hooks/stage-eval-fixture.sh`).

## Refresh commerce base

```bash
npm run fixtures:vendor
```

Updates `evals/fixtures/_base/nextjs-commerce/` from [vercel/commerce](https://github.com/vercel/commerce). See `ATTRIBUTION.md` in that directory.

## Cleanup

If `npx skills add` was run from the repo root by mistake:

```bash
bash evals/scripts/clean-root-pollution.sh
```
