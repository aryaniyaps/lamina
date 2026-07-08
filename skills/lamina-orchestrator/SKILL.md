---
name: lamina-orchestrator
description: "Multi-step UX workflows, artifact contracts, and subagent coordination. Loaded by /lamina* slash commands."
disable-model-invocation: true
---

# Lamina Orchestrator

Coordinates multi-capability UX workflows. Slash commands (`/lamina`, `/lamina-init`, etc.) are `disable-model-invocation` skills under `skills/lamina*`.

**Guardrail:** Writes: `.lamina/` only. Repo: read-only. Do not create, edit, delete, format, or refactor app source code, tests, config, styles, docs outside `.lamina/`, package files, generated source, or examples. Do not implement product code or visual styling specs. See [guardrails in lamina-core](../lamina-core/guardrails.md).

## Modes

| Mode | When | Load path |
|---|---|---|
| **Direct** | One clear topic; single skill suffices | [lamina-core](../lamina-core/SKILL.md) → one `lamina-<id>/SKILL.md` |
| **Workflow** | Slash command invoked, or 2+ UX domains in one ask | This skill → workflow file → listed skills → merge |

Workflow commands always load this skill first, then their workflow file from [workflows/](workflows/).

## Three steps

1. **Select** — parse request; list skills from Problem Router, skill `related` metadata, or [audit-profiles.yaml](audit-profiles.yaml). Workflow profiles define the skill set; **do not truncate** audit lenses when the user asks to skip or limit them.
2. **Apply** — load each skill; run inline by default. For audit, prefer parallel lens subagents over loading all profile skills inline when the host supports Task.
3. **Deliver** — merge into the command output contract; load `lamina-decision-making` per the table below. After emitting the output contract and writing `.lamina/` artifacts such as `report.md`, artifact packs, and `handoff.md`: **STOP**. Do not edit files outside `.lamina/`. Offer implementation only as a separate coding session.

### When to load `lamina-decision-making`

| Workflow | Load `lamina-decision-making` |
|---|---|
| audit | Always (scoring) |
| design | Risks section + conflicts |
| init | Conflicts only |
| direct | Only if user asks |

## Files

| File | Purpose |
|---|---|
| [workflows/router.md](workflows/router.md) | `/lamina` intent routing |
| [workflows/init.md](workflows/init.md) | `/lamina-init` establish + update |
| [workflows/design.md](workflows/design.md) | `/lamina-design` — single net-new UX workflow |
| [workflows/audit.md](workflows/audit.md) | `/lamina-audit` steps |
| [prerequisites/init-required.md](prerequisites/init-required.md) | Init gate for downstream workflows |
| [audit-profiles.yaml](audit-profiles.yaml) | Workflow → skill name lists |
| [merge-rules.md](merge-rules.md) | Work plan, merge order, conflicts |
| [artifacts.md](artifacts.md) | `.lamina/` contract, persona protocol |
| [patterns/parallel-review.md](patterns/parallel-review.md) | Parallel audit lenses |
| [patterns/persona-panel.md](patterns/persona-panel.md) | Persona simulation |
| [patterns/fresh-context.md](patterns/fresh-context.md) | Isolated synthesis pass |
| [patterns/artifact-subagents.md](patterns/artifact-subagents.md) | Dynamic readonly artifact writers |
| [artifact-catalog.yaml](artifact-catalog.yaml) | Artifact input/evidence/diagram routing |

## Subagent patterns

Delegate to agents in `agents/` — see pattern files. Lamina never requires subagents; the host chooses inline, parallel, or fresh-session execution.

## Prompts

Output contracts and templates live in `prompts/` — referenced by ID from workflows.
