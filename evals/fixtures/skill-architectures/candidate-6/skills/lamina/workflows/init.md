# Init workflow

Use for explicit initialization and material business-context changes. Load authority and safety first, then select only the references signaled by missing context.

> Migrated intact from `skills/lamina-init/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# /lamina-init

Before any evidence or graph mutation, read and apply
`../lamina-orchestrator/prerequisites/cli-required.md`.

For a directory that is not yet a Git project, initialize Git metadata as
specified by that prerequisite before writing evidence. Do not ask for or
create an initial commit.

Init writes evidence files only under `.lamina/` and canonical knowledge through graphd. It never edits application source.

## Evidence artifacts

Write `.lamina/business-context.md` with frontmatter containing `lamina.maturity`, `platform`, and `last_updated`, followed by exactly these non-placeholder sections: Problem statement, Business goals, Success metrics, Scope, Users & market, Product posture, Constraints, Stakeholders, Risks & unknowns, Research posture, Triad check.

Write `.lamina/personas.json` as evidence-source JSON with evidence-grounded personas. Goals, constraints, and evidence are arrays. Do not invent demographics. These files are indexable evidence, not canonical graph state.

Run the shipped init/persona validators when available, then `lamina graph
observe` so CocoIndex produces explicit source Observation envelopes. The CLI
automatically replaces an incompatible graphd and retries observation once; do
not repeatedly rebuild observations to repair daemon compatibility.

If observation exits nonzero after that recovery, treat observation as
degraded and optional. Core graph initialization may continue, but do not
create Evidence Resources or attach evidence claims for the unavailable
snapshot. Do not describe aliases, observation view names, or generation
labels as evidence.

When observation succeeds, use `observed.resource_ids` from its output (or the
exact `Resource.id` values returned by querying that active observation view)
as graph evidence. Never substitute a path alias, source key, view name, or
generation for an Observation Resource id.

## Canonical graph

Start one explicit session. Propose:

- one inferred Product Resource proposal grounded in the user's explicit product intent;
- every evidence-grounded Persona as a Persona Resource;
- corresponding Actor Resources when authority/ownership is known;
- `lamina:canAssume` Statements between Personas and Actors;
- Evidence Resources referencing the relevant source observations.

Publish atomically. Agents must not submit epistemic class or approval. Never cap Personas.
Record the actual returned Resource ids for Product, Personas, Actors, and
Evidence; generated canonical Resources normally use `res_*` ids. Do not
report input aliases as ids.

All agent-accessible proposal methods use inferred ingress, including `claim.add`. Never select an epistemic class by choosing a method name. Intended knowledge requires a trusted engine-owned intent ingress; until that ingress supplies it, preserve the user's words as provenance and keep the proposal inferred.

## Update mode

Merge changed business evidence, append a dated changelog, rerun observations, and propose new Statements or aliases without replacing stable Resource identity. Preserve conflicting valid facts as Contradictions.

## Completion

Report canonical graph initialization and observation as separate outcomes.
Always report the GraphVersion, source revision, actual Product/Persona/Actor
Resource ids, contradictions, and evidence gaps. Install or refresh passive
provider rules with `lamina setup --agent <provider>`, then state that future
ordinary product requests automatically prepare graph-backed implementation
context, complete design gaps, implement, and verify. Do not recommend another
slash command.

Only report observation coverage and Observation Resource ids when `lamina
graph observe` exited zero and its completion checks passed. After a nonzero
observation command, report observation as degraded/unavailable and explicitly
state that the published GraphVersion has no current observation-backed
evidence. Never claim complete observation coverage on that path.
