# Verify workflow

This workflow is source-read-only. Isolate Persona Missions, collect current runtime evidence, publish Runs, and report findings without editing application source.

> Migrated intact from `skills/lamina-verify/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# /lamina-verify

Verification reads the active GraphVersion and publishes runtime Evidence through isolated Mission sessions. It never discovers, selects, or mutates the active GraphVersion.

Verification Missions are the runtime replay of Persona-bound Experience
Cases. They do not replace the earlier design-time Persona simulations that
must discover and expand new-feature flows before implementation begins.

## Gate and grounding

First read and apply
`../lamina-orchestrator/prerequisites/cli-required.md`. Stop before all
mutations unless the CLI API 1 prerequisite passes.

Require valid `.lamina/business-context.md` using `../lamina-orchestrator/prerequisites/init-required.md`; on failure emit `../lamina-orchestrator/prompts/outputs/init-blocked.md`. Then run `lamina graph status`. Query the requested workflow and its actors, Personas, Operations, invariants, Scenarios, Proofs, Surfaces, dependencies, and Contradictions. Inspect the actual product using a runnable adapter when available; otherwise record static-analysis capability limits. Absence of an Observation is never evidence that behavior is absent.

## Mission protocol

1. Run `lamina mission compile --workflow <workflow-id>`. This must return one independent Mission for every active Persona; there is no maximum of three.
2. Select adapters only through capability_manifest Resources. Unknown modalities are strings and require no database migration.
3. Give every Persona an independent adapter context and Run session. Do not share mutable login, browser, process, clock, device, or fixture state.
4. Exercise every compiled Experience Case, including actor inputs and
   requiredness, relationship identity/cardinality, duplicates,
   self-reference, visible states, denial/failure recovery, and invariant
   probes.
5. Save large artifacts to the local evidence CAS. Pass normalized events to:
   `lamina mission run <mission-id> --events <events.json>`.
6. `mission run` returns an isolated staged session. Publish that exact session
   with `lamina session publish <session-id>`. When a previously published
   independent Run advanced the branch, first run `lamina session rebase
   <session-id>`, then publish. A staged Run is not verification evidence.
7. Only adapter-observed events in a published Run become runtime evidence.
   Persona interpretation remains simulated.
8. Missing/corrupt evidence, stale source snapshots, budget failures, or capability failures invalidate related readiness; they never silently pass.
9. Query the resulting GraphVersion and report product gaps, intended-contract gaps, and operational limitations separately. Conflicting Statements remain present as a Contradiction and block approval.

For source reconciliation, run the one-shot `lamina graph observe`. Never run
`lamina graph observe --live` in a foreground agent turn: live mode is a
persistent operator-owned watcher and cannot be a completion gate.

Allowed normalized event types are action/state/outcome observed, oracle
passed/failed, denial observed, recovery attempted, artifact captured,
`audit_passed` with a valid `audit_kind`, and budget/capability failure. Each
`oracle_passed` or `oracle_failed` event must name a compiled `case_id` and
include a structured observation. A passing oracle must reference a
reproducible artifact. The structured event already binds the case, expected
behavior, and observed behavior; do not duplicate it in a second manifest.

For every Mission whose closure contains a Surface, exercise relevant states
in a real runnable UI adapter and capture all four independent audit classes:

- `functional`: interaction and outcome oracle;
- `visual`: screenshot or visual-diff inspection;
- `responsive`: relevant desktop and mobile viewport evidence;
- `accessibility`: semantic tree and automated/manual accessibility evidence.

Emit one `audit_passed` event per class with its artifact, Mission surface, and
concrete state. A missing browser, viewport, screenshot, or accessibility
capability is a capability failure and must block verification; static
analysis is not a substitute. Do not reuse one artifact across audit classes.

## Completion

Verification is complete only when every active Persona Mission ran independently, all required evidence is available and reproducible, and `lamina graph validate --at HEAD` reports the validation and contradiction state. Human `report.md` or `fix.md` may be generated as query projections; they are not truth-bearing runtime inputs.

In passive flow, finish with `lamina work verify --packet <packet> --map
<work-map>`. This command requires published current-source Mission evidence
for every active UI Persona; staged HarnessResults and standalone audit files
cannot satisfy it. Do not recommend that the user invoke a verification skill.

Report the GraphVersion, source revision, Run and HarnessResult ids, evidence gaps, contradictions, and a crisp verified/not-verified verdict.

## Hard rules

- Never read or select legacy run directories as runtime state.
- Never fabricate Persona findings or runtime events.
- Never let an agent claim observed, runtime, human, or approved status.
- Never reuse mutable state across Runs.
- Never treat screenshots alone as authoritative-state proof.
- Never edit application source during `/lamina-verify`.
