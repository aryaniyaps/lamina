# Model locks

Generate one lock per release cohort before freezing:

```bash
node benchmarks/v2/runtime/freeze-model.mjs codex gpt-5.6-sol benchmarks/v2/model-locks/openai-gpt-5.6-sol.json
node benchmarks/v2/runtime/freeze-model.mjs codex gpt-5.5 benchmarks/v2/model-locks/openai-gpt-5.5.json
node benchmarks/v2/runtime/freeze-model.mjs codex gpt-5.5 benchmarks/v2/model-locks/openai-gpt-5.5-secondary-judge.json
```

Copy the resolved model IDs for both execution cohorts and `model_judge` into `release.json`, review CLI versions, and commit the locks before setting the release to `frozen`. If ChatGPT subscription routing reports only the requested provider-managed alias, record that limitation explicitly in the lock and publication report; an alias plus CLI version and execution timestamp is a reproducibility constraint, not an immutable model snapshot.
