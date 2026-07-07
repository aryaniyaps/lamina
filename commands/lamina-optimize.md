---
description: "Renamed to /lamina-audit."
disable-model-invocation: true
---

# /lamina-optimize (deprecated)

**Renamed to `/lamina-audit`.** Run the audit workflow — not design.

## Load

- `skills/lamina-orchestrator/SKILL.md`
- `skills/lamina-orchestrator/workflows/audit.md`
- `skills/lamina-orchestrator/prerequisites/init-required.md`
- `skills/lamina-orchestrator/prompts/outputs/init-blocked.md`
- `skills/lamina-core/guardrails.md`

Load and execute `skills/lamina-orchestrator/workflows/audit.md`. Run init gate first; on failure emit `init-blocked` verbatim.
