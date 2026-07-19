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

Each phase permits at most two preregistered in-phase continuations only for an explicit provider capacity, overload, temporary-unavailability, or rate-limit response. The continuation resumes the same session and workspace, preserves every failed raw event stream under the phase evidence directory, uses a fixed continuation instruction, and aggregates elapsed time, tool calls, and token usage into the phase telemetry. Timeouts, validation failures, agent errors, and quality outcomes are never retried by this policy. Exhausting the allowance fails the cell and remains in the append-only failure ledger.

Development model processes run in Bubblewrap namespaces exposing only the assigned workspace, credential-only runtime home, fixed toolchain, and network resolver. Multi-agent tools are disabled for executing agents and reviewers, and any observed delegation call invalidates the cell. Product-source snapshots must remain byte-identical through discovery, initialization, contract authoring, finalization, and review-only turns. Post-implementation review runs in an isolated copy so native review tools may write reports and fix lists without mutating either application source or the authoritative frozen contract; only those review artifacts are handed back to the fix turn. Publication still requires the stronger independently operated custody protocol.

The blinded rubric never awards points for Lamina terminology, persona artifacts, or schema compliance alone. Its perspective-grounding dimension applies equally to raw, structured, and Lamina contracts.

Quality judging is scoped to the smallest coherent current slice evidenced by the task and artifact. Judges do not substitute an imagined production backlog or require live third-party credentials when deployment is outside the brief. They do require truthful local adapters, concrete provider seams and fail-closed production posture where identity or delivery is promised, and they continue to penalize false success, self-asserted consequential identity, and lifecycle behavior that silently collapses after rollover, restart, or external failure.

## Tracks

- `autonomous`: classify assumptions and decision forks without founder answers.
- `oracle`: ask at most three questions through the deterministic topic-indexed oracle.

Analyze tracks separately.

## Linked studies

Snapshot the contract after phase two. Score that immutable artifact for Study A. Continue the original session through implementation, review, and fix for Study C. Give the snapshot to a fresh session for Study B.

Snapshot blinded product source after initial implementation and after fix in both the main and transfer sessions. Judge both stages. Time to threshold is the elapsed model time at the first stage meeting the frozen quality threshold; fix-phase tokens, tool calls, and quality delta quantify agent rework. Trials that never reach threshold keep `time_to_threshold: null` and remain incomplete rather than receiving an invented terminal time.

Contract artifacts use `product-contract-rubric.json`; executable product stages use `product-quality-rubric.json`. Independent application checks run a declared `check` script once, a declared build once, and the declared test suite three times from the isolated runtime; their logs are preserved separately from blinded quality ratings. The efficiency outcome (`time_to_threshold`, fix tokens, or fix tool calls) is selected in frozen thresholds before publication outcomes are visible and cannot be chosen retrospectively.

The transfer builder receives the original brief and sanitized artifact in its native format. Do not enrich raw artifacts through canonicalization before transfer. Across every arm, explicit authority, privacy, durability, transaction, time, and safety boundaries remain binding: a builder may not substitute browser-owned state, demo identities, seeded credentials, or local persistence for a declared trusted boundary. An unsupported boundary must be surfaced as unsupported and fail validation rather than being silently weakened.

## Unit and analysis

The task is the independent unit. Repeated runs estimate within-task model variance. Use paired task-level estimates, report all task medians and deterministic task-level bootstrap 95% intervals, and never treat repeats as additional task samples. Superiority gates require a positive lower interval bound as well as a point effect above the frozen minimum meaningful difference.

The GPT-5.6 Sol primary cohort contains 144 publication trial cells. The preregistered GPT-5.5 replication yields a two-cohort matrix of 288 trial cells. Cohorts are analyzed separately; replication does not rescue a failed primary claim. Each cell includes a main session, isolated contract reviewers where assigned, and a fresh transfer builder. Study A reuses the frozen contract snapshot and Study C reuses the main session; neither becomes an additional independent sample.

The bundled matrix runner is for development tasks. Publication cells are exported to an external isolated executor following `EXECUTION_CUSTODY.md`; this prevents agents from reading goldens, oracle facts, other task briefs, or prior-arm workspaces.

Every cell records both a protocol hash and a task/fixture/model input hash. A completed cell is reusable only when both hashes match and its preserved evidence revalidates. Attempts, failures, and invalidations are append-only. Changes and invalidated scopes are recorded in `CHANGE_LEDGER.md` and `change-ledger.jsonl`; incompatible protocol hashes are never aggregated.

## Freeze order

Tune only on development tasks and freeze the authoring protocol plus candidate skill. An independent custodian then supplies publication packages without exposing them to the skill implementer or accepting further candidate changes. Insert their recursive hashes, pin every execution-cohort model and the secondary model judge under `model-locks/`, freeze the judge prompt and CLI/runtime fingerprint, set the release status to `frozen`, commit all inputs, and run `bench:v2:freeze`. Publication execution refuses a missing or mismatched freeze record. The execution team sees briefs only when its assigned runs begin and never sees goldens.
