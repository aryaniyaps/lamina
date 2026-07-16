Use this exact structure for `.lamina/runs/<run_id>/fix.md`.

`fix.md` is the post-verify brief for applying product fixes in application source.

**Always write this file** when `/lamina-verify` completes — even if `findings[]` is empty (empty Product fixes section).

```markdown
---
id: fix
title: Product fix brief
run_id: <run_id>
source_run: .lamina/runs/<run_id>/run.yaml
verify_report: .lamina/runs/<run_id>/report.md
confidence: <high|medium|low|blocked>
grounding: <live_app|static_source|mixed>
sources:
  - .lamina/runs/<run_id>/run.yaml
  - .lamina/runs/<run_id>/report.md
  - <walkthrough or source paths when available>
---

# Fix brief: <target>

## Product fixes

Prioritized from `run.yaml` `findings[]` where `fix_target` is `product` or unset (default: product).

If none: write `_No product findings._`

`_No product findings._` is valid only when the Unticked contract checklist is also empty. Every missing/weak checklist id is a product defect (unless it demonstrates a wrong contract, in which case it is a contract delta) and must map to a ticket below. Related ids may share one ticket, but its Acceptance must enumerate all covered ids.

For each finding:

- **`<finding-id>`** — `<priority>` — `<one-line summary>`
  - **Repro:** <steps, actor walk, or static-source evidence>
  - **Recommendation:** <fix guidance>
  - **Context:** `screen_id` / `workflow_id` / invariant or scenario ref when present
  - **Evidence:** walkthrough step, file path, or symbol (required — no invented findings)
  - **Acceptance:** <observable pass condition tied to finding id>

## Unticked contract checklist

Re-read `implement.md` Must-implement / Done-when. List every `screen.*`, `scenario.*`, `forbidden.*`, `a11y.*`, and `tradeoff.*` id that is **still missing or weak in source** after this verify — even if not yet a formal finding. Fix phase must close these before polish.

Also list required entity/state, invariant, permission/resource-filter, and workflow ids that are represented only by interfaces, imports/routes, placeholder comments, hard-coded display data, or no-op handlers.

For each unticked id, cite evidence (`missing` or a weak path/symbol). Every `screens[]` entry with `status: new` that has no corresponding app path (route/component/template) **must** appear here — do not write that UI changes are out of scope when those screens are missing.

Only write `_All must-implement ids observed in source._` when every `screen.*` with `status: new` has a cited app path, every interactive path traces through trusted enforcement, mutation/persistence, actor-scoped projection, and visible feedback/recovery, and remaining checklist ids are observed in executable source. Passing agent-authored tests or matching scenario names alone is insufficient.

## Contract deltas

Findings where `fix_target: contract` — scope change, new workflow/invariant, or deferred capability. **Do not implement these in app code.** Run `/lamina-design` with the scoped prompt below.

If none: write `_No contract deltas._`

- **`<finding-id>`** — `/lamina-design` prompt: <one-line scoped delta request>

## Non-goals

- Do not change `.lamina/` during product fixes
- Do not implement contract-delta items without a design pass
- Do not chase ops items (CI/CD, deploy, push vendors, monitoring) unless the brief requires them — those are omitted from this brief even if mentioned in `report.md`
- Do not excuse missing `screens[]` with `status: new` as “UI not required” when those screens remain unticked
- <run-specific non-goals>

## When applying this brief

1. **This turn writes app source** — edit files outside `.lamina/` to close Product fixes and Unticked contract checklist ids.
2. **Rewriting `fix.md` is not a fix** — do not claim complete after only editing `.lamina/` artifacts. Evidence of done is changed application source (and, when feasible, a local re-check).
3. **Scaffold still does not count** — adding types-only or empty shells for missing screens/APIs does not close `screen.*` / `scenario.*` ids.
4. **Re-run the action inventory** — exercise every changed mutation family through its production route/control against a deterministic seed or isolated store. A build plus agent-authored tests is insufficient: no 5xx, `ReferenceError`, undefined symbol/import, unhandled rejection, or mutation that fails to persist and re-project may remain.
5. **Close findings literally and downstream** — implement every acceptance clause through the normal product path, then inspect adjacent trust boundaries and consumers. A verification-only handoff credential, seeded-only recovery record, implicit privileged session, renamed plaintext field, or UI-only workaround does not close delivery, organic-state, identity, confidentiality, or concurrency findings.
6. **Re-probe cross-actor and integrity chains** — for changed handoffs, execute sender → delivery → authenticated recipient → durable response → both projections. For changed ingestion/state code, create recovery records organically, attempt stale/concurrent writes, and verify every live/offline projection refreshes.
7. **Close trust and durability bypasses** — prove identity control rather than accepting an identifier, run every changed mutation against every disallowed role, and failure-inject changed persistence so live memory is not published before durable commit.
8. **Preserve the independent build gate** — add/fix and run a discoverable clean build/compile/typecheck command; do not finish with only tests, start, or smoke checks.

## Implementation session prompt

Copy into a coding session (or use as the post-verify user turn):

> Implement product fixes from `.lamina/runs/<run_id>/fix.md` end to end completely in application source (outside `.lamina/`).
> Read `run.yaml` for machine-readable `findings[]` and close Unticked contract checklist ids (including `screen.*` / `a11y.*` when present).
> Prioritize high-priority product findings and missing checklist ids first.
> Do not end after only rewriting `fix.md`. Do not stop at scaffolding.
> Do not modify `.lamina/`. After fixes, re-run `/lamina-verify`.
```

## Required inputs

- Current `run.yaml` (may have empty `findings[]`)
- `report.md` from the same verify pass (never `verify-report.md`)
- Each finding classified with `fix_target: product | contract | ops` (default `product` when unset)
- Evidence per product finding: walkthrough step, repo path, or symbol
- Ticket shape: `fix_target` + `evidence` + `acceptance` for every product|contract finding
- `grounding` set to how verify observed the product

## Ops findings

Findings with `fix_target: ops` belong in `report.md` only — **do not list them under Product fixes**. Examples: missing CI, deploy scripts, FCM/SNS, APM, production IdP scaffolding — unless the brief explicitly required them (then `product` or `contract` as appropriate).

If required narrative inputs are missing, write `confidence: blocked`, explain what is missing, still emit `fix.md`, and do not invent implementation details.

**Refuse `status: complete` without writing this file** under `.lamina/runs/<run_id>/fix.md` with the Write tool. A chat reply that only *shows* a fix brief is not delivery — the implementer and harness look for the path on disk.
