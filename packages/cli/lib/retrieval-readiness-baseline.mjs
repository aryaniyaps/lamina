/** Baseline composite: observe then rebuild with bounded phase teardown in one CLI process. */
import { runObservation } from './observe.mjs';
import { ensureRetrieval } from './retrieval-runtime/process.mjs';
import { releaseRuntimeBetweenPhases, runWithRuntimeLifecycle } from './runtime-lifecycle.mjs';
import { runtimeBudgetFromEnvironment } from './runtime-budget.mjs';

export async function runRetrievalReadinessBaseline(cwd = process.cwd()) {
  const budget = runtimeBudgetFromEnvironment();
  return runWithRuntimeLifecycle(cwd, async () => {
    const observation = await runObservation({ cwd, embedded: true });
    if (budget) {
      await releaseRuntimeBetweenPhases(cwd);
    }
    const retrieval = await ensureRetrieval(cwd, {
      force: true,
      embedded: true,
    });
    return {
      ok: true,
      observation,
      retrieval,
    };
  }, { mutation: true });
}
