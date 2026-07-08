# @lamina/blueprint

Semantic UX blueprint components and dark greyscale wireframe preview for Lamina — visualize and evaluate UX artifacts (flows, screens, scenarios, persona blockers).

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
- **Skeleton screens** for missing TSX files; graph nodes show Pending/Error badges
- **Provisional flow graph** from `.lamina/flows-inventory.yaml` when `flows.tsx` is absent
- Per-flow screen overrides at `flows/<flow-id>/screens/<screen>.tsx` (fallback: `screens/`)
- Edge-case variants at `scenarios/<id>/screens/<screen>.tsx` (see `scenarios.yaml` — requires `category`, `trigger`, `ux`)
- Single designed state in the canvas (no baseline/proposed comparison)
- Viewport presets in the topbar: Mobile (390px), Tablet (768px), Desktop (1280px, default)

### CLI lifecycle

```bash
lamina-blueprint preview --root .lamina/blueprints --id <id> --ensure --open
```

Writes `.lamina/preview-state.yaml`. `--ensure` starts background server if not running; `--open` uses system browser (`xdg-open` / `open` / `start`).

### Agent API

- `GET /__lamina/state?id=<id>&flowId=<flow>` — per-screen completeness
- `GET /__lamina/screenshot` — not yet available (returns 501; use `/state`)

## Components

Import from `@lamina/blueprint`. See `skills/lamina-blueprint/SKILL.md` for the full SUB taxonomy and generation rules.

## Brownfield validation

Optional `structure-manifest.yaml` in a blueprint directory lists **existing** screens (`source` + `elements` checklist). `lamina-blueprint validate` enforces manifest fidelity for listed screens only; new screens without manifest rows use standard checks. See `skills/lamina-blueprint/SKILL.md` § Brownfield extraction.
