# LaminaBench v2 methodology

## Questions

1. Does Lamina create a better implementation contract from an incomplete product brief?
2. Does a fresh builder produce a better product from that contract?
3. Does the full Lamina loop reach trusted behavior with less rework or model effort?

Human iteration speed is tested separately; agent wall time is not a proxy for active founder time.

## Arms

- `raw`: best contract in any format, no required reviewers.
- `structured`: neutral schema plus three isolated generic contract critics.
- `lamina`: Contract v2 plus up to three isolated evidence-grounded persona perspective reviewers. When the product has fewer than three materially different personas, graph-focused reviewers fill the remaining matched reviewer slots without inventing another user type.

All arms receive matched discovery, initialization, contract, finalization, implementation, review, and fix turns. Structured and Lamina also receive identical reviewer counts, reviewer model and reasoning effort, tools, timeouts, and whole-trial opportunity. The harness owns these reviewer slots and explicitly suppresses additional in-skill reviewer spawning during benchmark contract turns. Discovery owns the shared `questions.json` protocol; Lamina initialization begins only after the external oracle has answered, so the skill's `.lamina/` write boundary remains intact. Record actual tokens and tool calls rather than claiming an unenforced token ceiling. Report Lamina versus raw as ecological value and Lamina versus structured as method value.

The blinded rubric never awards points for Lamina terminology, persona artifacts, or schema compliance alone. Its perspective-grounding dimension applies equally to raw, structured, and Lamina contracts.

## Tracks

- `autonomous`: classify assumptions and decision forks without founder answers.
- `oracle`: ask at most three questions through the deterministic topic-indexed oracle.

Analyze tracks separately.

## Linked studies

Snapshot the contract after phase two. Score that immutable artifact for Study A. Continue the original session through implementation, review, and fix for Study C. Give the snapshot to a fresh session for Study B.

Snapshot blinded product source after initial implementation and after fix in both the main and transfer sessions. Judge both stages. Time to threshold is the elapsed model time at the first stage meeting the frozen quality threshold; fix-phase tokens, tool calls, and quality delta quantify agent rework. Trials that never reach threshold keep `time_to_threshold: null` and remain incomplete rather than receiving an invented terminal time.

The transfer builder receives the original brief and sanitized artifact in its native format. Do not enrich raw artifacts through canonicalization before transfer.

## Unit and analysis

The task is the independent unit. Repeated runs estimate within-task model variance. Use paired task-level estimates, report all task medians and deterministic task-level bootstrap 95% intervals, and never treat repeats as additional task samples. Superiority gates require a positive lower interval bound as well as a point effect above the frozen minimum meaningful difference.

The primary cohort contains 144 publication trial cells. The four-cohort confirmatory and replication matrix contains 576 trial cells. Each cell includes a main session, isolated contract reviewers where assigned, and a fresh transfer builder. Study A reuses the frozen contract snapshot and Study C reuses the main session; neither becomes an additional independent sample.

The bundled matrix runner is for development tasks. Publication cells are exported to an external isolated executor following `EXECUTION_CUSTODY.md`; this prevents agents from reading goldens, oracle facts, other task briefs, or prior-arm workspaces.

## Freeze order

Tune only on development tasks and freeze the authoring protocol plus candidate skill. An independent custodian then supplies publication packages without exposing them to the skill implementer or accepting further candidate changes. Insert their recursive hashes, pin every cohort model under `model-locks/`, freeze the CLI/runtime fingerprint, set the release status to `frozen`, commit all inputs, and run `bench:v2:freeze`. Publication execution refuses a missing or mismatched freeze record. The execution team sees briefs only when its assigned runs begin and never sees goldens.
