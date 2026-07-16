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

function runMetricFailure(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-metric-fail-'));
  const input = path.join(dir, 'rewards.jsonl');
  const output = path.join(dir, 'out.json');
  fs.writeFileSync(input, lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return spawnSync('uv', ['run', METRIC, '-i', input, '-o', output], {
    cwd: ROOT,
    encoding: 'utf8',
  });
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

// Agent failures are outcomes, not attrition: keep their finalized zero score.
const ittFailure = reward('task001', 'control', 1, 0);
ittFailure.agent_failed = true;
const itt = runMetric([ittFailure, reward('task001', 'treatment', 1, 0.6)]);
assert.equal(itt.trials_included, 2);
assert.equal(itt.paired_by_task.task001, 0.6);

// Duplicate scheduled cells must never be silently combined.
const duplicate = runMetricFailure([
  reward('task001', 'control', 1, 0.2),
  reward('task001', 'control', 1, 0.3),
  reward('task001', 'treatment', 1, 0.5),
]);
assert.notEqual(duplicate.status, 0);
assert.match(duplicate.stderr, /Duplicate trial/);

// Claim readiness requires the exact frozen core and complete provenance.
const { evaluateClaimReadiness } = await import('../benchmarks/scripts/claim-readiness.mjs');
const { benchmarkProtocolSha256 } = await import('../benchmarks/scripts/benchmark-provenance.mjs');
const { readYamlSync } = await import('../benchmarks/scripts/yaml.mjs');
const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
const core = ['task001', 'task003', 'task005', 'task007', 'task009'];
let position = 0;
const publishRows = core.flatMap((taskId) =>
  ['control', 'treatment'].flatMap((arm) =>
    [1, 2, 3].map((run) => ({
      ...reward(taskId, arm, run, 0.5),
      publish_mode: true,
      worktree_clean: true,
      benchmark_git_commit: '0123456789abcdef',
      protocol_sha256: benchmarkProtocolSha256().sha256,
      runtime_image_id: 'sha256:runtime',
      quality_isolated: true,
      claim_scope: { type: 'core', task_ids: core },
      schedule_position: ++position,
      workspace_snapshot: true,
      recovered_metadata: false,
      harness_version: release.harness_version,
      results_contract_version: release.results_contract_version,
      rubric_version: release.rubric_version,
    }))
  )
);
assert.equal(evaluateClaimReadiness(publishRows, release).claim_ready, true);
const incompletePublish = publishRows.slice(0, -1);
const readiness = evaluateClaimReadiness(incompletePublish, release);
assert.equal(readiness.claim_ready, false);
assert.ok(readiness.reasons.some((reason) => reason.includes('missing scheduled cells')));

let taskPosition = 0;
const taskPublishRows = ['control', 'treatment'].flatMap((arm) =>
  [1, 2, 3].map((run) => ({
    ...reward('task001', arm, run, 0.5),
    publish_mode: true,
    worktree_clean: true,
    benchmark_git_commit: '0123456789abcdef',
    protocol_sha256: benchmarkProtocolSha256().sha256,
    runtime_image_id: 'sha256:runtime',
    quality_isolated: true,
    schedule_position: ++taskPosition,
    workspace_snapshot: true,
    recovered_metadata: false,
    harness_version: release.harness_version,
    results_contract_version: release.results_contract_version,
    rubric_version: release.rubric_version,
    claim_scope: { type: 'task', task_ids: ['task001'] },
  }))
);
const taskReadiness = evaluateClaimReadiness(taskPublishRows, release);
assert.equal(taskReadiness.claim_ready, true);
assert.equal(taskReadiness.claim_status, 'publishable_for_declared_task_only');
assert.deepEqual(taskReadiness.expected_task_ids, ['task001']);

const { scheduledPairs } = await import('../benchmarks/scripts/benchmark-schedule.mjs');
const schedule = scheduledPairs(core, 3, release.schedule_seed);
assert.equal(schedule.length, 30);
const pairFirstArms = Array.from({ length: 15 }, (_, index) =>
  schedule[index * 2].harborName.endsWith('-treatment') ? 'treatment' : 'control'
);
const treatmentFirstCount = pairFirstArms.filter((arm) => arm === 'treatment').length;
assert.ok([7, 8].includes(treatmentFirstCount));
for (let index = 0; index < schedule.length; index += 2) {
  assert.equal(schedule[index].taskId, schedule[index + 1].taskId);
  assert.equal(schedule[index].run, schedule[index + 1].run);
  assert.notEqual(schedule[index].harborName, schedule[index + 1].harborName);
}

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
