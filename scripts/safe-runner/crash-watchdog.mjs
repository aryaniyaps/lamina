#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  identityAlive, processIdentity, processRecord, readPidList, signalIdentity,
} from './processes.mjs';
import { finishReport, writeReportWithFallback } from './report.mjs';
import { removeOwnedDirectory } from './filesystem.mjs';
import { systemdKillArguments } from './linux-systemd.mjs';

const [manifestFile, readyFile, disarmFile] = process.argv.slice(2);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const safeUnit = (value) => typeof value === 'string'
  && /^lamina-safe-[A-Za-z0-9_-]{1,80}\.scope$/.test(value);

function safeCgroup(value, unit) {
  if (!safeUnit(unit) || typeof value !== 'string') return null;
  const resolved = path.resolve(value);
  return resolved.startsWith('/sys/fs/cgroup/') && path.basename(resolved) === unit ? resolved : null;
}

function cgroupPids(root) {
  const found = new Set();
  const visit = (directory) => {
    for (const pid of readPidList(path.join(directory, 'cgroup.procs'))) found.add(pid);
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch {}
    for (const entry of entries) if (entry.isDirectory()) visit(path.join(directory, entry.name));
  };
  if (root) visit(root);
  return [...found];
}

function systemctl(args) {
  return spawnSync('systemctl', ['--user', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000,
  });
}

function unitAbsent(unit) {
  const result = systemctl(['show', unit, '--property=LoadState', '--value']);
  const state = String(result.stdout || '').trim();
  const detail = String(result.stderr || '').trim();
  const explicitMissing = /(?:not loaded|not found|could not be found)/i.test(detail);
  return {
    absent: !result.error && (state === 'not-found' || (result.status !== 0 && explicitMissing)),
    result,
    state,
  };
}

function operationError(result, operation) {
  if (!result.error && result.status === 0) return null;
  return `${operation}: ${result.error?.message || String(result.stderr || '').trim() || `status ${result.status}`}`;
}

function removeManagedPaths(candidates) {
  const remaining = [];
  for (const candidate of candidates || []) {
    const resolved = path.resolve(candidate);
    if (!['graphd.sock', 'graphd.lock'].includes(path.basename(resolved))) {
      remaining.push(resolved);
      continue;
    }
    try { fs.rmSync(resolved, { force: true }); } catch {}
    if (fs.existsSync(resolved)) remaining.push(resolved);
  }
  return remaining;
}

function releaseLock(file, expected) {
  if (!file) return null;
  if (!fs.existsSync(file)) return true;
  const owner = readJson(file);
  if (!owner || owner.pid !== expected?.pid || owner.start_ticks !== expected?.start_ticks
    || owner.nonce !== expected?.nonce) return false;
  try { fs.rmSync(file, { force: true }); } catch { return false; }
  return !fs.existsSync(file);
}

async function supervise() {
  const initial = readJson(manifestFile);
  const watchdogDirectory = path.dirname(path.resolve(manifestFile));
  if (!path.basename(watchdogDirectory).startsWith('lamina-safe-watchdog-')
    || path.dirname(watchdogDirectory) !== path.resolve(os.tmpdir())
    || initial?.schema !== 'lamina.safe-runner-crash-watchdog/v1') process.exit(64);
  fs.writeFileSync(readyFile, `${JSON.stringify(processIdentity(process.pid))}\n`, { mode: 0o600 });
  while (identityAlive(initial.controller)) {
    try {
      if (fs.readFileSync(disarmFile, 'utf8').trim() === initial.token) {
        removeOwnedDirectory(
          watchdogDirectory, 'lamina-safe-watchdog-', initial.watchdog_directory_identity,
        );
        return;
      }
    } catch {}
    await wait(25);
  }

  const manifest = readJson(manifestFile) || initial;
  const errors = [];
  const cgroup = safeCgroup(manifest.cgroup, manifest.unit);
  let scopeRemoved = null;
  if (manifest.adapter?.production_enforcement && safeUnit(manifest.unit)) {
    const before = unitAbsent(manifest.unit);
    if (!before.absent) {
      for (const [args, label] of [
        [systemdKillArguments('SIGKILL', manifest.unit, manifest.systemd_major), 'systemctl kill'],
        [['stop', manifest.unit], 'systemctl stop'],
        [['reset-failed', manifest.unit], 'systemctl reset-failed'],
      ]) {
        if (unitAbsent(manifest.unit).absent) break;
        const result = systemctl(args);
        const error = operationError(result, `${label} ${manifest.unit}`);
        // A transient scope may be collected between commands. A nonzero
        // status is acceptable only when an independent readback proves that
        // exact unit is already absent.
        if (error && !unitAbsent(manifest.unit).absent) errors.push(error);
      }
    }
  } else if (manifest.payload) {
    const current = processRecord(manifest.payload.pid);
    const groupProven = identityAlive(manifest.payload)
      && Number.isInteger(manifest.payload_process_group)
      && manifest.payload_process_group === manifest.payload.pid
      && current?.process_group === manifest.payload_process_group;
    if (groupProven) {
      try { process.kill(-manifest.payload_process_group, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') errors.push(`payload group kill: ${error.message}`);
      }
    }
    try { signalIdentity(manifest.payload, 'SIGKILL'); } catch (error) {
      if (error.code !== 'ESRCH') errors.push(`payload kill: ${error.message}`);
    }
  }
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const processesRemain = identityAlive(manifest.payload) || cgroupPids(cgroup).length > 0;
    const unitRemains = manifest.adapter?.production_enforcement
      && safeUnit(manifest.unit) && !unitAbsent(manifest.unit).absent;
    if (!processesRemain && !unitRemains) break;
    await wait(25);
  }
  const descendantsRemaining = cgroupPids(cgroup);
  if (identityAlive(manifest.payload)) descendantsRemaining.push(manifest.payload.pid);
  if (manifest.adapter?.production_enforcement) {
    const finalUnit = safeUnit(manifest.unit) ? unitAbsent(manifest.unit) : { absent: false };
    scopeRemoved = finalUnit.absent && descendantsRemaining.length === 0;
    if (!scopeRemoved) errors.push(`systemd scope was not collected: ${manifest.unit || 'invalid unit'}`);
  } else {
    scopeRemoved = descendantsRemaining.length === 0;
  }
  const managedRemaining = removeManagedPaths(manifest.managed_paths);
  let temporaryRemoved = false;
  try {
    temporaryRemoved = !fs.existsSync(manifest.runner_temporary_directory)
      || removeOwnedDirectory(
        manifest.runner_temporary_directory, 'lamina-safe-runner-',
        manifest.runner_temporary_identity,
      );
  } catch (error) { errors.push(`temporary cleanup: ${error.message}`); }
  const lockReleased = releaseLock(manifest.lock_file, manifest.lock_identity);
  if (manifest.lock_file && !lockReleased) errors.push('production lock ownership could not be verified');
  try {
    removeOwnedDirectory(
      watchdogDirectory, 'lamina-safe-watchdog-', manifest.watchdog_directory_identity,
    );
  } catch (error) { errors.push(`watchdog cleanup: ${error.message}`); }

  const report = manifest.report_seed;
  report.outcome = 'internal_error';
  report.report_file = path.resolve(manifest.report_file);
  report.termination.reason = 'controller_crashed';
  report.termination.limit = null;
  if (!report.termination.requested_signals.includes('SIGKILL')) report.termination.requested_signals.push('SIGKILL');
  report.cleanup = {
    attempted: true,
    descendants_remaining: [...new Set(descendantsRemaining)],
    managed_paths_remaining: managedRemaining,
    scope_removed: scopeRemoved,
    temporary_directory_removed: temporaryRemoved,
    lock_released: lockReleased,
    errors,
  };
  report.error = {
    code: 'LAMINA_SAFE_CONTROLLER_CRASH',
    message: 'the external watchdog observed the runner controller exit and completed bounded cleanup',
  };
  finishReport(report, Date.parse(report.started_at));
  writeReportWithFallback(manifest.report_file, report);
}

await supervise();
