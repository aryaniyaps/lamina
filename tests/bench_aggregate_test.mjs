#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const METRIC = path.join(ROOT, 'benchmarks/harbor/dataset/metric.py');

function reward(task_id, arm, run, score, category = 'greenfield') {
  return {
    reward: score,
    composite: score,
    lamina_task_id: task_id,
    lamina_arm: arm,
    lamina_run: run,
    lamina_category: category,
    artifact_valid: score > 0,
    clarify_stall: false,
  };
}

function runMetric(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-metric-'));
  const input = path.join(dir, 'rewards.jsonl');
  const output = path.join(dir, 'out.json');
  fs.writeFileSync(input, lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const r = spawnSync('uv', ['run', METRIC, '-i', input, '-o', output], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(fs.readFileSync(output, 'utf8'));
}

// Single run per arm: treatment wins on both tasks.
const single = runMetric([
  reward('task001', 'control', 1, 0.4),
  reward('task001', 'treatment', 1, 0.7),
  reward('task002', 'control', 1, 0.3),
  reward('task002', 'treatment', 1, 0.6),
]);
assert.equal(single.tasks_paired, 2);
assert.equal(single.mean_delta_treatment_minus_control, 0.3);
assert.ok(single.bootstrap_95_ci_delta[0] <= single.mean_delta_treatment_minus_control);
assert.ok(single.bootstrap_95_ci_delta[1] >= single.mean_delta_treatment_minus_control);

// Three runs: median within cell, not mean of runs.
const triple = runMetric([
  reward('task001', 'control', 1, 0.1),
  reward('task001', 'control', 2, 0.9),
  reward('task001', 'control', 3, 0.2),
  reward('task001', 'treatment', 1, 0.8),
  reward('task001', 'treatment', 2, 0.2),
  reward('task001', 'treatment', 3, 0.7),
]);
assert.equal(triple.cells.task001.control.cell_median, 0.2);
assert.equal(triple.cells.task001.treatment.cell_median, 0.7);
assert.equal(triple.paired_by_task.task001, 0.5);

// Lib helpers
const lib = await import('../benchmarks/scripts/bench-results-lib.mjs');
assert.deepEqual(lib.parseHarborJobName('task003-treatment__run2'), {
  task_id: 'task003',
  arm: 'treatment',
  run: 2,
});
assert.deepEqual(lib.parseHarborTaskName('task003-control'), {
  task_id: 'task003',
  arm: 'control',
});

console.log('bench_aggregate_test: ok');
