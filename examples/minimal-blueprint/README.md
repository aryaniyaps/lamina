# Minimal blueprint example

Demo blueprint for smoke tests and local preview.

```bash
# from repo root
pnpm install
pnpm test:blueprint
pnpm preview:example

# export flow graph as Mermaid (after pnpm install at repo root)
pnpm exec lamina-blueprint export-graph \
  --root examples/minimal-blueprint/.lamina/blueprints \
  --id demo --stdout

# without bin on PATH
node ../../packages/lamina-blueprint/cli/index.js preview \
  --root .lamina/blueprints --id demo
```

Blueprint files live in `.lamina/blueprints/demo/`.
