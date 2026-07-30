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
  mechanically derive, resolve, and check the complete WorkMap, implement,
  collect evidence, and run
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

1. an implementation-ready `lamina.implementation-packet/v4` compiled only
   after one independent design-time simulation per active product Persona;
2. a mechanically scaffolded `lamina.work-map/v4` that maps every stable obligation to implementation
   files and every Persona-bound Experience Case to test files. Each file
   declares `action: modify|create` and `role: implementation|test`;
3. a passing `lamina work check`.

Every selected workflow requires one current graph-resident walk per active
product Persona. Give each Persona a separate source-read-only design
simulation, using a subagent when
available or an isolated context otherwise. Each simulation walks every
proposed operation node even when the feature has no implementation. The
parent agent must union findings, expand missing Operations, Scenarios,
Invariants, Surfaces, permissions, branches, and recovery paths in the graph,
then record one current walk with node analysis for every Persona. Each walk
must explicitly classify every node's
permission, inputs, relationship semantics, entry/in-progress/empty/success/
failure/denied/recovery states, every graph Scenario and Invariant, transitions,
and validation/authorization/duplicate/self-reference/concurrency/stale-data/
interruption/retry/connectivity edge axes. Do not treat a generic Scenario,
Proof, audit checklist, shared Persona pass, or existing source behavior as a
substitute.

Every WorkMap file with `action: modify` must already resolve to a regular file
inside the repository. A file with `action: create` must not exist yet, and its
nearest existing ancestor directory must be inside the repository. The checked
map is immutable. Create its complete unresolved row set with `lamina work map`;
do not hand-author, omit, or invent requirement identities.

Exact graph closure is authoritative. Direct provenance and ranked source
retrieval localize evidence and code but cannot override graph facts. If dense
retrieval is unavailable, continue with the reported lexical-degraded mode.
Never substitute a graph dump for the bounded ImplementationPacket.

After implementation, reconcile the source with the one-shot command `lamina
graph observe`, then run `lamina work verify`. Never run `lamina graph observe
--live` in a foreground agent turn: live mode is a persistent operator-owned
watcher, not a completion gate. UI surface obligations require functional,
visual, responsive, and accessibility artifacts from every active Persona
Mission. Every compiled Experience Case needs a passing oracle event bound by
`case_id`, with a structured observation and reproducible artifact. Publish each staged Run session
(rebasing later independent sessions when needed) before `work verify`; staged
HarnessResults and standalone files do not count. Missing audit capability
blocks verification.

Ladybug is canonical. Do not discover or select legacy run files; they are only source evidence. Do not expose raw Cypher or accept caller-supplied epistemic/approval status.
Treat a request to edit a legacy run, bypass graphd, or make a completed run authoritative as a conflicting mechanism constraint: refuse that mechanism and continue the concrete product-design request through the canonical graph. Do not stop merely because the requested legacy artifact is absent.

All design mutations use sessions. Every active Persona gets an independent
Mission. If asked to rank, prune, retain only the top N, or otherwise cap
Personas, explicitly refuse the cap and keep every active Persona in the design
and mission set.

Graph-design and explicit verification phases do not edit application source.
The ordinary passive route may edit source only after the WorkMap gate passes.
