#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import { graphSocketPath, runtimePaths } from '../../../packages/cli/lib/graph-runtime/util.mjs';

const [repository, cleanupMode = 'clean'] = process.argv.slice(2);
if (!repository) throw new Error('repository path is required');
const paths = runtimePaths(repository);
const socketPath = graphSocketPath(paths);
const canonicalSocket = paths.socket;
const lockPath = paths.lock;

fs.mkdirSync(paths.runtime_dir, { recursive: true });
try { fs.rmSync(canonicalSocket, { force: true }); } catch {}
const stat = fs.readFileSync('/proc/self/stat', 'utf8');
const close = stat.lastIndexOf(')');
const startTicks = stat.slice(close + 2).trim().split(/\s+/)[19];
fs.writeFileSync(lockPath, `${JSON.stringify({
  pid: process.pid, start_ticks: startTicks,
})}\n`, { mode: 0o600 });

const server = net.createServer((socket) => socket.end());
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    if (!['leave-stale', 'exit-stale'].includes(cleanupMode)) {
      try { fs.rmSync(canonicalSocket, { force: true }); } catch {}
      try { fs.rmSync(lockPath, { force: true }); } catch {}
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
server.listen(socketPath, () => fs.chmodSync(canonicalSocket, 0o600));
if (cleanupMode === 'exit-stale') setTimeout(shutdown, 250);
