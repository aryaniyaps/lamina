import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ownedDirectoryIdentity } from './filesystem.mjs';
import { identityAlive, processIdentity } from './processes.mjs';
import { redactEvidence } from './redaction.mjs';
import { sanitizedEnvironment } from './infrastructure.mjs';
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

export async function startCrashWatchdog({
  report,
  reportFile,
  temporaryDirectory,
  temporaryDirectoryIdentity,
  adapter,
  lock,
  reportAuthority,
}) {
  const controller = processIdentity(process.pid);
  if (!controller) throw new Error('cannot establish crash-watchdog controller identity');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-watchdog-'));
  fs.chmodSync(directory, 0o700);
  const directoryIdentity = ownedDirectoryIdentity(directory);
  const manifestFile = path.join(directory, 'manifest.json');
  const readyFile = path.join(directory, 'ready.json');
  const disarmFile = path.join(directory, 'disarm');
  const token = crypto.randomBytes(32).toString('hex');
  let manifest = {
    schema: 'lamina.safe-runner-crash-watchdog/v1',
    token,
    controller,
    report_file: path.resolve(reportFile),
    report_authority: reportAuthority,
    report_seed: redactEvidence(report),
    runner_temporary_directory: path.resolve(temporaryDirectory),
    runner_temporary_identity: temporaryDirectoryIdentity,
    watchdog_directory_identity: directoryIdentity,
    unit: adapter.unit,
    systemd_major: adapter.systemdMajor,
    cgroup: null,
    managed_paths: [],
    lock_file: lock?.file || null,
    lock_identity: lock?.identity?.() || null,
    armed: false,
  };
  atomicJson(manifestFile, manifest);
  const child = spawn(process.execPath, [WATCHDOG, manifestFile, readyFile, disarmFile], {
    detached: true,
    stdio: 'ignore',
    env: sanitizedEnvironment(process.env),
  });
  child.unref();
  const deadline = Date.now() + 2_000;
  let identity = null;
  while (Date.now() < deadline) {
    identity = readJson(readyFile);
    if (identityAlive(identity)) break;
    await wait(20);
  }
  if (!identityAlive(identity)) throw new Error('crash watchdog did not become ready');

  const persist = (fields) => {
    manifest = { ...manifest, ...fields };
    atomicJson(manifestFile, manifest);
  };
  return {
    directory,
    identity,
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
      while (Date.now() < stopDeadline && identityAlive(identity)) await wait(20);
      if (identityAlive(identity) || fs.existsSync(directory)) {
        const error = new Error('crash watchdog did not disarm and remove its owned state');
        error.code = 'LAMINA_SAFE_WATCHDOG_DISARM';
        throw error;
      }
      return true;
    },
  };
}
