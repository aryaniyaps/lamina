# Lamina

UX research and design knowledge for coding agents — slash commands plus a 38-capability knowledge base.

## Slash commands

| Command | Product |
|---|---|
| `/lamina` | Auto-route to ideate, feature, optimize, or a single-topic answer |
| `/lamina-ideate` | Problem → user model, journey, IA, flows, screens, interactions, copy, a11y, validation |
| `/lamina-feature` | Feature idea → spec, risks, accessibility, metrics, implementation checklist |
| `/lamina-optimize` | Audit existing flows → prioritized improvements (impact × effort) |

## Knowledge core

- [`skills/lamina/SKILL.md`](skills/lamina/SKILL.md) — skill entry and Problem Router
- [`skills/lamina/orchestration.md`](skills/lamina/orchestration.md) — multi-capability coordination, merge, subagent hints
- [`skills/lamina/reference.md`](skills/lamina/reference.md) — shortcuts, capability index, glossary
- [`skills/lamina/artifacts.md`](skills/lamina/artifacts.md) — `.lamina/` artifact contract and persona protocol
- [`skills/lamina/capabilities/`](skills/lamina/capabilities/) — 38 problem-oriented guides
- [`commands/`](commands/) — slash command product specs

**Guardrail:** UX guidance only. No product code or visual styling specs.

## Install

```bash
npx skills add . -a claude-code -a cursor -a codex -a pi -y
```

See [docs/superpowers/distribution/skills-cli.md](docs/superpowers/distribution/skills-cli.md) for scope, global install, and manual fallback.

Manual fallback: copy `commands/` and `lamina/` into your agent's skills directory; point the lamina skill at `lamina/SKILL.md`.
