import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ownedDirectoryIdentity } from './filesystem.mjs';
import { identityAlive, processIdentity } from './processes.mjs';

const WATCHDOG = fileURLToPath(new URL('./crash-watchdog.mjs', import.meta.url));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function atomicJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export async function startCrashWatchdog({
  report, reportFile, temporaryDirectory, temporaryDirectoryIdentity, adapter, lock,
}) {
  if (process.platform !== 'linux') return null;
  const controller = processIdentity(process.pid);
  if (!controller) throw new Error('cannot establish controller PID start identity');
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
    report_seed: structuredClone(report),
    runner_temporary_directory: path.resolve(temporaryDirectory),
    runner_temporary_identity: temporaryDirectoryIdentity,
    watchdog_directory_identity: directoryIdentity,
    adapter: { id: adapter.id, production_enforcement: adapter.production_enforcement === true },
    unit: adapter.unit || null,
    systemd_major: adapter.systemdMajor || null,
    cgroup: null,
    payload: null,
    payload_process_group: null,
    managed_paths: [],
    lock_file: lock?.file || null,
    lock_identity: lock?.file ? readJson(lock.file) : null,
  };
  atomicJson(manifestFile, manifest);
  const child = spawn(process.execPath, [WATCHDOG, manifestFile, readyFile, disarmFile], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const deadline = Date.now() + 2_000;
  let identity = null;
  while (Date.now() < deadline) {
    const ready = readJson(readyFile);
    identity = ready ? { pid: ready.pid, start_ticks: ready.start_ticks } : null;
    if (identityAlive(identity)) break;
    await wait(20);
  }
  if (!identityAlive(identity)) throw new Error('crash watchdog did not become ready');
  return {
    directory,
    update(fields) {
      manifest = { ...manifest, ...fields };
      atomicJson(manifestFile, manifest);
    },
    registerManagedPath(...candidates) {
      const managed = new Set(manifest.managed_paths);
      for (const candidate of candidates) managed.add(path.resolve(candidate));
      manifest = { ...manifest, managed_paths: [...managed] };
      atomicJson(manifestFile, manifest);
    },
    async disarm() {
      fs.writeFileSync(disarmFile, `${token}\n`, { mode: 0o600 });
      const stopDeadline = Date.now() + 2_000;
      while (Date.now() < stopDeadline && identityAlive(identity)) await wait(20);
      if (identityAlive(identity)) throw new Error('crash watchdog did not disarm');
      if (fs.existsSync(directory)) throw new Error('crash watchdog directory was not removed');
      return true;
    },
  };
}
