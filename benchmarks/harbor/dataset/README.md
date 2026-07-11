# aryaniyaps/lamina-bench

LaminaBench v3.0 — SkillsBench-paired product implementation benchmark.

- **25 tasks** across greenfield, OSS feature, OSS audit, workflow edge, and resilience categories
- **50 Harbor tasks** (`taskNNN-control` + `taskNNN-treatment`) for paired evaluation
- **Control:** fixture + `instruction.md` only (no Lamina skills)
- **Treatment:** same brief + Lamina skills + workflow `AGENTS.md`/`CLAUDE.md`

## Run from registry

```bash
harbor run -d "aryaniyaps/lamina-bench@v3.0.0" -a claude-code -m "<model>" \
  --ak "prompt_template=benchmarks/harbor/prompt_template.j2"
```

## Publish / refresh

From the repo root (requires `harbor auth login`):

```bash
npm run bench:harbor:publish
```

This syncs workspaces, symlinks tasks beside `dataset.toml`, refreshes digests, and publishes all 50 tasks plus the dataset manifest.
