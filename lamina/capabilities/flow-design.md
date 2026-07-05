---
id: flow-design
problems:
  - "multi-step workflow design"
  - "reducing excise and manipulative work"
  - "orchestrating user flows"
related:
  - product-behavior
  - forms
  - task-analysis
---

# Flow Design

## When to load

- multi-step workflow design
- reducing excise and manipulative work
- orchestrating user flows

## Decision frameworks

- **Flow and Transparency**: Design so interaction mechanics disappear and users face their objectives directly (Csikszentmihalyi flow). - Use when evaluating whether UI interrupts productive concentration. - How: Minimize interface; make interaction transparent like invisible prose.
- **Orchestration / Harmonious Interactions**: All elements work coherently toward a single goal—follow mental models, less is more, modeless feedback. - Use when composing multi-step workflows. - How: Apply strategies—provide choices not questions, keep tools close, avoid blank slates.
- **behavior-first Tasks versus Excise Tasks**: Goal-directed tasks advance user objectives; excise satisfies tools or external agents. - Use when auditing any workflow or form. - How: Map each action—does it directly serve the persona's goal?
- **Types of Excise**: Navigational, manipulative, modality, and visual excise.
- **Eliminating Excise**: Allow input wherever you have output; don't stop proceedings with idiocy; ask forgiveness not permission.
- **Motion, Timing, and Transitions**: Animation that communicates state change without delaying user action. - Use when objects move, appear, or transform. - How: Keep transitions under 300ms for responsiveness; use motion to show causality.
- **The Ideal of Effortlessness**: Reduce steps, decisions, and mode switches on behavior-first paths. - Use during excise audits. - How: Count clicks, fields, and mode changes from intent to outcome.
- **Creating the Design Framework**: Three parallel frameworks define product skeleton before pixel polish. - How: Map objects and navigation → define functional groups and flows → establish layout and hierarchy.
- **Refining the Form and Behavior**: Iterative detail on controls, states, transitions within the framework.
- **Validating and Testing the Design**: Usability testing and design reviews against scenarios and requirements.
- **Information Framework**: Object map and navigation hierarchy derived from persona mental models. - Use before wireframing individual screens. - How: List domain objects, relationships, and primary navigation paths from scenarios.
- **Interaction Framework**: Functional grouping of controls and behaviors supporting key paths. - Use when defining how users manipulate content objects. - How: Map inputs, outputs, and state changes for each key-path scenario.

## Checklists

1. Preserve flow—disrupting concentration destroys productivity.
2. Eliminate excise wherever possible; classify every step as behavior-first or excise.
3. Orchestrate interactions harmoniously toward persona goals.
4. Allow input wherever you have output; don't make users traverse separate spaces.
5. Significant change must be significantly better—don't reshuffle without measurable gain.
1. Framework design establishes structure across information, interaction, and visual dimensions.
2. Refinement adds detail without abandoning framework decisions.
3. Form and behavior must be designed in concert.
4. Never present a design direction you wouldn't defend to completion.
5. Validate against scenarios and requirements, not gut reactions alone.

## Heuristics

- **No matter how cool your interface is, less of it would be better.**
- **Excise Is Contextual**: Pedagogic navigation may serve learners even if it feels like excise to experts.
- **Logical zoom**: Interface complexity scales with user expertise.
- **The Ideal of Effortlessness**: Motion, timing, transitions support flow.
- Flow is**mental ergonomics**—disruption has compound cost.
- Excise is a**tax on every use**—compound taxes drive abandonment.
- Digital products need not replicate**physical-world roadblocks**.
- **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.
- **Information framework**: Object hierarchy, navigation structure, content organization.
- **Interaction framework**: Functional grouping, input/output mapping, core behavior patterns.
- **Visual framework**: Grid, typography, color, spatial hierarchy.
- **Form and behavior in concert**: There is only one user experience.
- Framework is**architecture**; refinement is**interior design**.
- Never show a design you're unhappy with—stakeholders may prefer the wrong direction.
- Testing validates**persona goal achievement**, not aesthetic preference alone.

## Anti-patterns

- **Dialogs to report normalcy**: Stopping flow for routine status.
- **Permission for routine actions**: Confirming saves users clearly intend.
- **Deep navigation for frequent features**: Hiding daily tasks in menu hierarchies.
- **Visible interaction designer**: Clumsy UI that reminds users they're using software.
- **Premature visual polish**: High-fidelity mockups before interaction framework is settled.
- **Framework drift**: Adding features that break established information architecture.
- **Separate visual and interaction tracks**: Form divorced from behavior produces incoherent products.

## Examples

- **Orchestration Flow Excise**: A clerk enters invoices but the app halts on ZIP format mismatches with modal errors. reframes: the goal is recording invoices, not satisfying schema at keystroke time. Goal-directed redesign accepts varied formats, flags uncertain entries with modeless feedback, and enables batch audit later—eliminating manipulative excise while preserving data quality.

## Related capabilities

- [Product Behavior](product-behavior.md)
- [Forms](forms.md)
- [Task Analysis](task-analysis.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](decision-making.md).
