# aryaniyaps/lamina-bench

LaminaBench v1 — ecological matched-phase product implementation benchmark.

- **5 tasks (v1 core)** across greenfield, OSS feature, OSS audit, workflow edge, and resilience (one per category)
- **10 Harbor tasks** in the published dataset (`taskNNN-control` + `taskNNN-treatment`)
- **10 additional tasks** maintained in-repo as `suite: extended` for future full-corpus release
- **Control:** five-phase generic plan → review loop (no Lamina skills)
- **Treatment:** five-phase Lamina init → design → verify loop (skills installed; harness sends `/lamina-*`)

## Run locally

```bash
npm run bench:harbor:sync
npm run bench:run
```

Both arms use the matched phased harness (`matched-phased-agent.sh`).

## Publish (no benchmark results required)

```bash
harbor auth login
npm run fixtures:vendor   # once, for OSS task fixtures
npm run bench:harbor:publish
```

The publish script uploads tasks from `benchmarks/harbor/tasks/`, refreshes `dataset.toml` digests from the registry (`harbor sync --upgrade`), then publishes the dataset manifest.
