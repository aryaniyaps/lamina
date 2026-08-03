import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANDIDATE_SMOKE_OVERRIDES,
  CANDIDATE_SMOKE_WORKLOAD_ID,
} from '../../scripts/safe-runner/candidate-smoke-profile.mjs';
import { runSafely } from '../../scripts/safe-runner/runner.mjs';
import { validateCandidateSmokeReport } from './candidate-smoke-report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRYPOINT = path.join(ROOT, 'benchmarks/real-repository-oracle-v1/workload.mjs');
const ISSUED = new WeakSet();

export function isCandidateSmokeControllerVerification(value) {
  return ISSUED.has(value);
}

export async function runCandidateSmokeThroughSafeRunner(options) {
  let descriptor = null;
  if (options && typeof options === 'object' && !Array.isArray(options)
    && Object.getPrototypeOf(options) === Object.prototype) {
    const keys = Reflect.ownKeys(options);
    if (keys.length === 1 && keys[0] === 'reportFile') {
      descriptor = Object.getOwnPropertyDescriptor(options, 'reportFile');
    }
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true
    || typeof descriptor.value !== 'string' || !path.isAbsolute(descriptor.value)) {
    throw new Error('candidate smoke controller accepts only reportFile authority');
  }
  const reportFileAuthority = descriptor.value;
  const requestedReport = path.resolve(reportFileAuthority);
  const requestedParent = path.dirname(requestedReport);
  const physicalParent = fs.realpathSync.native(requestedParent);
  if (physicalParent !== requestedParent) {
    throw new Error('candidate smoke controller report parent must be an exact physical path');
  }
  const reportFile = path.join(physicalParent, path.basename(requestedReport));
  const command = [
    fs.realpathSync.native(process.execPath), ENTRYPOINT, 'smoke-candidate-small',
  ];
  const report = await runSafely({
    command,
    tier: 'small',
    cwd: ROOT,
    reportFile,
    workloadId: CANDIDATE_SMOKE_WORKLOAD_ID,
    overrides: CANDIDATE_SMOKE_OVERRIDES,
  });
  if (report.outcome !== 'success') {
    const error = new Error(report.error?.message || 'candidate smoke safe-runner execution failed');
    error.code = report.error?.code || 'LAMINA_CANDIDATE_SMOKE_RUN_FAILED';
    throw error;
  }
  const record = validateCandidateSmokeReport(report);
  const verification = Object.freeze({
    schema: 'lamina.real-repository-oracle-candidate-smoke-controller-verification/v1',
    record,
    outer_cleanup_verified: true,
    cleanup_proof_issued: false,
    grading_reachable: false,
  });
  ISSUED.add(verification);
  return verification;
}
