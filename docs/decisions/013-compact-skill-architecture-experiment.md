# ADR 013: Evaluate a compact public skill architecture

- Status: Proposed
- Date: 2026-07-31
- Decision contract: [`../migrations/compact-skills/decision-criteria.json`](../migrations/compact-skills/decision-criteria.json)
- Migration stack: [`../migrations/compact-skills/README.md`](../migrations/compact-skills/README.md)

## Context

ADR 003 exposes 59 public sibling skills. That layout makes every specialist
capability independently discoverable, but it also creates a large installation
surface, overlapping trigger metadata, a high audit burden, and the impression
that Lamina installs dozens of unrelated agents.

Installed files and loaded model context are different quantities. A compact
public catalog only improves context use when routing loads one workflow and the
smallest applicable references. Moving the same content under one directory and
then reading it eagerly would reduce the visible count without solving routing,
trust, or context cost.

This migration also crosses safety boundaries. Graph authority, graph sessions,
design and verification source-write prohibitions, the ImplementationPacket and
checked WorkMap gates, independent Persona walks and Missions, observation,
case-bound evidence, and publication cannot become optional as content moves.

## Proposed experiment

Compare three architectures while retaining the current production layout:

1. `baseline-59`: the public sibling layout accepted by ADR 003;
2. `candidate-6`: `lamina`, `lamina-init`, `lamina-design`, `lamina-work`,
   `lamina-verify`, and `lamina-product`; and
3. `candidate-1`: one public `lamina` router using the same internal workflow
   and capability references as `candidate-6`.

The experiment has a prior toward six public skills because the major workflows
have distinct intent and write boundaries. That prior is not the decision.
Candidates must use equivalent normative content, routing labels, prompts, and
evaluation inputs so the public manifest boundary is the main variable.

Candidate layouts remain isolated under
`evals/fixtures/skill-architectures/`. They must not be placed under production
`skills/` until a candidate passes the decision contract.

## Decision rules

The versioned decision contract owns thresholds and weights. In summary:

- any loss of a mandatory safety rule disqualifies a candidate;
- public catalog metadata must fall by at least 75 percent;
- focused-question instruction loading must fall by at least 50 percent from
  the baseline median;
- routing, activation, and provider installation must be no worse than the
  baseline;
- supported providers must recursively install and resolve internal references;
- developer comprehension and willingness to install must materially improve;
- the selected architecture must pass rollback and mixed-install migration
  tests before production replacement.

The one-skill candidate wins only when it is no worse than six on routing,
activation, context use, provider behavior, and failure diagnostics, and the
developer study prefers it. Otherwise, six wins after meeting every mandatory
threshold. A seventh or eighth public specialist requires measured routing
failure and a separate admission decision.

## Relationship to ADR 003

ADR 003 remains **Accepted** throughout the experiment. This proposal does not
change production installation, discovery, documentation, benchmark staging, or
release artifacts.

After the experiment, this ADR must be amended with recorded results and the
selected architecture before it can become Accepted. Only that accepted update
may supersede ADR 003, and only after the production migration and rollback
gates pass. If neither compact candidate passes, this ADR is rejected and ADR
003 remains authoritative.

## Consequences

- The migration is delivered as a stack of independently reviewable changes.
- A machine-readable normative ledger must account for every retained,
  rewritten, merged, removed, obsolete, or conflicting baseline instruction.
- Structural, routing, safety, context, install, behavioral, mutation, and
  developer-study evidence are release inputs rather than post-release checks.
- Production continues to expose 59 public skills until a later, evidence-backed
  migration PR changes the architecture manifest and all dependent consumers.
- The experiment adds files and test cost before it removes catalog complexity.
  That temporary duplication is intentional and bounded to the evaluation
  fixtures.
