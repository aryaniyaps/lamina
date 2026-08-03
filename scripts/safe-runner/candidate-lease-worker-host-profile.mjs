import crypto from 'node:crypto';
import path from 'node:path';
import {
  ORACLE_CACHE_CAPABILITY_FD, ORACLE_CACHE_CAPABILITY_MOUNT,
} from './oracle-cache-capability.mjs';
import {
  ORACLE_HOST_ROOT_BYTES,
  ORACLE_KEEPER_REQUIRED_BWRAP_OPTIONS,
  TMPFS_MAGIC,
} from './oracle-host-profile.mjs';

export const CANDIDATE_LEASE_WORKER_HOST_LAUNCH_PROFILE =
  'candidate-lease-worker-v1';
export const CANDIDATE_LEASE_WORKER_MAX_QUOTA_BYTES = 512 * 1024 * 1024;

export { TMPFS_MAGIC, ORACLE_KEEPER_REQUIRED_BWRAP_OPTIONS };

export function candidateLeaseWorkerKeeperArgumentsFromWireProfile(profile, sealedGitIdentity) {
  if (!profile || profile.id !== CANDIDATE_LEASE_WORKER_HOST_LAUNCH_PROFILE) {
    throw new TypeError('wire profile is not a candidate lease worker oracle-host profile');
  }
  return candidateLeaseWorkerKeeperBwrapArguments({
    quotaBytes: profile.quota_bytes,
    nodePath: profile.node_executable,
    executionAuthorityRoot: profile.execution_authority_root,
    snapshotRepository: profile.snapshot_repository,
    workerRunner: profile.worker_runner,
    workerArgs: profile.worker_args,
    sealedGitIdentity,
  });
}

export function candidateLeaseWorkerKeeperBwrapArguments({
  quotaBytes, nodePath, executionAuthorityRoot, snapshotRepository, workerRunner, workerArgs,
  sealedGitIdentity,
}) {
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 4096
    || quotaBytes > CANDIDATE_LEASE_WORKER_MAX_QUOTA_BYTES
    || !path.isAbsolute(nodePath || '') || !path.isAbsolute(executionAuthorityRoot || '')
    || !path.isAbsolute(snapshotRepository || '')
    || !path.isAbsolute(workerRunner || '') || !Array.isArray(workerArgs)
    || typeof sealedGitIdentity !== 'string' || sealedGitIdentity.length < 1
    || !/^[A-Za-z0-9_-]+$/.test(sealedGitIdentity)) {
    throw new TypeError('candidate lease worker keeper arguments are invalid');
  }
  if (!workerRunner.startsWith(`${snapshotRepository}${path.sep}`)
    || !nodePath.startsWith(`${executionAuthorityRoot}${path.sep}`)) {
    throw new TypeError('candidate lease worker keeper paths must live inside sealed authority');
  }
  return Object.freeze([
    '--die-with-parent', '--new-session',
    '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-net',
    '--uid', '0', '--gid', '0', '--hostname', 'lamina-lease-worker',
    '--cap-drop', 'ALL', '--clearenv',
    '--perms', '0755', '--size', String(ORACLE_HOST_ROOT_BYTES), '--tmpfs', '/',
    '--dir', '/oracle-state',
    '--perms', '0700', '--size', String(quotaBytes), '--tmpfs', '/oracle-state',
    '--proc', '/proc',
    '--dev', '/dev',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/etc', '/etc',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', executionAuthorityRoot, executionAuthorityRoot,
    '--ro-bind-fd', String(ORACLE_CACHE_CAPABILITY_FD), ORACLE_CACHE_CAPABILITY_MOUNT,
    '--ro-bind', snapshotRepository, snapshotRepository,
    '--setenv', 'LANG', 'C.UTF-8',
    '--setenv', 'LC_ALL', 'C.UTF-8',
    '--setenv', 'TZ', 'UTC',
    '--setenv', 'PATH', '/usr/bin:/bin',
    '--setenv', 'LAMINA_SAFE_RUNNER_SNAPSHOT_REPOSITORY', snapshotRepository,
    '--setenv', 'LAMINA_SAFE_RUNNER_TEMP', '/oracle-state',
    '--setenv', 'LAMINA_SAFE_RUNNER_TEMP_DIR', '/oracle-state',
    '--setenv', 'LAMINA_SAFE_GIT_IDENTITY', sealedGitIdentity,
    '--chdir', '/oracle-state',
    '--remount-ro', '/',
    '--info-fd', '3',
    '--', nodePath, workerRunner, ...workerArgs,
  ]);
}

export function attestCandidateLeaseWorkerKeeperBwrapHelp(stdout) {
  const text = String(stdout || '');
  const missing = ORACLE_KEEPER_REQUIRED_BWRAP_OPTIONS.filter((option) => {
    const pattern = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    return !new RegExp(`^\\s*${pattern}(?:\\s|$)`, 'm').test(text);
  });
  if (missing.length) {
    const error = new Error(`candidate lease worker keeper requires bwrap options: ${missing.join(', ')}`);
    error.code = 'LAMINA_SAFE_ORACLE_KEEPER_UNSUPPORTED';
    throw error;
  }
  return Object.freeze({
    required_options: ORACLE_KEEPER_REQUIRED_BWRAP_OPTIONS,
    help_sha256: crypto.createHash('sha256').update(Buffer.from(text)).digest('hex'),
  });
}

export function candidateLeaseWorkerHostProbeLimits(limits) {
  return Boolean(limits
    && Number.isSafeInteger(limits.memory_max_bytes)
    && limits.memory_max_bytes <= 512 * 1024 ** 2
    && Number.isSafeInteger(limits.pids_max) && limits.pids_max <= 32
    && Number.isSafeInteger(limits.timeout_ms) && limits.timeout_ms <= 180_000
    && Number.isSafeInteger(limits.temporary_max_bytes)
    && limits.temporary_max_bytes >= 4096
    && limits.temporary_max_bytes <= CANDIDATE_LEASE_WORKER_MAX_QUOTA_BYTES);
}
