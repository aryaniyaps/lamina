# Harness matrix

Tier 1 (agent-skill-eval native): `claude-code`, `codex`, `opencode`

Tier 2 (custom adapters in this directory): `cursor`, `gemini-cli`, `github-copilot`, `roo-code`

Install all Tier 1 agents before running `npm run test:eval:smoke` or `npm run test:eval:full`.

```bash
pip install -r evals/requirements.txt
npm install
npm run test:eval:spec
```
