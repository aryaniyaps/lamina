import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { processRecord, readPidList } from './processes.mjs';

const GATE = fileURLToPath(new URL('./gate.sh', import.meta.url));

function systemctl(args) {
  return spawnSync('systemctl', ['--user', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 3_000,
    maxBuffer: 64 * 1024,
  });
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

  launch({ command, cwd, env, readyFile, releaseFile, payloadExitFile }) {
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
      '--collect', '--', '/bin/sh', GATE, readyFile, releaseFile, payloadExitFile,
      ...command,
    ];
    this.child = spawn('systemd-run', args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return this.child;
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
    if (!cgroup) return { aggregateRssBytes: 0, taskCount: 0, pids: [], records: [], events: {} };
    const pids = cgroupPids(cgroup);
    const records = pids.map(processRecord).filter(Boolean);
    const processRss = records.reduce((sum, record) => sum + record.rss_bytes, 0);
    const cgroupCurrent = readNumber(path.join(cgroup, 'memory.current'));
    return {
      aggregateRssBytes: Math.max(cgroupCurrent, processRss),
      aggregatePeakBytes: Math.max(readNumber(path.join(cgroup, 'memory.peak')), processRss),
      cgroupMemoryCurrentBytes: cgroupCurrent,
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
    if (result.error && result.error.code !== 'ETIMEDOUT') throw result.error;
    return result;
  }

  stop() {
    return systemctl(['stop', this.unit]);
  }

  cleanup() {
    const before = this.sample().pids;
    const stopped = systemctl(['stop', this.unit]);
    const reset = systemctl(['reset-failed', this.unit]);
    const pids = this.sample().pids;
    const shown = systemctl(['show', this.unit, '--property=LoadState', '--value']);
    const state = String(shown.stdout || '').trim();
    return {
      pids,
      knownPids: before,
      removed: (shown.status !== 0 || state === 'not-found' || !state)
        && !stopped.error && !reset.error,
      commands: {
        stop_status: stopped.status,
        reset_status: reset.status,
        show_status: shown.status,
      },
    };
  }
}
