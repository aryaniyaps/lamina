import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReport } from '../../scripts/safe-runner/report.mjs';
import {
  CANDIDATE_LEASE_WORKER_LAUNCH_PROFILE,
  CANDIDATE_LEASE_WORKER_LIMITS,
  CANDIDATE_LEASE_WORKER_WORKLOAD_ID,
  exactCandidateLeaseWorkerCommand,
  exactCandidateLeaseWorkerLimits,
} from '../../scripts/safe-runner/candidate-lease-worker-profile.mjs';
import {
  temporaryMaxInodesForBytes,
} from '../../scripts/safe-runner/constants.mjs';
import {
  realRepositoryOracleSourceClosureIdentity,
} from '../../scripts/safe-runner/real-repository-source-closure.mjs';
import {
  repositorySourceDigest, runnerBuildDigest,
} from '../../scripts/safe-runner/source-identity.mjs';
import { CANDIDATE_LEASE_ORACLE_HOST_RESULT_SCHEMA } from './candidate-lease-oracle-host.mjs';
import { parseCandidateLeaseWorkerRecordLine } from './candidate-lease-worker.mjs';

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

export function validateCandidateLeaseWorkerReport(report, authority) {
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
      repository, 'lease-candidate-worker',
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
    CANDIDATE_LEASE_WORKER_LIMITS.temporary_max_bytes,
  );
  const promotion = preflight?.promotion;
  const expectedCommand = [
    process.execPath, path.join(ROOT, ENTRYPOINT), 'lease-candidate-worker',
    authority.tier, authority.slot_id, authority.phase,
  ];
  const structureValid = validation.valid
    && repository === ROOT && physicalRepository === ROOT
    && report.outcome === 'success' && report.tier === authority.tier && report.error === null
    && exactCandidateLeaseWorkerCommand(command)
    && JSON.stringify(command) === JSON.stringify(expectedCommand)
    && JSON.stringify(executionCommand) === JSON.stringify(expectedCommand)
    && preflight?.ok === true && preflight.workload_id === CANDIDATE_LEASE_WORKER_WORKLOAD_ID
    && preflight.launch_profile === CANDIDATE_LEASE_WORKER_LAUNCH_PROFILE
    && preflight.temporary_inode_reservation === null
    && exactCandidateLeaseWorkerLimits(limits)
    && limits.stdout_tail_max_bytes === 8 * 1024
    && limits.stderr_tail_max_bytes === 8 * 1024
    && limits.temporary_max_inodes === expectedTemporaryInodes
    && Number.isSafeInteger(report.peaks?.cgroup_memory_bytes)
    && report.peaks.cgroup_memory_bytes <= CANDIDATE_LEASE_WORKER_LIMITS.memory_max_bytes
    && Number.isSafeInteger(report.peaks?.pids)
    && report.peaks.pids <= CANDIDATE_LEASE_WORKER_LIMITS.pids_max
    && Number.isSafeInteger(report.peaks?.temporary_bytes)
    && report.peaks.temporary_bytes <= CANDIDATE_LEASE_WORKER_LIMITS.temporary_max_bytes
    && Number.isSafeInteger(report.peaks?.temporary_inodes)
    && report.peaks.temporary_inodes <= expectedTemporaryInodes
    && preflight.ownership?.proven === true
    && preflight.ownership.audited_entrypoint === ENTRYPOINT
    && preflight.ownership.executable === executionCommand?.[0]
    && preflight.scope_proof?.production_enforcement === true
    && report.adapter?.id === 'linux-systemd-cgroup-v2'
    && report.adapter.production_enforcement === true
    && snapshot?.launch_profile === CANDIDATE_LEASE_WORKER_LAUNCH_PROFILE
    && cleanup?.scope_removed === true && cleanup.temporary_directory_removed === true
    && termination?.child_exit_code === 0 && termination.child_signal === null;
  if (!structureValid) {
    throw new Error('candidate lease worker report does not match the exact structural contract');
  }
  if (output?.truncated !== false || output.stderr_bytes !== 0 || output.stderr_tail !== ''
    || typeof output.stdout_tail !== 'string'
    || output.total_bytes !== output.stdout_bytes + output.stderr_bytes
    || output.stdout_bytes !== Buffer.byteLength(output.stdout_tail, 'utf8')
    || !output.stdout_tail.endsWith('\n')
    || output.stdout_tail.slice(0, -1).includes('\n')
    || output.stdout_tail.includes('\r')) {
    throw new Error('candidate lease worker report did not retain one complete canonical line');
  }
  let hostResult;
  try { hostResult = JSON.parse(output.stdout_tail); }
  catch { throw new Error('candidate lease worker host result is not JSON'); }
  if (hostResult.schema !== CANDIDATE_LEASE_ORACLE_HOST_RESULT_SCHEMA
    || hostResult.non_gradeable !== true || hostResult.candidate_executed !== true
    || hostResult.keeper_mount_proven !== true || hostResult.broker_finish_verified !== true
    || hostResult.mount_fds_released !== true
    || hostResult.cache_capability_fd_released !== true
    || !hostResult.worker_record) {
    throw new Error('candidate lease worker host lifecycle evidence is incomplete');
  }
  const workerRecord = parseCandidateLeaseWorkerRecordLine(
    `${JSON.stringify(hostResult.worker_record)}\n`, authority,
  );
  return Object.freeze({ host: hostResult, worker: workerRecord, report });
}
