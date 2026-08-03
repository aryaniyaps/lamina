#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  candidateSmokeAuthority, candidateSmokeRecord,
} from '../benchmarks/real-repository-oracle-v1/candidate-smoke.mjs';
import {
  decodeCandidateSmokeReport,
} from '../benchmarks/real-repository-oracle-v1/candidate-smoke-report.mjs';
import {
  CANDIDATE_SMOKE_LAUNCH_PROFILE,
  CANDIDATE_SMOKE_LIMITS,
  CANDIDATE_SMOKE_WORKLOAD_ID,
} from '../scripts/safe-runner/candidate-smoke-profile.mjs';
import { temporaryMaxInodesForBytes } from '../scripts/safe-runner/constants.mjs';
import {
  realRepositoryOracleSourceClosureIdentity,
} from '../scripts/safe-runner/real-repository-source-closure.mjs';
import { frozenWorkloadIdentity } from '../scripts/safe-runner/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = [process.execPath,
  path.join(ROOT, 'benchmarks/real-repository-oracle-v1/workload.mjs'),
  'smoke-candidate-small'];
const authority = candidateSmokeAuthority();
const record = candidateSmokeRecord({
  authority,
  candidate_result_sha256: authority.expected_result_sha256,
  lease: {
    provenance_digest: authority.expected_lease.provenance_digest,
    start_digest: authority.expected_lease.start_digest,
  },
  release: {
    end_digest: authority.expected_lease.end_digest,
    cleanup_verified: false,
    terminal_disposition: 'awaiting_supervisor_cleanup',
  },
  repository_unchanged: true,
});
const line = `${JSON.stringify(record)}\n`;
const source = frozenWorkloadIdentity(ROOT, command);
const sourceClosure = realRepositoryOracleSourceClosureIdentity(
  ROOT, 'smoke-candidate-small',
);
const snapshotDigest = '1'.repeat(64);
const absentSnapshotRoot = path.join(ROOT, '.candidate-smoke-synthetic-snapshot-absent');
const executionDigest = crypto.createHash('sha256').update(JSON.stringify({
  source_identity_digest: source.digest,
  execution_snapshot_digest: snapshotDigest,
})).digest('hex');
const report = {
  schema: 'lamina.safe-runner-report/v1',
  schema_version: 1,
  run_id: 'synthetic-candidate-smoke',
  report_file: path.join(ROOT, '.synthetic-candidate-smoke-report.json'),
  outcome: 'success',
  tier: 'small',
  command,
  cwd: ROOT,
  started_at: '2026-08-03T00:00:00.000Z',
  finished_at: '2026-08-03T00:00:01.000Z',
  duration_ms: 1000,
  adapter: {
    id: 'linux-systemd-cgroup-v2', production_enforcement: true,
    aggregate_memory: true, aggregate_pids: true,
    complete_descendant_ownership: true, temporary_quota: true,
  },
  limits: {
    ...CANDIDATE_SMOKE_LIMITS,
    temporary_max_inodes: temporaryMaxInodesForBytes(
      CANDIDATE_SMOKE_LIMITS.temporary_max_bytes,
    ),
    stdout_tail_max_bytes: 8 * 1024,
    stderr_tail_max_bytes: 8 * 1024,
  },
  preflight: {
    ok: true,
    workload_id: CANDIDATE_SMOKE_WORKLOAD_ID,
    launch_profile: CANDIDATE_SMOKE_LAUNCH_PROFILE,
    temporary_inode_reservation: null,
    ownership: {
      proven: true,
      audited_entrypoint: 'benchmarks/real-repository-oracle-v1/workload.mjs',
      executable: process.execPath,
    },
    execution_command: command,
    source_identity: source,
    execution_snapshot: {
      schema: 'lamina.safe-runner-execution-snapshot/v1',
      digest: snapshotDigest,
      launch_profile: CANDIDATE_SMOKE_LAUNCH_PROFILE,
      file_count: sourceClosure.file_count,
      total_bytes: sourceClosure.total_bytes,
      source_closure: sourceClosure,
      snapshot_roots: [absentSnapshotRoot],
      writable_roots: [],
    },
    execution_identity: {
      ...source,
      source_identity_digest: source.digest,
      execution_snapshot_digest: snapshotDigest,
      digest: executionDigest,
    },
    retry: { ok: true, signature: source.digest, previous: null },
    promotion: {
      ok: true, required: [], missing: [], completed: [],
      deferred_to_execution_snapshot: false,
    },
    scope_proof: { production_enforcement: true },
  },
  samples: [{
    elapsed_ms: 1, aggregate_rss_bytes: 1, cgroup_memory_bytes: 1,
    pids: 1, temporary_bytes: 1, temporary_inodes: 1,
  }],
  peaks: {
    aggregate_rss_bytes: 1, cgroup_memory_bytes: 1, pids: 1,
    temporary_bytes: 1, temporary_inodes: 1,
  },
  descendants: [],
  output: {
    stdout_bytes: Buffer.byteLength(line), stderr_bytes: 0,
    total_bytes: Buffer.byteLength(line), stdout_tail: line, stderr_tail: '', truncated: false,
  },
  termination: {
    reason: 'completed', limit: null, requested_signals: [],
    child_exit_code: 0, child_signal: null, cgroup_events: {},
  },
  cleanup: {
    attempted: true, descendants_remaining: [], managed_paths_remaining: [],
    scope_removed: true, temporary_directory_removed: true, lock_released: null, errors: [],
  },
  error: null,
};

const decoded = decodeCandidateSmokeReport(report);
assert.deepEqual(decoded, {
  record,
  outer_cleanup_authenticated: true,
  cleanup_proof_issued: false,
  grading_reachable: false,
});
assert.equal(Object.isFrozen(decoded), true);
assert.equal(Object.isFrozen(decoded.record), true);
for (const mutate of [
  (value) => { value.command.push('extra'); },
  (value) => { value.preflight.workload_id = 'spoofed'; },
  (value) => { value.preflight.launch_profile = null; },
  (value) => { value.preflight.execution_snapshot.launch_profile = null; },
  (value) => { value.tier = 'medium'; },
  ...Object.keys(CANDIDATE_SMOKE_LIMITS).map((key) => (value) => {
    value.limits[key] -= 1;
  }),
  (value) => { value.preflight.source_identity.repository_source = '2'.repeat(64); },
  (value) => { value.preflight.execution_snapshot.source_closure.files_sha256 = '3'.repeat(64); },
  (value) => { value.preflight.execution_snapshot.snapshot_roots = [ROOT]; },
  (value) => { value.preflight.retry.signature = '4'.repeat(64); },
  (value) => { value.preflight.promotion.completed = ['small']; },
  (value) => { value.peaks.cgroup_memory_bytes = CANDIDATE_SMOKE_LIMITS.memory_max_bytes + 1; },
  (value) => { value.peaks.pids = CANDIDATE_SMOKE_LIMITS.pids_max + 1; },
  (value) => { value.peaks.temporary_bytes = CANDIDATE_SMOKE_LIMITS.temporary_max_bytes + 1; },
  (value) => { value.peaks.temporary_inodes = report.limits.temporary_max_inodes + 1; },
  (value) => { value.output.total_bytes = CANDIDATE_SMOKE_LIMITS.output_max_bytes + 1;
    value.output.stdout_bytes = value.output.total_bytes; },
  (value) => { value.output.truncated = true; },
  (value) => { value.output.stderr_bytes = 1; value.output.total_bytes += 1; },
  (value) => { value.output.stdout_tail += '{}\n'; value.output.stdout_bytes += 3;
    value.output.total_bytes += 3; },
  (value) => { value.termination.child_exit_code = 1; },
  (value) => { value.cleanup.descendants_remaining.push(7); },
  (value) => { value.cleanup.managed_paths_remaining.push('/tmp/leak'); },
  (value) => { value.cleanup.temporary_directory_removed = false; },
  (value) => { value.cleanup.errors.push('cleanup failed'); },
]) {
  const changed = structuredClone(report);
  mutate(changed);
  assert.throws(() => decodeCandidateSmokeReport(changed));
}

console.log('real repository oracle candidate smoke report decoder passed');
