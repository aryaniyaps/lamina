---
name: lamina-user-modeling
description: "User Modeling UX guidance. Use when building personas from research; identifying primary users; behavioral archetypes and goals."
metadata:
  lamina:
    id: user-modeling
    problems:
      - "building personas from research"
      - "identifying primary users"
      - "behavioral archetypes and goals"
      - "after qualitative research"
      - "before requirements"
      - "feature debates need user grounding"
      - "feature prioritization debate"
      - "conflicting user needs"
    related:
      - lamina-research-synthesis
      - lamina-requirements-definition
      - lamina-decision-making
---
# User Modeling

## When to load

- building personas from research
- identifying primary users
- behavioral archetypes and goals
- after qualitative research
- before requirements
- feature debates need user grounding
- feature prioritization debate
- conflicting user needs

## Decision frameworks

- **Personas**: Fictional individuals assembled from real behavior patterns; each represents a class of users for a specific product context. - When to use: After research synthesis; before scenarios and requirements. - How: Group by role → identify behavioral variables → map subjects → find clusters → synthesize goals → designate types → write narrative.
- **Three types of user goals**(mapped to visceral/behavioral/reflective): - **Experience goals**(how users want to feel): smart, in control, reassured. - **End goals**(what users want to do): clear inbox by 5pm, find music they'll love. - **Life goals**(who users want to be): succeed, be respected, live well.
- **Persona types**: Primary (one per interface—design target), Secondary (satisfied by primary with additions), Supplemental, Customer, Served, Negative (anti-persona). - When to use: After persona construction; before framework design. - How: Eliminate until one primary persona's goals are fully met without disenfranchising others; avoid picking largest market segment over most constrained user (OXO Good Grips lesson).

## Checklists

1. Personas determine what the product should do and how it should behave; they align stakeholders without flowcharts.
2. Goals must relate to the product being designed; infer from behavior—users rarely state goals accurately.
3. Construct personas: 8-step process from grouping roles to expanding narratives with photos.
4. Zero to two experience goals, three to five end goals, zero to one life goal per persona is typical.
5. Customer and business goals matter but must not trump end-user goals at the user's expense.
6. The most important interaction guideline: don't make the user feel stupid.

## Heuristics

- **Elastic user**: "The user" who morphs between novice and expert to justify any design choice.
- **Self-referential design**: Designers or developers projecting their own skills onto the product.
- **Edge cases**: Must be supported but never drive the design focus.
- **Personas vs market segments**: Segments = demographics and buying; personas = usage behavior and goals.
- **Personas vs roles**: Roles are abstractions; personas add empathy, narrative, and goal hierarchy.
- **Provisional personas**: Hypothesis-based stand-ins when fieldwork isn't possible—better than none, but not a substitute.
- Design for specific individuals with specific needs—not everyone—because broad accommodation increases cognitive load for all.
- If your user model has no goals, it isn't a persona.
- Primary persona test: Would this person be satisfied by a design aimed at anyone else in the set? If not, they're primary.
- Personas are Method acting for interaction design: role-play scenarios from their perspective.

## Persona simulation

Personas are **simulated users**, not static documents. Run each persona as an **isolated subagent** (one agent per persona, parallel). Never inline multiple personas in one agent — that averages voices and kills conflict.

**Artifacts:** `.lamina/personas.yaml` (registry) and `.lamina/personas/simulations/<run_id>.yaml` (per panel run). See [artifacts.md](../../lamina-orchestrator/artifacts.md).

**Simulate via dynamic spawns:** one subagent per persona; each prompt embeds that persona's identity — `prompts/subagents/persona-panel-spawn.md`.

### Cast

After research synthesis or problem framing:
- Append to `personas.yaml`; no fixed persona count.
- Each entry needs: goals (experience/end/life), frustrations, motivations, technical_literacy, accessibility, confidence.
- Designate one `primary` persona per interface.
- Behavioral rigor over demographics; provisional personas get `confidence: low`.

### Simulate (think-aloud walkthrough)

When a flow, screen, or journey exists:
1. Orchestrator picks personas (always primary; add others relevant to the target).
2. Spawn one **dynamic subagent per persona** in parallel — each prompt makes the subagent **that person** (see `prompts/subagents/persona-panel-spawn.md`). Do not use a fixed agent type.
3. Orchestrator reconciles via Primary User Filter and conflict records.

**Situational context** (spawn prompt, not persisted): scenario, device, time_pressure, stakes.

### Simulation anti-patterns

- **Inlined personas:** One agent playing all users — produces designer-flavored consensus.
- **Simulation as research:** Label all panel output as simulation; real usability tests validate.
- **Designer vocabulary in character:** Personas describe confusion, not heuristic names.
- **Solutions in blockers:** Report pain and abandonment triggers, not prescribed fixes.
- **Cross-contamination:** Subagents must not see other personas' outputs before reconciling.

## Evaluation rubrics

### User Archetype Construction
- **When**: After qualitative user research, before design requirements.
- **Process**: Identify behavioral variables  ->  map subjects  ->  find patterns  ->  synthesize 2-4 archetypes  ->  define experience/end/life goals  ->  name and detail  ->  identify primary user.
- **Pass**: Archetypes distinguish behaviors and goals; primary user identified for prioritization.
- **Failure signals**: Thin research  ->  false precision; demographic-only personas.

### Primary User Filter
- **When**: Feature prioritization debates among multiple user types.
- **Process**: Ask: does this serve the primary user's goals ->  If no  ->  deprioritize or cut. If yes  ->  design fully for their scenario.
- **Pass**: Features ranked by primary user goal alignment.
- **Failure signals**: Designing for edge cases first; accommodating everyone equally  ->  nobody satisfied.

## Anti-patterns

- **Stereotype personas**: Stock photo + job title without behavioral rigor.
- **Demographic-only profiles**: Car and kids listed, no goals or pain points.
- **Reusing personas across products**: Behaviors are context-specific; one-size personas dilute precision.
- **Participatory design replacing personas**: Real users carry idiosyncrasies; aggregation reveals critical patterns.
- **Solutions in persona narratives**: Describe pain, not prescribed fixes.

## Examples

- **User Archetypes And Goals**: An online store interview mapping reveals clusters: User 1, 4, 5 are price-oriented necessity shoppers; User 2 is entertainment-driven; User 3 is service-oriented. Across axes (frequency, desire to shop, motivation), a significant pattern emerges—a "deal hunter" persona with end goals like "stretch the household budget" and experience goals like "feel smart, not duped." Design targets comparison tools and trust signals, not boutique browsing features that serve a different cluster.

## Related capabilities

- [Research Synthesis](../lamina-research-synthesis/SKILL.md)
- [Requirements Definition](../lamina-requirements-definition/SKILL.md)
- [Decision Making](../lamina-decision-making/SKILL.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](../lamina-decision-making/SKILL.md).
