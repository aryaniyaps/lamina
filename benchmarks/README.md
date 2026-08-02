# LaminaBench

The tiny [practical-runtime harness](runtime-v1/README.md) validates the
versioned measurement and cleanup contract without claiming a product baseline.

The [normalized semantic behavior oracle](semantic-oracle-v1/README.md)
compares implementation-independent product semantics on a compact reviewed
fixture. Real-repository observation and retrieval cases are intentionally
outside that oracle.

> **Lamina Product Coding Pilot (3-arm):**  
> Hub → https://hub.harborframework.com/datasets/shiv-eshwar/lb6-dev-pilot-issue18-rewardkit ·  
> claim → [`lb6/pilot/publication/README.md`](./lb6/pilot/publication/README.md) ·  
> reproduce → [`lb6/pilot/publication/REPRODUCE.md`](./lb6/pilot/publication/REPRODUCE.md)

## Quick start

```bash
npm run bench:lb6:v3:build
npm run bench:lb6:v3:validate
npm run bench:lb6:preflight
```

## Web release (publication boundary)

Export the current **running** public facts artifact for website vendoring. The explicit release manifest is the only selector — no result directory scanning.

```bash
npm run bench:release:export     # manifest → benchmarks/releases/current/release.json
npm run bench:release:validate   # contract checks + determinism tests
```

| Path | Role |
|---|---|
| `releases/contract.md` | Versioned `running \| published \| withheld` contract |
| `releases/lb6-running/manifest.json` | Explicit LB6 running release manifest |
| `releases/current/release.json` | Generated running snapshot (vendored into website) |
| `scripts/export-web-release.mjs` | Deterministic exporter |
| `scripts/validate-web-release.mjs` | Contract validator |

## Structure

| Path | Role |
|---|---|
| `corpus/manifest.json` | Public task corpus + goldens |
| `corpus/lamina-bench-skills.json` | Loop + risk-capability skill allowlist for lamina arm |
| `lib/behavior-grade.mjs` | Behavior oracle + treatment gates |
| `lib/behavior-selfcheck.mjs` | Structural agent self-check (no golden expects) |
| `lb6/pilot/scripts/build-transactional-pilot.mjs` | Generate the current graph-backed LB6 Harbor tasks |
| `lb6/pilot/scripts/validate-transactional-pilot.mjs` | Validate the current graph-backed pilot package |

## Local cache cleanup

Ephemeral Harbor runs and eval workspaces are gitignored. To reclaim disk:

```bash
./scripts/clean-local-cache.sh
```
