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
0.5. **Read-only source boundary** — during `/lamina-verify`, application source is evidence only. Use Read/Glob and non-mutating checks for source; Write/Edit only `.lamina/`. A missing or broken source file is a finding, never permission to create or repair it in this command. Do not let “unattended” or “make it buildable” language collapse verify and external fix into one turn.
1. Load design run (`ready_to_build` or prior complete) or brownfield context.
2. Set `status: verifying` on run (create verify run if brownfield-only).
3. **Grounding** — record mode in `report.md` / `fix.md` as `live_app` | `static_source` | `mixed`.
    - When `base_url` available: [visual-walkthrough](../patterns/visual-walkthrough.md).
    - When no runnable UI: **static source walk** — probe `workflows[]`, `scenarios[].acceptance`, invariants, permissions, and **`screens[]` with `status: new`** against repo paths/symbols. **Never** ask the user how to proceed or STOP for missing `base_url` in agent-primary flows.
4. **Screen surface probes** — for **each** `screens[]` entry with `status: new`, require a corresponding app path (route/component/template) or emit a product finding + unticked `screen.*` / `a11y.*` ids. Do **not** clear the contract or write that UI changes are out of scope while those screens are missing — including under `static_source` grounding.
5. **Build integrity (static)** — scan entrypoints / routers for imports or path references to modules that do **not** exist on disk (e.g. `App.tsx` imports `./screens/Settings` but file missing). Each broken import → **high** product finding. A product that would not compile is never “no findings.”
5.5. **Behavior integrity (static)** — probe for placeholder/TODO comments, no-op handlers, context/state that stores identifiers but no product data, type-only “domain” modules without enforcement, and route registrations with no workflow transition. Trace each required path from reachable action → trusted enforcement → mutation/persistence → actor-scoped projection → visible result/recovery. Client-only role/privacy hiding is a high finding for consequential shared data. These are unticked behavior, not implementation evidence. Run the available typecheck/build when feasible; record the command/result in `report.md`.
5.6. **Independent evidence discipline** — do not close a row from agent-authored tests, scenario names, comments, or a declared script alone. Tests may identify intended behavior, but confirm the production path calls the implementation. Record the actual clean build/typecheck exit status and inspect failures.
5.7. **Production-shaped dependency probe** — when a real vendor is out of scope, accept a replaceable local adapter only if the product path still performs begin → state/nonce → callback/exchange → durable success/failure attempt → retry. A fixture outcome selector in the main UI, or provider logic fused into the route/screen, is a product finding. Confirm server-bound identity outside explicit verification mode, reject credential-free privileged access, and require explicit identity establishment through even a simple local adapter.
5.8. **Action inventory + runtime smoke** — enumerate every reachable mutating route/control and its production service method. Using a deterministic seed or isolated temporary store, exercise one authorized path for each mutation family plus brief-critical denial/recovery paths. Fail verification on any 5xx, `ReferenceError`, undefined symbol/import, unhandled rejection, or mutation whose persisted result is not visible through the actor projection. A passing build or agent-authored test suite never substitutes for this inventory. Under static-only grounding, cross-check referenced runtime symbols/imports and list every unexecuted action as residual risk.
5.9. **Cross-actor / organic-state probe** — trace every handoff through its delivery boundary, recipient open, authenticated binding, accept/reject, durable state, and both projections. Treat verification-only handoff credentials as incomplete. Drive normal input/delivery paths and require them to create their own conflict, retry, delivery, or other required recovery records; seeded examples alone are insufficient.
5.10. **State-integrity probe** — attempt stale/concurrent consequential writes, confirm every affected live/offline projection refreshes, and inspect sensitive offline storage semantics. Atomic file replacement without serialization/version checks is residual integrity risk; base64 or plaintext browser cache must not be labelled encrypted.
5.11. **Identity / denial-matrix probe** — try to claim a known actor using only public identifiers; proof-free identity is a high finding. For every mutating route, run every contract-disallowed role and assert no record/version/projection changes. Probe every actor-scoped status, acknowledgment, completion, and preference transition rather than assuming shared state.
5.12. **Organic creation / commit-failure probe** — from the normal initial state, create each advertised brief-critical record, relationship, and lifecycle variant without fixture-only shortcuts. Inject a store write/rename failure when feasible and assert the error leaves live memory and durable state identical to the pre-action snapshot.
5.13. **Independent build gate** — for greenfield work, require and run a discoverable clean build/compile/typecheck command. A start command, runtime smoke, check script not declared as build, or passing agent-authored tests is not a substitute; missing build is a product/readiness finding and must appear in `fix.md`.
6. **Brief coverage probes** — when the task brief names primary flows, personas, or edge cases, check they appear in source (and preferably in the contract). Missing from source → product finding; present in brief but absent from `run.yaml` → `fix_target: contract` finding. Do **not** rubber-stamp empty `findings[]` when brief-named surfaces are absent.
7. **Actor walks** — one subagent per actor (including occasional/viewer personas when contracted); attempt operations from `workflows` and `actors.permissions` (live or against source+contract).
8. **Reachability probes (first-class)** — for **each** `domain.dependencies[]` edge, put the product in the unmet state (seed/fixtures or live); attempt `from` workflow; assert linked scenario `acceptance` and that `mode` matches (unreachable / degraded / blocked_ui / recover). Silent happy path → product finding.
9. **Invariant / scenario probes** — test remaining `scenarios[]` against live UI or source. **Also probe client-bypassable invariants** (query flags that skip filters, client-supplied roles, direct state writes, include_private-style overrides) and confirm failure preserves the last-known-good state — bypass or data loss → high product finding.
10. **Forbidden content + a11y** — for each `forbidden_content[]` entry, confirm absence / rejection surface in source or UI (channel must match the brief / contracted screens). For each `screens[].a11y` on `status: new`, check labels, `touch_min_px`, color-not-only, navigation/rerender focus, field-error focus/association, async live announcements, busy/disabled state, and semantic progress/status against the realizing surface — missing surface → unticked `a11y.*`. Load [lamina-accessibility](../../lamina-accessibility/SKILL.md).
11. **Tradeoff surfaces** — for each `tradeoffs[]`, confirm the chosen behavior and named mitigating control exist in source.
12. Write ticket-shaped `findings[]`: `fix_target`, `priority`, `summary`/`finding`, `evidence`, `acceptance` (for product|contract). Every missing or weak Must-implement row is a product finding unless the contract itself is wrong (then contract finding); do not hide defects only in an “unticked checklist.” Group tightly related rows into one ticket when useful, but preserve every id in its acceptance. Classify CI/deploy/push as `ops` or omit. Empty `findings[]` is allowed only when probes passed, every `status: new` screen is observed, **build and behavior integrity are clean, the action inventory has no unexplained runtime failure**, and brief-named flows/edges that belong in product are observed — still emit `fix.md`.
13. **Write on disk** `report.md` and **always** `fix.md` via the Write tool from [prompts/outputs/fix.md](../prompts/outputs/fix.md) (include Unticked contract checklist with `screen.*` when applicable). Chat-only paste of those documents is a failed verify. **Do not** copy Mode B / “do not edit app source” into `fix.md` — Mode B is this slash command only.
14. **Existence gate (hard)** — before any long chat summary, `Bash`: `test -f .lamina/runs/<run_id>/report.md && test -f .lamina/runs/<run_id>/fix.md` must exit 0. If it fails, Write the missing file(s) first.
15. Set `status: complete` **only after** both files exist under `.lamina/runs/<run_id>/`. Then **STOP** Lamina writes.

Tell the host: implement **product fixes** from `fix.md` end to end in a coding session, then re-run `/lamina-verify`. Route **contract deltas** to `/lamina-design`.

## Subagent hints

- **Visual walkthrough** before actor walks when `base_url` exists
- **Static source** persona/contract probes when no UI server
- **Parallel:** actor walks + a11y when host supports
- Persona panel: verify mode grounded in walkthrough or source — see [persona-panel](../patterns/persona-panel.md)
- **Never** write `verify-report.md` or root-only substitutes for `runs/<id>/fix.md`
