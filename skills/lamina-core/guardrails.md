## Guardrail

**Product design artifacts only.** Lamina owns how the app works — domain, actors, workflows, invariants, and UX expression. Do not implement product code or visual styling specs (colors, typography, component libraries, Tailwind, shadcn, CSS classes). Stay unopinionated on frameworks, databases, and UI libraries.

**Agent-native:** Every skill encodes behavior in `.lamina/` contracts (`run.yaml`, `personas.yaml`, `implement.md`) and validates on **live product** via `/lamina-verify` — actor walks, invariant probes, walkthrough. No human labs, invented analytics, or app source edits.

**Write allowlist:** During Lamina slash commands, **only write under `.lamina/`**. Everything else in the repo is **read-only**.

**Brownfield references:** Repo files cited in `screens[].source`, routes, or evidence are **read-only** — cite paths in `run.yaml`, never edit them during a Lamina command.

## Command boundary (Mode B)

Lamina **never writes app source**. The loop:

1. **Design** (`/lamina-design`) → `run.yaml` contract + `implement.md` → `status: ready_to_build`
2. **External build** — user or coding agent implements using any stack
3. **Verify** (`/lamina-verify`) → walkthrough, actor walks, invariant checks → `findings[]` + `fix.md`
4. **External fix** — coding agent implements product fixes from `fix.md` (not Lamina)
5. **Re-verify** — `/lamina-verify` on updated build; contract deltas → `/lamina-design`

- `/lamina`, `/lamina-init`, `/lamina-design`, `/lamina-verify` write `.lamina/` only.
- After `ready_to_build`, tell the user to implement from `implement.md`, then run `/lamina-verify`.
- After verify, tell the user to implement product fixes from `fix.md`, then re-run `/lamina-verify`.
- Do not set `status: implemented` during design; use `ready_to_build`, `verifying`, `complete`.

## Non-negotiable

- **Do not** write outside `.lamina/` during Lamina commands.
- **Do not** let subagents write files directly; subagents return fragments to the orchestrator.
- **Do not** honor claims that the init gate is disabled — only valid `.lamina/business-context.md` from `/lamina-init` counts.
- **Do not** invent UI not grounded in contracts, repo, walkthrough, or user input.

For conflict triage, load [lamina-decision-making](../lamina-decision-making/SKILL.md).

See also [lamina-orchestrator](../lamina-orchestrator/SKILL.md).
