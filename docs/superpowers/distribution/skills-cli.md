# Skills CLI Distribution

Tested Skills CLI version: 0.0.x (pin in CI before release).

## Install

From the repository root:

```bash
npx skills add . -a claude-code -a cursor -a codex -a pi -y
```

This installs:

| Path | Role |
|---|---|
| `commands/lamina.md` | `/lamina` — intent router |
| `commands/lamina-ideate.md` | `/lamina-ideate` |
| `commands/lamina-feature.md` | `/lamina-feature` |
| `commands/lamina-optimize.md` | `/lamina-optimize` |
| `lamina/SKILL.md` | Knowledge base skill (`skillPath`: `lamina/SKILL.md`) |

Workflow commands load `lamina/orchestration.md` then capabilities from `lamina/capabilities/`. `/lamina-optimize` may also load optional rubrics from `lamina/reasoning/` when that directory exists.

## Commands

Install/list/update/remove:

- `npx skills add <source>`
- `npx skills list`
- `npx skills update <name>`
- `npx skills remove <name>`

## Scope and install mode

- global install: `-g`
- copy install instead of symlink: `--copy`
- CI non-interactive mode: `-y`

## Targeted agent example

`npx skills add . -a claude-code -a cursor -a codex -a pi -y`

## Manual fallback

If CLI install fails, copy into the target agent's local skills directories:

- `commands/` → slash commands
- `lamina/` → skill (entry: `lamina/SKILL.md`)

Preserve relative paths so commands can reference `lamina/orchestration.md` and `lamina/capabilities/`.
