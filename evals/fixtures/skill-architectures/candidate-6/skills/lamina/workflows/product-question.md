# Product-question workflow

Answer a focused product, systems, or UX question with at most one primary capability leaf unless the question itself spans multiple concerns. Do not start implementation or Mission machinery.

> Migrated intact from `skills/lamina-core/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Lamina Core — Problem Router

Load one capability skill per problem.

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
WorkMap gate. See guardrails.md.

## Systems thinking (spine)

| Problem signal | Skill |
|----------------|-------|
| Entities, relationships, purpose | system-structure |
| Feedback, delays, oscillation | feedback-loops |
| Fixes keep failing, structural traps | system-traps |
| Where to intervene (rules vs UI) | leverage-points |
| Impossible states, business rules | invariants |
| Feature reachability, unmet prerequisites, degraded modes | dependencies — **first-class** |
| Domain boundaries, hide complexity | modularity-boundaries |
| What users see when (stale data) | consistency-guarantees |
| Double-submit, concurrent edits | idempotency-concurrency |
| Name trade-offs before mechanisms | tradeoffs |
| Multi-actor views stay consistent | multi-view-integrity |
| Evolving rules safely | evolutionary-rules |
| Notifications, downstream updates | side-effects |
| Dates, deadlines, expiry, recurrence, timezones | time-semantics |

## UX and product expression

| Problem signal | Skill |
|----------------|-------|
| Bootstrap context | business-context |
| Inclusive design | accessibility |
| Copy, labels, errors | content-design |
| Prioritize, resolve conflicts | decision-making |
| Affordances, signifiers | discoverability |
| Domain-empty screens | empty-states |
| Violation recovery UX | error-handling |
| Permission/conflict scenarios | edge-cases |
| Unreachable or silently broken prerequisites | dependencies |
| Async feedback, status | feedback-and-status |
| User journeys over state | flow-design |
| Forms under rules | forms |
| Local date/time input | time-semantics |
| Entity organization | information-architecture |
| Wayfinding | navigation |
| First-run paths | onboarding |
| UI reflects domain truth | product-behavior |
| Operations actors perform | task-analysis |
| Actors, roles, permissions | user-modeling |

## Agent simulation (replaces human research)

Human labs, interviews, and workshop ceremony are reframed as **contract + live-product simulation**.

| Problem signal | Skill |
|----------------|-------|
| Design→build→verify loop | design-process |
| Scope the design target | problem-framing |
| Map ask → workflows | feature-discovery |
| What evidence vs assumption | research-scoping |
| Plan independent design-time and verify-time actor walks | research-planning |
| Merge design discoveries or runtime findings | research-synthesis |
| Report walk findings | research-communication |
| Node-by-node actor-walk scripts | interview-design |
| Design simulation or runtime walkthrough evidence | interview-documentation |
| Repo + live UI grounding | field-research |
| Persona simulation (design and verify) | usability-evaluation |
| Real metrics only | quantitative-validation |
| Conflicting actor goals | stakeholder-alignment |
| User-cited references | competitive-analysis |
| Workflow priority | feature-prioritization |
| Group permissions / shared state | persuasion-and-groups |
| Parallel expert lenses | heuristic-review |
| Complexity budget / disclosure | platform-posture, progressive-disclosure |
| Payment / sensitive action honesty | trust |
| Testable acceptance criteria | requirements-definition |

## Supporting files

- guardrails.md
- artifacts.md
- lamina-orchestrator
