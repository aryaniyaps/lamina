import crypto from 'node:crypto';
import {
  ORACLE_CACHE_CAPABILITY_FD, ORACLE_CACHE_CAPABILITY_MOUNT,
} from './oracle-cache-capability.mjs';

export const ORACLE_HOST_PROBE_WORKLOAD_ID =
  'real-repository-oracle-v1:oracle-host-probe';
export const ORACLE_HOST_PROBE_COMMAND = 'probe-oracle-host';
export const ORACLE_HOST_LAUNCH_PROFILE = 'oracle-host-probe-v1';
export const ORACLE_HOST_PROBE_MAX_QUOTA_BYTES = 16 * 1024 * 1024;
export const ORACLE_HOST_ROOT_BYTES = 1024 * 1024;
export const TMPFS_MAGIC = 16_914_836;
export const ORACLE_BWRAP_INFO_MAX_BYTES = 8 * 1024;

export const ORACLE_KEEPER_REQUIRED_BWRAP_OPTIONS = Object.freeze([
  '--die-with-parent', '--new-session', '--unshare-user', '--unshare-pid',
  '--unshare-ipc', '--unshare-uts', '--unshare-net', '--uid UID', '--gid GID',
  '--hostname NAME', '--disable-userns', '--assert-userns-disabled', '--cap-drop CAP',
  '--clearenv', '--perms OCTAL', '--size BYTES', '--tmpfs DEST', '--dir DEST',
  '--ro-bind-fd FD DEST',
  '--remount-ro DEST', '--as-pid-1', '--block-fd FD', '--info-fd FD',
]);

export function oracleKeeperBwrapArguments(quotaBytes) {
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 4096
    || quotaBytes > ORACLE_HOST_PROBE_MAX_QUOTA_BYTES) {
    throw new TypeError('oracle quota must be a bounded positive integer');
  }
  return Object.freeze([
    '--die-with-parent', '--new-session',
    '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-net',
    '--uid', '0', '--gid', '0', '--hostname', 'lamina-quota',
    '--disable-userns', '--assert-userns-disabled', '--cap-drop', 'ALL', '--clearenv',
    '--perms', '0755', '--size', String(ORACLE_HOST_ROOT_BYTES), '--tmpfs', '/',
    '--dir', '/oracle-state',
    '--perms', '0700', '--size', String(quotaBytes), '--tmpfs', '/oracle-state',
    '--ro-bind-fd', String(ORACLE_CACHE_CAPABILITY_FD), ORACLE_CACHE_CAPABILITY_MOUNT,
    '--remount-ro', '/', '--as-pid-1', '--block-fd', '0', '--info-fd', '3',
    '--', '/oracle-state',
  ]);
}

export function attestOracleKeeperBwrapHelp(stdout) {
  const text = String(stdout || '');
  const missing = ORACLE_KEEPER_REQUIRED_BWRAP_OPTIONS.filter((option) => {
    const pattern = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    return !new RegExp(`^\\s*${pattern}(?:\\s|$)`, 'm').test(text);
  });
  if (missing.length) {
    const error = new Error(`oracle quota keeper requires bwrap options: ${missing.join(', ')}`);
    error.code = 'LAMINA_SAFE_ORACLE_KEEPER_UNSUPPORTED';
    throw error;
  }
  return Object.freeze({
    required_options: ORACLE_KEEPER_REQUIRED_BWRAP_OPTIONS,
    help_sha256: crypto.createHash('sha256').update(Buffer.from(text)).digest('hex'),
  });
}

export function parseOracleBwrapInfo(value) {
  const text = String(value ?? '');
  if (!text || Buffer.byteLength(text, 'utf8') > ORACLE_BWRAP_INFO_MAX_BYTES
    || text.includes('\0') || !text.endsWith('\n')) {
    throw new Error('bwrap info is missing, malformed, or unbounded');
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('bwrap info is not exact JSON'); }
  const keys = [
    'child-pid', 'ipc-namespace', 'mnt-namespace', 'net-namespace',
    'pid-namespace', 'uts-namespace',
  ];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify([...keys].sort())
    || keys.some((key) => !Number.isSafeInteger(parsed[key]) || parsed[key] <= 1)) {
    throw new Error('bwrap info does not contain exact namespace identities');
  }
  return {
    child_pid: parsed['child-pid'],
    namespaces: {
      ipc: parsed['ipc-namespace'], mount: parsed['mnt-namespace'],
      network: parsed['net-namespace'], pid: parsed['pid-namespace'],
      uts: parsed['uts-namespace'],
    },
  };
}

export function oracleHostProbeLimits(limits) {
  return Boolean(limits
    && Number.isSafeInteger(limits.memory_max_bytes) && limits.memory_max_bytes <= 256 * 1024 ** 2
    && Number.isSafeInteger(limits.pids_max) && limits.pids_max <= 16
    && Number.isSafeInteger(limits.timeout_ms) && limits.timeout_ms <= 10_000
    && Number.isSafeInteger(limits.temporary_max_bytes)
    && limits.temporary_max_bytes >= 4096
    && limits.temporary_max_bytes <= ORACLE_HOST_PROBE_MAX_QUOTA_BYTES);
}

export function encodeOracleHostWireProfile(oracleHostProfile, {
  quotaBytes, keeperArguments, brokerSocket, privateTmpRoot,
}) {
  const wire = {
    schema: oracleHostProfile.schema,
    id: oracleHostProfile.id,
    bwrap: oracleHostProfile.bwrap,
    bwrap_identity: oracleHostProfile.bwrap_identity,
    bwrap_capabilities: oracleHostProfile.bwrap_capabilities,
    launcher: oracleHostProfile.launcher,
    launcher_identity: oracleHostProfile.launcher_identity,
    bootstrap_environment: oracleHostProfile.bootstrap_environment,
    host: oracleHostProfile.host,
    host_identity: oracleHostProfile.host_identity,
    non_gradeable: oracleHostProfile.non_gradeable,
    cache_capability_sha256: oracleHostProfile.cache_capability.digest,
    cache_capability_sealed_relative: oracleHostProfile.cache_capability_sealed_relative,
    quota_bytes: quotaBytes,
    broker_socket: brokerSocket,
    private_tmp_root: privateTmpRoot,
  };
  if (oracleHostProfile.id === 'candidate-lease-worker-v1'
    && oracleHostProfile.snapshot_repository && oracleHostProfile.worker_runner) {
    wire.snapshot_repository = oracleHostProfile.snapshot_repository;
    wire.worker_runner = oracleHostProfile.worker_runner;
    wire.worker_args = oracleHostProfile.worker_args;
    wire.execution_authority_root = oracleHostProfile.execution_authority_root;
    wire.node_executable = oracleHostProfile.node_executable;
    wire.node_executable_identity = oracleHostProfile.node_executable_identity;
    wire.sealed_git_identity_relative = oracleHostProfile.sealed_git_identity_relative;
    wire.sealed_git_identity_sha256 = oracleHostProfile.sealed_git_identity_sha256;
  } else {
    wire.keeper_arguments = keeperArguments;
  }
  return Object.freeze(wire);
}
