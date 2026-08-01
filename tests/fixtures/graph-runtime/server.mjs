#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';

const [socketPath, lockPath, cleanupMode = 'clean'] = process.argv.slice(2);
if (!socketPath || !lockPath) throw new Error('socket and lock paths are required');

try { fs.rmSync(socketPath, { force: true }); } catch {}
fs.writeFileSync(lockPath, `${process.pid}\n`, { mode: 0o600 });

const server = net.createServer((socket) => socket.end());
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    if (cleanupMode !== 'leave-stale') {
      try { fs.rmSync(socketPath, { force: true }); } catch {}
      try { fs.rmSync(lockPath, { force: true }); } catch {}
    } else if (!fs.existsSync(socketPath)) {
      // Node unlinks a listening Unix socket during graceful close. Recreate a
      // stale path so the supervisor regression exercises both registered
      // runtime artifacts left behind by a faulty daemon shutdown.
      fs.writeFileSync(socketPath, 'stale socket path\n', { mode: 0o600 });
    }
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600));
