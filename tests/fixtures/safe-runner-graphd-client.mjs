#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registerManagedGraphd } from '../../packages/cli/lib/graph-runtime/client.mjs';

const repository = process.argv[2];
if (!repository) throw new Error('repository path is required');

const runtime = path.join(repository, '.git', 'lamina');
const socket = path.join(runtime, 'graphd.sock');
const lock = path.join(runtime, 'graphd.lock');
const server = fileURLToPath(new URL('./graph-runtime/server.mjs', import.meta.url));
fs.mkdirSync(runtime, { recursive: true });
const child = spawn(process.execPath, [server, socket, lock], {
  detached: true,
  stdio: 'ignore',
});
registerManagedGraphd(child);
child.unref();

const deadline = Date.now() + 2_000;
while (!fs.existsSync(socket) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
if (!fs.existsSync(socket)) throw new Error('graphd fixture socket did not become ready');

process.stdout.write(`${JSON.stringify({
  pid: child.pid,
  socket,
  lock,
  registration: fs.readFileSync(process.env.LAMINA_SAFE_RUNNER_MANAGED_DESCENDANTS, 'utf8').trim(),
})}\n`);
