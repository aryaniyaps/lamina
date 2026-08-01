#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { removeOwnedDirectory } from './filesystem.mjs';
import { systemdAbsenceProof, systemdKillArguments } from './linux-systemd.mjs';
import { identityAlive, processIdentity } from './processes.mjs';
import { finishReport, writeReportWithFallback } from './report.mjs';
import { infrastructureBinaries, sanitizedEnvironment } from './infrastructure.mjs';

const [manifestFile, readyFile, disarmFile] = process.argv.slice(2);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const safeUnit = (unit) => typeof unit === 'string'
  && /^lamina-safe-[A-Za-z0-9_-]+\.scope$/.test(unit);

function validManifest(value, initial = value) {
  if (value?.schema !== 'lamina.safe-runner-crash-watchdog/v1'
    || value.token !== initial?.token
    || !safeUnit(value.unit)
    || value.unit !== initial?.unit
    || Number(value.controller?.pid) !== Number(initial?.controller?.pid)
    || String(value.controller?.start_ticks || '') !== String(initial?.controller?.start_ticks || '')
    || !path.isAbsolute(value.report_file || '')
    || value.report_authority?.file !== value.report_file
    || value.report_authority?.parent !== path.dirname(value.report_file)
    || value.report_authority?.run_id !== value.report_seed?.run_id
    || typeof value.report_authority?.parent_identity?.dev !== 'string'
    || typeof value.report_authority?.parent_identity?.ino !== 'string'
    || !path.isAbsolute(value.runner_temporary_directory || '')
    || value.runner_temporary_identity?.path !== value.runner_temporary_directory
    || value.watchdog_directory_identity?.path !== path.dirname(path.resolve(manifestFile))) return false;
  if (value.cgroup !== null && (typeof value.cgroup !== 'string'
    || !value.cgroup.startsWith('/sys/fs/cgroup/') || path.basename(value.cgroup) !== value.unit)) return false;
  if (value.lock_file !== null) {
    if (!path.isAbsolute(value.lock_file || '') || !value.lock_identity?.nonce
      || value.lock_identity?.scope?.unit !== value.unit) return false;
  }
  return Array.isArray(value.managed_paths) && value.managed_paths.every((item) =>
    path.isAbsolute(item?.path || '') && ['socket', 'lock'].includes(item?.type)
      && ['reserved', 'bound'].includes(item.state)
      && typeof item.parent_identity?.dev === 'string'
      && typeof item.parent_identity?.ino === 'string'
      && (item.state === 'reserved' || (Array.isArray(item.expected_pids)
        && item.expected_pids.length >= 1 && item.expected_pids.every(Number.isSafeInteger))));
}

function systemctl(args) {
  return spawnSync(infrastructureBinaries().systemctl, ['--user', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000, maxBuffer: 64 * 1024,
    env: sanitizedEnvironment(process.env),
  });
}

function authoritativeAbsence(manifest) {
  if (!safeUnit(manifest.unit)) return false;
  const shown = systemctl([
    'show', manifest.unit, '--property=LoadState', '--property=ControlGroup',
  ]);
  const cachedCgroupExists = typeof manifest.cgroup === 'string' && fs.existsSync(manifest.cgroup);
  return systemdAbsenceProof(shown, cachedCgroupExists);
}

async function terminateScope(manifest) {
  if (authoritativeAbsence(manifest)) return true;
  if (safeUnit(manifest.unit) && Number.isSafeInteger(manifest.systemd_major)) {
    systemctl(systemdKillArguments('SIGKILL', manifest.unit, manifest.systemd_major));
    systemctl(['stop', manifest.unit]);
    systemctl(['reset-failed', manifest.unit]);
  }
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (authoritativeAbsence(manifest)) return true;
    await wait(25);
  }
  return false;
}

function samePathIdentity(candidate, expected) {
  try {
    const stat = fs.lstatSync(candidate, { bigint: true });
    const typeMatches = expected.type === 'socket' ? stat.isSocket() : stat.isFile();
    if (!typeMatches || stat.isSymbolicLink() || expected.state !== 'bound'
      || Number(stat.uid) !== expected.uid) return false;
    const parent = fs.lstatSync(path.dirname(candidate), { bigint: true });
    if (!parent.isDirectory() || parent.isSymbolicLink()
      || String(parent.dev) !== expected.parent_identity.dev
      || String(parent.ino) !== expected.parent_identity.ino
      || Number(parent.uid) !== expected.parent_identity.uid) return false;
    return true;
  } catch { return false; }
}

function removeManagedPaths(records) {
  const remaining = [];
  for (const record of records || []) {
    if (!fs.existsSync(record.path)) continue;
    if (!samePathIdentity(record.path, record)) {
      remaining.push(record.path);
      continue;
    }
    try { fs.unlinkSync(record.path); } catch { remaining.push(record.path); }
  }
  return remaining;
}

function releaseLock(manifest, cleanupProven) {
  if (!manifest.lock_file) return null;
  if (!fs.existsSync(manifest.lock_file)) return true;
  const owner = readJson(manifest.lock_file);
  const expected = manifest.lock_identity;
  let stat = null;
  try { stat = fs.lstatSync(manifest.lock_file, { bigint: true }); } catch {}
  if (!cleanupProven || !owner || owner.pid !== expected?.pid
    || owner.start_ticks !== expected?.start_ticks || owner.nonce !== expected?.nonce
    || String(stat?.dev) !== expected?.file_identity?.dev
    || String(stat?.ino) !== expected?.file_identity?.ino
    || Number(stat?.uid) !== expected?.file_identity?.uid) return false;
  try { fs.unlinkSync(manifest.lock_file); } catch { return false; }
  return !fs.existsSync(manifest.lock_file);
}

async function crashCleanup(initial) {
  const candidate = readJson(manifestFile);
  const manifest = validManifest(candidate, initial) ? candidate : initial;
  const scopeRemoved = await terminateScope(manifest);
  const managedRemaining = scopeRemoved ? removeManagedPaths(manifest.managed_paths) : [];
  let temporaryRemoved = false;
  if (scopeRemoved) {
    try {
      temporaryRemoved = removeOwnedDirectory(
        manifest.runner_temporary_directory,
        'lamina-safe-runner-',
        manifest.runner_temporary_identity,
      );
    } catch {}
  }
  const cleanupProven = scopeRemoved && managedRemaining.length === 0 && temporaryRemoved;
  const lockReleased = releaseLock(manifest, cleanupProven);
  const report = structuredClone(manifest.report_seed || {});
  const qualifiedCrashEvidence = manifest.armed === true
    && report.preflight?.ok === true
    && Array.isArray(report.samples)
    && report.samples.length > 0;
  report.cleanup = {
    ...(report.cleanup || {}),
    attempted: true,
    descendants_remaining: scopeRemoved ? [] : (report.cleanup?.descendants_remaining || []),
    managed_paths_remaining: managedRemaining,
    scope_removed: scopeRemoved,
    temporary_directory_removed: temporaryRemoved,
    lock_released: lockReleased,
    errors: cleanupProven && lockReleased !== false ? []
      : ['crash watchdog could not prove complete exact-scope cleanup'],
  };
  report.termination = {
    ...(report.termination || {}),
    reason: cleanupProven && qualifiedCrashEvidence ? 'interrupted' : 'cleanup_incomplete',
    limit: cleanupProven && qualifiedCrashEvidence ? 'signal' : 'supervisor_crash',
    requested_signals: [...new Set([...(report.termination?.requested_signals || []), 'SIGKILL'])],
    child_signal: 'SIGKILL',
  };
  report.outcome = cleanupProven && lockReleased !== false && qualifiedCrashEvidence
    ? 'interrupted' : 'internal_error';
  report.error = cleanupProven && lockReleased !== false && qualifiedCrashEvidence ? {
    code: 'LAMINA_SAFE_SUPERVISOR_CRASH',
    message: 'the independent crash watchdog terminated the exact supervised scope after controller loss',
  } : {
    code: 'LAMINA_SAFE_CLEANUP_INCOMPLETE',
    message: 'crash watchdog cleanup could not be authoritatively proven',
  };
  finishReport(report, Date.parse(report.started_at) || Date.now());
  try { writeReportWithFallback(manifest.report_file, report, manifest.report_authority); } catch {}
}

async function main() {
  const initial = readJson(manifestFile);
  if (!validManifest(initial)) process.exit(64);
  fs.writeFileSync(readyFile, `${JSON.stringify(processIdentity(process.pid))}\n`, { mode: 0o600 });
  while (identityAlive(initial.controller)) {
    try {
      if (fs.readFileSync(disarmFile, 'utf8').trim() === initial.token) {
        removeOwnedDirectory(
          path.dirname(manifestFile), 'lamina-safe-watchdog-', initial.watchdog_directory_identity,
        );
        return;
      }
    } catch {}
    await wait(25);
  }
  await crashCleanup(initial);
  try {
    removeOwnedDirectory(
      path.dirname(manifestFile), 'lamina-safe-watchdog-', initial.watchdog_directory_identity,
    );
  } catch {}
}

await main();
