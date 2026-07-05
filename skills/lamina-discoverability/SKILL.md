---
name: lamina-discoverability
description: "Discoverability UX guidance. Use when users can't see what to do; hidden affordances and signifiers; execution and evaluation gaps."
metadata:
  lamina:
    id: discoverability
    problems:
      - "users can't see what to do"
      - "hidden affordances and signifiers"
      - "execution and evaluation gaps"
      - "users can't figure out what to do"
      - "onboarding failures"
      - "users can't act"
      - "users can't tell what happened"
    related:
      - lamina-onboarding
      - lamina-error-handling
      - lamina-feedback-and-status
    tags:
      - audit-default
      - interaction
---
# Discoverability

## When to load

- users can't see what to do
- hidden affordances and signifiers
- execution and evaluation gaps
- users can't figure out what to do
- onboarding failures
- users can't act
- users can't tell what happened

## Decision frameworks

- **Human-Centered Design (HCD)**: Design philosophy starting with people—ensure products fit human needs and capabilities. - When to use: Any product, service, or interface design. - How: Observe users; iterate; avoid specifying problems too early; integrate design specializations (interaction, industrial, service).
- **Affordances**: Relational property between object and agent—what actions the environment enables (a chair affords sitting; glass affords seeing through). - When to use: Designing interactive elements. - How: Match perceived and actual affordances; note anti-affordances block actions.
- **Signifiers**: Perceivable signals indicating where and how to act—more important than affordances for designers. - When to use: When affordances aren't visible (especially digital). - How: Labels, icons, handles, highlights showing actionable areas.
- **Mapping**: Relationship between controls and effects—natural mapping uses spatial correspondence. - When to use: Control layouts, dashboards, stove burners. - How: Align control position with outcome position (top-left burner → top-left knob).
- **Constraints**: Physical, cultural, semantic, and logical limits guiding correct action. - When to use: Preventing errors before they occur. - How: Make wrong actions impossible or unlikely.
- **Gulf of Execution**: Gap between user's goal and actions required to achieve it on the device. - When to use: Users can't figure out how to operate something. - How: Improve signifiers, constraints, mappings; simplify controls; match conceptual model.
- **Gulf of Evaluation**: Gap between system state and user's understanding of what happened. - When to use: Users performed action but can't tell if it worked. - How: Provide immediate, visible feedback; clear state indicators.
- **action feedback cycle**:
- **Feedback**: Continuous communication of system state—essential for bridging Gulf of Evaluation. - When to use: Every action with delayed or invisible outcome. - How: Immediate, informative, not annoying confirmation.
- **Knowledge in the World vs. Knowledge in the Head**:
- **World**: Signifiers, affordances, mappings, constraints, physical layout.
- **Head**: Conceptual models, cultural conventions, semantic/logical rules, analogies. - When to use: Deciding what users must learn vs. what design can show. - How: Put critical information in world; reserve head knowledge for transferable conventions.
- **Four Types of Constraints**:
- **Natural Mapping**: Exploit spatial correspondence between controls and effects. - When to use: Multi-control layouts. - How: Position controls where effects occur spatially.

## Checklists

1. HCD starts with people, not technology.
2. Affordances are relationships; signifiers make them visible.
3. Mapping connects controls to effects—prefer natural spatial mapping.
4. Constraints guide correct behavior physically and logically.
5. Conceptual models come from system image—design communicates.
6. Users blaming themselves signals design failure.
7. Discoverability is prerequisite for usable products.
1. Bridge Gulf of Execution (how to act) and Gulf of Evaluation (what happened).
2. Seven Stages trace goal to satisfaction—find the broken stage.
3. Feedback must be immediate and interpretable.
4. Feedforward sets expectations before action.
5. Conceptual models enable recovery when default plan fails.
6. Users blame themselves when design offers no recovery path.
7. Emotions signal gulf width—frustration means design debt.
1. Distribute knowledge between world and head strategically.
2. Use signifiers, constraints, and mapping to reduce memory load.
3. Four constraints—physical, cultural, semantic, logical—guide action.
4. Natural mapping exploits spatial layout.
5. Conventions in head enable transfer across products.
6. Arbitrary mappings are error-prone—redesign when possible.
7. Consistency lets users learn once, apply everywhere.

## Heuristics

- **Conceptual model**: User's mental story of how something works.
- **System image**: Designer communicates model via appearance, docs, feedback.
- **Discoverability**: Can users figure out what's possible?
- **Anti-affordance**: Prevents interaction (wall blocks passage).
- **Visceral/experience of failure**: Users blame themselves when design fails.
- Think**affordance as relationship**, not object property—exists only for capable agent in context.
- Use**signifiers as design's real job**—making affordances visible.
- Treat user self-blame as**symptom of bad design**, not user incompetence.
- **Feedforward**: Information before action showing what will happen.
- **Feedback**: Information after action showing what did happen.
- **Conceptual model**: Enables planning when things go wrong (filing cabinet example).
- **Root cause of landlady's failure**: Blamed herself; lacked model and recovery plan.
- **Emotional design**: Frustration when plans thwarted; pleasure when flow works.
- Think of design as**bridge-building**across two gulfs—not feature listing.
- Use Seven Stages as**debugging checklist**for interaction breakdowns.
- Treat feedback as**conversation**between system and user—silence is failure.
- **Memory burden**: Cognitive cost of recalling arbitrary mappings.
- **Reminding**: Environment cues recall at point of need.
- **Consistency**: Same action same result across system—learn once.
- **Standards and conventions**: Shared head knowledge across products.
- **Arbitrary mappings**: Require learning and cause errors (knob rows).
- Think of world knowledge as**post-it notes on reality**—design should litter environment with cues.
- Use constraints as**gentle rails**—physical where possible, logical everywhere.
- Treat arbitrary mappings as**memory tax**—eliminate unless unavoidable.

## Evaluation rubrics

### Discoverability Checklist
- **When**: Evaluating whether users can determine possible actions and how things work.
- **Process**: Check signifiers (where to act), mapping (control-effect relationship), feedback, constraints, conceptual model clarity.
- **Pass**: All checklist elements pass for primary tasks.
- **Failure signals**: Invisible affordances; inconsistent mapping; mode confusion.

### Execution Evaluation Gaps
- **When**: Users struggle to execute intentions or interpret system state.
- **Process**: Bridge execution gap (intent to action) with affordances and signifiers. Bridge evaluation gap (action to understanding) with clear feedback.
- **Pass**: Users know what they can do and what happened after acting.
- **Failure signals**: Hidden controls; ambiguous system state; no signifiers.

## Diagnostic questions

| Element | Ask |
|---|---|
| Signifiers | Can users see WHERE to act? |
| Mapping | Do controls relate naturally to effects? |
| Feedback | Does every action get immediate response? |
| Constraints | Are wrong actions prevented or hard? |
| Conceptual model | Will users form correct mental model? |

## Anti-patterns

- **Mystery door**: No signifier which side to push/pull.
- **Invisible affordances**: Touch screens with no discoverable gestures.
- **Bad mapping**: Arbitrary knob-to-burner layout on stoves.
- **Blaming users**: "Human error" without design investigation.
- **Technology-driven design**: Features without human needs.
- **No feedback on submit**: User clicks; nothing happens; clicks again.
- **Cryptic error states**: Gulf of evaluation widens.
- **Hidden modes**: Execution gulf expands when controls change meaning.
- **Blaming user incompetence**: Landlady syndrome—design didn't support recovery.
- **Delayed feedback**: User repeats action, causing errors.
- **Identical unlabeled controls**: Four stove knobs in a row.
- **Mode-dependent buttons**: Same button, different meaning—head knowledge overload.
- **Hidden conventions**: Assuming users know your internal jargon.
- **Over-reliance on training**: Fixing bad design with manuals.
- **Inconsistent mappings across products**: Users relearn constantly.

## Examples

- **Psychology Of Actions**: Filing cabinet drawer stuck: Landlady had goal and plan (pull handle) but no recovery when plan failed—Gulf of Execution expanded with no signifiers for alternative actions. conceptual model (catch mechanism misaligned) enabled wiggle, twist, bang strategy. Good design: visible release mechanism, feedback when catch engages, constraints preventing misalignment.
- **Knowledge Head World**: LEGO motorcycle assembly: physical constraints ensure pieces fit only correct mates; logical constraints when two pieces and two holes remain. Contrast: software installer with identical "Next" buttons where one skips critical option—no world knowledge, heavy head burden. Stove redesign: map knobs to burner positions spatially—knowledge in world replaces memorization.

## Related capabilities

- [Onboarding](../lamina-onboarding/SKILL.md)
- [Error Handling](../lamina-error-handling/SKILL.md)
- [Feedback And Status](../lamina-feedback-and-status/SKILL.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](../lamina-decision-making/SKILL.md).
