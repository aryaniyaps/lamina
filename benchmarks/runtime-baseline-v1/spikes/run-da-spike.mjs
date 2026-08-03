#!/usr/bin/env node
/** #52 Slice 3 Spike 1 (D+A): run small baseline with bounded topology caps. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRuntimeBudgetToEnvironment, runtimeBudgetFromEnvironment } from '../../../packages/cli/lib/runtime-budget.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.resolve(HERE, '../../..');
const RUN = path.join(REPOSITORY, 'benchmarks/runtime-baseline-v1/run.mjs');
const INPUTS = path.join(REPOSITORY, 'dist/runtime-baseline-inputs');
const OUTPUT = process.env.LAMINA_SPIKE_DA_OUTPUT
  || '/tmp/lamina-spike-da-bounded-topology';

const budgetEnv = applyRuntimeBudgetToEnvironment({
  ...process.env,
  LAMINA_RUNTIME_BOUNDED_TOPOLOGY: '1',
  // Spike-only unblock helpers — not default baseline or production (#52 Slice 4 ADR).
  LAMINA_OBSERVATION_BACKEND: 'node',
  LAMINA_SPIKE_SKIP_INITIAL_OBSERVATION_SEED: '1',
});
const budget = runtimeBudgetFromEnvironment(budgetEnv);

for (const required of ['cocoindex-worker', 'model.onnx']) {
  if (!fs.existsSync(path.join(INPUTS, required))) {
    throw new Error(`missing spike runtime input: ${path.join(INPUTS, required)}`);
  }
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true, mode: 0o700 });
const result = spawnSync(process.execPath, [
  RUN, 'run',
  '--fixture', 'small',
  '--output', OUTPUT,
  '--model', path.join(INPUTS, 'model.onnx'),
  '--worker', path.join(INPUTS, 'cocoindex-worker'),
], {
  cwd: REPOSITORY,
  env: budgetEnv,
  encoding: 'utf8',
  stdio: 'inherit',
});

const evidence = {
  schema: 'lamina.runtime-baseline-spike/v1',
  spike: 'da-bounded-topology',
  generated_at: new Date().toISOString(),
  lamina_commit: spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPOSITORY, encoding: 'utf8',
  }).stdout.trim(),
  runtime_budget: budget ? {
    graphd_threads: budget.graphd_threads,
    worker_threads: budget.worker_threads,
    observation_workers_max: budget.observation_workers_max,
    observation_retries_max: budget.observation_retries_max,
  } : null,
  output: OUTPUT,
  exit_code: result.status ?? 1,
};
const evidencePath = path.join(HERE, 'da-bounded-topology.json');
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
process.exit(result.status ?? 1);
