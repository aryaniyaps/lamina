# Lamina

UX research and design knowledge for coding agents — slash commands, 40 capability skills, orchestration, subagents, and optional UX blueprint preview.

## Slash commands


| Command            | Product                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `/lamina`          | Auto-route to ideate, feature, optimize, or a single-topic answer                       |
| `/lamina-init`     | Establish or update business context (goals, scope, users, metrics) for UX work         |
| `/lamina-ideate`   | Problem → user model, journey, IA, flows, screens, interactions, copy, a11y, validation |
| `/lamina-feature`  | Feature idea → spec, risks, accessibility, metrics, implementation checklist            |
| `/lamina-optimize` | Audit existing flows → prioritized improvements (impact × effort)                       |




## Plugin structure


| Layer             | Path                                                         |
| ----------------- | ------------------------------------------------------------ |
| Commands          | `[commands/](commands/)`                                     |
| Index / router    | `[skills/lamina-core/SKILL.md](skills/lamina-core/SKILL.md)` |
| Orchestration     | `[skills/lamina-orchestrator/](skills/lamina-orchestrator/)` |
| Capability skills | `[skills/lamina-*/SKILL.md](skills/)` (40 skills)            |
| Subagents         | `[agents/](agents/)`                                         |
| Reusable prompts  | `[prompts/](prompts/)`                                       |


**Guardrail:** UX guidance only. No product code or visual styling specs.

## UX Blueprint preview (optional)

Semantic wireframe specs in `.lamina/blueprints/<id>/` with a local greyscale preview:

```bash
pnpm install
pnpm preview:example
# or: pnpm exec lamina-blueprint preview --root .lamina/blueprints --id <id>
# from repo root without install: node packages/lamina-blueprint/cli/index.js preview --root ...
```

See [skills/lamina-blueprint/SKILL.md](skills/lamina-blueprint/SKILL.md) and [examples/minimal-blueprint/](examples/minimal-blueprint/).

## Install

```bash
npx skills add . -a claude-code -a cursor -a codex -a pi -y
```

See [docs/superpowers/distribution/skills-cli.md](docs/superpowers/distribution/skills-cli.md) for scope, global install, and manual fallback.