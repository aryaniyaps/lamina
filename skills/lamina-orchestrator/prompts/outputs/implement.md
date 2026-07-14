Use this exact structure for `.lamina/runs/<run_id>/implement.md`.

`implement.md` is the **ship pack** for implementing `run.yaml` in application source. It is a **projection** of `run.yaml` — especially the **dependency reachability graph** — not a second architecture. Stack-agnostic.

Do **not** set `status: ready_to_build` until `node .claude/skills/lamina-orchestrator/lib/validate-run.mjs .lamina/runs/<run_id>/run.yaml` passes and this file matches the sections below.

```markdown
---
id: implement
title: Ship pack
run_id: <run_id>
source_run: .lamina/runs/<run_id>/run.yaml
confidence: <high|medium|low|blocked>
---

# Ship pack: <target>

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

For each `domain.invariants[]` id: where it must hold (data constraint and/or request/handler check) and the **rejection shape** when violated. Match the brief’s channel: if `screens[]` with `status: new` exist for that flow, name a UI (or UI+API) rejection surface; if the contract is API/headless only, an API rejection shape is enough.

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

1. **Screens** — one checkbox per `screens[].id` with `status: new` (cite the app path that will realize it).
2. **Scenarios** — one checkbox per `scenarios[].id` with its `acceptance` copied verbatim.
3. **Forbidden content** — one checkbox per `forbidden_content[]` entry: name the **rejection / absence surface** matching the brief channel (UI and/or API as contracted — not “API error” by default when screens exist).
4. **A11y** — for each `screens[]` with `status: new`, tick `a11y.labels`, `a11y.touch_min_px` (primary controls ≥ that px), and `a11y.color_not_only`.
5. **Tradeoffs** — for each `tradeoffs[].id`, ship the `choice` and the mitigating surface named in `cost` / `surfaces` (stable ids — do not rename `clarity_vs_granularity` to a synonym).

## Done-when

Union of Must-implement ids: `dependency.*`, `workflow.*`, `scenario.*`, `invariant.*`, `screen.*`, `forbidden.*`, `a11y.*`, `tradeoff.*`.

## Out of scope

Copy `out_of_scope[]` and `forbidden_content[]` from `run.yaml`. Plus default ops bans unless the brief requires them:

- CI/CD, deploy scripts, monitoring/APM
- Push/notification vendor wiring
- Real bank OAuth / production IdP unless required

## When implementing from this file

1. **Read first** — open this `implement.md` and the matching `run.yaml` before writing application source. Do not invent a narrower scope from memory.
2. **One session, full checklist** — realize every Must-implement checkbox in this coding session. If `screens[]` with `status: new` are listed, ship those surfaces in app source now (routes/components/templates). Do **not** ship API/domain only and defer contracted screens to a “later frontend” pass.
3. **Done means checklist done** — do not claim complete while any Must-implement id remains unrealized in source.
4. **Scaffold ≠ shipped** — `package.json`, `tsconfig`, shared type stubs, or empty module shells do **not** satisfy Must-implement. Do not say checklist items are “represented,” “scaffolded,” or “ready for a coding session” — **this turn is that coding session**. Keep writing application source until contracted behavior (handlers/routes/UI as required by the checklist) exists on disk outside `.lamina/`.
5. **Buildable before done** — every module imported by entrypoints/routers/screens must exist on disk. Do not claim complete while any imported path is missing (e.g. `Settings` screen referenced but not written). Prefer a quick compile or import-path check before ending.
6. **Brief-named surfaces** — if the task brief names primary flows (settings, invite partner, category adjustment, etc.), ship those surfaces in this session when they appear on the Must-implement checklist — do not omit them as “phase 2.”
7. **Do not burn this turn on `.lamina/`** — if `implement.md` / `ready_to_build` are already present, do not regenerate the ship pack; implement the product. If they are missing, finish design artifacts only long enough to unblock, then immediately continue into application source in the same turn.

## Implementation session prompt

Copy into a coding session (or use as the post-design user turn):

> Read `.lamina/runs/<run_id>/implement.md` and `run.yaml` first.
> Implement the full product end to end completely in application source (outside `.lamina/`).
> Honor the reachability graph: every dependency mode and scenario acceptance.
> Complete every Must-implement checklist item in this session — including every `screens[]` with `status: new` and their a11y — do not defer contracted surfaces.
> Do not stop after manifests/types/scaffolding. Do not claim “ready for a later coding session.”
> Ensure the app is buildable: every imported module path exists on disk.
> Load seed fixtures. Ship every workflow named in the contract (and every brief primary flow on the checklist).
> Choose any stack that fits the brief. Do not modify `.lamina/` unless the ship pack is missing and must be finished first.
> Skip items in out_of_scope. After the product runs locally, run `/lamina-verify`.
```

## Forbidden sections

Do **not** add required sections titled CI/CD, Deployment, Push notifications, Monitoring, Threat model, or Production readiness milestones. Do **not** replace the Reachability graph with prose “architecture.”
