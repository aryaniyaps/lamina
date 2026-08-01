# User modeling

Business documents and `.lamina/personas.json` are indexable evidence. Canonical Personas and Actors are Resource records in Ladybug:

- Actor expresses authority, ownership, identity proof, and allowed Operations.
- Persona expresses goals, constraints, context, and evidence.
- Link them with a typed Statement such as `lamina:canAssume`.

Use explicit input, research, analytics, support evidence, or brownfield observations. Keep agent inference epistemically inferred and Persona interpretation simulated. Do not invent demographics or preferences that do not change behavior.

Before implementation, run one independent `lamina design prepare-walk` task
per active Persona and record the isolated result with `lamina design
record-walk`. These design-time simulations walk every proposed operation,
including denied and inapplicable nodes, and may expand the graph with missing
permissions, states, Scenarios, Invariants, and recovery paths. Rerun all
affected walks until a current full round returns empty discovery arrays.

After implementation, compile one independent runtime Mission for every active
Persona with `lamina mission compile`. There is no maximum. Each Mission gets
an isolated Run and adapter context. Design simulations and runtime Missions
are different evidence classes. Preference findings remain hypotheses; only
structural, safety, contradiction, observed, human, or runtime evidence may
support stronger claims.
