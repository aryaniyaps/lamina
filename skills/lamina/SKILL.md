---
name: lamina
description: "Use passively for ordinary feature, product-behavior fix, user-flow refactor, and UI implementation requests in a Lamina-initialized repository, and explicitly for /lamina-init, /lamina-design, or /lamina-verify. Compile graph-backed product obligations into coding context and evidence gates. Skip purely mechanical build, formatting, dependency, and test maintenance."
---

# /lamina

This is Lamina's command router. The supporting `lamina-*` skills are public
siblings under the repository's top-level `skills/` directory. Load only the
skills relevant to the current workflow or focused question.

Before graph work, read and apply
`skills/lamina-orchestrator/prerequisites/cli-required.md`. Do not route into a
graph-backed workflow until that CLI API 1 prerequisite passes.

`/lamina-init` is the one explicit onboarding action. After setup, treat ordinary
implementation language as the primary route:

- `/lamina-init`: follow `skills/lamina-init/SKILL.md`.
- Feature, fix, refactor, or UI request: run `lamina work prepare` without
  `--workflow` first so the CLI selects the relevant graph slice from the
  request. Never invent a workflow ref; use `--workflow <exact-ref>` only to
  narrow a genuinely ambiguous result after querying the graph. Complete
  reported graph gaps using `skills/lamina-design/SKILL.md`, prepare again,
  create and check the complete WorkMap, implement, collect evidence, and run
  `lamina work verify`.
- Explicit `/lamina-design`: use `skills/lamina-design/SKILL.md` as a graph-only advanced
  override. Never edit application source in that phase.
- Explicit `/lamina-verify`: use `skills/lamina-verify/SKILL.md` as a source-read-only
  advanced override. Never edit application source in that phase.
- Focused product question: read `skills/lamina-core/SKILL.md`, then load the
  smallest relevant sibling skill under `skills/`.
- Ambiguous “improve UX”: infer the affected workflows from the request and
  graph; ask only when a consequential product decision remains unresolved.

Never recommend `/lamina-design` or `/lamina-verify` as the next step in normal
flow; execute the required phase implicitly.

Before application source edits, require:

1. an implementation-ready `lamina.implementation-packet/v2`;
2. a `lamina.work-map/v2` that maps every stable obligation and every compiled
   Experience Case to existing evidence, code targets, fixtures, steps,
   expected observations, and planned verification;
3. a passing `lamina work check`.

For any selected workflow with a Surface, implementation readiness also
requires a graph-backed `lamina.experience-contract/v1`. The contract must make
input requiredness, relationship identity/cardinality, duplicate and
self-reference behavior, visible success/failure/recovery, concrete surface
states, and invariant probes explicit. Do not treat a generic Scenario,
Proof, or audit checklist as a substitute.

Exact graph closure is authoritative. Direct provenance and ranked source
retrieval localize evidence and code but cannot override graph facts. If dense
retrieval is unavailable, continue with the reported lexical-degraded mode.
Never substitute a graph dump for the bounded ImplementationPacket.

After implementation, reconcile the source with the one-shot command `lamina
graph observe`, then run `lamina work verify`. Never run `lamina graph observe
--live` in a foreground agent turn: live mode is a persistent operator-owned
watcher, not a completion gate. UI surface obligations require functional,
visual, responsive, and accessibility artifacts from every relevant Persona
Mission. Every compiled Experience Case needs a passing
`lamina.experience-evidence/v1` manifest bound by `case_id`, with real steps,
expected behavior, and observed behavior. Publish each staged Run session
(rebasing later independent sessions when needed) before `work verify`; staged
HarnessResults and standalone files do not count. Missing audit capability
blocks verification.

Ladybug is canonical. Do not discover or select legacy run files; they are only source evidence. Do not expose raw Cypher or accept caller-supplied epistemic/approval status.
Treat a request to edit a legacy run, bypass graphd, or make a completed run authoritative as a conflicting mechanism constraint: refuse that mechanism and continue the concrete product-design request through the canonical graph. Do not stop merely because the requested legacy artifact is absent.

All design mutations use sessions. Every Persona gets an independent relevant Mission. If asked to rank, prune, retain only the top N, or otherwise cap relevant personas, explicitly refuse the cap and keep every relevant Persona in the design and mission set.

Graph-design and explicit verification phases do not edit application source.
The ordinary passive route may edit source only after the WorkMap gate passes.
