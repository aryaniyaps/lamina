#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  registerManagedGraphd, reserveManagedGraphd,
} from '../../packages/cli/lib/graph-runtime/client.mjs';
import { runtimePaths } from '../../packages/cli/lib/graph-runtime/util.mjs';

const repository = process.argv[2];
if (!repository) throw new Error('repository path is required');

const paths = runtimePaths(repository);
const socket = paths.socket;
const lock = paths.lock;
const server = fileURLToPath(new URL('./graph-runtime/server.mjs', import.meta.url));
fs.mkdirSync(paths.runtime_dir, { recursive: true });
const reservation = reserveManagedGraphd(paths);
const child = spawn(process.execPath, [server, repository, process.argv[3] || 'clean'], {
  detached: true,
  stdio: 'ignore',
});
const childExit = once(child, 'exit');
const registration = registerManagedGraphd(child, paths, reservation);
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
  registration: JSON.stringify(registration),
})}\n`);
if (process.argv[3] === 'exit-stale') await childExit;
if (process.argv[4] === 'hold') setInterval(() => {}, 1_000);
