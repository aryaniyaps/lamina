#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  registerManagedGraphd, reserveManagedGraphd, sealManagedGraphd,
} from '../../packages/cli/lib/graph-runtime/client.mjs';
import { runtimePaths } from '../../packages/cli/lib/graph-runtime/util.mjs';
import { sealedSandboxGitProbe } from './safe-runner-sealed-git-probe.mjs';

const repository = process.argv[2];
if (!repository) throw new Error('repository path is required');

process.stdout.write(`${JSON.stringify(sealedSandboxGitProbe(repository))}\n`);
const paths = runtimePaths(repository);
const socket = paths.socket;
const lock = paths.lock;
const server = fileURLToPath(new URL('./graph-runtime/server.mjs', import.meta.url));
fs.mkdirSync(paths.runtime_dir, { recursive: true });
const reservation = reserveManagedGraphd(paths);
const child = spawn(process.execPath, [server, repository, process.argv[3] || 'clean'], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, LAMINA_SAFE_GRAPHD_RESERVATION: reservation || '' },
});
const childExit = once(child, 'exit');
const registration = registerManagedGraphd(child, paths, reservation);
child.unref();

const socketReady = () => {
  try { return fs.lstatSync(socket).isSocket(); } catch { return false; }
};
const deadline = Date.now() + 2_000;
while (!socketReady() && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
if (!socketReady()) throw new Error('graphd fixture socket did not become ready');
const sealed = sealManagedGraphd(reservation);

process.stdout.write(`${JSON.stringify({
  pid: child.pid,
  socket,
  lock,
  registration: JSON.stringify(registration),
  sealed,
})}\n`);
if (process.argv[3] === 'exit-stale') await childExit;
if (process.argv[4] === 'hold') setInterval(() => {}, 1_000);
