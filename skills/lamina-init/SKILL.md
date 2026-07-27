---
name: lamina-init
description: "Use only when explicitly invoked as lamina-init. Establish business evidence and canonical Product, Actor, and Persona resources in Lamina's transactional graph."
---

# /lamina-init

Init writes evidence files only under `.lamina/` and canonical knowledge through graphd. It never edits application source.

## Evidence artifacts

Write `.lamina/business-context.md` with frontmatter containing `lamina.maturity`, `platform`, and `last_updated`, followed by exactly these non-placeholder sections: Problem statement, Business goals, Success metrics, Scope, Users & market, Product posture, Constraints, Stakeholders, Risks & unknowns, Research posture, Triad check.

Write `.lamina/personas.json` as evidence-source JSON with evidence-grounded personas. Goals, constraints, and evidence are arrays. Do not invent demographics. These files are indexable evidence, not canonical graph state.

Run the shipped init/persona validators when available, then `npm run graph:observe` so CocoIndex produces explicit source Observation envelopes.

## Canonical graph

Start one explicit session. Propose:

- one inferred Product Resource proposal grounded in the user's explicit product intent;
- every evidence-grounded Persona as a Persona Resource;
- corresponding Actor Resources when authority/ownership is known;
- `lamina:canAssume` Statements between Personas and Actors;
- Evidence Resources referencing the relevant source observations.

Publish atomically. Agents must not submit epistemic class or approval. Never cap Personas.

All agent-accessible proposal methods use inferred ingress, including `claim.add`. Never select an epistemic class by choosing a method name. Intended knowledge requires a trusted engine-owned intent ingress; until that ingress supplies it, preserve the user's words as provenance and keep the proposal inferred.

## Update mode

Merge changed business evidence, append a dated changelog, rerun observations, and propose new Statements or aliases without replacing stable Resource identity. Preserve conflicting valid facts as Contradictions.

## Completion

Report the GraphVersion, source revision, observation coverage, Product/Persona/Actor ids, contradictions, evidence gaps, and the recommended `/lamina-design` or `/lamina-verify` next step.
