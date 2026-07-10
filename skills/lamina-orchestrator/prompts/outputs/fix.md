Use this exact structure for `.lamina/runs/<run_id>/fix.md`.

`fix.md` is the post-verify implementation brief for a **separate coding session**. It is not permission for the current Lamina command to edit app source code.

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
  - <walkthrough paths when available>
---

# Fix brief: <target>

## Command boundary

This Lamina command produced UX artifacts only. **Do not edit app source in this session.**

Start a coding-agent session to implement the **product fixes** below. That session may edit app source; do not modify `.lamina/` while fixing.

## Product fixes

Prioritized from `run.yaml` `findings[]` where `fix_target` is `product` or unset (default: product).

For each finding:

- **`<finding-id>`** — `<priority>` — `<one-line summary>`
  - **Repro:** <steps or actor walk excerpt>
  - **Recommendation:** <fix guidance>
  - **Context:** `screen_id` / `flow_id` / invariant or scenario ref when present
  - **Evidence:** walkthrough step or repo path when available
  - **Acceptance:** <observable pass condition tied to finding id>

## Contract deltas

Findings where `fix_target: contract` — scope change, new workflow/invariant, or deferred capability. **Do not implement these in app code.** Run `/lamina-design` with the scoped prompt below.

- **`<finding-id>`** — `/lamina-design` prompt: <one-line scoped delta request>

## Non-goals

- Do not change `.lamina/` during product fixes
- Do not implement contract-delta items without a design pass
- <run-specific non-goals>

## Implementation session prompt

Copy into a new coding session:

> Implement product fixes from `.lamina/runs/<run_id>/fix.md`.
> Read `run.yaml` for machine-readable `findings[]`.
> Prioritize high-priority findings first. Keep changes scoped.
> Do not modify `.lamina/`. After fixes, re-run `/lamina-verify`.

## Re-verify

After product fixes are deployed, run `/lamina-verify` against the updated build.
```

## Required inputs

- Current `run.yaml` with non-empty `findings[]`
- `report.md` (or `verify-report.md`) from the same verify pass
- Each finding classified with `fix_target: product | contract` (default `product` when unset)
- Walkthrough evidence when `base_url` capture exists

If `findings[]` is empty, do not write `fix.md` — document gaps in `report.md` only.

If required inputs are missing, write `confidence: blocked`, explain what is missing, and do not invent implementation details.
