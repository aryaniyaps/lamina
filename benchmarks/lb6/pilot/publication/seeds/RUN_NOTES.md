# Seed run notes — Lamina Product Coding Pilot

Operator tee logs under `../logs/seed-N/` are **gitignored** (large / machine-local). This file is the **portable** exception log for the published three seeds.

Harness was **not** changed between seeds or retries. Retries were only for `measurementValid=false` cells (agent exit / timeout), never to chase a higher reward.

## Seed 1

- Full 4 × 3 matrix; **12/12** valid on first collect.
- No cell retries.
- Package: `seed-1-issue18-rewardkit.{md,json,campaign.json}`

## Seed 2

- Full 4 × 3 matrix under a new campaign marker (`--force-marker`).
- **Retry:** `dev-loan-library` / `plan`
  - First job: `trial_exception` — `shape_build` `NonZeroAgentExitCodeError` (invalid for claim even if a reward file appeared).
  - Replacement job: `lb6-pilot-skill-rerun-v3-dev-loan-library-plan-1784916309722`
  - Valid reward: **0.5388**
- Package after collect: `seed-2-issue18-rewardkit.*` (includes only the valid replacement for that cell).

## Seed 3

- Full 4 × 3 matrix under a new campaign marker.
- **Retry:** `dev-review-room` / `lamina`
  - First job: `AgentTimeoutError` (reward present but measurement invalid).
  - Replacement job: `lb6-pilot-skill-rerun-v3-dev-review-room-lamina-1784920693601`
  - Valid reward: **0.6408**
- Package after collect: `seed-3-issue18-rewardkit.*`

## Aggregation

```bash
npm run bench:lb6:v3:median-issue18
```

See [`../REPRODUCE.md`](../REPRODUCE.md) for the full protocol.
