#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  jobKey,
  dedupeIndexByJob,
  isScoreableEntry,
  isCompleteForResume,
  computeJobFingerprint,
  upsertIndexEntry,
  readIndexRows,
  loadCompletedJobKeys,
} from '../benchmarks/scripts/bench-index.mjs';

const rows = [
  { task_id: 'task001', arm: 'control', run: 1, timestamp: '2026-07-11T01:00:00.000Z', artifact_valid: true },
  { task_id: 'task001', arm: 'control', run: 1, timestamp: '2026-07-11T02:00:00.000Z', artifact_valid: false },
];
assert.equal(dedupeIndexByJob(rows)[0].artifact_valid, false);
assert.equal(jobKey(rows[0]), 'task001:control:run1');

assert.equal(
  isScoreableEntry({
    artifact_valid: true,
    status: 'success',
    failed_gate: null,
    results_contract_version: '1.0.0',
  }, '1.0.0'),
  true
);
assert.equal(
  isScoreableEntry({
    artifact_valid: true,
    status: 'success',
    failed_gate: null,
    results_contract_version: '2.1.0',
  }, '1.0.0'),
  false
);

const task = {
  id: 'taskX',
  category: 'greenfield',
  workflow: 'design',
  prompt: 'Build X',
  fixture: null,
  instruction: 'Desc\n\n## Context\n\nCtx',
};
const fp1 = computeJobFingerprint(task, {
  arm: 'control',
  run: 1,
  agent: 'claude-code',
  model: 'm1',
  resultsContractVersion: '1.0.0',
});
const fp2 = computeJobFingerprint(task, {
  arm: 'control',
  run: 1,
  agent: 'claude-code',
  model: 'm1',
  resultsContractVersion: '1.0.0',
});
assert.equal(fp1, fp2);
const fp3 = computeJobFingerprint(
  { ...task, prompt: 'Build Y' },
  { arm: 'control', run: 1, agent: 'claude-code', model: 'm1', resultsContractVersion: '1.0.0' }
);
assert.notEqual(fp1, fp3);

assert.equal(
  isCompleteForResume(
    { artifact_valid: true, status: 'success', failed_gate: null, job_fingerprint: fp1 },
    fp1
  ),
  true
);
assert.equal(
  isCompleteForResume(
    { artifact_valid: true, status: 'success', failed_gate: null, job_fingerprint: fp1 },
    fp3
  ),
  false
);

const idxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-index-'));
upsertIndexEntry(
  {
    task_id: 'taskX',
    arm: 'control',
    run: 1,
    artifact_valid: true,
    status: 'success',
    results_contract_version: '1.0.0',
    job_fingerprint: fp1,
    timestamp: '2026-07-11T03:00:00.000Z',
  },
  idxDir
);
const completed = loadCompletedJobKeys({
  jobs: [{ task, run: 1, arm: 'control' }],
  agent: 'claude-code',
  model: 'm1',
  resultsContractVersion: '1.0.0',
  resultsDir: idxDir,
});
assert.ok(completed.has('taskX:control:run1'));

const forced = loadCompletedJobKeys({
  jobs: [{ task, run: 1, arm: 'control' }],
  agent: 'claude-code',
  model: 'm1',
  resultsContractVersion: '1.0.0',
  resultsDir: idxDir,
  forceKeys: new Set(['taskX']),
});
assert.equal(forced.has('taskX:control:run1'), false);

assert.equal(readIndexRows(idxDir).length, 1);
fs.rmSync(idxDir, { recursive: true, force: true });

console.log('bench_harness_hardening_test: ok');
