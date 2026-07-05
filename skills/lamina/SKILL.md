---
name: lamina
description: "Unified UX research and design knowledge base. Use when conducting user research, designing interactions, evaluating usability, building personas, running persona panel simulations, preserving .lamina/ UX artifacts across sessions, running interviews, or applying human-centered design reasoning."
---

<!-- argument-hint: [problem or capability-id] -->

# Lamina - UX Research & Design Knowledge Base

**Capabilities**: 38 problem-oriented guides

## Entry points (slash commands)

| Command | Use when |
|---|---|
| `/lamina` | Auto-route or single-topic answer |
| `/lamina-ideate` | Problem ? full concept |
| `/lamina-feature` | Feature idea ? spec + checklist |
| `/lamina-optimize` | Audit existing flows |

Workflow commands: load [orchestration.md](orchestration.md), then the matching file from `commands/`. Direct mode: [reference.md](reference.md) ? one capability (below).

**Guardrail:** UX artifacts only. Do not implement product code or visual styling specs.

## How to Use

**Load order** (minimize tokens): `reference.md` ? `capabilities/<problem>.md`

- **Without arguments** — scan the Problem Router below; load the matching capability
- **With a problem** — e.g. `forms`, `usability testing`, `users feel lost`; load that capability directly
- **Cross-cutting filters** — prioritization and evidence triage ? [decision-making](capabilities/decision-making.md)
- **Artifacts** — load [artifacts.md](artifacts.md) when writing or reusing `.lamina/` outputs (includes persona cast and panel protocol)

## Problem Router

| Problem signal | Capability |
|---|---|
| Assumptions untested, scope debate | [research-scoping](capabilities/research-scoping.md) |
| Problem undefined, early discovery | [feature-discovery](capabilities/feature-discovery.md) |
| Research questions misaligned | [problem-framing](capabilities/problem-framing.md) |
| Study logistics, recruitment | [research-planning](capabilities/research-planning.md) |
| Interview guide, question craft | [interview-design](capabilities/interview-design.md) |
| Observe real behavior in context | [field-research](capabilities/field-research.md) |
| Capture and organize notes | [interview-documentation](capabilities/interview-documentation.md) |
| Affinity mapping, sense-making | [research-synthesis](capabilities/research-synthesis.md) |
| Personas, primary user | [user-modeling](capabilities/user-modeling.md) |
| Scenarios to specs | [requirements-definition](capabilities/requirements-definition.md) |
| Task flows, deal-breaker tasks | [task-analysis](capabilities/task-analysis.md) |
| Prioritize features, triangulate evidence | [decision-making](capabilities/decision-making.md) |
| Test prototype or live product | [usability-evaluation](capabilities/usability-evaluation.md) |
| Nielsen heuristics, no users yet | [heuristic-review](capabilities/heuristic-review.md) |
| Market positioning, parity debates | [competitive-analysis](capabilities/competitive-analysis.md) |
| Post-launch metrics, A/B tests | [quantitative-validation](capabilities/quantitative-validation.md) |
| UI mirrors database/org chart | [product-behavior](capabilities/product-behavior.md) |
| Workflow excise, orchestration | [flow-design](capabilities/flow-design.md) |
| Sovereign vs transient density | [platform-posture](capabilities/platform-posture.md) |
| Expert-only features, featuritis | [feature-prioritization](capabilities/feature-prioritization.md) |
| Social features, ethical persuasion | [persuasion-and-groups](capabilities/persuasion-and-groups.md) |
| Structure content and data | [information-architecture](capabilities/information-architecture.md) |
| Lost users, breadcrumbs, deep pages | [navigation](capabilities/navigation.md) |
| Wordy pages, scan failures | [content-design](capabilities/content-design.md) |
| Form abandonment, validation pain | [forms](capabilities/forms.md) |
| Destructive actions, undo | [controls-and-menus](capabilities/controls-and-menus.md) |
| Touch, mobile patterns | [mobile-interaction](capabilities/mobile-interaction.md) |
| Learnability, can't figure it out | [onboarding](capabilities/onboarding.md) |
| No data yet screen | [empty-states](capabilities/empty-states.md) |
| Novice overwhelmed, power users stuck | [progressive-disclosure](capabilities/progressive-disclosure.md) |
| Hidden affordances, signifiers | [discoverability](capabilities/discoverability.md) |
| High errors, bad messages | [error-handling](capabilities/error-handling.md) |
| Did my action work? | [feedback-and-status](capabilities/feedback-and-status.md) |
| Goodwill depleted, rude UX | [trust](capabilities/trust.md) |
| Inclusive design | [accessibility](capabilities/accessibility.md) |
| Double-diamond, team design | [design-process](capabilities/design-process.md) |
| Org politics, objections | [stakeholder-alignment](capabilities/stakeholder-alignment.md) |
| Deliver findings, build impact | [research-communication](capabilities/research-communication.md) |

## Supporting files

- [orchestration.md](orchestration.md) — multi-capability workflows, merge rules, subagent hints
- [reference.md](reference.md) — shortcuts, full capability index, glossary
- [artifacts.md](artifacts.md) — `.lamina/` artifact contract, persona cast and panel protocol

## Scope & Limits

Problem-first routing loads one capability per user problem. Each capability bundles frameworks, checklists, heuristics, rubrics, prompts, and abbreviated examples. Provenance for human audit lives in `meta/` and is not part of the agent load path.
