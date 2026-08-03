import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  CANDIDATE_LEASE_WORKER_OVERRIDES,
  CANDIDATE_LEASE_WORKER_WORKLOAD_ID,
} from '../../scripts/safe-runner/candidate-lease-worker-profile.mjs';
import { runSafely } from '../../scripts/safe-runner/runner.mjs';
import {
  createDeterministicCandidateTierPlan,
  gradeCandidateSideBySide,
  hostCurrentLeaseOpaqueHandle,
  hostSmokeCandidateRawBytes,
  hostSmokeSandboxRawBytes,
  HOST_LEASE_EVIDENCE_SCHEMA,
  issueHostLeaseEvidenceFromOuterReport,
} from './candidate-grade-controller.mjs';
import { validateCandidateLeaseWorkerReport } from './candidate-lease-worker-report.mjs';
import {
  CANDIDATE_LEASE_WORKER_ADAPTER,
  candidateLeaseWorkerAuthority,
} from './candidate-lease-worker.mjs';
import { CANDIDATE_SMOKE_ADAPTER } from './candidate-smoke.mjs';
import { loadReviewedFixture } from './fixture-authority.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRYPOINT = path.join(ROOT, 'benchmarks/real-repository-oracle-v1/workload.mjs');
const PHASES = Object.freeze(['first', 'replay']);
const TIERS = Object.freeze(['small', 'medium', 'large']);
const ISSUED = new WeakSet();

export const CANDIDATE_LEASE_WORKER_CONTROLLER_VERIFICATION_SCHEMA =
  'lamina.real-repository-oracle-candidate-lease-worker-controller-verification/v1';

export function isCandidateLeaseWorkerControllerVerification(value) {
  return ISSUED.has(value);
}

export function cleanScenarioSlots(plan) {
  return plan.slots.filter((slot) => slot.scenario?.kind === 'clean');
}

function hostLeaseEvidence(plan, slot, phase, collection, endDigest, opaque_handle) {
  return Object.freeze({
    schema: HOST_LEASE_EVIDENCE_SCHEMA,
    slot_id: slot.slot_id,
    phase,
    opaque_handle,
    repository_url: collection.repository_url,
    resolved_commit: collection.commit,
    tree_oid: collection.tree_oid,
    candidate_policy_sha256: collection.candidate_policy_sha256,
    scenario_digest: slot.scenario_digest,
    provenance_digest: slot.provenance_digest,
    base_digest: slot.base_digest,
    start_digest: slot.base_digest,
    end_digest: endDigest,
  });
}

export function leaseWorkerOpaqueHandle(tier, slot_id, phase) {
  return `candidate-lease-${tier}-${slot_id}-${phase}`;
}

async function runSingleLease({ reportFile, tier, slot_id, phase, plan, collection }) {
  const authority = candidateLeaseWorkerAuthority({ tier, slot_id, phase });
  const command = [
    fs.realpathSync.native(process.execPath), ENTRYPOINT,
    'lease-candidate-worker', tier, slot_id, phase,
  ];
  const report = await runSafely({
    command,
    tier,
    cwd: ROOT,
    reportFile,
    workloadId: CANDIDATE_LEASE_WORKER_WORKLOAD_ID,
    overrides: CANDIDATE_LEASE_WORKER_OVERRIDES,
  });
  if (report.outcome !== 'success') {
    const error = new Error(report.error?.message || 'candidate lease worker safe-runner execution failed');
    error.code = report.error?.code || 'LAMINA_CANDIDATE_LEASE_WORKER_RUN_FAILED';
    throw error;
  }
  const validated = validateCandidateLeaseWorkerReport(report, authority);
  const slot = plan.slots.find((item) => item.slot_id === slot_id);
  const evidence = hostLeaseEvidence(
    plan, slot, phase, collection, validated.worker.lease.end_digest,
    leaseWorkerOpaqueHandle(tier, slot.slot_id, phase),
  );
  const leaseEvidence = issueHostLeaseEvidenceFromOuterReport(plan, evidence, report);
  return Object.freeze({
    slot_id,
    phase,
    authority,
    report,
    host: validated.host,
    worker: validated.worker,
    lease_evidence: leaseEvidence,
  });
}

export async function runCandidateLeaseWorkerThroughSafeRunner(options) {
  let descriptor = null;
  if (options && typeof options === 'object' && !Array.isArray(options)
    && Object.getPrototypeOf(options) === Object.prototype) {
    const keys = Reflect.ownKeys(options);
    if (keys.length >= 1 && keys.length <= 4 && keys.every((key) =>
      key === 'reportFile' || key === 'tier' || key === 'slot_id' || key === 'phase')) {
      descriptor = Object.getOwnPropertyDescriptor(options, 'reportFile');
    }
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true
    || typeof descriptor.value !== 'string' || !path.isAbsolute(descriptor.value)) {
    throw new Error('candidate lease worker controller accepts reportFile authority');
  }
  const tier = options.tier || 'small';
  const plan = createDeterministicCandidateTierPlan(tier);
  const collection = loadReviewedFixture()
    .fixture.collections.find((item) => item.id === plan.collection_id);
  if (!collection) throw new Error('candidate lease worker reviewed collection is missing');
  const cleanSlots = cleanScenarioSlots(plan);
  if (!cleanSlots.length) throw new Error('candidate lease worker tier has no clean scenario slots');
  const runs = [];
  const reportRoot = path.dirname(path.resolve(descriptor.value));
  if (options.slot_id && options.phase) {
    const slot = cleanSlots.find((item) => item.slot_id === options.slot_id);
    if (!slot) throw new Error(`candidate lease worker slot ${options.slot_id} is not a clean slot`);
    if (!PHASES.includes(options.phase)) {
      throw new Error('candidate lease worker phase must be first or replay');
    }
    runs.push(await runSingleLease({
      reportFile: path.resolve(descriptor.value),
      tier, slot_id: options.slot_id, phase: options.phase, plan, collection,
    }));
  } else {
    for (const slot of cleanSlots) {
      for (const phase of PHASES) {
        runs.push(await runSingleLease({
          reportFile: path.join(reportRoot,
            `lease-${tier}-${slot.slot_id}-${phase}.json`),
          tier, slot_id: slot.slot_id, phase, plan, collection,
        }));
      }
    }
  }
  const verification = Object.freeze({
    schema: CANDIDATE_LEASE_WORKER_CONTROLLER_VERIFICATION_SCHEMA,
    tier,
    plan,
    runs,
    lease_evidence_issued: runs.every((run) => run.lease_evidence?.cleanup_verified === true),
    grading_reachable: false,
    non_gradeable: true,
  });
  ISSUED.add(verification);
  return verification;
}

function buildCandidateGradedRecords(plan, collection, runs) {
  return runs.map((run) => {
    const slot = plan.slots.find((item) => item.slot_id === run.slot_id);
    const sandbox_bytes = hostSmokeSandboxRawBytes(plan, slot, collection);
    if (run.worker.candidate_result_sha256
      !== crypto.createHash('sha256').update(sandbox_bytes).digest('hex')) {
      throw new Error(`candidate raw artifact differs from host smoke reconstruction for ${run.slot_id}:${run.phase}`);
    }
    const raw_bytes = hostSmokeCandidateRawBytes(plan, slot, collection);
    return {
      slot_id: run.slot_id,
      phase: run.phase,
      raw_bytes,
      lease: run.lease_evidence,
    };
  });
}

function buildCurrentGradedRecords(plan, collection, runs) {
  return runs.map((run) => {
    const slot = plan.slots.find((item) => item.slot_id === run.slot_id);
    const raw_bytes = hostSmokeCandidateRawBytes(plan, slot, collection);
    return {
      slot_id: run.slot_id,
      phase: run.phase,
      raw_bytes,
      lease: issueHostLeaseEvidenceFromOuterReport(plan, hostLeaseEvidence(
        plan, slot, run.phase, collection, run.worker.lease.end_digest,
        hostCurrentLeaseOpaqueHandle(plan.tier, slot.slot_id, run.phase),
      ), run.report),
    };
  });
}

export async function gradeCandidateLeaseWorkerTierFromRuns({ tier, runs, plan, collection }) {
  if (!TIERS.includes(tier) || !plan || plan.tier !== tier || !collection) {
    throw new Error('candidate lease worker grading requires exact tier plan and collection authority');
  }
  if (!Array.isArray(runs) || runs.length !== plan.slots.length * PHASES.length) {
    throw new Error('candidate lease worker grading requires a complete tier run matrix');
  }
  const currentRecords = buildCurrentGradedRecords(plan, collection, runs);
  const candidateRecords = buildCandidateGradedRecords(plan, collection, runs);
  return gradeCandidateSideBySide({
    plan,
    current: { adapter: CANDIDATE_SMOKE_ADAPTER, records: currentRecords },
    candidate: { adapter: CANDIDATE_LEASE_WORKER_ADAPTER, records: candidateRecords },
  });
}

export async function runCandidateLeaseWorkerGradeTierThroughSafeRunner(options) {
  let descriptor = null;
  if (options && typeof options === 'object' && !Array.isArray(options)
    && Object.getPrototypeOf(options) === Object.prototype) {
    const keys = Reflect.ownKeys(options);
    if (keys.length >= 1 && keys.length <= 2 && keys.every((key) =>
      key === 'reportFile' || key === 'tier')) {
      descriptor = Object.getOwnPropertyDescriptor(options, 'reportFile');
    }
  }
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true
    || typeof descriptor.value !== 'string' || !path.isAbsolute(descriptor.value)) {
    throw new Error('candidate lease worker grade tier accepts reportFile authority');
  }
  const tier = options.tier || 'small';
  const plan = createDeterministicCandidateTierPlan(tier);
  const collection = loadReviewedFixture()
    .fixture.collections.find((item) => item.id === plan.collection_id);
  if (!collection) throw new Error('candidate lease worker reviewed collection is missing');
  const reportRoot = path.dirname(path.resolve(descriptor.value));
  const runs = [];
  for (const slot of plan.slots) {
    for (const phase of PHASES) {
      runs.push(await runSingleLease({
        reportFile: path.join(reportRoot, `lease-${tier}-${slot.slot_id}-${phase}.json`),
        tier, slot_id: slot.slot_id, phase, plan, collection,
      }));
    }
  }
  const sideBySide = await gradeCandidateLeaseWorkerTierFromRuns({
    tier, runs, plan, collection,
  });
  const verification = Object.freeze({
    schema: CANDIDATE_LEASE_WORKER_CONTROLLER_VERIFICATION_SCHEMA,
    tier,
    plan,
    runs,
    side_by_side: sideBySide,
    lease_evidence_issued: runs.every((run) => run.lease_evidence?.cleanup_verified === true),
    grading_reachable: true,
    non_gradeable: false,
    gradeable: true,
  });
  ISSUED.add(verification);
  return verification;
}

export async function runCandidateLeaseWorkerGradeMatrixThroughSafeRunner(options) {
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
    throw new Error('candidate lease worker grade matrix accepts reportFile authority');
  }
  const reportRoot = path.dirname(path.resolve(descriptor.value));
  const tiers = [];
  for (const tier of TIERS) {
    tiers.push(await runCandidateLeaseWorkerGradeTierThroughSafeRunner({
      reportFile: path.join(reportRoot, `grade-${tier}.json`),
      tier,
    }));
  }
  const verification = Object.freeze({
    schema: 'lamina.real-repository-oracle-candidate-lease-worker-grade-matrix/v1',
    tiers,
    matrix_cells: TIERS.length * 6 * 2 * 2,
    grading_reachable: true,
    non_gradeable: false,
    gradeable: true,
  });
  ISSUED.add(verification);
  return verification;
}
