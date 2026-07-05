# Lamina

UX research and design knowledge for coding agents — slash commands, 38 capability skills, orchestration, and subagents.

## Slash commands


| Command            | Product                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `/lamina`          | Auto-route to ideate, feature, optimize, or a single-topic answer                       |
| `/lamina-ideate`   | Problem → user model, journey, IA, flows, screens, interactions, copy, a11y, validation |
| `/lamina-feature`  | Feature idea → spec, risks, accessibility, metrics, implementation checklist            |
| `/lamina-optimize` | Audit existing flows → prioritized improvements (impact × effort)                       |




## Plugin structure


| Layer             | Path                                                         |
| ----------------- | ------------------------------------------------------------ |
| Commands          | `[commands/](commands/)`                                     |
| Index / router    | `[skills/lamina-core/SKILL.md](skills/lamina-core/SKILL.md)` |
| Orchestration     | `[skills/lamina-orchestrator/](skills/lamina-orchestrator/)` |
| Capability skills | `[skills/lamina-*/SKILL.md](skills/)` (38 skills)            |
| Subagents         | `[agents/](agents/)`                                         |
| Reusable prompts  | `[prompts/](prompts/)`                                       |


**Guardrail:** UX guidance only. No product code or visual styling specs.

## Install

```bash
npx skills add . -a claude-code -a cursor -a codex -a pi -y
```

See [docs/superpowers/distribution/skills-cli.md](docs/superpowers/distribution/skills-cli.md) for scope, global install, and manual fallback.