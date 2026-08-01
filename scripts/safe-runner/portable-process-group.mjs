import { spawn } from 'node:child_process';
import {
  descendantRecords,
  identityAlive,
  processGroupRecords,
  processIdentity,
  processRecord,
  signalIdentity,
} from './processes.mjs';

export class PortableProcessGroupAdapter {
  constructor() {
    this.id = 'portable-process-group-small-only';
    this.production_enforcement = false;
    this.aggregate_memory = false;
    this.aggregate_pids = false;
    this.complete_descendant_ownership = false;
    this.controllers = [];
    this.child = null;
    this.identities = new Map();
  }

  launch({ command, cwd, env }) {
    this.child = spawn(command[0], command.slice(1), {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const identity = processIdentity(this.child.pid);
    if (identity) this.identities.set(identity.pid, identity);
    return this.child;
  }

  sample(_options = {}) {
    if (process.platform !== 'linux' || !this.child?.pid) {
      const alive = this.child?.exitCode === null && this.child?.signalCode === null;
      return {
        aggregateRssBytes: 0,
        aggregatePeakBytes: 0,
        taskCount: alive ? 1 : 0,
        pids: alive ? [this.child.pid] : [],
        records: [],
        accounting: null,
        events: {},
      };
    }
    const records = new Map();
    const remember = (record) => {
      if (!record) return;
      records.set(record.pid, record);
      if (record.start_ticks) {
        this.identities.set(record.pid, { pid: record.pid, start_ticks: record.start_ticks });
      }
    };
    remember(processRecord(this.child.pid));
    for (const record of descendantRecords(this.child.pid)) remember(record);
    for (const record of processGroupRecords(this.child.pid)) remember(record);
    for (const identity of this.identities.values()) {
      if (identityAlive(identity)) remember(processRecord(identity.pid));
    }
    const current = [...records.values()].sort((left, right) => left.pid - right.pid);
    return {
      aggregateRssBytes: current.reduce((sum, record) => sum + record.rss_bytes, 0),
      aggregatePeakBytes: 0,
      taskCount: current.length,
      pids: current.map((record) => record.pid),
      records: current,
      accounting: null,
      events: {},
    };
  }

  signal(signal) {
    const errors = [];
    if (process.platform !== 'win32' && this.child?.pid) {
      try { process.kill(-this.child.pid, signal); } catch (error) {
        if (error.code !== 'ESRCH') errors.push(error.message);
      }
    } else if (this.child) {
      try { this.child.kill(signal); } catch (error) { errors.push(error.message); }
    }
    for (const identity of this.identities.values()) {
      try { signalIdentity(identity, signal); } catch (error) {
        if (error.code !== 'ESRCH') errors.push(error.message);
      }
    }
    return { status: errors.length ? 1 : 0, errors };
  }

  cleanup() {
    this.signal('SIGKILL');
    const remaining = [...this.identities.values()]
      .filter(identityAlive)
      .map((identity) => identity.pid);
    return { pids: remaining, knownPids: [...this.identities.keys()], removed: remaining.length === 0 };
  }
}
