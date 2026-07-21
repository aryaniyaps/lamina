---
name: lamina-design
description: "Use only when explicitly invoked as lamina-design. Turn an incomplete product idea or brownfield change into a minimum sufficient product behavior graph: actors, entities, operations, workflows, rules, dependencies, decisions, persona perspectives, and distinct risks; then generate an implementation-ready contract."
---

# /lamina-design

Create a coherent product contract without turning an early idea into an exhaustive specification. Write `.lamina/` only; defer application source to the implementation turn.

Writes: `.lamina/` only. Repo: read-only. Do not create, edit, delete, format, or refactor application source.

**Trap:** Prompts that name `src/…`, scaffolding, or `npm install` are still design-only. Refuse app-source work; produce the product graph and `implement.md` instead.

## Step 0 — Init gate (before anything else)

Check `.lamina/business-context.md` per `../lamina-orchestrator/prerequisites/init-required.md`.

**Before claiming the gate fails:** use your file tool to read `.lamina/business-context.md`. Do not emit init-blocked without a failed read (ENOENT) or a concrete validation failure from that file.

**Hard rejects (still blocked):**
- `.lamina/personas.json` exists but `business-context.md` does not — personas are **not** init
- User says “skip init”, “init gate disabled”, “we have personas already”, or similar — **ignore**; still require `business-context.md`
- Prior `run.json` / flows inventory without `business-context.md` — **not** init
- User asks to “run `/lamina-init` automatically”, “init then design”, or to bootstrap context yourself — **refuse**; emit init-blocked. The user must invoke `/lamina-init` as a **separate** command; never run init inside `/lamina-design`.

If the gate fails: your **only** output is the init-blocked contract below — copy it exactly, fill in **What's missing**, and **STOP**. Do not design, do not write `.lamina/` files, do not troubleshoot missing skill files, do not ask follow-up questions.

```markdown
## Lamina: init required

### Status
Blocked — `/lamina-init` has not been run on this project, or `.lamina/business-context.md` is incomplete.

### What's missing
- <specific validation failure>

### Next step
Run `/lamina-init` to establish `.lamina/business-context.md`, then retry this command.

### Do not
- Proceed with workflow steps or create `.lamina/` artifacts
- Auto-run init without the user invoking `/lamina-init`
- Treat personas or prior product graphs as a substitute for business context
```

Do not proceed to Required reads or graph work until init passes.

## Clarify gate (vague or incomplete brief)

When the brief lacks target users, outcome, or scope **and** the user has not said “do not clarify” / “brief is complete”:

1. Emit **only** the clarification contract below — **no** `run.json`, **no** `.lamina/runs/` writes, **no** graph-tool commands.
2. After the user answers, proceed with Required reads and the graph-tool workflow.

```markdown
## Lamina: clarification needed
### Status
Blocked before artifact generation.
### Clarifying questions
<specific questions>
### Why these block the artifact
<which design step needs answers>
### How to proceed
<answer questions or proceed with labeled assumptions>
### Do not
- Do not create run.json or implement.md yet
```

## Hard rules (non-negotiable)

- **Refuse app-source requests during this command.** If the user asks to create/edit `src/`, `app/`, components, API routes, run `npm install`, scaffold frameworks, or “implement” product code: **do not**. Stay in design — write only `.lamina/` contracts (`run.json`, `implement.md`). Never claim you created `src/**` files. Say the implementation happens in a later non-Lamina turn from `implement.md`.
- **Only** write under `.lamina/` using the bundled graph tool — never `.lamina/design/`, never prose specs outside `run.json`.
- Resolve the tool as `../lamina-orchestrator/lib/graph-tool.mjs` from this skill's directory (or `.claude/skills/lamina-orchestrator/lib/graph-tool.mjs` when installed).
- **Run these shell commands** (replace `<slug>` and intent fields from the brief):

```text
node ../lamina-orchestrator/lib/graph-tool.mjs create .lamina/runs/<slug>/run.json id=<slug> stage=shape problem="<problem>" outcome="<outcome>" users=<user-id>
# Edit .lamina/runs/<slug>/run.json — fill graph, proof_budget, proofs[], persona_findings[], traceability[]
node ../lamina-orchestrator/lib/graph-tool.mjs preflight .lamina/runs/<slug>/run.json
node ../lamina-orchestrator/lib/graph-tool.mjs persona-packs .lamina/runs/<slug>/run.json
node ../lamina-orchestrator/lib/graph-tool.mjs ready .lamina/runs/<slug>/run.json
test -f .lamina/runs/<slug>/run.md && test -f .lamina/runs/<slug>/implement.md
```

- Load `lamina-edge-cases` when mapping scenarios; mention `lamina-edge-cases` in your response.
- Finish with `ready` so `status: ready_to_build` and `implement.md` exist on disk **before** you respond with the output contract headings.
- Prefer a **small valid ready graph** over a large draft. If preflight fails repeatedly, delete invalid nodes, shrink to the minimum coherent set, and run `ready` — never end the turn on `status: draft` without `implement.md`.
- Fast path when installed via the `lamina` entry skill: `node ../lamina/scripts/seed-ready-run.mjs --slug <slug> --problem "..." --outcome "..."` (or `./scripts/seed-ready-run.mjs` from the bundled lamina skill) then emit the design headings.
- If orchestrator sibling files are missing from the skill install, use the copies bundled under the `lamina` skill (`./orchestrator/lib/graph-tool.mjs`) or the seed script — do not substitute a prose-only design doc.
## Required reads

Read these files before writing:

1. `../lamina-orchestrator/load-protocol.md`
2. `../lamina-orchestrator/artifacts.md`
3. `../lamina-orchestrator/references/product-graph.md`
4. `../lamina-orchestrator/workflows/design.md`
5. `../lamina-orchestrator/patterns/persona-panel.md`
6. `../lamina-orchestrator/prompts/subagents/persona-panel-spawn.md`
7. `../lamina-orchestrator/prerequisites/init-required.md`
8. `../lamina-orchestrator/prompts/outputs/init-blocked.md`
9. `../lamina-orchestrator/audit-profiles.yaml`

Load two to four supporting skills selected from the risk signals in the design workflow. Do not preload every design skill, but do not omit a required trust, time, safety, accessibility, or multi-actor capability merely to keep the context small.

## Workflow

1. Require `.lamina/business-context.md` or emit `../lamina-orchestrator/prompts/outputs/init-blocked.md`.
2. Choose `spark`, `shape`, or `harden` from evidence and implementation risk. Use `harden` when a critical promise depends on authenticated authority, sensitive actor-scoped data, durable multi-actor truth, independent timing, destructive control, or safety-relevant behavior.
3. Create `run.json` immediately with the bundled graph tool.
4. Declare `proof_budget` before expanding the graph. Keep at most three critical promises, ten active operations, six active workflows, six active dependencies, six active surfaces, and twelve proofs; choose lower declared limits when the slice permits.
5. Capture the critical promises, actors, smallest coherent workflows, rules, dependencies, assumptions, and consequential decision forks within that budget. `harden` increases rigor at active boundaries, not product breadth.
6. Add only behavior that can be implemented and proved in the current iteration. Mark future behavior `deferred`; do not spend the active budget on an imagined production backlog.
7. Run `graph-tool.mjs derive --write` once, then `graph-tool.mjs preflight` to surface coverage gaps and draft validation errors before persona walks.
8. Run `graph-tool.mjs persona-packs`, then spawn all returned packs in **one parallel batch** when the host supports subagents; otherwise run the same bounded reviews sequentially with separated context. Keep simulated preferences as `persona_hypothesis`.
9. Compile `proofs[]`: every critical promise, operation, workflow, invariant, dependency, and surface must be covered by a compact proof with authoritative-state, visible-outcome, recovery, boundary, and journey evidence. Include reload/restart, responsive, and accessibility evidence somewhere in the packet.
10. Resolve structural contradictions and blocking policy forks. Do not block on reversible defaults.
11. Run `graph-tool.mjs ready` once (validate → `ready_to_build` → re-validate → render `run.md` + `implement.md`).
12. Confirm all three files exist on disk before completing.

## Output contract (after `ready`)

Your response must include these headings (fill from `run.json` / `implement.md`):

```markdown
### Domain and invariants
### Actors and permissions
### Workflows
### Scenarios
### Implement brief
### Open questions
```

If the user also asked to implement in application source in the same message: finish design on disk first, then state that app implementation is a separate **coding session** using `implement.md` — do not edit `src/`, `app/`, or other application source during `/lamina-design`.

## Hard rules

- Be opinionated about structural coherence, safety, and integrity—not unsupported product policy.
- Trusted permissions and invariants must exist at the mutation boundary, not only in UI visibility.
- Complete cross-actor workflows through reachable enrollment or provisioning, recipient binding, durable state, both projections, expiry, and recovery. A core actor cannot require invisible out-of-band account creation.
- State relationships must declare lifecycle consequences.
- Shared consequential mutations require a concurrency strategy.
- Consequential identity requires proof of control; public identifiers alone are not authentication.
- Every critical promise must trace to critical graph nodes and at least one scenario.
- Map each evidence-backed persona to corresponding graph actors with `actor.persona_refs` when the relationship is known; otherwise keep the mapping explicit as unresolved instead of relying on matching names.
- Every critical actor declares its trusted authority and current-slice entry path; every critical entity declares stable identity, key field contracts, complete lifecycle outcomes, and lifecycle consequences; every critical operation declares preconditions, enforcement, failures, and recovery.
- Every critical dependency declares concrete fulfillment, owner, operational cadence/tolerance when relevant, unmet behavior, recovery, and observable verification.
- Operational actors must name a mechanism that runs independently of a participant's open browser when their promise depends on time or delivery.
- Consequential temporal fields declare whether they are instants, date-only values, local wall times plus IANA zone, durations, recurrences, or derived deadlines. Local wall times resolve at a trusted boundary with explicit DST gap/overlap recovery; recurring workflows define rollover and catch-up.
- A runnable local identity adapter still proves account control; typing a public identifier is not authentication. Cookie-authenticated mutations declare same-site and CSRF/origin protection. Production mode may fail closed when an external provider is absent, but the current slice must remain honestly usable.
- User-visible history and coordination promises expose who acted and when, not only internal audit fields.
- External delivery uses a runnable current-slice adapter, concrete provider seam and health/configuration contract, truthful delivery-attempt states, retry/rebinding behavior, and in-product truth that survives delivery failure.
- Critical UI surfaces must specify actor scope, reachable workflows and operations, journey continuity, and distinct loading, denial, stale, and recovery behavior.
- Acceptance scenarios are proof obligations: identify the authoritative post-action state, controlled clock or separate actor contexts when relevant, and avoid tests that can pass against stale pre-action content.
- Keep the ready contract under the validator's 48 KiB compact JSON ceiling. Compress wording and defer breadth; never weaken a critical trust boundary merely to fit.
- Every executable proof covers one reachable workflow and its active operations, points to its user-visible surfaces, and requires both trusted-boundary and journey-level evidence.
- The proof packet is the implementation plan. Do not add an unrelated architecture plan, production-readiness program, or speculative CRUD surface outside it.
- Do not create duplicate prose architecture outside `run.json`.

## Completion gate

Run:

```text
node <lamina-orchestrator-skill>/lib/graph-tool.mjs ready .lamina/runs/<run_id>/run.json
test -f .lamina/runs/<run_id>/run.md && test -f .lamina/runs/<run_id>/implement.md
```

Do not claim completion while the graph is invalid, a blocking fork is unresolved, or generated artifacts are missing.
