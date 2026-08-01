#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ownedDirectoryIdentity, removeOwnedDirectory } from './filesystem.mjs';
import { systemdAbsenceProof, systemdKillArguments } from './linux-systemd.mjs';
import { identityAlive, processIdentity } from './processes.mjs';
import { finishReport, writeReportWithFallback } from './report.mjs';
import { infrastructureBinaries, sanitizedEnvironment } from './infrastructure.mjs';
import { lstatPresence, removeManagedObjects } from './managed-paths.mjs';
import { acquireConcurrencyLock, productionLockDirectory } from './state.mjs';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const safeUnit = (unit) => typeof unit === 'string'
  && /^lamina-safe-[A-Za-z0-9_-]+\.scope$/.test(unit);
let aborted = false;
let controllerDisconnected = false;
process.on('message', (message) => { if (message?.type === 'abort') aborted = true; });
process.on('disconnect', () => { controllerDisconnected = true; });

function atomicJson(file, value) {
  const temporary = `${file}.tmp-${crypto.randomBytes(16).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
    const descriptor = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, file);
    const parent = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  } finally { fs.rmSync(temporary, { force: true }); }
}

function validReportAuthority(value, reportFile, reportSeed) {
  return value?.file === reportFile && value?.parent === path.dirname(reportFile)
    && value?.run_id === reportSeed?.run_id
    && typeof value?.parent_identity?.dev === 'string'
    && typeof value?.parent_identity?.ino === 'string'
    && Number.isSafeInteger(value?.generation)
    && typeof value?.file_identity?.dev === 'string'
    && typeof value?.file_identity?.ino === 'string'
    && value?.file_identity?.nlink === 1;
}

function validBootstrap(value) {
  return value?.schema === 'lamina.safe-runner-crash-watchdog-bootstrap/v1'
    && /^[a-f0-9]{64}$/.test(value.token || '')
    && value.adapter_id === 'linux-systemd-cgroup-v2'
    && safeUnit(value.unit)
    && Number.isSafeInteger(value.controller?.pid)
    && typeof value.controller?.start_ticks === 'string'
    && path.isAbsolute(value.report_file || '')
    && validReportAuthority(value.report_authority, value.report_file, value.report_seed)
    && (value.test_crash_marker_file === null
      || path.isAbsolute(value.test_crash_marker_file || ''));
}

function validManifest(value, initial = value) {
  if (value?.schema !== 'lamina.safe-runner-crash-watchdog/v1'
    || value.token !== initial?.token
    || !safeUnit(value.unit)
    || value.unit !== initial?.unit
    || Number(value.controller?.pid) !== Number(initial?.controller?.pid)
    || String(value.controller?.start_ticks || '') !== String(initial?.controller?.start_ticks || '')
    || !path.isAbsolute(value.report_file || '')
    || !validReportAuthority(value.report_authority, value.report_file, value.report_seed)
    || !path.isAbsolute(value.runner_temporary_directory || '')
    || value.runner_temporary_identity?.path !== value.runner_temporary_directory
    || !path.isAbsolute(value.payload_temporary_directory || '')
    || value.payload_temporary_identity?.path !== value.payload_temporary_directory
    || path.dirname(value.payload_temporary_directory) !== value.runner_temporary_directory
    || value.watchdog_directory_identity?.path !== path.dirname(path.resolve(value.manifest_file || ''))
    || value.manifest_file !== path.resolve(value.manifest_file || '')) return false;
  if (value.report_authority.pending_generation !== null
    && (!Number.isSafeInteger(value.report_authority.pending_generation?.generation)
      || value.report_authority.pending_generation.generation !== value.report_authority.generation + 1
      || typeof value.report_authority.pending_generation?.file_identity?.dev !== 'string'
      || typeof value.report_authority.pending_generation?.file_identity?.ino !== 'string'
      || value.report_authority.pending_generation?.file_identity?.nlink !== 1)) return false;
  if (value.cgroup !== null && (typeof value.cgroup !== 'string'
    || !value.cgroup.startsWith('/sys/fs/cgroup/') || path.basename(value.cgroup) !== value.unit)) return false;
  if (value.lock_file !== null) {
    if (!path.isAbsolute(value.lock_file || '') || !value.lock_identity?.nonce
      || value.lock_identity?.scope?.unit !== value.unit
      || path.dirname(value.lock_file) !== path.resolve(productionLockDirectory())
      || value.lock_identity?.directory_identity?.path !== path.dirname(value.lock_file)) return false;
  }
  return Array.isArray(value.managed_paths) && value.managed_paths.every((item) =>
    path.isAbsolute(item?.path || '') && ['socket', 'lock'].includes(item?.type)
      && ['reserved', 'bound', 'authorized', 'sealed'].includes(item.state)
      && typeof item.parent_identity?.dev === 'string'
      && typeof item.parent_identity?.ino === 'string'
      && (item.state === 'reserved' || (Array.isArray(item.expected_pids)
        && item.expected_pids.length >= 1 && item.expected_pids.every(Number.isSafeInteger)))
      && (item.state !== 'sealed' || (typeof item.object_identity?.dev === 'string'
        && typeof item.object_identity?.ino === 'string'
        && item.object_identity?.type === item.type)));
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

function releaseLock(manifest, cleanupProven) {
  if (!manifest.lock_file) return true;
  if (!lstatPresence(manifest.lock_file).exists) return true;
  const owner = readJson(manifest.lock_file);
  const expected = manifest.lock_identity;
  let stat = null;
  let directory = null;
  try { stat = fs.lstatSync(manifest.lock_file, { bigint: true }); } catch {}
  try { directory = ownedDirectoryIdentity(path.dirname(manifest.lock_file)); } catch {}
  if (!cleanupProven || !owner || owner.pid !== expected?.pid
    || owner.start_ticks !== expected?.start_ticks || owner.nonce !== expected?.nonce
    || directory?.dev !== expected?.directory_identity?.dev
    || directory?.ino !== expected?.directory_identity?.ino
    || directory?.uid !== expected?.directory_identity?.uid
    || String(stat?.dev) !== expected?.file_identity?.dev
    || String(stat?.ino) !== expected?.file_identity?.ino
    || Number(stat?.uid) !== expected?.file_identity?.uid) return false;
  try { fs.unlinkSync(manifest.lock_file); } catch { return false; }
  return !lstatPresence(manifest.lock_file).exists;
}

async function crashCleanup(initial) {
  const candidate = readJson(initial.manifest_file);
  const manifest = validManifest(candidate, initial) ? candidate : initial;
  const scopeRemoved = await terminateScope(manifest);
  const managedRemaining = scopeRemoved ? removeManagedObjects(manifest.managed_paths) : [];
  let temporaryRemoved = false;
  if (scopeRemoved) {
    try {
      temporaryRemoved = removeOwnedDirectory(
        manifest.runner_temporary_directory,
        'lamina-safe-runner-', manifest.runner_temporary_identity,
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
  const cleanupTrusted = cleanupProven && lockReleased === true;
  report.cleanup = {
    ...(report.cleanup || {}),
    attempted: true,
    descendants_remaining: scopeRemoved ? [] : (report.cleanup?.descendants_remaining || []),
    managed_paths_remaining: managedRemaining,
    scope_removed: scopeRemoved,
    temporary_directory_removed: temporaryRemoved,
    lock_released: lockReleased,
    errors: cleanupTrusted ? []
      : ['crash watchdog could not prove complete exact-scope cleanup'],
  };
  report.termination = {
    ...(report.termination || {}),
    reason: cleanupTrusted
      ? (qualifiedCrashEvidence ? 'interrupted' : 'supervisor_crash_before_payload')
      : 'cleanup_incomplete',
    limit: qualifiedCrashEvidence && cleanupTrusted ? 'signal' : 'supervisor_crash',
    requested_signals: [...new Set([...(report.termination?.requested_signals || []), 'SIGKILL'])],
    child_signal: 'SIGKILL',
  };
  report.outcome = cleanupTrusted && qualifiedCrashEvidence
    ? 'interrupted' : 'internal_error';
  report.error = cleanupTrusted ? {
    code: 'LAMINA_SAFE_SUPERVISOR_CRASH',
    message: qualifiedCrashEvidence
      ? 'the independent crash watchdog terminated the exact supervised scope after controller loss'
      : 'the independent crash watchdog cleaned exact runner authority before payload release',
  } : {
    code: 'LAMINA_SAFE_CLEANUP_INCOMPLETE',
    message: 'crash watchdog cleanup could not be authoritatively proven',
  };
  finishReport(report, Date.parse(report.started_at) || Date.now());
  try { writeReportWithFallback(manifest.report_file, report, manifest.report_authority); } catch {}
}

async function bootstrapMessage() {
  return new Promise((resolve) => {
    process.on('message', (message) => {
      if (message?.type === 'bootstrap') resolve(message.value);
    });
  });
}

function send(token, type, value) {
  if (!process.connected) return;
  try { process.send({ token, type, ...value }); } catch {}
}

async function main() {
  const bootstrap = await bootstrapMessage();
  if (!validBootstrap(bootstrap)) process.exit(64);
  const resources = { watchdog_process: processIdentity(process.pid) };
  let lock = null;
  let initial = null;
  const progress = () => send(bootstrap.token, 'progress', { resources });
  const controllerGone = () => controllerDisconnected || !identityAlive(bootstrap.controller);
  const writeMarker = (name) => {
    if (!bootstrap.test_crash_marker_file) return;
    fs.writeFileSync(bootstrap.test_crash_marker_file, `${JSON.stringify({
      boundary: name,
      controller_pid: bootstrap.controller.pid,
      unit: bootstrap.unit,
      temporary_directory: resources.runner_temporary_directory || null,
      watchdog_directory: resources.watchdog_directory || null,
      lock_file: resources.lock_file || null,
      watchdog_process: resources.watchdog_process,
    })}\n`, { flag: 'wx', mode: 0o600 });
  };
  const crashBoundary = async (name) => {
    if (bootstrap.test_crash_boundary !== name || !bootstrap.test_crash_marker_file) return;
    writeMarker(name);
    while (!controllerGone() && !aborted) await wait(20);
  };
  try {
    resources.watchdog_directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-watchdog-'));
    fs.chmodSync(resources.watchdog_directory, 0o700);
    resources.watchdog_directory_identity = ownedDirectoryIdentity(resources.watchdog_directory);
    resources.manifest_file = path.join(resources.watchdog_directory, 'manifest.json');
    resources.disarm_file = path.join(resources.watchdog_directory, 'disarm');
    progress();
    await crashBoundary('watchdog_state_created');
    if (controllerGone() || aborted) throw Object.assign(new Error('controller lost during watchdog bootstrap'),
      { controllerGone: controllerGone() });

    resources.runner_temporary_directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-'));
    fs.chmodSync(resources.runner_temporary_directory, 0o700);
    resources.runner_temporary_identity = ownedDirectoryIdentity(resources.runner_temporary_directory);
    resources.payload_temporary_directory = path.join(resources.runner_temporary_directory, 'payload-tmp');
    fs.mkdirSync(resources.payload_temporary_directory, { mode: 0o700 });
    resources.payload_temporary_identity = ownedDirectoryIdentity(resources.payload_temporary_directory);
    progress();
    await crashBoundary('runner_temporary_created');
    if (controllerGone() || aborted) throw Object.assign(new Error('controller lost during watchdog bootstrap'),
      { controllerGone: controllerGone() });

    if (bootstrap.acquire_lock) {
      lock = acquireConcurrencyLock({
        scope: { adapter: bootstrap.adapter_id, unit: bootstrap.unit, cgroup: null },
      });
      resources.lock_file = lock.file;
      resources.lock_identity = lock.identity();
      progress();
      if (bootstrap.test_bootstrap_failure === 'exit_after_lock') {
        writeMarker('exit_after_lock');
        process.exit(70);
      }
    }
    if (controllerGone() || aborted) throw Object.assign(new Error('controller lost during watchdog bootstrap'),
      { controllerGone: controllerGone() });
    initial = {
      schema: 'lamina.safe-runner-crash-watchdog/v1',
      token: bootstrap.token,
      controller: bootstrap.controller,
      report_file: bootstrap.report_file,
      report_authority: bootstrap.report_authority,
      report_seed: bootstrap.report_seed,
      runner_temporary_directory: resources.runner_temporary_directory,
      runner_temporary_identity: resources.runner_temporary_identity,
      payload_temporary_directory: resources.payload_temporary_directory,
      payload_temporary_identity: resources.payload_temporary_identity,
      watchdog_directory_identity: resources.watchdog_directory_identity,
      manifest_file: resources.manifest_file,
      unit: bootstrap.unit,
      systemd_major: bootstrap.systemd_major,
      cgroup: null,
      managed_paths: [],
      lock_file: resources.lock_file || null,
      lock_identity: resources.lock_identity || null,
      armed: false,
    };
    atomicJson(resources.manifest_file, initial);
    send(bootstrap.token, 'ready', {
      schema: 'lamina.safe-runner-crash-watchdog-ready/v1', resources,
    });
    process.channel?.unref();
    while (!controllerGone()) {
      try {
        if (fs.readFileSync(resources.disarm_file, 'utf8').trim() === bootstrap.token) {
          removeOwnedDirectory(resources.watchdog_directory,
            'lamina-safe-watchdog-', resources.watchdog_directory_identity);
          return;
        }
      } catch {}
      await wait(25);
    }
    await crashCleanup(initial);
    try {
      removeOwnedDirectory(resources.watchdog_directory,
        'lamina-safe-watchdog-', resources.watchdog_directory_identity);
    } catch {}
  } catch (error) {
    const lostController = error.controllerGone === true || controllerGone();
    if (lostController && resources.runner_temporary_directory) {
      initial ||= {
        schema: 'lamina.safe-runner-crash-watchdog/v1', token: bootstrap.token,
        controller: bootstrap.controller, report_file: bootstrap.report_file,
        report_authority: bootstrap.report_authority, report_seed: bootstrap.report_seed,
        runner_temporary_directory: resources.runner_temporary_directory,
        runner_temporary_identity: resources.runner_temporary_identity,
        payload_temporary_directory: resources.payload_temporary_directory,
        payload_temporary_identity: resources.payload_temporary_identity,
        watchdog_directory_identity: resources.watchdog_directory_identity,
        manifest_file: resources.manifest_file, unit: bootstrap.unit,
        systemd_major: bootstrap.systemd_major, cgroup: null, managed_paths: [],
        lock_file: resources.lock_file || null, lock_identity: resources.lock_identity || null,
        armed: false,
      };
      await crashCleanup(initial);
    } else if (lostController) {
      const report = structuredClone(bootstrap.report_seed || {});
      const scopeRemoved = await terminateScope(bootstrap);
      report.cleanup = {
        ...(report.cleanup || {}), attempted: true, descendants_remaining: [],
        managed_paths_remaining: [], scope_removed: scopeRemoved,
        temporary_directory_removed: true, lock_released: true,
        errors: scopeRemoved ? [] : ['crash watchdog could not prove exact-scope absence'],
      };
      report.termination = {
        ...(report.termination || {}), reason: scopeRemoved
          ? 'supervisor_crash_before_payload' : 'cleanup_incomplete',
        limit: 'supervisor_crash', requested_signals: ['SIGKILL'], child_signal: 'SIGKILL',
      };
      report.outcome = 'internal_error';
      report.error = scopeRemoved ? {
        code: 'LAMINA_SAFE_SUPERVISOR_CRASH',
        message: 'the independent crash watchdog cleaned exact runner authority before payload release',
      } : {
        code: 'LAMINA_SAFE_CLEANUP_INCOMPLETE',
        message: 'crash watchdog cleanup could not be authoritatively proven',
      };
      finishReport(report, Date.parse(report.started_at) || Date.now());
      try { writeReportWithFallback(bootstrap.report_file, report, bootstrap.report_authority); } catch {}
    } else {
      send(bootstrap.token, 'failed', { error: {
        code: error.code || 'LAMINA_SAFE_WATCHDOG_BOOTSTRAP', message: error.message,
      } });
    }
    if (lock && fs.existsSync(lock.file)) {
      try { lock.release(); } catch {}
    }
    if (resources.runner_temporary_directory && fs.existsSync(resources.runner_temporary_directory)) {
      try {
        removeOwnedDirectory(resources.runner_temporary_directory,
          'lamina-safe-runner-', resources.runner_temporary_identity);
      } catch {}
    }
    if (resources.watchdog_directory && fs.existsSync(resources.watchdog_directory)) {
      try {
        removeOwnedDirectory(resources.watchdog_directory,
          'lamina-safe-watchdog-', resources.watchdog_directory_identity);
      } catch {}
    }
  }
}

await main();
