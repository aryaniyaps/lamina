# Lamina Product Coding Pilot (LB6)

Public-facing name: **Lamina Product Coding Pilot — 3-arm (direct / plan / lamina)**.  
Work lives under [`pilot/`](./pilot/).

## Start here

**Harbor (share):**  
→ https://hub.harborframework.com/datasets/shiv-eshwar/lb6-dev-pilot-issue18-rewardkit

**Reproduce (Hub + local 3-seed):**  
→ [`pilot/publication/REPRODUCE.md`](./pilot/publication/REPRODUCE.md)

**Claim scope + median matrix:**  
→ [`pilot/publication/README.md`](./pilot/publication/README.md)

**Pilot overview / commands:**  
→ [`pilot/README.md`](./pilot/README.md)

## What this is

A Harbor pilot comparing three arms (`direct`, `plan`, `lamina`) on small product tasks, scored by an LLM judge on product source (`app.mjs` / `ui.mjs`).

Published claim = **per-cell median of three independent full matrices** (seed packages under `pilot/publication/seeds/`).

Explicitly **`development_only` / non-confirmatory**.

## What this is not

- Not confirmatory LaminaBench-6.
- Not a claim that `/lamina-verify` ran (lamina arm is init + design + implement + fix).
- Not a judge of `.lamina/` process artifacts.
