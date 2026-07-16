# Model locks

Generate one lock per release cohort before freezing:

```bash
node benchmarks/v2/runtime/freeze-model.mjs codex gpt-5.6-sol benchmarks/v2/model-locks/openai-gpt-5.6-sol.json
node benchmarks/v2/runtime/freeze-model.mjs codex gpt-5.6-terra benchmarks/v2/model-locks/openai-gpt-5.6-terra.json
node benchmarks/v2/runtime/freeze-model.mjs claude-code opus benchmarks/v2/model-locks/anthropic-opus.json
node benchmarks/v2/runtime/freeze-model.mjs claude-code sonnet benchmarks/v2/model-locks/anthropic-sonnet.json
```

Copy the resolved Claude model IDs into `release.json`, review CLI versions, and commit the locks before setting the release to `frozen`.
