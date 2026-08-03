#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  isCandidateSmokeControllerVerification,
  runCandidateSmokeThroughSafeRunner,
} from '../benchmarks/real-repository-oracle-v1/candidate-smoke-controller.mjs';

const lookalike = Object.freeze({
  schema: 'lamina.real-repository-oracle-candidate-smoke-controller-verification/v1',
  record: Object.freeze({ non_gradeable: true }),
  outer_cleanup_verified: true,
  cleanup_proof_issued: false,
  grading_reachable: false,
});
assert.equal(isCandidateSmokeControllerVerification(lookalike), false);
assert.equal(isCandidateSmokeControllerVerification(structuredClone(lookalike)), false);

for (const [name, value] of Object.entries({
  env: {},
  command: ['spoofed'],
  workloadId: 'spoofed',
  overrides: {},
  promote: false,
  tier: 'small',
  cwd: process.cwd(),
})) {
  await assert.rejects(
    runCandidateSmokeThroughSafeRunner({ reportFile: '/not-reached/report.json', [name]: value }),
    /accepts only reportFile authority/,
    `candidate smoke controller must reject caller ${name} authority`,
  );
}

let accessorReads = 0;
const accessorOptions = {};
Object.defineProperty(accessorOptions, 'reportFile', {
  enumerable: true,
  get() { accessorReads += 1; return '/not-reached/report.json'; },
});
const symbolOptions = { reportFile: '/not-reached/report.json' };
symbolOptions[Symbol('caller-authority')] = true;
for (const [label, options] of [
  ['accessor', accessorOptions],
  ['symbol', symbolOptions],
  ['null prototype', Object.assign(Object.create(null), {
    reportFile: '/not-reached/report.json',
  })],
  ['custom prototype', Object.assign(Object.create({ callerAuthority: true }), {
    reportFile: '/not-reached/report.json',
  })],
]) {
  await assert.rejects(runCandidateSmokeThroughSafeRunner(options),
    /accepts only reportFile authority/, label);
}
assert.equal(accessorReads, 0, 'controller must inspect the descriptor without invoking a getter');

console.log('real repository oracle candidate smoke controller authority passed');
