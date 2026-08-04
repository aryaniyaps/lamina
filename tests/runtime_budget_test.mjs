#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  applyRuntimeBudgetToEnvironment,
  graphdLadybugThreads,
  graphdThreadEnvironment,
  maxObservationAttempts,
  observationWorkerThreadEnvironment,
  retrievalBatchEnvironment,
  runtimeBudgetFromEnvironment,
  threadLimitEnvironment,
  workerThreadEnvironment,
} from '../packages/cli/lib/runtime-budget.mjs';
import { shouldReleaseGraphdAfterCommand } from '../packages/cli/lib/runtime-lifecycle.mjs';

assert.equal(runtimeBudgetFromEnvironment({ LAMINA_RUNTIME_BOUNDED_TOPOLOGY: '0' }), null);
assert.equal(runtimeBudgetFromEnvironment({ LAMINA_RUNTIME_BOUNDED_TOPOLOGY: 'false' }), null);

const defaultBudget = runtimeBudgetFromEnvironment({});
assert.ok(defaultBudget);
assert.equal(defaultBudget.graphd_threads, 1);
assert.equal(defaultBudget.worker_threads, 1);
assert.equal(defaultBudget.observation_workers_max, 1);
assert.equal(defaultBudget.observation_retries_max, 0);
assert.equal(defaultBudget.retrieval_batch_size, 16);
assert.equal(defaultBudget.defer_graphd_compat_recovery, true);
assert.equal(defaultBudget.idle_graphd_shutdown_ms, 0);

const explicitBudget = runtimeBudgetFromEnvironment({ LAMINA_RUNTIME_BOUNDED_TOPOLOGY: '1' });
assert.ok(explicitBudget);
assert.equal(explicitBudget.graphd_threads, 1);

const tuned = runtimeBudgetFromEnvironment({
  LAMINA_RUNTIME_GRAPHD_THREADS: '6',
  LAMINA_RUNTIME_WORKER_THREADS: '3',
  LAMINA_RUNTIME_OBSERVATION_RETRIES: '1',
  LAMINA_RUNTIME_DEFER_GRAPHD_COMPAT_RECOVERY: '0',
});
assert.equal(tuned.graphd_threads, 6);
assert.equal(tuned.worker_threads, 3);
assert.equal(tuned.observation_retries_max, 1);
assert.equal(tuned.defer_graphd_compat_recovery, false);

assert.equal(graphdLadybugThreads(defaultBudget), 1);
assert.equal(graphdLadybugThreads(null), null);

assert.deepEqual(threadLimitEnvironment(2), {
  OMP_NUM_THREADS: '2',
  OPENBLAS_NUM_THREADS: '2',
  MKL_NUM_THREADS: '2',
  VECLIB_MAXIMUM_THREADS: '2',
  NUMEXPR_NUM_THREADS: '2',
  ORT_NUM_THREADS: '2',
  UV_THREADPOOL_SIZE: '2',
  TOKENIZERS_PARALLELISM: 'false',
  RAYON_NUM_THREADS: '2',
  TOKIO_WORKER_THREADS: '2',
  LAMINA_RUNTIME_WORKER_THREADS: '2',
});

assert.deepEqual(graphdThreadEnvironment(defaultBudget), threadLimitEnvironment(1));
assert.deepEqual(workerThreadEnvironment(defaultBudget), threadLimitEnvironment(1));
assert.deepEqual(observationWorkerThreadEnvironment(defaultBudget), {
  OMP_NUM_THREADS: '1',
  OPENBLAS_NUM_THREADS: '1',
  MKL_NUM_THREADS: '1',
  VECLIB_MAXIMUM_THREADS: '1',
  NUMEXPR_NUM_THREADS: '1',
  ORT_NUM_THREADS: '1',
  TOKENIZERS_PARALLELISM: 'false',
  RAYON_NUM_THREADS: '1',
  TOKIO_WORKER_THREADS: '1',
  COCOINDEX_MAX_INFLIGHT_COMPONENTS: '1',
  LAMINA_RUNTIME_WORKER_THREADS: '1',
});
assert.equal(maxObservationAttempts(null), 2);
assert.equal(maxObservationAttempts(defaultBudget), 2);
assert.equal(maxObservationAttempts(tuned), 2);
assert.deepEqual(retrievalBatchEnvironment(defaultBudget), { LAMINA_RUNTIME_RETRIEVAL_BATCH: '16' });

const applied = applyRuntimeBudgetToEnvironment({ HOME: '/tmp' }, defaultBudget);
assert.equal(applied.HOME, '/tmp');
assert.equal(applied.LAMINA_RUNTIME_BOUNDED_TOPOLOGY, '1');
assert.equal(applied.LAMINA_RUNTIME_GRAPHD_THREADS, '1');
assert.equal(shouldReleaseGraphdAfterCommand({ persistGraphd: false, budget: defaultBudget }), true);
assert.equal(shouldReleaseGraphdAfterCommand({ persistGraphd: true, budget: defaultBudget }), false);

process.stdout.write('runtime budget tests passed\n');
