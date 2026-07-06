---
name: lamina-progressive-disclosure
description: "Progressive Disclosure UX guidance. Use when complex interfaces overwhelming novices; hiding power features from experts; feature overload on first view."
metadata:
  lamina:
    id: progressive-disclosure
    problems:
      - "complex interfaces overwhelming novices"
      - "hiding power features from experts"
      - "feature overload on first view"
      - "complex interfaces"
      - "novice and expert users"
      - "feature overload"
    related:
      - lamina-feature-prioritization
      - lamina-controls-and-menus
      - lamina-onboarding
---
# Progressive Disclosure

## Decision frameworks

- **Progressive Disclosure**: Show essential controls first; reveal advanced on demand. - When: Novice and expert users share one interface. - How: Default to common tasks; tuck power features behind explicit affordances; remember preferences.
- **Command Modalities**: Pedagogic (menus, dialogs teach via inspection), immediate (sliders, buttons act directly), invisible (keyboard accelerators, gestures require memory). - Use when structuring how users invoke functions. - How: Provide multiple modalities for critical commands; guide beginners to intermediates.
- **Working Sets**: The small set of functions perpetual intermediates use daily—optimize discoverability and speed here. - Use when prioritizing toolbar and menu prominence. - How: Research actual usage; promote working-set items; demote the rest.
- **Interface Paradigms**: Implementation-centric, metaphoric, and idiomatic design—prefer idioms users learn once.
- **Building Idioms**: Consistent patterns across the product so learning transfers.
- **Instinct, Intuition, and Learning**: Three ways users grasp interfaces—design for learned idioms over fragile metaphors.
- **Escape the Grip of Metaphor**: Metaphors break at scale; idioms and direct manipulation scale better. - Use when choosing conceptual models for new features. - How: Test whether metaphor holds across all states; if not, switch to idiomatic pattern.
- **Help Systems as Fallback**: Online help, ToolTips, and tutorials when command modalities insufficient. - Use after optimizing pedagogic and immediate modalities. - How: Context-sensitive help tied to current task, not generic manual.

## Heuristics

- Show essential controls first  -  reveal advanced on demand.
- Remember user preferences to reduce repeated disclosure.
- Inflect interface by expertise level when usage data supports it.
- **Information in the world vs. information in the head**: Pedagogic commands externalize knowledge; invisible commands require memorization.
- **Memorization vectors**: UI elements that help users graduate from menus to shortcuts.
- **Most people would rather be successful than knowledgeable.**
- **All idioms must be learned; good idioms need to be learned only once.**
- **Manual Affordances**and**Direct Manipulation and Pliancy**: Visual cues for manipulability.

## Evaluation rubrics

### Progressive Disclosure
- **When**: Complex interfaces serving both novice and experienced users.
- **Process**: Show essential controls first  ->  reveal advanced on demand  ->  remember preferences  ->  inflect by expertise.
- **Pass**: Novices unoverwhelmed; experts can reach power features.
- **Failure signals**: Hidden power features; too many upfront choices.

## Anti-patterns

- **Hidden power features**: Advanced users cannot find capabilities they need.
- **Too many upfront choices**: Novices overwhelmed before first success.

## Related capabilities

- [Feature Prioritization](../lamina-feature-prioritization/SKILL.md)
- [Controls And Menus](../lamina-controls-and-menus/SKILL.md)
- [Onboarding](../lamina-onboarding/SKILL.md)
