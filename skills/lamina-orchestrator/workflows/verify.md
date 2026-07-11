# /lamina-verify workflow

Pre-merge verification against design contracts — actor walks, invariants, reachability, accessibility, integrity on live product. Run before opening a PR or merging when the product is buildable.

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
| Live grounding | `verify-grounding` | Walkthrough capture, repo evidence |
| Simulation plan | `verify-simulation` | Actor-walk scripts, synthesis |
| Actor walks | `verify-actors` + persona panel | Allowed/forbidden operations per role |
| Invariants | `verify-integrity` | Illegal transitions, duplicates, conflicts |
| Reachability | `verify-integrity` | Unmet `domain.dependencies[]` — workflow blocked or recovers |
| Accessibility | `verify-a11y` | Captured steps |
| Findings | `verify-findings` | Gaps → loop to design |

## Procedure

0. **Init gate** — [init-required](../prerequisites/init-required.md).
1. Load design run (`ready_to_build` or prior complete) or brownfield context.
2. Set `status: verifying` on run (create verify run if brownfield-only).
3. **Walkthrough** — when `base_url` available, run [visual-walkthrough](../patterns/visual-walkthrough.md).
4. **Actor walks** — one subagent per actor; attempt operations from `workflows` and `actors.permissions`.
5. **Reachability probes** — for each `domain.dependencies[]` edge, attempt `from` workflow when `requires` is unmet; UI must prevent, block, or recover per linked scenario.
6. **Invariant probes** — test scenarios from contract against live UI (double submit, permission denied, stale state).
7. **Accessibility** — load [lamina-accessibility](../../lamina-accessibility/SKILL.md) on captured steps.
8. Write `findings[]` with `fix_target` per finding (`product` default; `contract` for scope/design changes); set `status: complete` or document gaps.
9. Write `report.md` and `fix.md` from [prompts/outputs/fix.md](../prompts/outputs/fix.md); **STOP**.

Tell the user: implement **product fixes** from `fix.md` in a coding session, then re-run `/lamina-verify`. Route **contract deltas** in `fix.md` to `/lamina-design`.

## Subagent hints

- **Visual walkthrough** before actor walks when brownfield
- **Parallel:** actor walks + a11y when host supports
- Persona panel pattern applies **here only** — grounded in walkthrough, not invented wireframes
