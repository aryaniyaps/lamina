---
name: lamina-feedback-and-status
description: "Feedback And Status UX guidance. Use when users unsure if action worked; opaque system state changes; action-feedback loop gaps."
metadata:
  lamina:
    id: feedback-and-status
    problems:
      - "users unsure if action worked"
      - "opaque system state changes"
      - "action-feedback loop gaps"
      - "interaction design"
      - "users can't act"
      - "users can't tell what happened"
    related:
      - lamina-discoverability
      - lamina-error-handling
      - lamina-trust
    tags:
      - audit-default
---
# Feedback and Status

## When to load

- users unsure if action worked
- opaque system state changes
- action-feedback loop gaps
- interaction design
- users can't act
- users can't tell what happened

## Decision frameworks

- **Forcing Functions**: Physical or logical constraints preventing continuation until critical action taken (car won't start without key; microwave stops when door opens). - When to use: Safety-critical or irreversible actions. - How: Interlocks, confirmations that require understanding, not just clicking OK.
- **Visibility of System State**: User always knows where they are, what's happening, what's possible next. - When to use: Multi-step flows, modes, async operations. - How: Progress indicators, breadcrumbs, status messages, disabled state styling.
- **Design Exploits Constraints**: Combine physical, semantic, logical constraints so correct assembly/interaction is the only path. - When to use: Complex configuration, assembly, forms. - How: Shape coding, slot-key matching, disable invalid options.

## Checklists

1. Combine affordances, signifiers, mapping, constraints, and feedback.
2. Forcing functions prevent errors at critical moments.
3. System state must always be visible.
4. Group controls logically and spatially.
5. Constraints beat warnings for error prevention.
6. Feedforward previews consequences; feedback confirms results.
7. Every step should answer "what do I do now?"

## Heuristics

- **Affordances + signifiers + mapping + constraints + feedback**: Integrated toolkit for "knowing what to do."
- **Interlock**: Forcing function variant—action A required before B enabled.
- **Visibility**: Opposite of mystery—state perceivable without recall.
- **Grouping**: Related controls clustered by function or spatial logic.
- **Feedforward + feedback loop**: Continuous guidance through task.
- Think of each screen as**answering one question**: "What can I do here, right now?"
- Use forcing functions as**guardrails**, not annoyances—reserve for true risks.
- Treat invisible state as**design absence**—users will guess wrong.

## Evaluation rubrics

### Action Feedback Cycle
- **When**: Analyzing or designing any interactive control flow.
- **Process**: Map goal  ->  plan  ->  specify  ->  perform  ->  perceive  ->  interpret  ->  compare. Ensure each stage has visible feedback.
- **Pass**: Users can tell what happened and whether goal is met.
- **Failure signals**: Delayed or missing feedback; opaque state changes.

### Execution Evaluation Gaps
- **When**: Users struggle to execute intentions or interpret system state.
- **Process**: Bridge execution gap (intent to action) with affordances and signifiers. Bridge evaluation gap (action to understanding) with clear feedback.
- **Pass**: Users know what they can do and what happened after acting.
- **Failure signals**: Hidden controls; ambiguous system state; no signifiers.

## Anti-patterns

- **Mystery meat navigation**: No signifier of what's clickable.
- **Disabled with no explanation**: User doesn't know why or how to enable.
- **Warnings without constraints**: "Are you sure?" on destructive acts users click through.
- **Mode confusion**: Same control different effects—visibility fails.
- **Async silence**: Upload/processing with no progress feedback.

## Examples

- **Knowing What To Do**: Car ignition interlock: must be in Park, foot on brake, key present—constraints chain prevents dangerous starts. Web equivalent: checkout won't proceed without shipping address (forcing function with visible empty field signifier); progress bar during payment (feedback); shipping/billing grouped (mapping). Bad: identical buttons "Continue" on each step with no indication what's missing when disabled.

## Related capabilities

- [Discoverability](../lamina-discoverability/SKILL.md)
- [Error Handling](../lamina-error-handling/SKILL.md)
- [Trust](../lamina-trust/SKILL.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](../lamina-decision-making/SKILL.md).
