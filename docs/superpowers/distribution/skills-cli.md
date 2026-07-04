# Skills CLI Distribution
Tested Skills CLI version: 0.0.x (pin in CI before release).

Install/list/update/remove:
- `npx skills add <source>`
- `npx skills list`
- `npx skills update <name>`
- `npx skills remove <name>`

Scope and install mode:
- global install: `-g`
- copy install instead of symlink: `--copy`
- CI non-interactive mode: `-y`

Targeted agent example:
`npx skills add . -a claude-code -a cursor -a codex -a pi -y`

fallback manual install:
If CLI install fails, copy `commands/` and `skills/` into the target agent's local skill directories manually.
