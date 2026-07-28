# /lamina-init workflow

## Establish

1. Read repository context for brownfield work; otherwise use the supplied idea and research.
2. Capture business context in `.lamina/business-context.md` using each canonical level-two heading exactly once: `Problem statement`, `Business goals`, `Success metrics`, `Scope`, `Users & market`, `Product posture`, `Constraints`, `Stakeholders`, `Risks & unknowns`, `Research posture`, and `Triad check`. Do not combine or rename them. Each requires a non-placeholder `**Answer:**` line.
3. Identify up to three questions whose answers would materially change ownership, trust, lifecycle, monetization, destructive behavior, or regulatory posture.
4. In an interactive session, ask those questions together. In unattended work, continue with labeled assumptions when the brief already identifies goals, users, scope, and constraints.
5. Write `.lamina/personas.json` (JSON only — never `personas.yaml`) with `contract_version: "2.0"` and evidence-grounded personas. Every persona includes role, goals, constraints, evidence references, confidence, and whether it is primary.
6. Keep provisional or inferred personas at low or medium confidence. Never claim simulation replaces research.
7. Run the repository init validator when it is available; otherwise apply the same canonical-heading and persona checks manually. Do not report successful initialization while either artifact is invalid.
8. Run `lamina graph observe`, then start one explicit graph session.
9. Propose the inferred Product, every evidence-grounded Persona, known Actors, their `lamina:canAssume` relationships, and Evidence Resources grounded in the source Observations.
10. Validate and publish atomically. Report the exact GraphVersion and source revision.

## Update

Merge new evidence into business context, append a dated decision note, update persona evidence/confidence, rerun observation, and flag Missions or projections whose intent or actors may now be stale. Do not rewrite historical run artifacts.

## Blocking rule

Stop only when problem, target users, current scope, or a consequential constraint is absent and guessing would materially change the product. Do not stop for reversible defaults or details that the design graph can label as assumptions.
