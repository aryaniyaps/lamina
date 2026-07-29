---
name: lamina-verify
description: "Verify graph-backed product Missions after ordinary implementation work or when explicitly invoked as lamina-verify. Run isolated Persona and live UI audits; explicit verification is source-read-only."
---

# /lamina-verify

Verification reads the active GraphVersion and publishes runtime Evidence through isolated Mission sessions. It never discovers, selects, or mutates the active GraphVersion.

## Gate and grounding

First read and apply
`../lamina-orchestrator/prerequisites/cli-required.md`. Stop before all
mutations unless the CLI API 1 prerequisite passes.

Require valid `.lamina/business-context.md` using `../lamina-orchestrator/prerequisites/init-required.md`; on failure emit `../lamina-orchestrator/prompts/outputs/init-blocked.md`. Then run `lamina graph status`. Query the requested workflow and its actors, Personas, Operations, invariants, Scenarios, Proofs, Surfaces, dependencies, and Contradictions. Inspect the actual product using a runnable adapter when available; otherwise record static-analysis capability limits. Absence of an Observation is never evidence that behavior is absent.

## Mission protocol

1. Run `lamina mission compile --workflow <workflow-id>`. This must return one independent Mission for every relevant Persona; there is no maximum of three.
2. Select adapters only through capability_manifest Resources. Unknown modalities are strings and require no database migration.
3. Give every Persona an independent adapter context and Run session. Do not share mutable login, browser, process, clock, device, or fixture state.
4. Exercise reachable action, trusted authority, valid transition, durable result, actor-scoped projection, denial, failure, and recovery paths.
5. Save large artifacts to the local evidence CAS. Pass normalized events to:
   `lamina mission run <mission-id> --events <events.json>`.
6. Only adapter-observed events become runtime evidence. Persona interpretation remains simulated.
7. Missing/corrupt evidence, stale source snapshots, budget failures, or capability failures invalidate related readiness; they never silently pass.
8. Query the resulting GraphVersion and report product gaps, intended-contract gaps, and operational limitations separately. Conflicting Statements remain present as a Contradiction and block approval.

Allowed normalized event types are action/state/outcome observed, oracle
passed/failed, denial observed, recovery attempted, artifact captured,
`audit_passed` with a valid `audit_kind`, and budget/capability failure.

For every Mission whose closure contains a Surface, exercise relevant states
in a real runnable UI adapter and capture all four independent audit classes:

- `functional`: interaction and outcome oracle;
- `visual`: screenshot or visual-diff inspection;
- `responsive`: relevant desktop and mobile viewport evidence;
- `accessibility`: semantic tree and automated/manual accessibility evidence.

Emit one `audit_passed` event per class with its artifact. A missing browser,
viewport, screenshot, or accessibility capability is a capability failure and
must block verification; static analysis is not a substitute. Do not reuse one
artifact across audit classes.

## Completion

Verification is complete only when every relevant Persona Mission ran independently, all required evidence is available and reproducible, and `lamina graph validate --at HEAD` reports the validation and contradiction state. Human `report.md` or `fix.md` may be generated as query projections; they are not truth-bearing runtime inputs.

In passive flow, finish with `lamina work verify --packet <packet> --map
<work-map>`. Do not recommend that the user invoke a verification skill.

Report the GraphVersion, source revision, Run and HarnessResult ids, evidence gaps, contradictions, and a crisp verified/not-verified verdict.

## Hard rules

- Never read or select legacy run directories as runtime state.
- Never fabricate Persona findings or runtime events.
- Never let an agent claim observed, runtime, human, or approved status.
- Never reuse mutable state across Runs.
- Never treat screenshots alone as authoritative-state proof.
- Never edit application source during `/lamina-verify`.
