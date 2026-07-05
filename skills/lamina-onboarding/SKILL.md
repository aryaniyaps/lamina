---
name: lamina-onboarding
description: "Onboarding UX guidance. Use when first-time user experience; users can't figure out what to do; learnability vs power features."
metadata:
  lamina:
    id: onboarding
    problems:
      - "first-time user experience"
      - "users can't figure out what to do"
      - "learnability vs power features"
      - "onboarding failures"
      - "complex interfaces"
      - "novice and expert users"
      - "feature overload"
    related:
      - lamina-empty-states
      - lamina-discoverability
      - lamina-feature-prioritization
---
# Onboarding

## When to load

- first-time user experience
- users can't figure out what to do
- learnability vs power features
- onboarding failures
- complex interfaces
- novice and expert users
- feature overload

## Decision frameworks

- **Command Modalities**: Pedagogic (menus, dialogs teach via inspection), immediate (sliders, buttons act directly), invisible (keyboard accelerators, gestures require memory). - Use when structuring how users invoke functions. - How: Provide multiple modalities for critical commands; guide beginners to intermediates.
- **Working Sets**: The small set of functions perpetual intermediates use daily—optimize discoverability and speed here. - Use when prioritizing toolbar and menu prominence. - How: Research actual usage; promote working-set items; demote the rest.
- **Interface Paradigms**: Implementation-centric, metaphoric, and idiomatic design—prefer idioms users learn once.
- **Building Idioms**: Consistent patterns across the product so learning transfers.
- **Instinct, Intuition, and Learning**: Three ways users grasp interfaces—design for learned idioms over fragile metaphors.
- **Escape the Grip of Metaphor**: Metaphors break at scale; idioms and direct manipulation scale better. - Use when choosing conceptual models for new features. - How: Test whether metaphor holds across all states; if not, switch to idiomatic pattern.
- **Help Systems as Fallback**: Online help, ToolTips, and tutorials when command modalities insufficient. - Use after optimizing pedagogic and immediate modalities. - How: Context-sensitive help tied to current task, not generic manual.

## Checklists

1. Provide multiple command modalities for critical functions.
2. Optimize the working set—the functions intermediates use daily.
3. Build idioms, not metaphors—learn once, reuse everywhere.
4. Rich visual feedback and pliancy support direct manipulation learning.
5. Help systems are fallback—design the interface to teach itself first.

## Heuristics

- **Information in the world vs. information in the head**: Pedagogic commands externalize knowledge; invisible commands require memorization.
- **Memorization vectors**: UI elements that help users graduate from menus to shortcuts.
- **Most people would rather be successful than knowledgeable.**
- **All idioms must be learned; good idioms need to be learned only once.**
- **Manual Affordances**and**Direct Manipulation and Pliancy**: Visual cues for manipulability.
- Learnability is a**graduation path**—pedagogic → immediate → invisible.
- Metaphors**don't scale**; idioms**compound**across features.
- Working set**is the product**for perpetual intermediates. - **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.

## Evaluation rubrics

### Discoverability Checklist
- **When**: Evaluating whether users can determine possible actions and how things work.
- **Process**: Check signifiers (where to act), mapping (control-effect relationship), feedback, constraints, conceptual model clarity.
- **Pass**: All checklist elements pass for primary tasks.
- **Failure signals**: Invisible affordances; inconsistent mapping; mode confusion.

### Progressive Disclosure
- **When**: Complex interfaces serving both novice and experienced users.
- **Process**: Show essential controls first  ->  reveal advanced on demand  ->  remember preferences  ->  inflect by expertise.
- **Pass**: Novices unoverwhelmed; experts can reach power features.
- **Failure signals**: Hidden power features; too many upfront choices.

## Anti-patterns

- **Metaphor-bound interfaces**: Org-chart navigation, skeuomorphic decoration without behavior.
- **Invisible-only expert paths**: Accelerators with no discovery mechanism.
- **Menus forever**: Never providing faster paths for returning users.
- **Bending interface to fit metaphor**: Never bend your interface to fit a metaphor.

## Examples

- **Designing For Learnability**: Adobe Reader menus expose keyboard mnemonics and toolbar icons—pedagogic modality teaching invisible accelerators. designs a health app where nurses first use labeled menus for room assignment, then drag handles on a facility map (immediate), then learn Ctrl+R for rapid reassignment (invisible)—each modality serves the same command at different skill levels.

## Related capabilities

- [Empty States](../lamina-empty-states/SKILL.md)
- [Discoverability](../lamina-discoverability/SKILL.md)
- [Feature Prioritization](../lamina-feature-prioritization/SKILL.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](../lamina-decision-making/SKILL.md).
