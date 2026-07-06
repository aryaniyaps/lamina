# Minimal blueprint example

Demo blueprint for smoke tests and local preview.

```bash
# from repo root
pnpm install
pnpm test:blueprint
pnpm preview:example

# export flow graph as Mermaid
pnpm exec lamina-blueprint export-graph \
  --root examples/minimal-blueprint/.lamina/blueprints \
  --id demo --stdout
```

Blueprint files live in `.lamina/blueprints/demo/`.
