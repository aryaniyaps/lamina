---
name: lamina-ux
description: "Design understandable and accessible product interactions. Use when shaping workflows, information architecture, navigation, interface copy, forms, controls, empty states, onboarding, feedback, error recovery, progressive disclosure, discoverability, accessibility, trust, group dynamics, or interaction edge cases. Use lamina-product-behavior for authoritative state rules and lamina-evaluation to judge a built product."
---

# Lamina UX

## Reference-loading protocol

1. Match the request's primary interaction risk to one row below.
2. Open that linked reference before answering. Add another only when a second
   risk materially changes the answer; do not preload the directory.
3. Start the response with `Using lamina-ux: <topic path(s)>` so the selected
   interaction lens is auditable.

## Topic index

| Interaction signal | Read | Adds |
|---|---|---|
| Need the end-to-end design-to-implementation loop | [Design Process](references/design-process.md) | Persona walks, graph expansion, implementation, and verification lifecycle |
| Need to order steps, branches, prerequisites, and recovery for one outcome | [Workflow Design](references/flow-design.md) | operation-level flow structure |
| Need to group product concepts, hierarchy, labels, or findability | [Information Architecture](references/information-architecture.md) | entity- and task-based organization |
| Users are lost between destinations or cannot maintain orientation | [Navigation](references/navigation.md) | wayfinding, current location, and route structure |
| Need labels, headings, instructions, empty copy, or error copy | [Content Design](references/content-design.md) | consistent, scan-first interface language |
| Need input semantics, validation timing, field errors, or submission recovery | [Forms](references/forms.md) | accessible validation and data-entry behavior |
| Need action hierarchy, destructive-action policy, menus, confirmation, or undo | [Controls and Actions](references/controls-and-menus.md) | explicit action semantics and reversibility |
| A collection or account has no data yet | [Empty States](references/empty-states.md) | scenario-bound explanation and next action |
| New or returning users cannot reach first value | [Onboarding](references/onboarding.md) | minimal setup, permissions, and resumable progress |
| Users cannot tell whether an action started, succeeded, failed, or is delayed | [Feedback and Status](references/feedback-and-status.md) | visible transient and terminal states |
| Need actor-visible failure language and a concrete recovery path | [Error Handling](references/error-handling.md) | error categories, recovery, and blame-free copy |
| The interface exposes too much complexity at once | [Progressive Disclosure](references/progressive-disclosure.md) | essential versus advanced action tiers |
| Users cannot perceive an available action or its consequence | [Discoverability](references/discoverability.md) | signifiers, disabled reasons, and feedback gulfs |
| Need keyboard, screen-reader, focus, announcement, contrast, or touch behavior | [Accessibility](references/accessibility.md) | interaction-specific accessible acceptance criteria |
| Behavior changes through invitations, persuasion, groups, or social influence | [Multi-Actor Dynamics](references/persuasion-and-groups.md) | consent, autonomy, and group-effect safeguards |
| A high-stakes action needs honest consequence, fee, privacy, or success signals | [Trust Signals](references/trust.md) | observable product honesty |
| Need distinct denied, stale, concurrent, destructive, or dependency-failure cases | [Distinct Product Risks](references/edge-cases.md) | non-duplicative scenarios with observable acceptance |

## Working rule

Use the smallest sufficient reference set. Common pairs are forms + error
handling, navigation + information architecture, and feedback + trust for
high-stakes asynchronous actions. Accessibility applies to every critical
interaction but load its full reference when accessibility behavior is a
decision, acceptance target, or stated risk.
