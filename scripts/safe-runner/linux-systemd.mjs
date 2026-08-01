import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { processRecord, readPidList } from './processes.mjs';

const GATE = fileURLToPath(new URL('./gate.sh', import.meta.url));
const QUOTA_GATE = fileURLToPath(new URL('./quota-gate.sh', import.meta.url));
export const SYSTEMCTL_CONTROL_TIMEOUT_MS = 3_000;
// Cgroup discovery is polled behind a closed payload gate. Keep each D-Bus
// readback shorter than the overall handshake so one transiently stalled
// `systemctl show` cannot consume the complete proof window.
export const SYSTEMCTL_READBACK_TIMEOUT_MS = 500;

function systemctl(args, timeout = SYSTEMCTL_CONTROL_TIMEOUT_MS) {
  return spawnSync('systemctl', ['--user', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer: 64 * 1024,
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
    const version = assertSystemctlSuccess(systemctl(['--version']), 'systemctl --version');
    this.systemdMajor = parseSystemdMajor(version.stdout);
    this.child = null;
    this.cgroupPath = null;
    this.lastCgroupResolution = null;
  }

  launch({
    command, cwd, env, readyFile, releaseFile, payloadExitFile,
    quotaReadyFile, quotaReleaseFile, temporaryDirectory,
  }) {
    const args = [
      '--user', '--scope', '--quiet', '--unit', this.unit,
      ...systemdScopeProperties(this.limits),
      '--collect', '--', '/bin/sh', GATE, readyFile, releaseFile, payloadExitFile,
      quotaReadyFile, quotaReleaseFile, temporaryDirectory,
      String(this.limits.temporary_max_bytes), cwd, QUOTA_GATE,
      ...command,
    ];
    this.child = spawn('systemd-run', args, {
      cwd,
      env,
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

  sample() {
    const cgroup = this.resolveCgroup();
    if (!cgroup) return {
      aggregateRssBytes: 0, cgroupMemoryCurrentBytes: 0, cgroupMemoryPeakBytes: 0,
      taskCount: 0, pids: [], records: [], events: {},
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
      events: {
        memory: readKeyValues(path.join(cgroup, 'memory.events')),
        pids: readKeyValues(path.join(cgroup, 'pids.events')),
      },
    };
  }

  signal(signal) {
    const result = systemctl(systemdKillArguments(signal, this.unit, this.systemdMajor));
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
    const pids = this.sample().pids;
    const shown = systemctl(['show', this.unit, '--property=LoadState', '--value']);
    const state = String(shown.stdout || '').trim();
    const absent = shown.status !== 0 || state === 'not-found' || !state;
    const errors = [];
    if (!absent && stopped.status !== 0) errors.push(`systemctl stop failed with status ${stopped.status}`);
    if (!absent && reset.status !== 0) errors.push(`systemctl reset-failed failed with status ${reset.status}`);
    return {
      pids,
      knownPids: before,
      removed: absent && !stopped.error && !reset.error && errors.length === 0,
      errors,
      commands: {
        stop_status: stopped.status,
        reset_status: reset.status,
        show_status: shown.status,
      },
    };
  }
}
