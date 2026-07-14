# /lamina-verify workflow

Pre-merge verification against design contracts — actor walks, invariants, reachability, accessibility, integrity on the product (live or static source). Run before opening a PR or merging when the product is buildable.

## Boundary

| Signal | Dispatch |
|--------|----------|
| Implementation done, check against contract | Verify |
| Audit/improve shipped UI without new design run | Verify (infer domain from repo + walkthrough) |
| Net-new feature design | Route to [design.md](design.md) |

## Sections and profiles

| Section | Profile | Notes |
|---------|---------|-------|
| Load contract | `verify-contract` | Prior `run.yaml` or inferred domain |
| Live grounding | `verify-grounding` | Walkthrough when `base_url`; else static source |
| Simulation plan | `verify-simulation` | Actor-walk scripts, synthesis |
| Actor walks | `verify-actors` + persona panel | Allowed/forbidden operations per role |
| Invariants | `verify-integrity` | Illegal transitions, duplicates, conflicts |
| Reachability | `verify-integrity` | Unmet `domain.dependencies[]` — workflow blocked or recovers |
| Accessibility | `verify-a11y` | Captured steps or source a11y hooks |
| Findings | `verify-findings` | Gaps → `fix.md` (product/contract only) |

## Procedure

0. **Init gate** — [init-required](../prerequisites/init-required.md).
1. Load design run (`ready_to_build` or prior complete) or brownfield context.
2. Set `status: verifying` on run (create verify run if brownfield-only).
3. **Grounding**
    - When `base_url` available: [visual-walkthrough](../patterns/visual-walkthrough.md).
    - When no runnable UI: **static source walk** — probe `workflows[]`, `scenarios[].acceptance`, invariants, and permissions against repo paths/symbols. **Never** ask the user how to proceed or STOP for missing `base_url` in agent-primary flows.
4. **Actor walks** — one subagent per actor; attempt operations from `workflows` and `actors.permissions` (live or against source+contract).
5. **Reachability probes (first-class)** — for **each** `domain.dependencies[]` edge, put the product in the unmet state (seed/fixtures or live); attempt `from` workflow; assert linked scenario `acceptance` and that `mode` matches (unreachable / degraded / blocked_ui / recover). Silent happy path → product finding.
6. **Invariant / scenario probes** — test remaining `scenarios[]` against live UI or source. **Also probe client-bypassable invariants** (query flags that skip filters, client-supplied roles, include_private-style overrides) — bypass → high product finding.
7. **Forbidden content + a11y** — for each `forbidden_content[]` entry, confirm absence / rejection surface in source or UI. For each `screens[].a11y`, check labels, `touch_min_px`, and color-not-only. Load [lamina-accessibility](../../lamina-accessibility/SKILL.md).
8. **Tradeoff surfaces** — for each `tradeoffs[]`, confirm the chosen behavior and named mitigating control exist in source.
9. Write ticket-shaped `findings[]`: `fix_target`, `priority`, `summary`/`finding`, `evidence`, `acceptance` (for product|contract). Classify CI/deploy/push as `ops` or omit. Empty `findings[]` is allowed only when probes passed — still emit `fix.md`.
10. Set `status: complete` **only after** `report.md` and **`fix.md`** exist under `.lamina/runs/<run_id>/`.
11. Write `report.md` and **always** write `fix.md` (include Unticked contract checklist). **STOP** Lamina writes.

Tell the host: implement **product fixes** from `fix.md` in a coding session, then re-run `/lamina-verify`. Route **contract deltas** to `/lamina-design`.

## Subagent hints

- **Visual walkthrough** before actor walks when `base_url` exists
- **Static source** persona/contract probes when no UI server
- **Parallel:** actor walks + a11y when host supports
- Persona panel: verify mode grounded in walkthrough or source — see [persona-panel](../patterns/persona-panel.md)
- **Never** write `verify-report.md` or root-only substitutes for `runs/<id>/fix.md`
