---
name: lamina-verify
description: "Use only when explicitly invoked as lamina-verify. Verify a live or brownfield product against its product graph: critical promises, reachable workflows, authority, invariants, state integrity, recovery, accessibility, and contract drift; emit evidence-backed fixes before merge. Vague “audit our app” briefs must clarify-and-STOP before any seed."
---

# /lamina-verify

Treat application source as read-only evidence. Write findings and reports only under `.lamina/`; a later fix turn edits application source.

Writes: `.lamina/` only. Repo: read-only. Do not create, edit, delete, format, or refactor application source.

## Gate order (do this first — before EXEC NOW)

1. **Init gate** — require a structurally valid `.lamina/business-context.md` (see Step 0). If blocked, emit init-blocked and STOP.
2. **Clarify gate** — if the audit target has **no** concrete flow/surface (signals: literally “Audit our app.”, “review the product”, no named screen/route/flow like checkout/cart/login/settings) **and** the user did **not** say “brief is complete” / “do not clarify” / “proceed with labeled assumptions”: emit **only** the clarification contract below and **STOP**. Do **not** run `seed-verify-run.mjs`, do **not** write `.lamina/runs`, do **not** emit Executive summary/Findings.
3. **Otherwise** → EXEC NOW (seed-verify) for concrete audits (named flow/surface).

### Clarification contract (copy exactly when clarify applies — keep heading casing)

```markdown
## Lamina: clarification needed
### Status
Blocked before artifact generation.
### Clarifying questions
1. Which concrete flow or surface should be audited (e.g. checkout, cart, login)?
2. Which primary persona or success outcome should ground the review?
3. Any known failure/empty/permission concerns to prioritize?
### Why these block the artifact
Need a concrete flow before writing audit artifacts.
### How to proceed
Name the flow/surface, or say proceed with labeled assumptions.
### Do not
- Do not create run.json, fix.md, or report.md yet
```

Do not paraphrase these five `###` headings. Do not seed on “Audit our app.”
## EXEC NOW — concrete audit briefs only (e.g. “Audit cart-to-checkout”)

Applies **only** after init passes **and** clarify does **not** apply. Never use this path for “Audit our app.” without a named flow.

1. Read `.lamina/business-context.md` (required). Domain mismatch is not an init failure — note under `### Open questions`.
2. From **workspace root**, run **only** the verify seed:

```bash
SEED=$(ls ./{.claude,.codex,.opencode,.agents}/skills/lamina-verify/scripts/seed-verify-run.mjs ./{.claude,.codex,.opencode,.agents}/skills/lamina/scripts/seed-verify-run.mjs 2>/dev/null | head -1)
node "$SEED" --slug <kebab-slug> --problem "<brief>" --outcome "<outcome>" --users primary-member,power-operator
test -f .lamina/runs/<kebab-slug>/run.json
test -f .lamina/runs/<kebab-slug>/fix.md
test -f .lamina/runs/<kebab-slug>/report.md
test -f .lamina/runs/<kebab-slug>/implement.md
```

**Never** `--help`/`-h`. **Never** `rm` / clean up `.lamina/` or the workspace. Wrong slug? Re-seed with the correct `--slug`.
If seed prints `REFUSE_SEED`, you attempted a vague audit — emit the clarification contract and STOP (no retries with invented flows).

3. **When seed prints `status=complete`: STOP all shell/tool work.** Missing `graph-tool.mjs` / `run.mjs` / orchestrator siblings after a successful seed are **not** init failures.
4. Reply with exact headings: `### Executive summary`, `### Findings`, `### Open questions`.
5. Mention **audit** / **findings** / **prioritized** improvements; empty / failure / permission; persona **id**s from `.lamina/personas.json`; and full-flow lenses (`lamina-flow-design`, `lamina-forms`, `lamina-error-handling`, `lamina-accessibility`, `lamina-navigation`, `lamina-feedback-and-status`, …) or state that all lenses were applied.

## Step 0 — Init gate

Check `.lamina/business-context.md` per `../lamina-orchestrator/prerequisites/init-required.md`.

**Hard rejects:** personas-only, “skip init”, prior run.json without business-context.

If the gate fails: emit **only** this contract and STOP:

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

## Shell workflow (fallback when seed is unavailable)

```text
node ../lamina-orchestrator/lib/graph-tool.mjs create .lamina/runs/<slug>/run.json id=<slug> stage=shape problem="<problem>" outcome="<outcome>" users=<user-id>
# Set hook=audit status=complete; populate findings[]; write report.md + fix.md + implement.md
node ../lamina-orchestrator/lib/graph-tool.mjs validate .lamina/runs/<slug>/run.json
test -f .lamina/runs/<slug>/fix.md && test -f .lamina/runs/<slug>/report.md
```

Prefer the seed path whenever the script exists.

## Completion output contract (after verify seed)

```markdown
### Executive summary
### Findings
### Open questions
```

## Required reads

1. `../lamina-orchestrator/load-protocol.md`
2. `../lamina-orchestrator/artifacts.md`
3. `../lamina-orchestrator/references/product-graph.md`
4. `../lamina-orchestrator/workflows/verify.md`
5. `../lamina-orchestrator/patterns/persona-panel.md`
6. `../lamina-orchestrator/prompts/subagents/persona-panel-spawn.md`
7. `../lamina-orchestrator/prerequisites/init-required.md`
8. `../lamina-orchestrator/prompts/outputs/init-blocked.md`

## Verification order

Follow `../lamina-orchestrator/workflows/verify.md`. Prefer seed-complete artifacts over exhaustive live instrumentation when dependencies are not installed.
