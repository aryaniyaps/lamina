#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  applyRuntimeBudgetToEnvironment,
  graphdThreadEnvironment,
  maxObservationAttempts,
  runtimeBudgetFromEnvironment,
  threadLimitEnvironment,
  workerThreadEnvironment,
} from '../packages/cli/lib/runtime-budget.mjs';

assert.equal(runtimeBudgetFromEnvironment({}), null);
assert.equal(runtimeBudgetFromEnvironment({ LAMINA_RUNTIME_BOUNDED_TOPOLOGY: '0' }), null);

const budget = runtimeBudgetFromEnvironment({ LAMINA_RUNTIME_BOUNDED_TOPOLOGY: '1' });
assert.ok(budget);
assert.equal(budget.graphd_threads, 4);
assert.equal(budget.worker_threads, 4);
assert.equal(budget.observation_workers_max, 1);
assert.equal(budget.observation_retries_max, 0);
assert.equal(budget.defer_graphd_compat_recovery, true);

const tuned = runtimeBudgetFromEnvironment({
  LAMINA_RUNTIME_BOUNDED_TOPOLOGY: '1',
  LAMINA_RUNTIME_GRAPHD_THREADS: '6',
  LAMINA_RUNTIME_WORKER_THREADS: '3',
  LAMINA_RUNTIME_OBSERVATION_RETRIES: '1',
  LAMINA_RUNTIME_DEFER_GRAPHD_COMPAT_RECOVERY: '0',
});
assert.equal(tuned.graphd_threads, 6);
assert.equal(tuned.worker_threads, 3);
assert.equal(tuned.observation_retries_max, 1);
assert.equal(tuned.defer_graphd_compat_recovery, false);

assert.deepEqual(threadLimitEnvironment(2), {
  OMP_NUM_THREADS: '2',
  OPENBLAS_NUM_THREADS: '2',
  MKL_NUM_THREADS: '2',
  VECLIB_MAXIMUM_THREADS: '2',
  NUMEXPR_NUM_THREADS: '2',
  ORT_NUM_THREADS: '2',
  UV_THREADPOOL_SIZE: '2',
  TOKENIZERS_PARALLELISM: 'false',
});

assert.deepEqual(graphdThreadEnvironment(budget), threadLimitEnvironment(4));
assert.deepEqual(workerThreadEnvironment(budget), threadLimitEnvironment(4));
assert.equal(maxObservationAttempts(null), 2);
assert.equal(maxObservationAttempts(budget), 1);
assert.equal(maxObservationAttempts(tuned), 2);

const applied = applyRuntimeBudgetToEnvironment({ HOME: '/tmp' }, budget);
assert.equal(applied.HOME, '/tmp');
assert.equal(applied.LAMINA_RUNTIME_BOUNDED_TOPOLOGY, '1');
assert.equal(applied.LAMINA_RUNTIME_GRAPHD_THREADS, '4');

process.stdout.write('runtime budget tests passed\n');
