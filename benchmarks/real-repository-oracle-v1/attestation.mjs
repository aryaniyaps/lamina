import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  ATTESTATION_SCHEMA, attestableResultDigest,
  canonical, digest, validateResult,
} from './contract.mjs';
import { validateReport } from '../../scripts/safe-runner/report.mjs';

export const WORKLOAD_ID = 'real-repository-oracle-v1:validate';
export const AUDITED_ENTRYPOINT = 'benchmarks/real-repository-oracle-v1/workload.mjs';
export const CANONICAL_WORKLOAD_ARGV = Object.freeze(['node', AUDITED_ENTRYPOINT, 'validate']);
export const PAYLOAD_PREFIX = 'LAMINA_REAL_REPOSITORY_ORACLE_PAYLOAD_V1=';
export const MAX_PAYLOAD_LINE_BYTES = 7_680;
export const MAX_RETAINED_DIAGNOSTICS = 12;
export const MAX_RETAINED_DIAGNOSTIC_CHARS = 300;
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

const deepFreeze = (item) => {
  if (item && typeof item === 'object' && !Object.isFrozen(item)) {
    Object.freeze(item); Object.values(item).forEach(deepFreeze);
  }
  return item;
};

function physicalFileIdentity(file, { executable = false, hash = true, singleLink = false } = {}) {
  const declared = path.resolve(file);
  const named = fs.lstatSync(declared, { bigint: true });
  if (!named.isFile() || named.isSymbolicLink() || (singleLink && named.nlink !== 1n)
    || fs.realpathSync.native(declared) !== declared
    || (typeof process.getuid === 'function' && Number(named.uid) !== process.getuid())
    || (process.platform !== 'win32' && (named.mode & 0o022n) !== 0n)
    || (process.platform !== 'win32' && executable && (named.mode & 0o111n) === 0n)) {
    throw new Error('controller evidence must be a canonical same-user physical file');
  }
  const descriptor = fs.openSync(declared, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (opened.dev !== named.dev || opened.ino !== named.ino || opened.size !== named.size
      || opened.uid !== named.uid || opened.nlink !== named.nlink) throw new Error('controller evidence changed while opening');
    if (opened.size > BigInt(MAX_REPORT_BYTES) && !executable) throw new Error('controller report exceeds the verifier bound');
    const bytes = hash ? fs.readFileSync(descriptor) : null;
    const final = fs.fstatSync(descriptor, { bigint: true });
    if (final.dev !== opened.dev || final.ino !== opened.ino || final.size !== opened.size
      || final.uid !== opened.uid || final.nlink !== opened.nlink) throw new Error('controller evidence changed while reading');
    return {
      path: declared, bytes, size: String(opened.size), dev: String(opened.dev),
      ino: String(opened.ino), uid: Number(opened.uid), mode: Number(opened.mode & 0o777n),
      digest: bytes ? digest(bytes) : null,
    };
  } finally { fs.closeSync(descriptor); }
}

function readControllerReport(reportFile) {
  if (!path.isAbsolute(reportFile)) throw new Error('controller report path must be absolute');
  const reportIdentity = physicalFileIdentity(reportFile, { singleLink: true });
  const parent = path.dirname(reportIdentity.path);
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()
    || fs.realpathSync.native(parent) !== parent
    || (typeof process.getuid === 'function' && parentStat.uid !== process.getuid())) {
    throw new Error('controller report parent is not a canonical same-user directory');
  }
  let report;
  try { report = JSON.parse(reportIdentity.bytes.toString('utf8')); }
  catch { throw new Error('controller report file is not JSON'); }
  if (report.report_file !== reportIdentity.path) throw new Error('report_file does not bind the physical controller report');
  const cwd = fs.realpathSync.native(report.cwd);
  if (cwd === parent || parent.startsWith(`${cwd}${path.sep}`)
    || cwd.startsWith(`${parent}${path.sep}`)) {
    throw new Error('controller report authority overlaps the writable payload cwd');
  }
  return { report, reportIdentity, cwd };
}

function verifyIdentityDigest(identity, name) {
  if (!identity || !SHA256.test(identity.digest || '')) throw new Error(`${name} digest is absent`);
  const { digest: claimed, ...value } = identity;
  if (digest(JSON.stringify(value)) !== claimed) throw new Error(`${name} digest contradicts its report value`);
}

function verifyCommandAndPromotion(report, cwd) {
  const command = report.command;
  if (!Array.isArray(command) || command.length !== 3 || command[2] !== 'validate'
    || !path.isAbsolute(command[0]) || !path.isAbsolute(command[1])) {
    throw new Error('safe-runner report lacks the exact absolute oracle argv');
  }
  const executable = physicalFileIdentity(command[0], { executable: true });
  const entrypoint = physicalFileIdentity(command[1]);
  const relative = path.relative(cwd, entrypoint.path).replaceAll('\\', '/');
  if (relative !== AUDITED_ENTRYPOINT) throw new Error('oracle entrypoint is not the cwd-contained audited source');
  const preflight = report.preflight;
  if (preflight?.ok !== true || preflight.workload_id !== WORKLOAD_ID
    || preflight.ownership?.proven !== true
    || preflight.ownership?.audited_entrypoint !== AUDITED_ENTRYPOINT
    || fs.realpathSync.native(preflight.ownership.executable) !== executable.path
    || preflight.scope_proof?.production_enforcement !== true
    || JSON.stringify(preflight.execution_command) !== JSON.stringify(command)) {
    throw new Error('safe-runner preflight does not bind audited ownership, workload, and production enforcement');
  }
  const source = preflight.source_identity;
  if (!source || source.repository !== cwd || JSON.stringify(source.command) !== JSON.stringify(command)
    || source.executable?.path !== executable.path || source.executable?.digest !== executable.digest
    || source.executable?.size !== executable.size
    || !Array.isArray(source.workload_inputs)) {
    throw new Error('safe-runner source identity does not bind the exact executable and command');
  }
  const sourceEntrypoint = source.workload_inputs.find((item) => item.path === entrypoint.path);
  if (!sourceEntrypoint || sourceEntrypoint.digest !== entrypoint.digest
    || sourceEntrypoint.size !== entrypoint.size) {
    throw new Error('safe-runner source identity does not bind the audited entrypoint bytes');
  }
  verifyIdentityDigest(source, 'source identity');
  const snapshot = preflight.execution_snapshot;
  const execution = preflight.execution_identity;
  if (!snapshot || !SHA256.test(snapshot.digest || '') || !execution
    || execution.source_identity_digest !== source.digest
    || execution.execution_snapshot_digest !== snapshot.digest
    || execution.digest !== digest(JSON.stringify({ source_identity_digest: source.digest, execution_snapshot_digest: snapshot.digest }))) {
    throw new Error('safe-runner execution identity does not bind the sealed source snapshot');
  }
  const promotion = preflight.promotion;
  if (!promotion || promotion.ok !== true || promotion.deferred_to_execution_snapshot !== false
    || !Array.isArray(promotion.missing) || promotion.missing.length !== 0) {
    throw new Error('safe-runner report does not contain successful sealed promotion evidence');
  }
  return {
    source_identity_sha256: source.digest,
    execution_identity_sha256: execution.digest,
    promotion_sha256: digest(promotion),
  };
}

function extractPayload(report) {
  if (report.output.truncated) throw new Error('safe-runner output was truncated; oracle payload is not attestable');
  const matches = report.output.stdout_tail.split(/\r?\n/).filter((line) => line.startsWith(PAYLOAD_PREFIX));
  if (matches.length !== 1) throw new Error('safe-runner report must retain exactly one compact oracle payload');
  const line = matches[0];
  if (Buffer.byteLength(line) > MAX_PAYLOAD_LINE_BYTES) throw new Error('oracle payload exceeds the real safe-runner diagnostic-tail budget');
  let payload;
  try {
    const compressed = Buffer.from(line.slice(PAYLOAD_PREFIX.length), 'base64url');
    payload = JSON.parse(zlib.brotliDecompressSync(compressed, { maxOutputLength: 512 * 1024 }).toString('utf8'));
  } catch { throw new Error('safe-runner oracle payload is malformed'); }
  return payload;
}

export function createCompactGradeEnvelope({ fixtureDigest, result, grade }) {
  const raw = validateResult(result, { allowUnattested: true });
  if (!raw.valid || result.safety.mode !== 'unattested' || result.safety.outcome !== 'pending') {
    throw new Error(`cannot compact an invalid unattested result: ${raw.errors.join('; ')}`);
  }
  if (!grade || !['pass', 'product_regression'].includes(grade.classification)
    || typeof grade.passed !== 'boolean' || !grade.metrics || !Array.isArray(grade.diagnostics)) {
    throw new Error('compact grade envelope requires a complete parent-defined grade result');
  }
  const fullDiagnostics = grade.diagnostics.map((item) => String(item));
  const compactGrade = {
    ...grade,
    diagnostics: fullDiagnostics.slice(0, MAX_RETAINED_DIAGNOSTICS)
      .map((item) => item.slice(0, MAX_RETAINED_DIAGNOSTIC_CHARS)),
    diagnostics_total: fullDiagnostics.length,
    diagnostics_sha256: digest(fullDiagnostics),
  };
  return canonical({
    schema: 'lamina.real-repository-oracle-grade-envelope/v1',
    fixture_digest: fixtureDigest, collection_id: result.collection_id,
    collection_digest: result.collection_digest, evidence_mode: result.evidence_mode,
    claims: result.claims, adapter: result.adapter,
    result_sha256: attestableResultDigest(result), replay_digest: result.replay_digest,
    case_count: result.cases.length,
    materializations: result.materializations.map((item) => ({
      case_id: item.case_id, scenario_digest: item.scenario_digest,
      provenance_digest: item.provenance_digest, base_digest: item.base_digest,
    })),
    grade: compactGrade,
  });
}

export function encodeUnattestedPayload({ tier, collectionDigest, envelope }) {
  const payload = {
    schema: 'lamina.real-repository-oracle-payload/v1', tier,
    collection_digest: collectionDigest, envelope,
  };
  const compressed = zlib.brotliCompressSync(Buffer.from(JSON.stringify(canonical(payload))), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const line = `${PAYLOAD_PREFIX}${compressed.toString('base64url')}`;
  if (Buffer.byteLength(line) > MAX_PAYLOAD_LINE_BYTES) {
    throw new Error(`compact oracle payload exceeds ${MAX_PAYLOAD_LINE_BYTES} retained diagnostic bytes`);
  }
  return line;
}

function verifyCommon(returnedReport, { reportFile, expectedTier, expectedCollectionDigest }) {
  if (!returnedReport || returnedReport.writtenReport?.fallback !== false
    || returnedReport.writtenReport?.path !== path.resolve(reportFile)
    || returnedReport.writtenReport?.write_error) {
    throw new Error('verification requires the exact final report returned by the parent runSafely call');
  }
  const authority = readControllerReport(reportFile);
  if (JSON.stringify(canonical(authority.report)) !== JSON.stringify(canonical(returnedReport))) {
    throw new Error('physical report generation contradicts the parent-returned final report');
  }
  const validation = validateReport(authority.report);
  if (!validation.valid) throw new Error(`safe-runner report is invalid: ${validation.errors.join('; ')}`);
  if (authority.report.tier !== expectedTier) throw new Error('safe-runner report tier contradicts the requested verification');
  const bound = verifyCommandAndPromotion(authority.report, authority.cwd);
  return { ...authority, ...bound, expectedCollectionDigest };
}

function finalAttestation(common, envelope, materializationDigests) {
  return deepFreeze({
    schema: ATTESTATION_SCHEMA, report_schema: common.report.schema,
    report_sha256: common.reportIdentity.digest, result_sha256: envelope.result_sha256,
    fixture_digest: envelope.fixture_digest,
    tier: common.report.tier,
    command_sha256: digest(CANONICAL_WORKLOAD_ARGV),
    source_identity_sha256: common.source_identity_sha256,
    execution_identity_sha256: common.execution_identity_sha256,
    promotion_sha256: common.promotion_sha256,
    collection_digest: common.expectedCollectionDigest,
    materialization_digests: materializationDigests,
    runner_outcome: common.report.outcome, cleanup_verified: true,
  });
}

function verifiedEnvelopeMaterializationDigests(envelope) {
  if (!Number.isInteger(envelope.case_count) || envelope.case_count < 1
    || !Array.isArray(envelope.materializations)
    || envelope.materializations.length !== envelope.case_count) {
    throw new Error('oracle compact grade envelope has inconsistent case materializations');
  }
  const caseIds = new Set();
  for (const item of envelope.materializations) {
    if (!item || Object.keys(item).sort().join(',') !== 'base_digest,case_id,provenance_digest,scenario_digest'
      || typeof item.case_id !== 'string' || !item.case_id || caseIds.has(item.case_id)
      || !SHA256.test(item.scenario_digest || '') || !SHA256.test(item.provenance_digest || '')
      || !SHA256.test(item.base_digest || '')) {
      throw new Error('oracle compact grade envelope has an invalid or duplicate case materialization');
    }
    caseIds.add(item.case_id);
  }
  return [...new Set(envelope.materializations.map((item) => item.base_digest))].sort();
}

function verifyCompactGrade(grade) {
  if (!grade || !['pass', 'product_regression'].includes(grade.classification)
    || typeof grade.passed !== 'boolean'
    || grade.passed !== (grade.classification === 'pass')
    || !grade.metrics || typeof grade.metrics !== 'object' || Array.isArray(grade.metrics)
    || !grade.coverage || typeof grade.coverage !== 'object' || Array.isArray(grade.coverage)
    || !Array.isArray(grade.diagnostics)
    || grade.diagnostics.length > MAX_RETAINED_DIAGNOSTICS
    || !Number.isInteger(grade.diagnostics_total)
    || grade.diagnostics_total < grade.diagnostics.length
    || !SHA256.test(grade.diagnostics_sha256 || '')
    || grade.diagnostics.some((item) => typeof item !== 'string'
      || item.length > MAX_RETAINED_DIAGNOSTIC_CHARS)) {
    throw new Error('oracle compact grade envelope has invalid bounded grade evidence');
  }
}

export function verifyReturnedControllerReport(returnedReport, {
  reportFile, expectedTier, expectedCollectionDigest, expectedFixtureDigest,
}) {
  const common = verifyCommon(returnedReport, { reportFile, expectedTier, expectedCollectionDigest });
  const { report } = common;
  if (report.outcome !== 'success' || report.cleanup.attempted !== true
    || report.cleanup.descendants_remaining.length || report.cleanup.managed_paths_remaining.length
    || report.cleanup.scope_removed !== true || report.cleanup.temporary_directory_removed !== true
    || report.cleanup.errors.length) throw new Error('safe-runner report does not prove successful execution and complete outer cleanup');
  const payload = extractPayload(report);
  if (!payload || Object.keys(payload).sort().join(',') !== 'collection_digest,envelope,schema,tier'
    || payload.schema !== 'lamina.real-repository-oracle-payload/v1'
    || payload.tier !== expectedTier || payload.collection_digest !== expectedCollectionDigest
    || payload.envelope?.collection_digest !== expectedCollectionDigest
    || payload.envelope?.fixture_digest !== expectedFixtureDigest
    || payload.envelope?.schema !== 'lamina.real-repository-oracle-grade-envelope/v1') {
    throw new Error('oracle payload does not bind the expected tier and collection');
  }
  const envelope = payload.envelope;
  if (!SHA256.test(envelope.fixture_digest || '') || !SHA256.test(envelope.collection_digest || '')
    || !SHA256.test(envelope.result_sha256 || '') || !SHA256.test(envelope.replay_digest || '')) {
    throw new Error('oracle compact grade envelope is incomplete');
  }
  verifyCompactGrade(envelope.grade);
  const materializations = verifiedEnvelopeMaterializationDigests(envelope);
  const attestation = finalAttestation(common, envelope, materializations);
  return deepFreeze({
    schema: 'lamina.real-repository-oracle-unbranded-report/v1', envelope, attestation,
    report_file: common.reportIdentity.path, report_sha256: common.reportIdentity.digest,
  });
}

export function verifyReturnedBlockedControllerReport(returnedReport, {
  reportFile, expectedTier, expectedCollectionDigest, expectedFixtureDigest,
}) {
  if (!returnedReport || returnedReport.writtenReport?.fallback !== false
    || returnedReport.writtenReport?.path !== path.resolve(reportFile)
    || returnedReport.writtenReport?.write_error) {
    throw new Error('blocked verification requires the exact parent-returned report generation');
  }
  const common = readControllerReport(reportFile);
  const { report } = common;
  if (JSON.stringify(canonical(report)) !== JSON.stringify(canonical(returnedReport))) {
    throw new Error('blocked physical report contradicts the parent-returned final report');
  }
  const reportValidation = validateReport(report);
  if (!reportValidation.valid || report.tier !== expectedTier) {
    throw new Error(`blocked safe-runner report is invalid: ${reportValidation.errors.join('; ')}`);
  }
  const command = report.command;
  const entrypoint = Array.isArray(command) && command.length === 3
    && path.isAbsolute(command[0]) && path.isAbsolute(command[1]) && command[2] === 'validate'
    ? physicalFileIdentity(command[1]) : null;
  if (!entrypoint || path.relative(common.cwd, entrypoint.path).replaceAll('\\', '/') !== AUDITED_ENTRYPOINT
    || report.preflight?.workload_id !== WORKLOAD_ID
    || report.preflight?.ownership?.audited_entrypoint !== AUDITED_ENTRYPOINT) {
    throw new Error('blocked report does not bind the parent oracle command authority');
  }
  if (report.outcome === 'success') throw new Error('blocked evidence requires a non-success runner report');
  const cleanup = report.cleanup.descendants_remaining.length === 0
    && report.cleanup.managed_paths_remaining.length === 0 && report.cleanup.errors.length === 0
    && (report.outcome === 'preflight_refused'
      || (report.cleanup.attempted === true && report.cleanup.scope_removed === true
        && report.cleanup.temporary_directory_removed === true));
  if (!cleanup) throw new Error('blocked report left unverified cleanup state');
  const reason = report.error?.message || report.termination?.reason || report.outcome;
  return deepFreeze({
    schema: 'lamina.real-repository-oracle-unbranded-report/v1', envelope: null,
    attestation: {
      schema: ATTESTATION_SCHEMA, report_schema: report.schema,
      report_sha256: common.reportIdentity.digest, result_sha256: '0'.repeat(64),
      fixture_digest: expectedFixtureDigest, tier: expectedTier,
      command_sha256: digest(CANONICAL_WORKLOAD_ARGV),
      source_identity_sha256: SHA256.test(report.preflight?.source_identity?.digest || '')
        ? report.preflight.source_identity.digest : null,
      execution_identity_sha256: SHA256.test(report.preflight?.execution_identity?.digest || '')
        ? report.preflight.execution_identity.digest : null,
      promotion_sha256: report.preflight?.promotion ? digest(report.preflight.promotion) : null,
      collection_digest: expectedCollectionDigest, materialization_digests: [],
      runner_outcome: report.outcome, cleanup_verified: true,
    },
    blocked_reason: reason, report_file: common.reportIdentity.path,
    report_sha256: common.reportIdentity.digest,
  });
}
