---
name: lamina-requirements-definition
description: "Requirements Definition UX guidance. Use when turning research into requirements; writing scenarios and vision; bridging insights to specs."
metadata:
  lamina:
    id: requirements-definition
    problems:
      - "turning research into requirements"
      - "writing scenarios and vision"
      - "bridging insights to specs"
      - "bridging research to specs"
      - "vision setting"
    related:
      - lamina-user-modeling
      - lamina-product-behavior
      - lamina-task-analysis
---
# Requirements Definition

## Decision frameworks

- **Bridging the Research-Design Gap**: Personas and scenarios connect ethnographic data to concrete design decisions. - Use when research feels disconnected from wireframes. - How: Write context scenarios first; derive requirements from persona goals in narrative form.
- **Scenarios: Narrative as a Design Tool**: Stories describing personas using the product to achieve goals. - Use when teams need shared vision beyond feature lists. - How: Context scenarios → key-path scenarios → validation scenarios.
- **Design Requirements: The What of Interaction**: Statements of product behavior needed to satisfy scenarios—not implementation specs.
- **The Requirements Definition Process**: Iterative refinement from context through key paths to validation.
- **Context Scenarios**: Day-in-the-life stories without UI detail—anchor on persona goals and motivations. - Use at the start of requirements definition. - How: Write in present tense; follow one persona through a realistic day until the product opportunity appears.
- **Key-Path Scenarios**: Primary flows with interaction references once context is established. - Use when defining core product behavior. - How: One scenario per critical path; note decision points and system responses.

## Checklists

1. Define what the product will do before how it will do it.
2. Context scenarios keep design anchored on persona goals, not implementation models.
3. Design requirements are behavioral contracts derived from narrative.
4. Key-path and validation scenarios complete the picture for primary and edge flows.
5. Shared scenarios give the whole team a common vision to evaluate against.

## Heuristics

- **Context scenario**: Day-in-the-life narrative without interface mechanics.
- **Key-path scenario**: Primary interaction flows with UI references.
- **Validation scenario**: Edge cases, errors, and alternative paths.
- **Magic interface**: Early scenarios assume ideal interaction—constraints come later.
- Scenarios are**screenplays**—personas are the actors, the product is the stage.
- Requirements answer**what must happen**before designers answer**how it looks**.
- Pretend the interface is**magic**in early scenarios to avoid premature constraint. - **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.

## Evaluation rubrics

### Scenario To Requirements
- **When**: Bridging research insights to design specifications.
- **Process**: Write narrative with archetype achieving end goal  ->  extract capabilities  ->  define design requirements  ->  prioritize by primary user.
- **Pass**: Requirements trace to scenarios and goals; prioritized list exists.
- **Failure signals**: Happy-path-only narratives; requirements disconnected from research.

## Anti-patterns

- **Jumping to wireframes**: Designing screens before defining persona goals in narrative.
- **Feature laundry lists**: Requirements as competitor parity checklists without behavioral rationale.
- **Requirements as implementation**: Specifying database fields instead of user-facing behavior.

## Examples

- **Vision Scenarios Requirements**: For a contact-management app, writes a context scenario for persona Vivien: she learns a colleague's spouse is ill and wants to send condolences without awkward delay. From this, requirements emerge: surface relationship context proactively, enable one-gesture acknowledgment—behavioral needs no feature matrix would capture.

## Related capabilities

- [User Modeling](../lamina-user-modeling/SKILL.md)
- [Product Behavior](../lamina-product-behavior/SKILL.md)
- [Task Analysis](../lamina-task-analysis/SKILL.md)
