# LaminaBench LB6 (development pilot)

Current LB6 work lives under [`pilot/`](./pilot/).

## Start here

**Reproduce the Issue #18 RewardKit 3-seed median (open protocol):**  
→ [`pilot/publication/REPRODUCE.md`](./pilot/publication/REPRODUCE.md)

**Claim scope + published median matrix:**  
→ [`pilot/publication/README.md`](./pilot/publication/README.md)

**Pilot overview / commands:**  
→ [`pilot/README.md`](./pilot/README.md)

## What this is

A Harbor-based development pilot comparing three arms (`direct`, `plan`, `lamina`) on small product tasks, scored by Harbor RewardKit LLM-as-judge on product source (`app.mjs` / `ui.mjs`).

Published development claim = **per-cell median of three independent full matrices** (seed packages under `pilot/publication/seeds/`).

It is explicitly **`development_only` / non-confirmatory**.

## What this is not

- Not the legacy Harbor v4 tree under `benchmarks/` root README (Claude / checklist-era).
- Not a claim that `/lamina-verify` ran (Issue #18 lamina arm is init + design + implement + fix).
- Not a judge of `.lamina/` process artifacts.
