import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReport } from '../../scripts/safe-runner/report.mjs';
import {
  CANDIDATE_SMOKE_LAUNCH_PROFILE,
  CANDIDATE_SMOKE_LIMITS,
  CANDIDATE_SMOKE_WORKLOAD_ID,
  exactCandidateSmokeCommand,
  exactCandidateSmokeLimits,
} from '../../scripts/safe-runner/candidate-smoke-profile.mjs';
import {
  temporaryMaxInodesForBytes,
} from '../../scripts/safe-runner/constants.mjs';
import {
  realRepositoryOracleSourceClosureIdentity,
} from '../../scripts/safe-runner/real-repository-source-closure.mjs';
import {
  repositorySourceDigest, runnerBuildDigest,
} from '../../scripts/safe-runner/source-identity.mjs';
import { parseCandidateSmokeRecordLine } from './candidate-smoke.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRYPOINT = 'benchmarks/real-repository-oracle-v1/workload.mjs';
const SHA256 = /^[a-f0-9]{64}$/;

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function decodeCandidateSmokeReport(report) {
  const validation = validateReport(report || {});
  const repository = path.resolve(String(report?.cwd || ''));
  const command = report?.command;
  const preflight = report?.preflight;
  const executionCommand = preflight?.execution_command;
  const source = preflight?.source_identity;
  const snapshot = preflight?.execution_snapshot;
  const execution = preflight?.execution_identity;
  const limits = report?.limits;
  const cleanup = report?.cleanup;
  const termination = report?.termination;
  const output = report?.output;
  let physicalRepository = null;
  let currentRepositorySource = null;
  let currentRunnerBuild = null;
  let currentSourceClosure = null;
  try {
    physicalRepository = fs.realpathSync.native(repository);
    currentRepositorySource = repositorySourceDigest(repository);
    currentRunnerBuild = runnerBuildDigest();
    currentSourceClosure = realRepositoryOracleSourceClosureIdentity(
      repository, 'smoke-candidate-small',
    );
  } catch {}
  const sourceValue = source && {
    repository: source.repository,
    command: source.command,
    executable: source.executable,
    workload_inputs: source.workload_inputs,
    retrieval_authority: source.retrieval_authority,
    runtime_baseline_inputs: source.runtime_baseline_inputs,
    repository_source: source.repository_source,
    runner_build: source.runner_build,
  };
  const sourceDigest = sourceValue ? sha256(JSON.stringify(sourceValue)) : null;
  const executionDigest = execution ? sha256(JSON.stringify({
    source_identity_digest: execution.source_identity_digest,
    execution_snapshot_digest: execution.execution_snapshot_digest,
  })) : null;
  const expectedEntrypoint = path.join(repository, ENTRYPOINT);
  const entrypointInput = Array.isArray(source?.workload_inputs)
    ? source.workload_inputs.find((item) => item?.path === expectedEntrypoint) : null;
  const expectedTemporaryInodes = temporaryMaxInodesForBytes(
    CANDIDATE_SMOKE_LIMITS.temporary_max_bytes,
  );
  const promotion = preflight?.promotion;
  const authorityValid = validation.valid
    && repository === ROOT && physicalRepository === ROOT
    && report.outcome === 'success' && report.tier === 'small' && report.error === null
    && exactCandidateSmokeCommand(command)
    && JSON.stringify(command) === JSON.stringify([
      process.execPath, path.join(ROOT, ENTRYPOINT), 'smoke-candidate-small',
    ])
    && JSON.stringify(executionCommand) === JSON.stringify(command)
    && preflight?.ok === true && preflight.workload_id === CANDIDATE_SMOKE_WORKLOAD_ID
    && preflight.launch_profile === CANDIDATE_SMOKE_LAUNCH_PROFILE
    && preflight.temporary_inode_reservation === null
    && exactCandidateSmokeLimits(limits)
    && limits.stdout_tail_max_bytes === 8 * 1024
    && limits.stderr_tail_max_bytes === 8 * 1024
    && limits.temporary_max_inodes === expectedTemporaryInodes
    && Number.isSafeInteger(report.peaks?.cgroup_memory_bytes)
    && report.peaks.cgroup_memory_bytes <= CANDIDATE_SMOKE_LIMITS.memory_max_bytes
    && Number.isSafeInteger(report.peaks?.pids)
    && report.peaks.pids <= CANDIDATE_SMOKE_LIMITS.pids_max
    && Number.isSafeInteger(report.peaks?.temporary_bytes)
    && report.peaks.temporary_bytes <= CANDIDATE_SMOKE_LIMITS.temporary_max_bytes
    && Number.isSafeInteger(report.peaks?.temporary_inodes)
    && report.peaks.temporary_inodes <= expectedTemporaryInodes
    && preflight.ownership?.proven === true
    && preflight.ownership.audited_entrypoint === ENTRYPOINT
    && preflight.ownership.executable === executionCommand?.[0]
    && preflight.scope_proof?.production_enforcement === true
    && report.adapter?.id === 'linux-systemd-cgroup-v2'
    && report.adapter.production_enforcement === true
    && report.adapter.aggregate_memory === true
    && report.adapter.aggregate_pids === true
    && report.adapter.complete_descendant_ownership === true
    && report.adapter.temporary_quota === true
    && preflight.retry?.ok === true && preflight.retry.signature === source?.digest
    && preflight.retry.previous === null
    && exactKeys(promotion,
      ['ok', 'required', 'missing', 'completed', 'deferred_to_execution_snapshot'])
    && promotion.ok === true && promotion.deferred_to_execution_snapshot === false
    && JSON.stringify(promotion.required) === '[]'
    && JSON.stringify(promotion.missing) === '[]'
    && JSON.stringify(promotion.completed) === '[]'
    && source?.repository === ROOT
    && JSON.stringify(source.command) === JSON.stringify(executionCommand)
    && source.executable?.path === process.execPath
    && SHA256.test(source.executable?.digest || '')
    && Array.isArray(source.workload_inputs) && source.workload_inputs.length === 1
    && exactKeys(entrypointInput, ['path', 'size', 'digest'])
    && entrypointInput.digest === currentSourceClosure?.entrypoint_sha256
    && entrypointInput.size === String(currentSourceClosure?.entrypoint_bytes)
    && source.retrieval_authority === null && source.runtime_baseline_inputs === null
    && source.repository_source === currentRepositorySource
    && source.runner_build === currentRunnerBuild
    && source.digest === sourceDigest
    && snapshot?.schema === 'lamina.safe-runner-execution-snapshot/v1'
    && snapshot.launch_profile === CANDIDATE_SMOKE_LAUNCH_PROFILE
    && exactKeys(snapshot.source_closure,
      ['schema', 'command', 'file_count', 'total_bytes', 'paths_sha256', 'files_sha256',
        'entrypoint_bytes', 'entrypoint_sha256'])
    && JSON.stringify(snapshot.source_closure) === JSON.stringify(currentSourceClosure)
    && Number.isSafeInteger(snapshot.file_count)
    && snapshot.file_count >= currentSourceClosure?.file_count
    && Number.isSafeInteger(snapshot.total_bytes)
    && snapshot.total_bytes >= currentSourceClosure?.total_bytes
    && SHA256.test(snapshot.digest || '')
    && Array.isArray(snapshot.snapshot_roots) && snapshot.snapshot_roots.length > 0
    && snapshot.snapshot_roots.every((root) => path.isAbsolute(root) && !fs.existsSync(root))
    && Array.isArray(snapshot.writable_roots)
    && snapshot.writable_roots.every((root) => path.isAbsolute(root) && !fs.existsSync(root))
    && execution?.source_identity_digest === source.digest
    && execution.execution_snapshot_digest === snapshot.digest
    && execution.digest === executionDigest
    && execution.repository === source.repository
    && JSON.stringify(execution.command) === JSON.stringify(source.command)
    && Array.isArray(report.descendants)
    && termination?.reason === 'completed' && termination.limit === null
    && JSON.stringify(termination.requested_signals) === '[]'
    && termination.child_exit_code === 0 && termination.child_signal === null
    && cleanup?.attempted === true
    && JSON.stringify(cleanup.descendants_remaining) === '[]'
    && JSON.stringify(cleanup.managed_paths_remaining) === '[]'
    && cleanup.scope_removed === true && cleanup.temporary_directory_removed === true
    && cleanup.lock_released === null && JSON.stringify(cleanup.errors) === '[]'
    && Number.isSafeInteger(output?.total_bytes)
    && output.total_bytes <= CANDIDATE_SMOKE_LIMITS.output_max_bytes;
  if (!authorityValid) {
    throw new Error('candidate smoke report does not bind exact safe-runner authority');
  }
  if (output?.truncated !== false || output.stderr_bytes !== 0 || output.stderr_tail !== ''
    || typeof output.stdout_tail !== 'string'
    || output.total_bytes !== output.stdout_bytes + output.stderr_bytes
    || output.stdout_bytes !== Buffer.byteLength(output.stdout_tail, 'utf8')
    || output.stdout_bytes > 8 * 1024 || !output.stdout_tail.endsWith('\n')
    || output.stdout_tail.slice(0, -1).includes('\n')
    || output.stdout_tail.includes('\r')) {
    throw new Error('candidate smoke report did not retain one complete canonical line');
  }
  const record = parseCandidateSmokeRecordLine(output.stdout_tail);
  return Object.freeze({
    record,
    outer_cleanup_authenticated: true,
    cleanup_proof_issued: false,
    grading_reachable: false,
  });
}
