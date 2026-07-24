import assert from 'node:assert/strict';
import { replayV2Candidates } from '../benchmarks/lb6/pilot/scripts/replay-v2-candidates-v3.mjs';

const report = await replayV2Candidates();
assert.equal(report.cells.length, 12, 'all twelve accepted v2 candidates must replay');
for (const cell of report.cells) {
  assert.equal(cell.possible, 10, `${cell.taskId}/${cell.arm} must expose ten semantic points`);
  assert.equal(cell.criteria.length, 10, `${cell.taskId}/${cell.arm} must publish criterion outcomes`);
}
const unstable = report.cells.find(
  (cell) => cell.taskId === 'dev-simple-list' && cell.arm === 'lamina',
);
assert.ok(unstable, 'simple-list/Lamina v2 cell missing');
assert.equal(unstable.measurementInvalid, true, 'wall-clock v2 candidate must be measurement-invalid');
assert.equal(unstable.measurementInvalidReason, 'behavior_nondeterministic');
assert.equal(unstable.v3Reward, 0, 'measurement-invalid replay must fail closed');

console.log('lb6 v2 semantic replay test passed');
