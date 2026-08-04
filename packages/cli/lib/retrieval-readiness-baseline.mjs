/** Baseline composite: observe then rebuild with bounded phase teardown in one CLI process. */
import { graphRequest } from './graph-runtime/client.mjs';
import { runObservation } from './observe.mjs';
import { ensureRetrieval } from './retrieval-runtime/process.mjs';
import { forceStopRuntimeOrphans, runWithRuntimeLifecycle } from './runtime-lifecycle.mjs';
import { runtimeBudgetFromEnvironment } from './runtime-budget.mjs';

export async function runRetrievalReadinessBaseline(cwd = process.cwd()) {
  const budget = runtimeBudgetFromEnvironment();
  return runWithRuntimeLifecycle(cwd, async () => {
    const observation = await runObservation({ cwd, embedded: true });
    if (budget) {
      try { await graphRequest('graph.engine.release', {}, cwd); } catch {}
      try { await graphRequest('graph.retrieval.release', {}, cwd); } catch {}
      await forceStopRuntimeOrphans(cwd);
      process.env.LAMINA_GRAPHD_REUSE_ONLY = '1';
    }
    let retrieval;
    try {
      retrieval = await ensureRetrieval(cwd, {
        force: true,
        embedded: true,
        reuseGraphd: Boolean(budget),
      });
    } finally {
      if (budget) delete process.env.LAMINA_GRAPHD_REUSE_ONLY;
    }
    return {
      ok: true,
      observation,
      retrieval,
    };
  }, { mutation: true });
}
