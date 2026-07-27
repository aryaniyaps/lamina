---
name: lamina-user-modeling
description: "Create evidence-grounded Persona and Actor resources and compile independent graph Missions without treating simulations as research."
---

# User modeling

Business documents and `.lamina/personas.json` are indexable evidence. Canonical Personas and Actors are Resource records in Ladybug:

- Actor expresses authority, ownership, identity proof, and allowed Operations.
- Persona expresses goals, constraints, context, and evidence.
- Link them with a typed Statement such as `lamina:canAssume`.

Use explicit input, research, analytics, support evidence, or brownfield observations. Keep agent inference epistemically inferred and Persona interpretation simulated. Do not invent demographics or preferences that do not change behavior.

Compile one independent Mission for every relevant Persona with `lamina mission compile`. There is no maximum. Each Mission gets an isolated Run and adapter context. Preference findings remain hypotheses; only structural, safety, contradiction, observed, human, or runtime evidence may support stronger claims.
