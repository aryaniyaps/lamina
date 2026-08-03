#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  isCandidateLeaseWorkerControllerVerification,
  runCandidateLeaseWorkerThroughSafeRunner,
} from '../benchmarks/real-repository-oracle-v1/candidate-lease-worker-controller.mjs';

const spoof = {
  schema: 'lamina.real-repository-oracle-candidate-lease-worker-controller-verification/v1',
  tier: 'small',
  runs: [],
  lease_evidence_issued: false,
  grading_reachable: false,
  non_gradeable: true,
};
for (const name of ['plain object', 'frozen clone', 'structured clone']) {
  const value = name === 'frozen clone' ? Object.freeze({ ...spoof }) : structuredClone(spoof);
  assert.equal(
    isCandidateLeaseWorkerControllerVerification(value), false,
    `candidate lease worker controller must reject caller ${name} authority`,
  );
}
await assert.rejects(
  () => runCandidateLeaseWorkerThroughSafeRunner({}),
  /reportFile authority/,
);
await assert.rejects(
  () => runCandidateLeaseWorkerThroughSafeRunner({ reportFile: 'relative.json' }),
  /reportFile authority/,
);
await assert.rejects(
  () => runCandidateLeaseWorkerThroughSafeRunner({
    reportFile: '/tmp/report.json', slot_id: 'slot-999', phase: 'first',
  }),
  /not a clean slot/,
);

console.log('real repository oracle candidate lease worker controller authority passed');
