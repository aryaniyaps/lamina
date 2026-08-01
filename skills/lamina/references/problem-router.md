# Lamina Core — Problem Router

Choose one primary capability per problem. Add only the exact references needed
for distinct secondary concerns; do not load another capability wholesale.

## Passive routing

| Request | Route |
|---------|----------|
| One-time `/lamina-init` | Bootstrap domain charter and provider rules |
| Ordinary feature or fix | Prepare context, complete design gaps, map, implement, verify |
| Focused product question | Load the smallest relevant capability skill |
| Explicit `/lamina-design` | Advanced graph-only design phase |
| Explicit `/lamina-verify` | Advanced source-read-only audit phase |

**Guardrail:** Product-design skills write `.lamina/` evidence and graph state,
not app source. The coding agent may edit app source only after the passive
WorkMap gate. See [guardrails.md](guardrails.md).

## Systems thinking (spine)

| Problem signal | Skill |
|----------------|-------|
| Entities, relationships, purpose | [system-structure](../../lamina-systems/references/system-structure.md) |
| Feedback, delays, oscillation | [feedback-loops](../../lamina-systems/references/feedback-loops.md) |
| Fixes keep failing, structural traps | [system-traps](../../lamina-systems/references/system-traps.md) |
| Where to intervene (rules vs UI) | [leverage-points](../../lamina-systems/references/leverage-points.md) |
| Impossible states, business rules | [invariants](../../lamina-product-behavior/references/invariants.md) |
| Feature reachability, unmet prerequisites, degraded modes | [dependencies](../../lamina-product-behavior/references/dependencies.md) — **first-class** |
| Domain boundaries, hide complexity | [modularity-boundaries](../../lamina-product-behavior/references/modularity-boundaries.md) |
| What users see when (stale data) | [consistency-guarantees](../../lamina-product-behavior/references/consistency-guarantees.md) |
| Double-submit, concurrent edits | [idempotency-concurrency](../../lamina-product-behavior/references/idempotency-concurrency.md) |
| Name trade-offs before mechanisms | [tradeoffs](../../lamina-product-discovery/references/tradeoffs.md) |
| Multi-actor views stay consistent | [multi-view-integrity](../../lamina-product-behavior/references/multi-view-integrity.md) |
| Evolving rules safely | [evolutionary-rules](../../lamina-systems/references/evolutionary-rules.md) |
| Notifications, downstream updates | [side-effects](../../lamina-product-behavior/references/side-effects.md) |
| Dates, deadlines, expiry, recurrence, timezones | [time-semantics](../../lamina-product-behavior/references/time-semantics.md) |

## UX and product expression

| Problem signal | Skill |
|----------------|-------|
| Bootstrap context | [business-context](../../lamina-product-discovery/references/business-context.md) |
| Inclusive design | [accessibility](../../lamina-ux/references/accessibility.md) |
| Copy, labels, errors | [content-design](../../lamina-ux/references/content-design.md) |
| Prioritize, resolve conflicts | [decision-making](../../lamina-product-discovery/references/decision-making.md) |
| Affordances, signifiers | [discoverability](../../lamina-ux/references/discoverability.md) |
| Domain-empty screens | [empty-states](../../lamina-ux/references/empty-states.md) |
| Violation recovery UX | [error-handling](../../lamina-ux/references/error-handling.md) |
| Permission/conflict scenarios | [edge-cases](../../lamina-ux/references/edge-cases.md) |
| Unreachable or silently broken prerequisites | [dependencies](../../lamina-product-behavior/references/dependencies.md) |
| Async feedback, status | [feedback-and-status](../../lamina-ux/references/feedback-and-status.md) |
| User journeys over state | [flow-design](../../lamina-ux/references/flow-design.md) |
| Forms under rules | [forms](../../lamina-ux/references/forms.md) |
| Action hierarchy, destructive actions, undo, menus | [controls-and-menus](../../lamina-ux/references/controls-and-menus.md) |
| Local date/time input | [time-semantics](../../lamina-product-behavior/references/time-semantics.md) |
| Entity organization | [information-architecture](../../lamina-ux/references/information-architecture.md) |
| Wayfinding | [navigation](../../lamina-ux/references/navigation.md) |
| First-run paths | [onboarding](../../lamina-ux/references/onboarding.md) |
| UI reflects domain truth | [product-behavior](../../lamina-product-behavior/references/product-behavior.md) |
| Operations actors perform | [task-analysis](../../lamina-research/references/task-analysis.md) |
| Actors, roles, permissions | [user-modeling](../../lamina-research/references/user-modeling.md) |

## Agent simulation (replaces human research)

Human labs, interviews, and workshop ceremony are reframed as **contract + live-product simulation**.

| Problem signal | Skill |
|----------------|-------|
| Design→build→verify loop | [design-process](../../lamina-ux/references/design-process.md) |
| Scope the design target | [problem-framing](../../lamina-product-discovery/references/problem-framing.md) |
| Map ask → workflows | [feature-discovery](../../lamina-product-discovery/references/feature-discovery.md) |
| What evidence vs assumption | [research-scoping](../../lamina-research/references/research-scoping.md) |
| Plan independent design-time and verify-time actor walks | [research-planning](../../lamina-research/references/research-planning.md) |
| Merge design discoveries or runtime findings | [research-synthesis](../../lamina-research/references/research-synthesis.md) |
| Report walk findings | [research-communication](../../lamina-research/references/research-communication.md) |
| Node-by-node actor-walk scripts | [interview-design](../../lamina-research/references/interview-design.md) |
| Design simulation or runtime walkthrough evidence | [interview-documentation](../../lamina-research/references/interview-documentation.md) |
| Repo + live UI grounding | [field-research](../../lamina-research/references/field-research.md) |
| Persona simulation (design and verify) | [usability-evaluation](../../lamina-evaluation/references/usability-evaluation.md) |
| Real metrics only | [quantitative-validation](../../lamina-evaluation/references/quantitative-validation.md) |
| Conflicting actor goals | [stakeholder-alignment](../../lamina-product-discovery/references/stakeholder-alignment.md) |
| User-cited references | [competitive-analysis](../../lamina-research/references/competitive-analysis.md) |
| Workflow priority | [feature-prioritization](../../lamina-product-discovery/references/feature-prioritization.md) |
| Group permissions / shared state | [persuasion-and-groups](../../lamina-ux/references/persuasion-and-groups.md) |
| Parallel expert lenses | [heuristic-review](../../lamina-evaluation/references/heuristic-review.md) |
| Complexity budget / disclosure | [platform-posture](../../lamina-product-behavior/references/platform-posture.md), [progressive-disclosure](../../lamina-ux/references/progressive-disclosure.md) |
| Payment / sensitive action honesty | [trust](../../lamina-ux/references/trust.md) |
| Testable acceptance criteria | [requirements-definition](../../lamina-product-discovery/references/requirements-definition.md) |

## Supporting files

- [guardrails.md](guardrails.md)
- [artifacts.md](../orchestrator/artifacts.md)
- [internal orchestration](../orchestrator/load-protocol.md)
