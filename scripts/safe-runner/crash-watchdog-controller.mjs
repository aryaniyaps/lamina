import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ownedDirectoryIdentity, removeOwnedDirectory } from './filesystem.mjs';
import { identityAlive, processIdentity } from './processes.mjs';
import { redactEvidence } from './redaction.mjs';
import { sanitizedEnvironment } from './infrastructure.mjs';
import { adoptConcurrencyLock } from './state.mjs';
import {
  authorizeManagedObjects, bindManagedObjects, removeManagedObjects, reserveManagedObjects,
  sealManagedObjects,
} from './managed-paths.mjs';

const WATCHDOG = fileURLToPath(new URL('./crash-watchdog.mjs', import.meta.url));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

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

function sameDirectoryIdentity(directory, expected) {
  try {
    const actual = ownedDirectoryIdentity(directory);
    return actual.path === expected?.path && actual.dev === String(expected?.dev)
      && actual.ino === String(expected?.ino) && actual.uid === Number(expected?.uid);
  } catch { return false; }
}

async function cleanupFailedBootstrap(child, progress) {
  try { if (child.connected) child.send({ type: 'abort' }); } catch {}
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline && identityAlive(progress.watchdog_process)) await wait(20);
  if (identityAlive(progress.watchdog_process)) {
    try { child.kill('SIGKILL'); } catch {}
    await wait(50);
  }
  let clean = true;
  if (progress.lock_file && fs.existsSync(progress.lock_file)) {
    try { clean = adoptConcurrencyLock(progress.lock_file, progress.lock_identity).release() && clean; }
    catch { clean = false; }
  }
  if (progress.runner_temporary_directory && fs.existsSync(progress.runner_temporary_directory)) {
    try {
      clean = removeOwnedDirectory(progress.runner_temporary_directory,
        'lamina-safe-runner-', progress.runner_temporary_identity) && clean;
    } catch { clean = false; }
  }
  if (progress.watchdog_directory && fs.existsSync(progress.watchdog_directory)) {
    try {
      clean = removeOwnedDirectory(progress.watchdog_directory,
        'lamina-safe-watchdog-', progress.watchdog_directory_identity) && clean;
    } catch { clean = false; }
  }
  return clean;
}

export async function startCrashWatchdog({
  report,
  reportFile,
  adapter,
  reportAuthority,
  acquireLock = false,
  testCrashBoundary = null,
  testCrashMarkerFile = null,
  testBootstrapFailure = null,
}) {
  const controller = processIdentity(process.pid);
  if (!controller) throw new Error('cannot establish crash-watchdog controller identity');
  const token = crypto.randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [WATCHDOG], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: sanitizedEnvironment(process.env),
  });
  child.unref();
  const progress = {};
  const ready = new Promise((resolve, reject) => {
    child.on('message', (message) => {
      if (message?.token !== token) return;
      if (message.type === 'progress') Object.assign(progress, message.resources || {});
      if (message.type === 'ready') resolve(message);
      if (message.type === 'failed') reject(Object.assign(
        new Error(message.error?.message || 'crash watchdog bootstrap failed'),
        { code: message.error?.code || 'LAMINA_SAFE_WATCHDOG_BOOTSTRAP' },
      ));
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(Object.assign(
      new Error(`crash watchdog exited before ready (${signal || code})`),
      { code: 'LAMINA_SAFE_WATCHDOG_BOOTSTRAP' },
    )));
  });
  const bootstrap = {
    schema: 'lamina.safe-runner-crash-watchdog-bootstrap/v1',
    token,
    controller,
    report_file: path.resolve(reportFile),
    report_authority: reportAuthority,
    report_seed: redactEvidence(report),
    adapter_id: adapter.id,
    unit: adapter.unit,
    systemd_major: adapter.systemdMajor,
    acquire_lock: acquireLock,
    test_crash_boundary: testCrashBoundary,
    test_crash_marker_file: testCrashMarkerFile ? path.resolve(testCrashMarkerFile) : null,
    test_bootstrap_failure: testBootstrapFailure,
  };
  child.send({ type: 'bootstrap', value: bootstrap });
  let handshake;
  try {
    handshake = await Promise.race([
      ready,
      wait(2_000).then(() => { throw Object.assign(
        new Error('crash watchdog did not become ready'),
        { code: 'LAMINA_SAFE_WATCHDOG_BOOTSTRAP' },
      ); }),
    ]);
    Object.assign(progress, handshake.resources || {});
    const resources = progress;
    const manifestFile = resources.manifest_file;
    const manifest = readJson(manifestFile);
    if (handshake.schema !== 'lamina.safe-runner-crash-watchdog-ready/v1'
      || !identityAlive(resources.watchdog_process)
      || !sameDirectoryIdentity(resources.watchdog_directory,
        resources.watchdog_directory_identity)
      || !sameDirectoryIdentity(resources.runner_temporary_directory,
        resources.runner_temporary_identity)
      || !sameDirectoryIdentity(resources.payload_temporary_directory,
        resources.payload_temporary_identity)
      || path.dirname(resources.runner_temporary_directory) !== path.dirname(resources.watchdog_directory)
      || path.dirname(resources.payload_temporary_directory) !== resources.runner_temporary_directory
      || path.dirname(manifestFile) !== resources.watchdog_directory
      || manifest?.token !== token
      || manifest?.runner_temporary_identity?.ino !== resources.runner_temporary_identity?.ino
      || (acquireLock && (!resources.lock_file || !resources.lock_identity?.nonce
        || manifest?.lock_file !== resources.lock_file
        || manifest?.lock_identity?.nonce !== resources.lock_identity.nonce
        || manifest?.lock_identity?.file_identity?.ino
          !== resources.lock_identity.file_identity?.ino
        || resources.lock_identity?.directory_identity?.path
          !== path.dirname(resources.lock_file)))) {
      throw Object.assign(new Error('crash watchdog returned an invalid ready handshake'), {
        code: 'LAMINA_SAFE_WATCHDOG_BOOTSTRAP',
      });
    }
  } catch (error) {
    const clean = await cleanupFailedBootstrap(child, progress);
    if (!clean) {
      error.message = `${error.message}; exact bootstrap cleanup could not be proven`;
      error.code = 'LAMINA_SAFE_WATCHDOG_BOOTSTRAP_CLEANUP';
    }
    throw error;
  }
  child.channel?.unref();
  const resources = progress;
  const manifestFile = resources.manifest_file;
  const disarmFile = resources.disarm_file;
  let manifest = readJson(manifestFile);
  const persist = (fields) => {
    manifest = { ...manifest, ...fields };
    atomicJson(manifestFile, manifest);
  };
  return {
    directory: resources.watchdog_directory,
    identity: resources.watchdog_process,
    temporaryDirectory: resources.runner_temporary_directory,
    temporaryDirectoryIdentity: resources.runner_temporary_identity,
    payloadTemporaryDirectory: resources.payload_temporary_directory,
    payloadTemporaryDirectoryIdentity: resources.payload_temporary_identity,
    lock: resources.lock_file
      ? adoptConcurrencyLock(resources.lock_file, resources.lock_identity) : null,
    update(fields) {
      persist({
        ...fields,
        ...(fields.report_seed ? { report_seed: redactEvidence(fields.report_seed) } : {}),
      });
    },
    reserveManagedPaths(registration) {
      const identities = reserveManagedObjects(
        registration.socket, registration.lock, registration.token,
      );
      if (!identities) return null;
      const existing = new Map(manifest.managed_paths.map((item) => [item.path, item]));
      for (const item of identities) existing.set(item.path, item);
      persist({ managed_paths: [...existing.values()] });
      return identities;
    },
    bindManagedPaths(paths, pids) {
      const current = paths.map((item) => manifest.managed_paths.find((entry) => entry.path === item.path));
      const updates = bindManagedObjects(current, pids);
      if (!updates) return false;
      const existing = new Map(manifest.managed_paths.map((item) => [item.path, item]));
      for (const item of updates) existing.set(item.path, item);
      persist({ managed_paths: [...existing.values()] });
      return true;
    },
    authorizeManagedPaths(paths) {
      const current = paths.map((item) => manifest.managed_paths.find((entry) => entry.path === item.path));
      const updates = authorizeManagedObjects(current);
      if (!updates) return false;
      const existing = new Map(manifest.managed_paths.map((item) => [item.path, item]));
      for (const item of updates) existing.set(item.path, item);
      persist({ managed_paths: [...existing.values()] });
      return true;
    },
    sealManagedPaths(paths) {
      const current = paths.map((item) => manifest.managed_paths.find((entry) => entry.path === item.path));
      if (current.length > 0 && current.every((item) => item?.state === 'sealed')) return true;
      const updates = sealManagedObjects(current);
      if (!updates) return false;
      const existing = new Map(manifest.managed_paths.map((item) => [item.path, item]));
      for (const item of updates) existing.set(item.path, item);
      persist({ managed_paths: [...existing.values()] });
      return true;
    },
    managedPaths() {
      return structuredClone(manifest.managed_paths);
    },
    cleanupManagedPaths() {
      return removeManagedObjects(manifest.managed_paths);
    },
    async disarm() {
      fs.writeFileSync(disarmFile, `${token}\n`, { mode: 0o600 });
      const stopDeadline = Date.now() + 2_000;
      while (Date.now() < stopDeadline && identityAlive(resources.watchdog_process)) await wait(20);
      if (identityAlive(resources.watchdog_process) || fs.existsSync(resources.watchdog_directory)) {
        const error = new Error('crash watchdog did not disarm and remove its owned state');
        error.code = 'LAMINA_SAFE_WATCHDOG_DISARM';
        throw error;
      }
      return true;
    },
  };
}
