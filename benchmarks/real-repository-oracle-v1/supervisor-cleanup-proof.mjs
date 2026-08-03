import crypto from 'node:crypto';
import { outerSafeRunnerCleanupVerified, validateReport } from '../../scripts/safe-runner/report.mjs';

const SUPERVISOR_CLEANUP_PROOF_SCHEMA =
  'lamina.real-repository-oracle-supervisor-cleanup-proof/v1';
const HOST_INIT = Symbol.for('lamina.supervisor-cleanup-proof.host-init');
const HOST_MINT = Symbol.for('lamina.supervisor-cleanup-proof.host-mint');
const PHASES = new Set(['first', 'replay']);
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISSUED_SUPERVISOR_CLEANUP_PROOFS = new WeakSet();
const SUPERVISOR_CLEANUP_RECEIPTS = new WeakMap();
const HOST_CLEANUP_PROOF_CONTROLLERS = new WeakSet();

const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || Object.isFrozen(current)) continue;
    for (const child of Object.values(current)) pending.push(child);
    Object.freeze(current);
  }
  return value;
}

function outerReportDigest(report) {
  return sha256(JSON.stringify(report));
}

function validCorrelation(correlation) {
  return exactKeys(correlation, ['plan', 'slot_id', 'phase', 'opaque_handle', 'end_digest'])
    && correlation.plan !== null && typeof correlation.plan === 'object'
    && /^slot-[1-9]\d*$/.test(correlation.slot_id || '')
    && PHASES.has(correlation.phase)
    && HANDLE.test(correlation.opaque_handle || '')
    && SHA256.test(correlation.end_digest || '');
}

function assertOuterReportAuthority(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)
    || Object.getPrototypeOf(report) !== Object.prototype) {
    throw new Error('supervisor cleanup proof requires an exact outer safe-runner report object');
  }
  if (Object.hasOwn(report, 'cleanup_verified')) {
    throw new Error('caller-supplied cleanup_verified cannot authorize supervisor cleanup proof');
  }
  outerSafeRunnerCleanupVerified(report);
  const validation = validateReport(report);
  if (!validation.valid) {
    throw new Error(`outer safe-runner report is invalid: ${validation.errors.join('; ')}`);
  }
  return outerReportDigest(report);
}

function registerHostCleanupProofController() {
  const controller = Object.freeze({ schema: 'lamina.supervisor-cleanup-proof-host-controller/v1' });
  HOST_CLEANUP_PROOF_CONTROLLERS.add(controller);
  return controller;
}

function issueSupervisorCleanupProofFromOuterReport(hostController, outerReport, correlation) {
  if (!hostController || !HOST_CLEANUP_PROOF_CONTROLLERS.has(hostController)) {
    throw new Error('supervisor cleanup proof may only be issued by a registered host controller');
  }
  if (!validCorrelation(correlation)) {
    throw new Error('supervisor cleanup proof correlation is invalid');
  }
  if (Object.hasOwn(correlation, 'cleanup_verified')) {
    throw new Error('caller-supplied cleanup_verified cannot authorize supervisor cleanup proof');
  }
  const outerReportSha256 = assertOuterReportAuthority(outerReport);
  const proof = deepFreeze({
    schema: SUPERVISOR_CLEANUP_PROOF_SCHEMA,
    outer_report_sha256: outerReportSha256,
    slot_id: correlation.slot_id,
    phase: correlation.phase,
    opaque_handle: correlation.opaque_handle,
    end_digest: correlation.end_digest,
  });
  ISSUED_SUPERVISOR_CLEANUP_PROOFS.add(proof);
  SUPERVISOR_CLEANUP_RECEIPTS.set(proof, deepFreeze({
    plan: correlation.plan,
    slot_id: correlation.slot_id,
    phase: correlation.phase,
    opaque_handle: correlation.opaque_handle,
    end_digest: correlation.end_digest,
    outer_report_sha256: outerReportSha256,
  }));
  return proof;
}

export function verifyIssuedSupervisorCleanupProof(proof, expected) {
  const receipt = proof && ISSUED_SUPERVISOR_CLEANUP_PROOFS.has(proof)
    ? SUPERVISOR_CLEANUP_RECEIPTS.get(proof) : null;
  if (!receipt) {
    throw new Error('supervisor cleanup proof was not issued by the host authority');
  }
  if (!exactKeys(expected, ['plan', 'slot_id', 'phase', 'opaque_handle', 'end_digest'])
    || receipt.plan !== expected.plan || receipt.slot_id !== expected.slot_id
    || receipt.phase !== expected.phase || receipt.opaque_handle !== expected.opaque_handle
    || receipt.end_digest !== expected.end_digest
    || proof.schema !== SUPERVISOR_CLEANUP_PROOF_SCHEMA
    || proof.slot_id !== receipt.slot_id || proof.phase !== receipt.phase
    || proof.opaque_handle !== receipt.opaque_handle || proof.end_digest !== receipt.end_digest
    || proof.outer_report_sha256 !== receipt.outer_report_sha256
    || !SHA256.test(proof.outer_report_sha256 || '')) {
    throw new Error('supervisor cleanup proof belongs to different plan, slot, phase, lease, or digest');
  }
  return true;
}

verifyIssuedSupervisorCleanupProof[HOST_INIT] = registerHostCleanupProofController;
verifyIssuedSupervisorCleanupProof[HOST_MINT] = issueSupervisorCleanupProofFromOuterReport;
