---
name: lamina-orchestrator
description: "Product design workflows — domain contracts, implement brief, verify loop. Loaded by /lamina* commands."
disable-model-invocation: true
---

# Lamina Orchestrator

Coordinates design → `ready_to_build` → external build → verify. Mode B: never writes app source.

**Guardrail:** `.lamina/` only. See [guardrails](../lamina-core/guardrails.md).

## Modes

| Mode | When | Load |
|------|------|------|
| **Direct** | One clear topic | [lamina-core](../lamina-core/SKILL.md) → one skill |
| **Workflow** | Slash command | This skill → workflow → [audit-profiles.yaml](audit-profiles.yaml) |

## Workflows

| Workflow | File |
|----------|------|
| Router | [workflows/router.md](workflows/router.md) |
| Init | [workflows/init.md](workflows/init.md) |
| Design | [workflows/design.md](workflows/design.md) |
| Verify | [workflows/verify.md](workflows/verify.md) |
| Audit (deprecated) | [workflows/audit.md](workflows/audit.md) → verify |

## Steps

1. **Select** — skills from audit-profiles for workflow section
2. **Apply** — load each skill; write `run.yaml` incrementally
3. **Deliver** — output contract; design ends at `ready_to_build` + `implement.md`; verify ends at `findings[]`

## Files

| File | Purpose |
|------|---------|
| [artifacts.md](artifacts.md) | `run.yaml` schema, lifecycle |
| [merge-rules.md](merge-rules.md) | Merge order, grounding |
| [audit-profiles.yaml](audit-profiles.yaml) | Section → skills |
| [prerequisites/init-required.md](prerequisites/init-required.md) | Init gate |
