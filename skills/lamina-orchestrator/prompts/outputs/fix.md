Use this exact structure for `.lamina/runs/<run_id>/fix.md`.

`fix.md` is the post-verify implementation brief for a **separate coding session**. It is not permission for the current Lamina command to edit app source code.

**Always write this file** when `/lamina-verify` completes — even if `findings[]` is empty (empty Product fixes section).

```markdown
---
id: fix
title: Product fix brief
run_id: <run_id>
source_run: .lamina/runs/<run_id>/run.yaml
verify_report: .lamina/runs/<run_id>/report.md
confidence: <high|medium|low|blocked>
sources:
  - .lamina/runs/<run_id>/run.yaml
  - .lamina/runs/<run_id>/report.md
  - <walkthrough or source paths when available>
---

# Fix brief: <target>

## Command boundary

This Lamina command produced UX artifacts only. **Do not edit app source in this session.**

Start a coding-agent session to implement the **product fixes** below. That session may edit app source; do not modify `.lamina/` while fixing.

## Product fixes

Prioritized from `run.yaml` `findings[]` where `fix_target` is `product` or unset (default: product).

If none: write `_No product findings._`

For each finding:

- **`<finding-id>`** — `<priority>` — `<one-line summary>`
  - **Repro:** <steps, actor walk, or static-source evidence>
  - **Recommendation:** <fix guidance>
  - **Context:** `screen_id` / `workflow_id` / invariant or scenario ref when present
  - **Evidence:** walkthrough step, file path, or symbol (required — no invented findings)
  - **Acceptance:** <observable pass condition tied to finding id>

## Unticked contract checklist

Re-read `implement.md` Must-implement / Done-when. List every `scenario.*`, `forbidden.*`, `a11y.*`, and `tradeoff.*` id that is **still missing or weak in source** after this verify — even if not yet a formal finding. Fix phase must close these before polish.

If none: write `_All must-implement ids observed in source._`

## Contract deltas

Findings where `fix_target: contract` — scope change, new workflow/invariant, or deferred capability. **Do not implement these in app code.** Run `/lamina-design` with the scoped prompt below.

If none: write `_No contract deltas._`

- **`<finding-id>`** — `/lamina-design` prompt: <one-line scoped delta request>

## Non-goals

- Do not change `.lamina/` during product fixes
- Do not implement contract-delta items without a design pass
- Do not chase ops items (CI/CD, deploy, push vendors, monitoring) unless the brief requires them — those are omitted from this brief even if mentioned in `report.md`
- <run-specific non-goals>

## Implementation session prompt

Copy into a new coding session:

> Implement product fixes from `.lamina/runs/<run_id>/fix.md`.
> Read `run.yaml` for machine-readable `findings[]` and close Unticked contract checklist ids.
> Prioritize high-priority product findings and missing scenario/forbidden/a11y/tradeoff ids first.
> Do not modify `.lamina/`. After fixes, re-run `/lamina-verify`.
```

## Required inputs

- Current `run.yaml` (may have empty `findings[]`)
- `report.md` from the same verify pass (never `verify-report.md`)
- Each finding classified with `fix_target: product | contract | ops` (default `product` when unset)
- Evidence per product finding: walkthrough step, repo path, or symbol
- Ticket shape: `fix_target` + `evidence` + `acceptance` for every product|contract finding

## Ops findings

Findings with `fix_target: ops` belong in `report.md` only — **do not list them under Product fixes**. Examples: missing CI, deploy scripts, FCM/SNS, APM, production IdP scaffolding — unless the brief explicitly required them (then `product` or `contract` as appropriate).

If required narrative inputs are missing, write `confidence: blocked`, explain what is missing, still emit `fix.md`, and do not invent implementation details.

**Refuse `status: complete` without writing this file** under `.lamina/runs/<run_id>/fix.md`.
