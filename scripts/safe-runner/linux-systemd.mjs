import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { processRecord, readPidList } from './processes.mjs';

const GATE = fileURLToPath(new URL('./gate.sh', import.meta.url));
const QUOTA_GATE = fileURLToPath(new URL('./quota-gate.sh', import.meta.url));

function systemctl(args) {
  return spawnSync('systemctl', ['--user', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 3_000,
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
    this.child = null;
    this.cgroupPath = null;
  }

  launch({
    command, cwd, env, readyFile, releaseFile, payloadExitFile,
    quotaReadyFile, quotaReleaseFile, temporaryDirectory,
  }) {
    const args = [
      '--user', '--scope', '--quiet', '--unit', this.unit,
      '--property', 'MemoryAccounting=yes',
      '--property', `MemoryMax=${this.limits.memory_max_bytes}`,
      '--property', `MemoryHigh=${this.limits.memory_high_bytes}`,
      '--property', 'TasksAccounting=yes',
      '--property', `TasksMax=${this.limits.pids_max}`,
      '--property', 'KillMode=control-group',
      '--property', 'SendSIGKILL=yes',
      '--property', 'OOMPolicy=stop',
      '--property', `RuntimeMaxSec=${Math.ceil((this.limits.timeout_ms
        + this.limits.graceful_stop_ms + 5_000) / 1_000)}s`,
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
    const cgroup = this.resolveCgroup();
    if (!cgroup) return { ok: false, reason: 'cgroup path is unavailable' };
    const actual = {
      memory_max_bytes: readNumber(path.join(cgroup, 'memory.max')),
      memory_high_bytes: readNumber(path.join(cgroup, 'memory.high')),
      pids_max: readNumber(path.join(cgroup, 'pids.max')),
    };
    const expected = {
      memory_max_bytes: this.limits.memory_max_bytes,
      memory_high_bytes: this.limits.memory_high_bytes,
      pids_max: this.limits.pids_max,
    };
    return {
      ok: Object.keys(expected).every((key) => actual[key] === expected[key]),
      cgroup,
      actual,
      expected,
    };
  }

  resolveCgroup() {
    if (this.cgroupPath && fs.existsSync(this.cgroupPath)) return this.cgroupPath;
    const shown = systemctl(['show', this.unit, '--property=ControlGroup', '--value']);
    const controlGroup = String(shown.stdout || '').trim();
    if (shown.status !== 0 || !controlGroup.startsWith('/')) return null;
    const resolved = path.join('/sys/fs/cgroup', controlGroup);
    if (!fs.existsSync(resolved)) return null;
    this.cgroupPath = resolved;
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
    const result = systemctl(['kill', '--kill-whom=all', `--signal=${signal}`, this.unit]);
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
