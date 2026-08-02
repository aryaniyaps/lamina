import {
  ADAPTER_SCHEMA, ATTESTATION_SCHEMA, RESULT_SCHEMA, attestableResultDigest,
  canonical, digest, validateResult,
} from './contract.mjs';
import { registerVerifierAttestation } from './attestation-authority.mjs';
import { validateReport } from '../../scripts/safe-runner/report.mjs';

export const WORKLOAD_ID = 'real-repository-oracle-v1:validate';
export const EXACT_WORKLOAD_COMMAND = Object.freeze([
  'node', 'benchmarks/real-repository-oracle-v1/workload.mjs', 'validate',
]);
export const PAYLOAD_PREFIX = 'LAMINA_REAL_REPOSITORY_ORACLE_PAYLOAD_V1=';

const deepFreeze = (item) => {
  if (item && typeof item === 'object' && !Object.isFrozen(item)) {
    Object.freeze(item); Object.values(item).forEach(deepFreeze);
  }
  return item;
};

function extractPayload(report) {
  if (report.output.truncated) throw new Error('safe-runner output was truncated; oracle payload is not attestable');
  const matches = report.output.stdout_tail.split(/\r?\n/).filter((line) => line.startsWith(PAYLOAD_PREFIX));
  if (matches.length !== 1) throw new Error('safe-runner report must contain exactly one bounded oracle payload');
  const encoded = matches[0].slice(PAYLOAD_PREFIX.length);
  if (!encoded || encoded.length > 128 * 1024) throw new Error('oracle payload is empty or exceeds the verifier bound');
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
  catch { throw new Error('safe-runner oracle payload is malformed'); }
  return payload;
}

export function encodeUnattestedPayload({ tier, collectionDigest, result }) {
  const payload = {
    schema: 'lamina.real-repository-oracle-payload/v1', workload_id: WORKLOAD_ID,
    tier, command: [...EXACT_WORKLOAD_COMMAND], collection_digest: collectionDigest, result,
  };
  return `${PAYLOAD_PREFIX}${Buffer.from(JSON.stringify(canonical(payload))).toString('base64url')}`;
}

export function attestSafeRunnerReport(reportBytes, { expectedTier, expectedCollectionDigest }) {
  const exactBytes = Buffer.isBuffer(reportBytes) ? reportBytes : Buffer.from(reportBytes);
  let report;
  try { report = JSON.parse(exactBytes.toString('utf8')); }
  catch { throw new Error('safe-runner report bytes are not JSON'); }
  const reportValidation = validateReport(report);
  if (!reportValidation.valid) throw new Error(`safe-runner report is invalid: ${reportValidation.errors.join('; ')}`);
  if (report.outcome !== 'success') throw new Error(`safe-runner report outcome is not attestable success: ${report.outcome}`);
  if (report.tier !== expectedTier || JSON.stringify(report.command) !== JSON.stringify(EXACT_WORKLOAD_COMMAND)) {
    throw new Error('safe-runner report does not bind the exact workload command and tier');
  }
  if (report.cleanup.attempted !== true || report.cleanup.descendants_remaining.length
    || report.cleanup.managed_paths_remaining.length || report.cleanup.scope_removed !== true
    || report.cleanup.temporary_directory_removed !== true || report.cleanup.errors.length) {
    throw new Error('safe-runner report does not prove complete outer cleanup');
  }
  const payload = extractPayload(report);
  if (!payload || Object.keys(payload).sort().join(',') !== 'collection_digest,command,result,schema,tier,workload_id'
    || payload.schema !== 'lamina.real-repository-oracle-payload/v1' || payload.workload_id !== WORKLOAD_ID
    || payload.tier !== expectedTier || JSON.stringify(payload.command) !== JSON.stringify(EXACT_WORKLOAD_COMMAND)
    || payload.collection_digest !== expectedCollectionDigest
    || payload.result?.collection_digest !== expectedCollectionDigest) {
    throw new Error('oracle payload does not bind the expected workload, tier, command, and collection');
  }
  const rawValidation = validateResult(payload.result, { allowUnattested: true });
  if (!rawValidation.valid || payload.result.evidence_mode === 'oracle_validation'
    || payload.result.safety.mode !== 'unattested' || payload.result.safety.outcome !== 'pending') {
    throw new Error(`oracle payload is not a valid unattested measured result: ${rawValidation.errors.join('; ')}`);
  }
  const materializationDigests = [...new Set(payload.result.materializations.map((item) => item.base_digest))].sort();
  const attestation = deepFreeze(registerVerifierAttestation({
    schema: ATTESTATION_SCHEMA,
    report_schema: report.schema,
    report_sha256: digest(exactBytes),
    result_sha256: attestableResultDigest(payload.result),
    workload_id: WORKLOAD_ID,
    tier: expectedTier,
    command_sha256: digest(EXACT_WORKLOAD_COMMAND),
    collection_digest: expectedCollectionDigest,
    materialization_digests: materializationDigests,
    runner_outcome: report.outcome,
    cleanup_verified: true,
  }));
  const result = {
    ...payload.result,
    safety: { mode: 'attested', outcome: 'success', reason: null, attestation },
  };
  const finalValidation = validateResult(result, { safetyAttestation: attestation });
  if (!finalValidation.valid) throw new Error(`attested oracle result is invalid: ${finalValidation.errors.join('; ')}`);
  return { result: deepFreeze(result), attestation };
}

export function attestBlockedSafeRunnerReport(reportBytes, {
  expectedTier, expectedCollectionDigest, adapterId, evidenceMode = 'public_cli',
}) {
  const exactBytes = Buffer.isBuffer(reportBytes) ? reportBytes : Buffer.from(reportBytes);
  let report;
  try { report = JSON.parse(exactBytes.toString('utf8')); }
  catch { throw new Error('safe-runner report bytes are not JSON'); }
  const reportValidation = validateReport(report);
  if (!reportValidation.valid) throw new Error(`safe-runner report is invalid: ${reportValidation.errors.join('; ')}`);
  if (report.outcome === 'success' || report.tier !== expectedTier
    || JSON.stringify(report.command) !== JSON.stringify(EXACT_WORKLOAD_COMMAND)) {
    throw new Error('blocked evidence does not bind a non-success exact workload report');
  }
  const cleanupVerified = report.cleanup.descendants_remaining.length === 0
    && report.cleanup.managed_paths_remaining.length === 0 && report.cleanup.errors.length === 0
    && (report.outcome === 'preflight_refused'
      || (report.cleanup.attempted === true && report.cleanup.scope_removed === true
        && report.cleanup.temporary_directory_removed === true));
  if (!cleanupVerified) throw new Error('blocked report left unverified cleanup state');
  const resultWithoutSafety = {
    schema: RESULT_SCHEMA,
    adapter: { schema: ADAPTER_SCHEMA, id: adapterId, version: 1, input_format: 'lamina.real-repository-oracle-input/v1', output_format: 'lamina.real-repository-oracle-result-case/v1' },
    collection_id: `collection.${expectedTier}`, collection_digest: expectedCollectionDigest,
    evidence_mode: evidenceMode,
    claims: { end_to_end_runtime: false, observation: 'not_measured', obligations: 'not_measured', source_localization: 'not_measured' },
    cases: [], materializations: [], replay_digest: null,
  };
  const attestation = deepFreeze(registerVerifierAttestation({
    schema: ATTESTATION_SCHEMA, report_schema: report.schema, report_sha256: digest(exactBytes),
    result_sha256: digest(resultWithoutSafety),
    workload_id: WORKLOAD_ID, tier: expectedTier, command_sha256: digest(EXACT_WORKLOAD_COMMAND),
    collection_digest: expectedCollectionDigest, materialization_digests: [],
    runner_outcome: report.outcome, cleanup_verified: true,
  }));
  const reason = report.error?.message || report.termination?.reason || report.outcome;
  const result = {
    ...resultWithoutSafety,
    safety: { mode: 'attested', outcome: 'blocked', reason, attestation },
  };
  const validation = validateResult(result, { safetyAttestation: attestation });
  if (!validation.valid) throw new Error(`attested blocked result is invalid: ${validation.errors.join('; ')}`);
  return { result: deepFreeze(result), attestation };
}
