# @lamina/blueprint

Semantic UX blueprint components and dark greyscale wireframe preview for Lamina.

## CLI

```bash
lamina-blueprint preview --root .lamina/blueprints --id <id>
lamina-blueprint preview --root .lamina/blueprints --id <id> --diff
lamina-blueprint export-graph --root .lamina/blueprints --id <id> --stdout
lamina-blueprint validate .lamina/blueprints/<id>
lamina-blueprint retire <id> --root .lamina/blueprints
```

## Preview (v2)

- Dark greyscale wireframe renderer (preview CSS only — blueprint TSX stays unstyled)
- Visual flow graph in the sidebar with clickable screen nodes
- Interactive walkthrough via `trigger` on `Button`, `Action`, and `Link`
- Next-steps strip for outgoing transitions from the current screen
- Optimize diff: Baseline/Proposed tabs and sidebar badges on changed screens

## Components

Import from `@lamina/blueprint`. See `skills/lamina-blueprint/SKILL.md` for the full SUB taxonomy and generation rules.
