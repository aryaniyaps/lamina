# @lamina/blueprint

Semantic UX blueprint components and dark greyscale wireframe preview for Lamina.

## CLI

```bash
lamina-blueprint preview --root .lamina/blueprints --id <id>
lamina-blueprint export-graph --root .lamina/blueprints --id <id> --stdout
lamina-blueprint validate .lamina/blueprints/<id>
lamina-blueprint retire <id> --root .lamina/blueprints
```

## Preview (v2)

- Dark greyscale wireframe renderer (preview CSS only — blueprint TSX stays unstyled)
- Flow graph with **scenario branches** (dashed edges) — click nodes or hotspots to navigate
- Per-flow screen overrides at `flows/<flow-id>/screens/<screen>.tsx` (fallback: `screens/`)
- Edge-case variants at `scenarios/<id>/screens/<screen>.tsx` (see `scenarios.yaml`)
- Single designed state in the canvas (no baseline/proposed comparison)
- Viewport presets in the topbar: Mobile (390px), Tablet (768px), Desktop (1280px, default)

## Components

Import from `@lamina/blueprint`. See `skills/lamina-blueprint/SKILL.md` for the full SUB taxonomy and generation rules.
