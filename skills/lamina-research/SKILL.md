---
name: lamina-research
description: "Plan and synthesize evidence-grounded product research. Use when deciding what evidence is needed, designing actor walkthroughs, grounding claims in a repository or live product, analyzing user-provided references, modeling users and tasks, or communicating findings without inventing data. Use lamina-evaluation instead to judge a built product, and lamina-ux to design interaction behavior."
---

# Lamina Research

## Reference-loading protocol

1. Match the request's primary research decision to one row below.
2. Open that linked reference before answering. Add another only when a second
   decision materially changes the answer; do not preload the directory.
3. Start the response with `Using lamina-research: <topic path(s)>` so the
   selected evidence lens is auditable.

## Topic index

| Decision signal | Read | Adds |
|---|---|---|
| Need to plan who or what a verification pass will exercise | [Simulation Planning](references/research-planning.md) | actors, probes, parallel groups, and success criteria |
| Need to distinguish known evidence, assumptions, and evidence gaps | [Evidence Scoping](references/research-scoping.md) | source inventory and confidence labels |
| Need to merge several walkthrough results into non-duplicative findings | [Simulation Synthesis](references/research-synthesis.md) | clustering, root causes, severity, and traceability |
| Need to hand research findings to a designer or implementer | [Findings Communication](references/research-communication.md) | reproducible evidence and actionable finding structure |
| Need to inspect an existing repository, running product, capture, or ticket | [Live Product Grounding](references/field-research.md) | grounded surface and behavior claims |
| Need to define what each actor should attempt in a walkthrough | [Actor-Walk Script Design](references/interview-design.md) | goals, starting state, stress probes, and observable success |
| Need to record a walkthrough so another person can reproduce it | [Walkthrough Evidence](references/interview-documentation.md) | per-step expected/observed evidence |
| Need to learn from a user-supplied competitor, screenshot, or reference | [Reference Patterns](references/competitive-analysis.md) | borrowed patterns and deliberate differences without market theater |
| Need to define evidence-backed Personas, Actors, permissions, or constraints | [User Modeling](references/user-modeling.md) | provenance-aware user and authority models |
| Need to decompose an actor goal into operations and workflow steps | [Task Analysis](references/task-analysis.md) | outcome-oriented task structure and working sets |

## Working rule

Use the smallest sufficient reference set. Common pairs are evidence scoping +
live grounding before a study, and actor-walk design + walkthrough evidence for
a reproducible session. Preserve permissions, states, failures, recovery,
relationships, and evidence limits. Route elsewhere only when another
capability's decision materially changes the research plan.
