#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnTrustedGit } from '../scripts/safe-runner/git.mjs';
import {
  decodeScenarioVerificationPayload, decodeScenarioVerificationReport,
  encodeScenarioVerificationPayload, executeScenario,
  parseScenarioPorcelainV2Z, SCENARIO_VERIFICATION_BOUNDS,
  SCENARIO_VERIFICATION_PAYLOAD_PREFIX, SCENARIO_VERIFICATION_SCHEMA,
  SCENARIO_VERIFICATION_REPORT_STDERR_TAIL_BYTES,
  SCENARIO_VERIFICATION_REPORT_STDOUT_TAIL_BYTES,
  SCENARIO_VERIFICATION_WORKLOAD_ID, validateScenarioVerification,
} from '../benchmarks/real-repository-oracle-v1/scenario-verification.mjs';
import {
  loadScenarioSelection, SCENARIO_SELECTION_CANONICAL_SHA256, SCENARIO_SELECTION_RAW_SHA256,
} from '../benchmarks/real-repository-oracle-v1/scenario-selection.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'benchmarks/real-repository-oracle-v1/scenario-verification.mjs');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => sha256(Buffer.from(JSON.stringify(canonical(value))));
const git = (cwd, args) => {
  const result = spawnTrustedGit(cwd, args, { encoding: 'utf8', timeout: 10_000,
    maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  return String(result.stdout || '').trim();
};

const oid = '1'.repeat(40);
const cleanStatus = `# branch.oid ${oid}\0# branch.head (detached)\0`;
assert.deepEqual(parseScenarioPorcelainV2Z(cleanStatus), {
  head: oid, branch: null, upstream: null, changes: [],
});
const modifiedStatus = `${cleanStatus}1 .M N... 100644 100644 100644 ${oid} ${oid} src/a.txt\0`;
assert.equal(parseScenarioPorcelainV2Z(modifiedStatus).changes[0].xy, '.M');
const renameStatus = `${cleanStatus}2 R. N... 100644 100644 100644 ${oid} ${oid} R100 dst.txt\0src.txt\0`;
assert.deepEqual(parseScenarioPorcelainV2Z(renameStatus).changes[0], {
  record_type: '2', xy: 'R.', sub: 'N...', mode_head: '100644', mode_index: '100644',
  mode_worktree: '100644', oid_head: oid, oid_index: oid, rename_kind: 'R',
  rename_score: 100, path: 'dst.txt', original_path: 'src.txt',
});
for (const invalid of [cleanStatus.slice(0, -1), `${cleanStatus}# branch.head other\0`,
  `${cleanStatus}# branch.upstream origin/main\0`, `${cleanStatus}? stray\0`,
  `${cleanStatus}2 R. N... 100644 100644 100644 ${oid} ${oid} R100 dst.txt\0`]) {
  assert.throws(() => parseScenarioPorcelainV2Z(invalid));
}

const temporaryRoot = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-scenario-verification-test-'),
));
try {
  for (const [order, kind] of ['clean', 'modify', 'rename', 'delete', 'branch', 'logical_worktree'].entries()) {
    const repository = path.join(temporaryRoot, `repository-${kind}`);
    const linked = path.join(temporaryRoot, `linked-${kind}`);
    fs.mkdirSync(linked, { mode: 0o700 });
    git(temporaryRoot, ['init', '--quiet', repository]);
    fs.mkdirSync(path.join(repository, 'src'));
    const original = Buffer.from('alpha\n');
    fs.writeFileSync(path.join(repository, 'src/a.txt'), original, { mode: 0o644 });
    git(repository, ['add', '--', 'src/a.txt']);
    git(repository, ['-c', 'user.name=Lamina Test', '-c', 'user.email=lamina@example.invalid',
      'commit', '--quiet', '-m', 'fixture']);
    const commit = git(repository, ['rev-parse', 'HEAD']);
    const blob = git(repository, ['rev-parse', 'HEAD:src/a.txt']);
    git(repository, ['checkout', '--quiet', '--detach', commit]);
    const scenario = {
      order, kind, identity_sha256: sha256(kind), path: 'src/a.txt', blob_oid: blob,
      original_content_sha256: sha256(original), discovery_operation_kind: kind,
      discovery_index: 0, authored_operation_kind: kind,
    };
    if (kind === 'modify') {
      scenario.append_utf8 = 'tail\n';
      scenario.result_bytes = original.length + Buffer.byteLength(scenario.append_utf8);
      scenario.result_content_sha256 = sha256(Buffer.concat([original, Buffer.from(scenario.append_utf8)]));
    } else if (kind === 'rename') scenario.destination = 'renamed.txt';
    else if (kind === 'branch') scenario.branch = 'lamina-oracle/test-branch';
    else if (kind === 'logical_worktree') {
      scenario.derived_branch = 'lamina-oracle/worktree-test';
      scenario.logical_worktree_id = 'oracle-worktree-test';
    }
    const record = executeScenario(repository, { linked }, { commit }, scenario);
    assert.equal(record.kind, kind);
    assert.equal(record.internal_cleanup_verified, false);
    assert.equal(record.pre.head, commit);
    assert.equal(record.stage.before_count, 1);
    if (kind === 'logical_worktree') assert.equal(fs.readdirSync(linked).length, 0);
    if (kind === 'branch') {
      const absent = spawnTrustedGit(repository,
        ['show-ref', '--verify', '--quiet', `refs/heads/${scenario.branch}`], {
          encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      assert.equal(absent.status, 1);
    }
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: false });
}

const loaded = loadScenarioSelection();
const selected = loaded.selection.tiers.small;
const noClaims = { workflow_selection: false, observation: false, obligations: false,
  source_localization: false, retrieval_ranking: false, end_to_end_runtime: false };
const checks = () => ({ source_blob: null, source_content: null, result_content: null,
  destination_absence: null, ref_lifecycle: null, linked_marker: null, linked_admin: null,
  primary_clean: null, linked_topology_sha256: null });
const records = selected.scenarios.map((scenario, order) => {
  const before = 'a'.repeat(64);
  const afterStage = scenario.kind === 'rename' ? 'b'.repeat(64) : before;
  const afterPhysical = ['clean', 'branch', 'logical_worktree'].includes(scenario.kind)
    ? before : 'c'.repeat(64);
  const change = scenario.kind === 'modify' || scenario.kind === 'delete' ? {
    record_type: '1', xy: scenario.kind === 'modify' ? '.M' : '.D', sub: 'N...',
    mode_head: '100644', mode_index: '100644',
    mode_worktree: scenario.kind === 'modify' ? '100644' : '000000',
    oid_head: scenario.blob_oid, oid_index: scenario.blob_oid, rename_kind: null,
    rename_score: null, path: scenario.path, original_path: null,
  } : scenario.kind === 'rename' ? {
    record_type: '2', xy: 'R.', sub: 'N...', mode_head: '100644', mode_index: '100644',
    mode_worktree: '100644', oid_head: scenario.blob_oid, oid_index: scenario.blob_oid,
    rename_kind: 'R', rename_score: 100, path: scenario.destination, original_path: scenario.path,
  } : null;
  const valueChecks = checks();
  if (scenario.kind !== 'clean') valueChecks.source_blob = valueChecks.source_content = true;
  if (['modify', 'rename'].includes(scenario.kind)) valueChecks.result_content = true;
  if (scenario.kind === 'rename') valueChecks.destination_absence = true;
  if (['branch', 'logical_worktree'].includes(scenario.kind)) valueChecks.ref_lifecycle = true;
  if (scenario.kind === 'logical_worktree') {
    valueChecks.linked_marker = valueChecks.linked_admin = valueChecks.primary_clean = true;
    valueChecks.linked_topology_sha256 = 'd'.repeat(64);
  }
  const pre = { head: selected.pin.commit, branch: null, upstream: null, changes: [] };
  const selectedBefore = scenario.kind === 'clean' ? []
    : [{ mode: '100644', oid: scenario.blob_oid, path: scenario.path }];
  const selectedAfter = scenario.kind === 'clean' ? [] : [{ mode: '100644', oid: scenario.blob_oid,
    path: scenario.kind === 'rename' ? scenario.destination : scenario.path }];
  const physicalBefore = scenario.kind === 'clean' ? []
    : [{ mode: '100644', path: scenario.path, sha256: scenario.original_content_sha256 }];
  const physicalSelectedAfter = scenario.kind === 'clean' || scenario.kind === 'delete' ? []
    : [{ mode: '100644', path: scenario.kind === 'rename' ? scenario.destination : scenario.path,
      sha256: scenario.kind === 'modify'
        ? scenario.result_content_sha256 : scenario.original_content_sha256 }];
  return {
    order, scenario_identity_sha256: scenario.identity_sha256,
    scratch_lease_sha256: sha256(`lease-${order}`), kind: scenario.kind,
    selection_provenance: {
      discovery_operation_kind: scenario.discovery_operation_kind ?? null,
      discovery_index: scenario.discovery_index ?? null,
      authored_operation_kind: scenario.authored_operation_kind ?? null,
    },
    pre,
    post: { head: selected.pin.commit,
      branch: scenario.kind === 'branch' ? scenario.branch
        : scenario.kind === 'logical_worktree' ? scenario.derived_branch : null,
      upstream: null, changes: change ? [change] : [] },
    auxiliary: scenario.kind === 'logical_worktree' ? pre : null,
    stage: { before_count: 535, before_sha256: before, after_count: 535,
      after_sha256: afterStage, selected_before: selectedBefore, selected_after: selectedAfter,
      physical_before_count: 535, physical_before_sha256: before,
      physical_after_count: 535 + (scenario.kind === 'delete' ? -1 : 0),
      physical_after_sha256: afterPhysical, physical_selected_before: physicalBefore,
      physical_selected_after: physicalSelectedAfter },
    checks: valueChecks, internal_cleanup_verified: true,
  };
});
const sourceSha = sha256(fs.readFileSync(MODULE));
const recordsSha = digest(records);
const result = {
  schema: SCENARIO_VERIFICATION_SCHEMA, workload_id: SCENARIO_VERIFICATION_WORKLOAD_ID,
  status: 'reviewer_selected_scenarios_verified_lexically',
  collection: { fixture_id: 'small', ...selected.pin },
  selection_raw_sha256: SCENARIO_SELECTION_RAW_SHA256,
  selection_canonical_sha256: SCENARIO_SELECTION_CANONICAL_SHA256,
  bounds: SCENARIO_VERIFICATION_BOUNDS, records, records_sha256: recordsSha,
  source_sha256: sourceSha,
  workload_sha256: digest({ workload_id: SCENARIO_VERIFICATION_WORKLOAD_ID,
    source_sha256: sourceSha, selection_raw_sha256: SCENARIO_SELECTION_RAW_SHA256,
    selection_canonical_sha256: SCENARIO_SELECTION_CANONICAL_SHA256,
    records_sha256: recordsSha }),
  expectations_loaded: false, grade_controller_evidence: false, quality_claims: noClaims,
  selection_provenance: { status: 'selection_provenance_not_replayed', ...selected.discovery },
  limitation: 'Lexical Git state verification only. Accepted discovery provenance is carried from the digest-locked reviewer selection and is not independently replayed. No Workflow, expectation, retrieval, grade, quality, or end-to-end runtime claim.',
};
assert.deepEqual(validateScenarioVerification(result), { valid: true, errors: [] });
const line = encodeScenarioVerificationPayload(result);
assert.ok(line.startsWith(SCENARIO_VERIFICATION_PAYLOAD_PREFIX));
assert.ok(Buffer.byteLength(line) < 7_680);
assert.equal(SCENARIO_VERIFICATION_REPORT_STDOUT_TAIL_BYTES, 8 * 1024);
assert.equal(SCENARIO_VERIFICATION_REPORT_STDERR_TAIL_BYTES, 8 * 1024);
assert.ok(SCENARIO_VERIFICATION_PAYLOAD_PREFIX.length
  + Math.ceil(SCENARIO_VERIFICATION_BOUNDS.transport_bytes * 4 / 3)
  < SCENARIO_VERIFICATION_BOUNDS.encoded_line_bytes);
assert.deepEqual(decodeScenarioVerificationPayload(line), canonical(result));
assert.throws(() => decodeScenarioVerificationPayload(`${line}\n`), /malformed/);
assert.throws(() => decodeScenarioVerificationPayload(
  `${SCENARIO_VERIFICATION_PAYLOAD_PREFIX}${'A'.repeat(7_680)}`,
), /retained-output contract/);
const reusedLease = structuredClone(result);
reusedLease.records[1].scratch_lease_sha256 = reusedLease.records[0].scratch_lease_sha256;
assert.equal(validateScenarioVerification(reusedLease).valid, false);
const wrongPin = structuredClone(result);
wrongPin.collection.commit = 'f'.repeat(40);
assert.equal(validateScenarioVerification(wrongPin).valid, false);
const absoluteLeak = structuredClone(result);
absoluteLeak.records[1].post.changes[0].path = '/tmp/leak';
assert.equal(validateScenarioVerification(absoluteLeak).valid, false);

const command = [process.execPath,
  path.join(ROOT, 'benchmarks/real-repository-oracle-v1/workload.mjs'), 'verify-scenarios'];
const executableStat = fs.lstatSync(process.execPath, { bigint: true });
const executable = { path: process.execPath, dev: String(executableStat.dev),
  ino: String(executableStat.ino), uid: Number(executableStat.uid),
  mode: Number(executableStat.mode & 0o777n), size: String(executableStat.size),
  digest: sha256(fs.readFileSync(process.execPath)) };
const entrypoint = command[1];
const entrypointStat = fs.lstatSync(entrypoint, { bigint: true });
const entrypointIdentity = { path: entrypoint, size: String(entrypointStat.size),
  digest: sha256(fs.readFileSync(entrypoint)) };
const sourceValue = { repository: ROOT, command, executable,
  workload_inputs: [entrypointIdentity], retrieval_authority: null,
  runtime_baseline_inputs: null, repository_source: 'e'.repeat(64), runner_build: 'f'.repeat(64) };
const sourceIdentity = { ...sourceValue, digest: sha256(JSON.stringify(sourceValue)) };
const snapshotDigest = '1'.repeat(64);
const executionIdentity = { ...sourceIdentity, source_identity_digest: sourceIdentity.digest,
  execution_snapshot_digest: snapshotDigest,
  digest: sha256(JSON.stringify({ source_identity_digest: sourceIdentity.digest,
    execution_snapshot_digest: snapshotDigest })) };
const stdoutTail = `${line}\n`;
const safeReport = {
  schema: 'lamina.safe-runner-report/v1', schema_version: 1, run_id: 'synthetic-scenario-report',
  report_file: path.join(os.tmpdir(), 'synthetic-scenario-report.json'), outcome: 'success',
  tier: 'small', command, cwd: ROOT, started_at: '2026-08-03T00:00:00.000Z',
  finished_at: '2026-08-03T00:00:01.000Z', duration_ms: 1000,
  adapter: { id: 'linux-systemd-cgroup-v2', production_enforcement: true },
  limits: { stdout_tail_max_bytes: 8 * 1024, stderr_tail_max_bytes: 8 * 1024 },
  preflight: { ok: true, workload_id: SCENARIO_VERIFICATION_WORKLOAD_ID,
    ownership: { proven: true,
      audited_entrypoint: 'benchmarks/real-repository-oracle-v1/workload.mjs',
      executable: process.execPath }, execution_command: command, source_identity: sourceIdentity,
    execution_snapshot: { schema: 'lamina.safe-runner-execution-snapshot/v1', digest: snapshotDigest,
      file_count: 1, total_bytes: Number(entrypointStat.size), snapshot_roots: [ROOT],
      writable_roots: [] }, execution_identity: executionIdentity,
    retry: { ok: true, signature: sourceIdentity.digest, previous: null },
    promotion: { ok: true, required: [], missing: [], completed: [],
      deferred_to_execution_snapshot: false }, scope_proof: { production_enforcement: true } },
  samples: [{ elapsed_ms: 1, aggregate_rss_bytes: 1, cgroup_memory_bytes: 1,
    pids: 1, temporary_bytes: 1, temporary_inodes: 1 }],
  peaks: { aggregate_rss_bytes: 1, cgroup_memory_bytes: 1, pids: 1,
    temporary_bytes: 1, temporary_inodes: 1 }, descendants: [],
  output: { stdout_bytes: Buffer.byteLength(stdoutTail), stderr_bytes: 0,
    total_bytes: Buffer.byteLength(stdoutTail), stdout_tail: stdoutTail, stderr_tail: '',
    truncated: false },
  termination: { reason: 'completed', limit: null, requested_signals: [], child_exit_code: 0,
    child_signal: null, cgroup_events: {} },
  cleanup: { attempted: true, descendants_remaining: [], managed_paths_remaining: [],
    scope_removed: true, temporary_directory_removed: true, lock_released: null, errors: [] },
  error: null,
};
assert.deepEqual(decodeScenarioVerificationReport(safeReport), canonical(result));
const missingPromotion = structuredClone(safeReport);
missingPromotion.preflight.promotion.ok = false;
missingPromotion.preflight.promotion.missing = ['small'];
assert.throws(() => decodeScenarioVerificationReport(missingPromotion), /exact safe-runner authority/);
const crossedRetry = structuredClone(safeReport);
crossedRetry.preflight.retry.signature = '0'.repeat(64);
assert.throws(() => decodeScenarioVerificationReport(crossedRetry), /exact safe-runner authority/);

console.log('real repository oracle scenario verification tests passed');
