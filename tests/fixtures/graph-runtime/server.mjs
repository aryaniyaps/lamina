#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import { graphSocketPath, runtimePaths } from '../../../packages/cli/lib/graph-runtime/util.mjs';

const [repository, cleanupMode = 'clean'] = process.argv.slice(2);
if (!repository) throw new Error('repository path is required');
const paths = runtimePaths(repository);
const socketPath = graphSocketPath(paths);
const canonicalSocket = paths.socket;
const lockPath = paths.lock;

fs.mkdirSync(paths.runtime_dir, { recursive: true });
const processStartTicks = (pid) => {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    return stat.slice(close + 2).trim().split(/\s+/)[19];
  } catch { return null; }
};
const processRunning = (pid) => {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 1) return false;
  try { process.kill(Number(pid), 0); return true; } catch (error) { return error.code === 'EPERM'; }
};
const startTicks = processStartTicks(process.pid);
const operationNonce = crypto.randomBytes(16).toString('hex');
let releaseClaim;
if (process.platform === 'linux') {
  fs.mkdirSync(paths.operations_dir, { recursive: true, mode: 0o700 });
  const claimPattern = /^([1-9]\d*)-([1-9]\d*)-([a-f0-9]{32})\.json$/;
  const claims = () => fs.readdirSync(paths.operations_dir).flatMap((name) => {
    const match = name.match(claimPattern);
    if (!match) return [];
    const file = `${paths.operations_dir}/${name}`;
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Number(value.pid) === Number(match[1])
        && String(value.start_ticks || '') === match[2]
        && value.nonce === match[3] ? [{ file, value }] : [];
    } catch { return []; }
  });
  for (const claim of claims()) {
    if (processStartTicks(claim.value.pid) !== String(claim.value.start_ticks)) {
      try { fs.rmSync(claim.file); } catch {}
    }
  }
  const operationClaim = `${paths.operations_dir}/${process.pid}-${startTicks}-${operationNonce}.json`;
  const operationValue = {
    type: 'graphd', pid: process.pid, start_ticks: startTicks, nonce: operationNonce,
  };
  fs.writeFileSync(operationClaim, `${JSON.stringify(operationValue)}\n`, { flag: 'wx', mode: 0o600 });
  releaseClaim = () => {
    try {
      const current = JSON.parse(fs.readFileSync(operationClaim, 'utf8'));
      if (current.nonce === operationNonce && current.pid === process.pid
        && current.start_ticks === startTicks) fs.rmSync(operationClaim);
    } catch {}
  };
  if (claims().some((claim) => claim.file !== operationClaim
    && processStartTicks(claim.value.pid) === String(claim.value.start_ticks))) {
    releaseClaim();
    process.exit(2);
  }
} else {
  const operationClaim = path.join(paths.runtime_dir, 'graphd.startup.lock');
  try { fs.mkdirSync(operationClaim, { mode: 0o700 }); } catch (error) {
    if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
    process.exit(2);
  }
  fs.writeFileSync(path.join(operationClaim, 'owner.json'), JSON.stringify({
    pid: process.pid, nonce: operationNonce,
  }), { flag: 'wx' });
  releaseClaim = () => {
    try {
      const current = JSON.parse(fs.readFileSync(path.join(operationClaim, 'owner.json'), 'utf8'));
      if (current.pid === process.pid && current.nonce === operationNonce) {
        fs.rmSync(operationClaim, { recursive: true, force: true });
      }
    } catch {}
  };
}
const lockValue = { pid: process.pid, start_ticks: startTicks };
try {
  fs.writeFileSync(lockPath, `${JSON.stringify(lockValue)}\n`, { flag: 'wx', mode: 0o600 });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  let owner = null;
  try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
  const ownerAlive = process.platform === 'linux'
    ? processStartTicks(owner?.pid) === String(owner?.start_ticks || '')
    : processRunning(owner?.pid);
  if (ownerAlive) {
    releaseClaim();
    process.exit(2);
  }
  fs.rmSync(lockPath, { force: true });
  fs.writeFileSync(lockPath, `${JSON.stringify(lockValue)}\n`, { flag: 'wx', mode: 0o600 });
}
try { fs.rmSync(canonicalSocket, { force: true }); } catch {}

const server = net.createServer((socket) => socket.end());
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    if (!['leave-stale', 'exit-stale'].includes(cleanupMode)) {
      try { fs.rmSync(canonicalSocket, { force: true }); } catch {}
      try { fs.rmSync(lockPath, { force: true }); } catch {}
      releaseClaim();
      try { fs.rmdirSync(paths.operations_dir); } catch {}
    } else if (!fs.existsSync(canonicalSocket)) {
      // Node unlinks a listening Unix socket during graceful close. Recreate a
      // stale path so the supervisor regression exercises both registered
      // runtime artifacts left behind by a faulty daemon shutdown.
      fs.writeFileSync(canonicalSocket, 'stale socket path\n', { mode: 0o600 });
    }
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.listen(socketPath, () => {
  if (process.platform !== 'win32') fs.chmodSync(canonicalSocket, 0o600);
});
if (cleanupMode === 'exit-stale') setTimeout(shutdown, 250);
