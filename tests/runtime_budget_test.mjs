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

const disabled = runtimeBudgetFromEnvironment({ LAMINA_RUNTIME_BOUNDED_TOPOLOGY: '0' });
assert.equal(disabled, null);

const budget = runtimeBudgetFromEnvironment({
  LAMINA_RUNTIME_BOUNDED_TOPOLOGY: '1',
  LAMINA_RUNTIME_GRAPHD_THREADS: '2',
  LAMINA_RUNTIME_WORKER_THREADS: '3',
  LAMINA_RUNTIME_RETRIEVAL_BATCH: '8',
});
assert.equal(budget.graphd_threads, 2);
assert.equal(budget.worker_threads, 3);
assert.equal(budget.retrieval_batch_size, 8);
assert.equal(graphdLadybugThreads(budget), 2);
assert.equal(workerThreadEnvironment(budget).ORT_NUM_THREADS, '3');
assert.equal(retrievalBatchEnvironment(budget).LAMINA_RUNTIME_RETRIEVAL_BATCH, '8');
assert.equal(graphdThreadEnvironment(budget).OMP_NUM_THREADS, '2');
assert.equal(observationWorkerThreadEnvironment(budget).COCOINDEX_MAX_INFLIGHT_COMPONENTS, '1');
assert.equal(maxObservationAttempts(budget), 2);

const applied = applyRuntimeBudgetToEnvironment({ HOME: '/tmp' }, budget);
assert.equal(applied.LAMINA_RUNTIME_BOUNDED_TOPOLOGY, '1');
assert.equal(applied.LAMINA_RUNTIME_GRAPHD_THREADS, '2');
assert.equal(applied.HOME, '/tmp');

const threadEnv = threadLimitEnvironment(4);
assert.equal(threadEnv.ORT_NUM_THREADS, '4');
assert.equal(threadEnv.TOKENIZERS_PARALLELISM, 'false');

console.log('runtime_budget_test: ok');
