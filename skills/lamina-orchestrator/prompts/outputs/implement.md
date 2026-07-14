Use this exact structure for `.lamina/runs/<run_id>/implement.md`.

`implement.md` is the **ship pack** for a separate coding session. It is a **projection** of `run.yaml` — especially the **dependency reachability graph** — not a second architecture. Stack-agnostic. Not permission to edit app source in the Lamina command.

Do **not** set `status: ready_to_build` until `node lib/validate-run.mjs .lamina/runs/<run_id>/run.yaml` passes and this file matches the sections below.

```markdown
---
id: implement
title: Ship pack
run_id: <run_id>
source_run: .lamina/runs/<run_id>/run.yaml
confidence: <high|medium|low|blocked>
---

# Ship pack: <target>

## Command boundary

This Lamina command produced `.lamina/` artifacts only. **Do not edit app source in this session.**

Start a coding-agent session to implement the full contract from `run.yaml` + this brief. That session may edit app source; do not modify `.lamina/` while building.

## Stack

Stack-agnostic. The coding agent chooses language, framework, UI toolkit, and persistence that fit the brief and repo.

State any **hard constraints from the brief** (e.g. mobile-first, offline-capable, must run locally). Do **not** prescribe Auth0, Firebase, AWS, CI vendors, or a default framework.

## Module / file map

Where domain rules, auth/permissions, primary workflows, and seed/fixture data should live — as a logical map the implementer can map onto their stack.

## Run locally

≤3 commands (or equivalent) to install, **load seed**, and run the product for verify. Adapt to the chosen stack; do not invent cloud deploy steps.

## Reachability graph (first-class)

From `domain.dependencies[]` + `workflows[].requires` / `provides` / `standalone`:

1. **Build order** — topological (setup/provides workflows before dependents).
2. **Per edge table:**

| dependency id | from | requires | mode | unmet behavior | scenario_ref | acceptance (copy) |
|---------------|------|----------|------|----------------|--------------|-------------------|
| … | workflow.… | entity.… | unreachable\|degraded\|blocked_ui\|recover | … | … | … |

3. For `degraded`: list `degraded_surfaces` and recovery. For `blocked_ui`/`recover`: name recovery workflow/screen.
4. **Never** silent happy-path when a dependency is unmet.

## Invariants → enforcement

For each `domain.invariants[]` id: where it must hold (data constraint and/or request/handler check) and the **rejection shape** (status/body or UI) when violated.

## Permissions matrix

Actor × operation × **resource_filter** (from `actors[].resource_filters`). Ownership fields used in filters must exist on entities. Forbidden operations → `scenarios[]` category `permission`.

## Workflows → surfaces

For each `workflows[]` id: steps, linked `screens[]`, **success / degraded / failure** outcomes (align with dependency modes). Include every `screens[]` with `status: new`.

## Scenarios → acceptance

For each `scenarios[]` id: copy `acceptance` **verbatim** from `run.yaml`. Include every `dependency_ref` scenario. No “handle gracefully.”

## Seed

Copy `seed.summary` and fixture bullets — the world verify/persona walks assume.

## Must-implement checklist

Generate from the contract — **every row must be realized in application source** (not comments alone). Tick while coding:

1. **Scenarios** — one checkbox per `scenarios[].id` with its `acceptance` copied verbatim.
2. **Forbidden content** — one checkbox per `forbidden_content[]` entry: name the **rejection / absence surface** (API error, missing UI module, content filter). Brief bans like “investment advice” become enforceable product behavior.
3. **A11y** — for each `screens[]` with `status: new`, tick `a11y.labels`, `a11y.touch_min_px` (primary controls ≥ that px), and `a11y.color_not_only`.
4. **Tradeoffs** — for each `tradeoffs[].id`, ship the `choice` and the mitigating surface named in `cost` / `surfaces` (stable ids — do not rename `clarity_vs_granularity` to a synonym).

## Done-when

Union of Must-implement ids: `dependency.*`, `workflow.*`, `scenario.*`, `invariant.*`, `screen.*`, `forbidden.*`, `a11y.*`, `tradeoff.*`.

## Out of scope

Copy `out_of_scope[]` and `forbidden_content[]` from `run.yaml`. Plus default ops bans unless the brief requires them:

- CI/CD, deploy scripts, monitoring/APM
- Push/notification vendor wiring
- Real bank OAuth / production IdP unless required

## Implementation session prompt

Copy into a new coding session:

> Implement the full product from `.lamina/runs/<run_id>/run.yaml` and `implement.md`.
> Honor the reachability graph: every dependency mode and scenario acceptance.
> Complete the Must-implement checklist (scenarios, forbidden_content, a11y, tradeoffs).
> Load seed fixtures. Ship every workflow and `screens[]` with `status: new`.
> Choose any stack that fits the brief. Do not modify `.lamina/`.
> Skip items in out_of_scope. After the product runs locally, run `/lamina-verify`.
```

## Forbidden sections

Do **not** add required sections titled CI/CD, Deployment, Push notifications, Monitoring, Threat model, or Production readiness milestones. Do **not** replace the Reachability graph with prose “architecture.”
