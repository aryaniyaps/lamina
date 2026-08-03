import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { processRecord, readPidList } from './processes.mjs';
import {
  assertInfrastructureBinaries, infrastructureBinaries, sanitizedEnvironment,
} from './infrastructure.mjs';
import {
  ORACLE_HOST_LAUNCH_PROFILE, oracleKeeperBwrapArguments,
} from './oracle-host-profile.mjs';
import { ORACLE_CACHE_CAPABILITY_AUTHORITY } from './oracle-cache-capability.mjs';

export const SYSTEMCTL_CONTROL_TIMEOUT_MS = 3_000;
// Cgroup discovery is polled behind a closed payload gate. Keep each D-Bus
// readback shorter than the overall handshake so one transiently stalled
// `systemctl show` cannot consume the complete proof window.
export const SYSTEMCTL_READBACK_TIMEOUT_MS = 500;

export function exactOracleHostLaunchAuthorized(record, expected, gatePid = null) {
  const environment = record?.environment_attestation;
  return expected?.profile === ORACLE_HOST_LAUNCH_PROFILE
    && Number.isSafeInteger(gatePid) && record?.ppid === gatePid
    && Array.isArray(record?.argv) && Array.isArray(expected.argv)
    && record.argv.length === expected.argv.length
    && record.argv.every((value, index) => value === expected.argv[index])
    && record.cwd === expected.cwd
    && environment?.readable === true && environment?.bounded === true
    && environment?.malformed === false
    && JSON.stringify(environment?.names) === JSON.stringify(['LANG', 'LC_ALL', 'TZ'])
    && Array.isArray(environment.execution_hooks) && environment.execution_hooks.length === 0
    && ['dev', 'ino', 'uid'].every((field) =>
      record.executable_identity?.[field] === expected.executable_identity?.[field]);
}

export function encodeOracleHostLaunchAuthority({
  node, nodeIdentity, launcher, launcherIdentity, host, hostIdentity,
  cwd, argv, profileArgument,
}) {
  if (![node, launcher, host, cwd].every((value) => path.isAbsolute(value))
    || !Array.isArray(argv) || argv.length !== 5 || argv[0] !== node || argv[1] !== host
    || typeof profileArgument !== 'string' || argv[4] !== profileArgument
    || [nodeIdentity, launcherIdentity, hostIdentity]
      .some((identity) => !identity || identity.path === undefined)) {
    throw Object.assign(new Error('oracle-host launch authority inputs are not exact'), {
      code: 'LAMINA_SAFE_ORACLE_HOST_AUTHORITY',
    });
  }
  return Buffer.from(JSON.stringify({
    schema: 'lamina.safe-runner-oracle-host-launch-authority/v1',
    profile: ORACLE_HOST_LAUNCH_PROFILE,
    node: { path: node, identity: nodeIdentity },
    launcher: { path: launcher, identity: launcherIdentity },
    host: { path: host, identity: hostIdentity },
    cwd,
    argv,
    profile_argument_sha256: crypto.createHash('sha256').update(profileArgument).digest('hex'),
    non_gradeable: true,
  })).toString('base64url');
}

export function encodeExecutionAuthority(executionAuthority) {
  return Buffer.from(JSON.stringify({
    repository: executionAuthority.repository,
    snapshot_repository: executionAuthority.snapshot_repository,
    writable_bindings: executionAuthority?.writable_bindings || [],
    git_readonly_bindings: executionAuthority?.git_readonly_bindings || [],
    git_common: executionAuthority?.git_common || null,
    git_directory: executionAuthority?.git_directory || null,
    git_executable_identity: executionAuthority?.git_executable_identity || null,
    audited_entrypoint: executionAuthority?.audited_entrypoint || null,
    environment_overrides: executionAuthority?.environment_overrides || {},
  })).toString('base64url');
}

function systemctl(args, timeout = SYSTEMCTL_CONTROL_TIMEOUT_MS, binary = infrastructureBinaries().systemctl) {
  return spawnSync(binary, ['--user', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer: 64 * 1024, env: sanitizedEnvironment(process.env),
  });
}

export function assertSystemctlSuccess(result, operation) {
  if (result?.error) throw result.error;
  if (result?.status !== 0) {
    const detail = String(result?.stderr || '').trim() || `status ${result?.status}`;
    const error = new Error(`${operation} failed: ${detail}`);
    error.code = 'LAMINA_SAFE_SYSTEMD_CONTROL';
    throw error;
  }
  return result;
}

export function parseSystemdMajor(versionText) {
  const major = Number(String(versionText || '').match(/^systemd\s+(\d+)\b/m)?.[1]);
  if (!Number.isSafeInteger(major) || major < 249) {
    const error = new Error(`unsupported or unparsable systemd version: ${String(versionText || '').trim() || 'empty output'}`);
    error.code = 'LAMINA_SAFE_SYSTEMD_VERSION';
    throw error;
  }
  return major;
}

export function systemdKillArguments(signal, unit, major) {
  if (!Number.isSafeInteger(major) || major < 249) {
    const error = new Error(`unsupported systemd major version: ${major}`);
    error.code = 'LAMINA_SAFE_SYSTEMD_VERSION';
    throw error;
  }
  const selector = major >= 252 ? '--kill-whom=all' : '--kill-who=all';
  return ['kill', selector, `--signal=${signal}`, unit];
}

export function systemdScopeProperties(limits) {
  return [
    '--property', 'MemoryAccounting=yes',
    '--property', `MemoryMax=${limits.memory_max_bytes}`,
    '--property', `MemoryHigh=${limits.memory_high_bytes}`,
    '--property', 'TasksAccounting=yes',
    '--property', `TasksMax=${limits.pids_max}`,
    '--property', 'KillMode=control-group',
    '--property', 'SendSIGKILL=yes',
    '--property', `RuntimeMaxSec=${Math.ceil((limits.timeout_ms
      + limits.graceful_stop_ms + 5_000) / 1_000)}s`,
  ];
}

function readNumber(file) {
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    return value === 'max' ? Number.MAX_SAFE_INTEGER : Number(value || 0);
  } catch {
    return 0;
  }
}

function readKeyValues(file) {
  try {
    return Object.fromEntries(fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
      const [key, value] = line.trim().split(/\s+/, 2);
      return [key, Number(value)];
    }));
  } catch {
    return {};
  }
}

export function parseCgroupIoStat(text) {
  const totals = {
    read_bytes: 0,
    write_bytes: 0,
    read_operations: 0,
    write_operations: 0,
  };
  let devices = 0;
  let invalidTotal = false;
  for (const line of String(text || '').trim().split('\n').filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (!/^\d+:\d+$/.test(fields.shift() || '')) continue;
    const values = Object.fromEntries(fields.map((field) => {
      const separator = field.indexOf('=');
      return separator === -1 ? [field, Number.NaN]
        : [field.slice(0, separator), Number(field.slice(separator + 1))];
    }));
    if (![values.rbytes, values.wbytes, values.rios, values.wios]
      .every((value) => Number.isSafeInteger(value) && value >= 0)) continue;
    const next = {
      read_bytes: totals.read_bytes + values.rbytes,
      write_bytes: totals.write_bytes + values.wbytes,
      read_operations: totals.read_operations + values.rios,
      write_operations: totals.write_operations + values.wios,
    };
    if (!Object.values(next).every(Number.isSafeInteger)) {
      invalidTotal = true;
      break;
    }
    Object.assign(totals, next);
    devices += 1;
  }
  return devices > 0 && !invalidTotal ? { available: true, devices, ...totals } : {
    available: false,
    devices: 0,
    read_bytes: null,
    write_bytes: null,
    read_operations: null,
    write_operations: null,
  };
}

export function parseCgroupCpuStat(text) {
  const values = {};
  for (const line of String(text || '').trim().split('\n').filter(Boolean)) {
    const [key, raw, ...extra] = line.trim().split(/\s+/);
    const value = Number(raw);
    if (!key || extra.length > 0 || !Number.isSafeInteger(value) || value < 0) continue;
    values[key] = value;
  }
  const available = [values.usage_usec, values.user_usec, values.system_usec]
    .every(Number.isSafeInteger);
  return {
    available,
    usage_usec: Number.isSafeInteger(values.usage_usec) ? values.usage_usec : null,
    user_usec: Number.isSafeInteger(values.user_usec) ? values.user_usec : null,
    system_usec: Number.isSafeInteger(values.system_usec) ? values.system_usec : null,
    nr_periods: Number.isSafeInteger(values.nr_periods) ? values.nr_periods : null,
    nr_throttled: Number.isSafeInteger(values.nr_throttled) ? values.nr_throttled : null,
    throttled_usec: Number.isSafeInteger(values.throttled_usec) ? values.throttled_usec : null,
    reason: available ? null : 'cgroup cpu.stat did not contain complete usage accounting',
  };
}

function cgroupAccounting(cgroup) {
  let cpu = null;
  try { cpu = parseCgroupCpuStat(fs.readFileSync(path.join(cgroup, 'cpu.stat'), 'utf8')); } catch {
    cpu = parseCgroupCpuStat('');
  }
  let io = null;
  try { io = parseCgroupIoStat(fs.readFileSync(path.join(cgroup, 'io.stat'), 'utf8')); } catch {
    io = parseCgroupIoStat('');
  }
  return { cpu, io };
}

function cgroupPids(root) {
  const pids = new Set();
  const visit = (directory) => {
    for (const pid of readPidList(path.join(directory, 'cgroup.procs'))) pids.add(pid);
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch {}
    for (const entry of entries) {
      if (entry.isDirectory()) visit(path.join(directory, entry.name));
    }
  };
  visit(root);
  return [...pids].sort((left, right) => left - right);
}

export function cgroupResolutionState(shown, controlGroup = '', pathExists = false) {
  return {
    ok: shown?.status === 0 && controlGroup.startsWith('/') && pathExists,
    source: 'systemctl_show',
    status: Number.isInteger(shown?.status) ? shown.status : null,
    signal: shown?.signal || null,
    error_code: shown?.error?.code || null,
    error_message: String(shown?.error?.message || ''),
    stderr: String(shown?.stderr || ''),
    control_group_present: controlGroup.startsWith('/'),
    path_exists: pathExists,
  };
}

function systemdShowProperties(output) {
  return Object.fromEntries(String(output || '').split('\n').filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    return separator === -1 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

export function systemdAbsenceProof(shown, cachedCgroupExists = false) {
  const properties = systemdShowProperties(shown?.stdout);
  return shown?.status === 0
    && !shown?.error
    && properties.LoadState === 'not-found'
    && !properties.ControlGroup
    && cachedCgroupExists === false;
}

export class LinuxSystemdAdapter {
  constructor({ runId, limits, probe = {} }) {
    this.id = 'linux-systemd-cgroup-v2';
    this.production_enforcement = probe.production_enforcement === true;
    this.aggregate_memory = probe.aggregate_memory === true;
    this.aggregate_pids = probe.aggregate_pids === true;
    this.complete_descendant_ownership = probe.complete_descendant_ownership === true;
    this.controllers = probe.controllers || [];
    this.unit = `lamina-safe-${runId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(-48)}.scope`;
    this.limits = limits;
    this.infrastructure = probe.infrastructure || infrastructureBinaries();
    const version = assertSystemctlSuccess(systemctl(['--version'], SYSTEMCTL_CONTROL_TIMEOUT_MS,
      this.infrastructure.systemctl), 'systemctl --version');
    this.systemdMajor = parseSystemdMajor(version.stdout);
    this.child = null;
    this.cgroupPath = null;
    this.lastCgroupResolution = null;
    this.oracleHostLaunchAuthority = null;
  }

  launch({
    command, cwd, env, readyFile, releaseFile, payloadExitFile,
    quotaReadyFile, quotaReleaseFile, temporaryDirectory,
    executionAuthority = null,
  }) {
    assertInfrastructureBinaries(this.infrastructure, ['systemdRun', 'shell', 'node', 'bwrap']);
    const staged = executionAuthority?.infrastructure;
    if (!staged?.node || !staged?.bwrap || !staged?.gate_sh || !staged?.quota_gate_sh
      || !staged?.sandbox_mjs || !staged?.identities?.bwrap) {
      throw Object.assign(new Error('production launch requires staged execution infrastructure'), {
        code: 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY',
      });
    }
    const bwrapIdentity = Buffer.from(JSON.stringify(staged.identities.bwrap)).toString('base64url');
    const encodedExecutionAuthority = encodeExecutionAuthority(executionAuthority);
    const oracleProfile = executionAuthority?.launch_profile === ORACLE_HOST_LAUNCH_PROFILE;
    if (oracleProfile && (executionAuthority.oracle_host_profile?.id !== ORACLE_HOST_LAUNCH_PROFILE
      || !Array.isArray(executionAuthority.oracle_host_launch_command)
      || executionAuthority.oracle_host_launch_command.length !== 2
      || executionAuthority.oracle_host_launch_command[0] !== staged.node
      || executionAuthority.oracle_host_profile.launcher
        !== staged.oracle_host_launcher_mjs
      || executionAuthority.oracle_host_profile.bootstrap_environment?.path
        !== staged.oracle_host_env
      || JSON.stringify(executionAuthority.oracle_host_profile.cache_capability)
        !== JSON.stringify(ORACLE_CACHE_CAPABILITY_AUTHORITY)
      || executionAuthority.oracle_host_launch_cwd !== executionAuthority.snapshot_repository)) {
      throw Object.assign(new Error('oracle-host launch profile is not exact sealed authority'), {
        code: 'LAMINA_SAFE_ORACLE_HOST_AUTHORITY',
      });
    }
    const encodedOracleProfile = oracleProfile ? Buffer.from(JSON.stringify({
      ...executionAuthority.oracle_host_profile,
      quota_bytes: this.limits.temporary_max_bytes,
      keeper_arguments: oracleKeeperBwrapArguments(this.limits.temporary_max_bytes),
      broker_socket: env?.LAMINA_SAFE_RUNNER_BROKER,
      private_tmp_root: temporaryDirectory,
    })).toString('base64url') : '';
    if (oracleProfile && (!path.isAbsolute(env?.LAMINA_SAFE_RUNNER_BROKER || '')
      || path.dirname(env.LAMINA_SAFE_RUNNER_BROKER) !== path.dirname(quotaReadyFile)
      || temporaryDirectory !== path.join(path.dirname(quotaReadyFile), 'payload-tmp'))) {
      throw Object.assign(new Error('oracle-host broker socket is outside exact run authority'), {
        code: 'LAMINA_SAFE_ORACLE_HOST_AUTHORITY',
      });
    }
    const oracleHost = oracleProfile ? executionAuthority.oracle_host_launch_command[1] : '';
    const oracleCwd = oracleProfile ? executionAuthority.oracle_host_launch_cwd : '';
    const oracleArgv = oracleProfile ? [
      staged.node, oracleHost, quotaReadyFile, quotaReleaseFile, encodedOracleProfile,
    ] : null;
    const oracleLauncher = oracleProfile
      ? executionAuthority.oracle_host_profile.launcher : '';
    const oracleEnv = oracleProfile
      ? executionAuthority.oracle_host_profile.bootstrap_environment.path : '';
    const encodedOracleAuthority = oracleProfile ? encodeOracleHostLaunchAuthority({
      node: staged.node,
      nodeIdentity: staged.identities.node,
      launcher: oracleLauncher,
      launcherIdentity: executionAuthority.oracle_host_profile.launcher_identity,
      host: oracleHost,
      hostIdentity: executionAuthority.oracle_host_profile.host_identity,
      cwd: oracleCwd,
      argv: oracleArgv,
      profileArgument: encodedOracleProfile,
    }) : '';
    this.oracleHostLaunchAuthority = oracleProfile ? Object.freeze({
      profile: ORACLE_HOST_LAUNCH_PROFILE,
      argv: Object.freeze([staged.node, oracleLauncher, encodedOracleAuthority]),
      cwd: oracleCwd,
      executable_identity: Object.freeze({ ...staged.identities.node }),
      host_main_arguments: Object.freeze(oracleArgv.slice(2)),
      keeper_arguments: Object.freeze(oracleKeeperBwrapArguments(
        this.limits.temporary_max_bytes,
      )),
      private_tmp_root: temporaryDirectory,
      cache_capability: ORACLE_CACHE_CAPABILITY_AUTHORITY,
      launcher_identity: Object.freeze({
        ...executionAuthority.oracle_host_profile.launcher_identity,
      }),
      host_identity: Object.freeze({ ...executionAuthority.oracle_host_profile.host_identity }),
    }) : null;
    const args = [
      '--user', '--scope', '--quiet', '--unit', this.unit,
      ...systemdScopeProperties(this.limits),
      '--collect', '--', this.infrastructure.shell, staged.gate_sh, readyFile, releaseFile, payloadExitFile,
      quotaReadyFile, quotaReleaseFile, temporaryDirectory,
      String(this.limits.temporary_max_bytes), cwd, staged.quota_gate_sh,
      staged.node, staged.sandbox_mjs, staged.bwrap, bwrapIdentity,
      encodedExecutionAuthority, oracleLauncher, encodedOracleAuthority, oracleEnv,
      oracleProfile ? oracleCwd : '',
      ...command,
    ];
    this.child = spawn(this.infrastructure.systemdRun, args, {
      cwd,
      env: sanitizedEnvironment(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return this.child;
  }

  enforcementProof() {
    const expected = {
      memory_max_bytes: this.limits.memory_max_bytes,
      memory_high_bytes: this.limits.memory_high_bytes,
      pids_max: this.limits.pids_max,
    };
    const cgroup = this.resolveCgroup();
    if (!cgroup) {
      return {
        ok: false,
        reason: 'cgroup path is unavailable',
        actual: null,
        expected,
      };
    }
    const actual = {
      memory_max_bytes: readNumber(path.join(cgroup, 'memory.max')),
      memory_high_bytes: readNumber(path.join(cgroup, 'memory.high')),
      pids_max: readNumber(path.join(cgroup, 'pids.max')),
    };
    return {
      ok: Object.keys(expected).every((key) => actual[key] === expected[key]),
      cgroup,
      actual,
      expected,
    };
  }

  resolveCgroup() {
    if (this.cgroupPath && fs.existsSync(this.cgroupPath)) {
      this.lastCgroupResolution = {
        ok: true,
        source: 'cache',
        status: 0,
        signal: null,
        error_code: null,
        error_message: '',
        stderr: '',
        control_group_present: true,
        path_exists: true,
      };
      return this.cgroupPath;
    }
    const shown = systemctl(
      ['show', this.unit, '--property=ControlGroup', '--value'],
      SYSTEMCTL_READBACK_TIMEOUT_MS,
      this.infrastructure.systemctl,
    );
    const controlGroup = String(shown.stdout || '').trim();
    this.lastCgroupResolution = cgroupResolutionState(shown, controlGroup);
    if (shown.status !== 0 || !controlGroup.startsWith('/')) return null;
    const resolved = path.join('/sys/fs/cgroup', controlGroup);
    this.lastCgroupResolution = cgroupResolutionState(
      shown,
      controlGroup,
      fs.existsSync(resolved),
    );
    if (!this.lastCgroupResolution.path_exists) return null;
    this.cgroupPath = resolved;
    this.lastCgroupResolution.ok = true;
    return resolved;
  }

  sample({ accounting = false } = {}) {
    const cgroup = this.resolveCgroup();
    if (!cgroup) return {
      aggregateRssBytes: 0, cgroupMemoryCurrentBytes: 0, cgroupMemoryPeakBytes: 0,
      taskCount: 0, pids: [], records: [], events: {}, accounting: null,
    };
    const pids = cgroupPids(cgroup);
    const records = pids.map(processRecord).filter(Boolean);
    const cgroupCurrent = readNumber(path.join(cgroup, 'memory.current'));
    return {
      // memory.current/peak are the authoritative non-double-counted aggregate
      // for the complete scope. Per-process RSS remains in `records` for
      // diagnostics and must not be summed as shared pages would be counted
      // once per process.
      aggregateRssBytes: records.reduce((sum, record) => sum + (record.rss_bytes || 0), 0),
      cgroupMemoryCurrentBytes: cgroupCurrent,
      cgroupMemoryPeakBytes: readNumber(path.join(cgroup, 'memory.peak')),
      taskCount: readNumber(path.join(cgroup, 'pids.current')),
      pids,
      records,
      accounting: accounting ? cgroupAccounting(cgroup) : null,
      events: {
        memory: readKeyValues(path.join(cgroup, 'memory.events')),
        pids: readKeyValues(path.join(cgroup, 'pids.events')),
      },
    };
  }

  signal(signal) {
    const result = systemctl(systemdKillArguments(signal, this.unit, this.systemdMajor),
      SYSTEMCTL_CONTROL_TIMEOUT_MS, this.infrastructure.systemctl);
    if (result?.status !== 0 || result?.error) {
      const shown = systemctl([
        'show', this.unit, '--property=LoadState', '--property=ControlGroup',
      ]);
      const cachedCgroupExists = Boolean(this.cgroupPath && fs.existsSync(this.cgroupPath));
      if (systemdAbsenceProof(shown, cachedCgroupExists)) {
        return { ...result, alreadyAbsent: true };
      }
    }
    return assertSystemctlSuccess(result, `systemctl kill ${signal} for ${this.unit}`);
  }

  stop() {
    return assertSystemctlSuccess(systemctl(['stop', this.unit]), `systemctl stop ${this.unit}`);
  }

  cleanup() {
    const before = this.sample().pids;
    const stopped = systemctl(['stop', this.unit]);
    const reset = systemctl(['reset-failed', this.unit]);
    const shown = systemctl([
      'show', this.unit, '--property=LoadState', '--property=ControlGroup',
    ]);
    const cachedCgroupExists = Boolean(this.cgroupPath && fs.existsSync(this.cgroupPath));
    const absent = systemdAbsenceProof(shown, cachedCgroupExists);
    const pids = cachedCgroupExists ? cgroupPids(this.cgroupPath) : [];
    const errors = [];
    if (!absent && (stopped.status !== 0 || stopped.error)) {
      errors.push(`systemctl stop failed with ${stopped.error?.code || `status ${stopped.status}`}`);
    }
    if (!absent && (reset.status !== 0 || reset.error)) {
      errors.push(`systemctl reset-failed failed with ${reset.error?.code || `status ${reset.status}`}`);
    }
    if (!absent) {
      errors.push(`authoritative unit absence was not proven (${shown.error?.code || `status ${shown.status}`})`);
    }
    return {
      pids,
      knownPids: before,
      removed: absent && errors.length === 0,
      errors,
      commands: {
        stop_status: stopped.status,
        reset_status: reset.status,
        show_status: shown.status,
      },
    };
  }
}
