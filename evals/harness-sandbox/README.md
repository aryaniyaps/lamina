# Eval harness sandbox

Skills CLI install target for Lamina eval harnesses only.

Do **not** run `npx skills add` from the Lamina repo root — installs land here so agent skill copies (`.agents/`, `.windsurf/`, etc.) never pollute the canonical `skills/` tree.

Canonical skill source: `../../skills/`

External knowledge-base skills (branding, discovery-learning, systems-thinking): `../../../skills/` (sibling repo). Install for eval harness:

```bash
source ../../hooks/skills-sandbox.sh && skills_add_external
```

For local Cursor dev at repo root:

```bash
npm run setup:external-skills
```
