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
| `skills/lamina-core/SKILL.md` | Problem Router index |
| `skills/lamina-orchestrator/SKILL.md` | Workflow coordination |
| `skills/lamina-*/SKILL.md` | 38 capability skills |
| `agents/*.md` | Subagents (Cursor plugin) |

Workflow commands load `skills/lamina-orchestrator/` then capability skills by name.

## Cursor Marketplace

Plugin manifest: `.cursor-plugin/plugin.json` (owner: Aryan Iyappan). Multi-plugin registry: `.cursor-plugin/marketplace.json`.

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
- `skills/` → all lamina skills (core, orchestrator, and capability skills)
- `agents/` → subagents (Cursor)

Preserve relative paths so commands can reference `skills/lamina-orchestrator/` and `skills/lamina-<id>/`.

## Verify

```bash
npm run verify:bundle
```
