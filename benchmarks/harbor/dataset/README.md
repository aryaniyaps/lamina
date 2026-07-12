# aryaniyaps/lamina-bench

LaminaBench v1 — SkillsBench-paired product implementation benchmark.

- **10 tasks** across greenfield, OSS feature, OSS audit, workflow edge, and resilience categories (2 per category)
- **20 Harbor tasks** (`taskNNN-control` + `taskNNN-treatment`) for paired evaluation
- **Control:** fixture + `instruction.md` only (no Lamina skills)
- **Treatment:** same brief + Lamina skills + workflow `AGENTS.md`/`CLAUDE.md`

## Run from registry

```bash
harbor run -d "aryaniyaps/lamina-bench@v1" -a claude-code -m "<model>" \
  --ak "prompt_template=benchmarks/harbor/prompt_template.j2"
```

## Publish (no benchmark results required)

Publishing uploads **task definitions** to the Harbor registry. You do **not** need `bench:run`, `results/`, or scored artifacts.

```bash
harbor auth login
npm run fixtures:vendor   # once, for OSS task fixtures
npm run bench:harbor:publish
```

Answer `y` when Harbor asks to confirm making tasks public.

The publish script uploads tasks from `benchmarks/harbor/tasks/`, refreshes `dataset.toml` digests from the registry (`harbor sync --upgrade`), then publishes the dataset manifest.
