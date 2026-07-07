---
name: lamina-core
description: "Lamina Problem Router and UX reference index. Use to find the right capability skill for a UX question."
---

<!-- argument-hint: [problem or capability-id] -->

# Lamina Core — Problem Router

**40 capability skills** — load one skill per problem.

## Entry points (slash commands)

| Command | Use when |
|---|---|
| `/lamina` | Auto-route or single-topic answer |
| `/lamina-init` | Bootstrap or update business context for UX work |
| `/lamina-ideate` | Problem → full concept |
| `/lamina-feature` | Feature idea → spec + checklist |
| `/lamina-optimize` | Audit existing flows |

Workflow commands: load [lamina-orchestrator](../lamina-orchestrator/SKILL.md), then the matching workflow in `workflows/`, or invoke `/lamina`, `/lamina-init`, etc. Direct mode: Problem Router below → one `lamina-<id>/SKILL.md`.

**Guardrail:** UX artifacts only. Do not implement product code or visual styling specs. See [guardrails.md](guardrails.md).

## How to Use

**Load order** (minimize tokens): Problem Router below → one `lamina-<id>/SKILL.md`. Optional: [reference.md](reference.md) for research shortcuts and glossary only.

- **Without arguments** — scan the Problem Router below; load the matching skill
- **With a problem** — e.g. `forms`, `usability testing`, `users feel lost`; load that skill directly
- **Machine routing** — `metadata.lamina.problems` in each skill frontmatter is canonical; Problem Router must stay aligned
- **Cross-cutting filters** — prioritization and evidence triage → [lamina-decision-making](../lamina-decision-making/SKILL.md)
- **Artifacts** — load [artifacts.md](../lamina-orchestrator/artifacts.md) when writing or reusing `.lamina/` outputs

## Problem Router

| Problem signal | Skill |
|---|---|
| Bootstrap UX context, initialize lamina | `/lamina-init` — see [business-context](../lamina-business-context/SKILL.md) |
| Business pivot, scope change | `/lamina-init update` |
| Business goals, metrics, scope (existing project) | read `.lamina/business-context.md` |
| Inclusive design | [accessibility](../lamina-accessibility/SKILL.md) |
| Market positioning, parity debates | [competitive-analysis](../lamina-competitive-analysis/SKILL.md) |
| Wordy pages, scan failures | [content-design](../lamina-content-design/SKILL.md) |
| Destructive actions, undo | [controls-and-menus](../lamina-controls-and-menus/SKILL.md) |
| Prioritize features, triangulate evidence | [decision-making](../lamina-decision-making/SKILL.md) |
| Double-diamond, team design | [design-process](../lamina-design-process/SKILL.md) |
| Hidden affordances, signifiers | [discoverability](../lamina-discoverability/SKILL.md) |
| No data yet screen | [empty-states](../lamina-empty-states/SKILL.md) |
| High errors, bad messages | [error-handling](../lamina-error-handling/SKILL.md) |
| Problem undefined, early discovery | [feature-discovery](../lamina-feature-discovery/SKILL.md) |
| Expert-only features, featuritis | [feature-prioritization](../lamina-feature-prioritization/SKILL.md) |
| Did my action work? | [feedback-and-status](../lamina-feedback-and-status/SKILL.md) |
| Observe real behavior in context | [field-research](../lamina-field-research/SKILL.md) |
| Workflow excise, orchestration | [flow-design](../lamina-flow-design/SKILL.md) |
| Wireframe preview, screen structure | [blueprint](../lamina-blueprint/SKILL.md) |
| Form abandonment, validation pain | [forms](../lamina-forms/SKILL.md) |
| Nielsen heuristics, no users yet | [heuristic-review](../lamina-heuristic-review/SKILL.md) |
| Structure content and data | [information-architecture](../lamina-information-architecture/SKILL.md) |
| Interview guide, question craft | [interview-design](../lamina-interview-design/SKILL.md) |
| Capture and organize notes | [interview-documentation](../lamina-interview-documentation/SKILL.md) |
| Touch, mobile patterns | [mobile-interaction](../lamina-mobile-interaction/SKILL.md) |
| Lost users, breadcrumbs, deep pages | [navigation](../lamina-navigation/SKILL.md) |
| Learnability, can't figure it out | [onboarding](../lamina-onboarding/SKILL.md) |
| Social features, ethical persuasion | [persuasion-and-groups](../lamina-persuasion-and-groups/SKILL.md) |
| Sovereign vs transient density | [platform-posture](../lamina-platform-posture/SKILL.md) |
| Research questions misaligned | [problem-framing](../lamina-problem-framing/SKILL.md) |
| UI mirrors database/org chart | [product-behavior](../lamina-product-behavior/SKILL.md) |
| Novice overwhelmed, power users stuck | [progressive-disclosure](../lamina-progressive-disclosure/SKILL.md) |
| Post-launch metrics, A/B tests | [quantitative-validation](../lamina-quantitative-validation/SKILL.md) |
| Scenarios to specs | [requirements-definition](../lamina-requirements-definition/SKILL.md) |
| Deliver findings, build impact | [research-communication](../lamina-research-communication/SKILL.md) |
| Study logistics, recruitment | [research-planning](../lamina-research-planning/SKILL.md) |
| Assumptions untested, scope debate | [research-scoping](../lamina-research-scoping/SKILL.md) |
| Affinity mapping, sense-making | [research-synthesis](../lamina-research-synthesis/SKILL.md) |
| Org politics, objections | [stakeholder-alignment](../lamina-stakeholder-alignment/SKILL.md) |
| Task flows, deal-breaker tasks | [task-analysis](../lamina-task-analysis/SKILL.md) |
| Goodwill depleted, rude UX | [trust](../lamina-trust/SKILL.md) |
| Test prototype or live product | [usability-evaluation](../lamina-usability-evaluation/SKILL.md) |
| Personas, primary user | [user-modeling](../lamina-user-modeling/SKILL.md) |

## Supporting files

- [reference.md](reference.md) — research shortcuts and glossary (optional)
- [guardrails.md](guardrails.md) — scope limits
- [lamina-orchestrator](../lamina-orchestrator/SKILL.md) — multi-capability workflows, merge rules, subagent patterns
