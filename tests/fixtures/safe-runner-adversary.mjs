#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const mode = process.argv[2];
const hold = () => setInterval(() => {}, 1_000);

if (mode === 'direct-memory') {
  const blocks = [];
  setInterval(() => {
    const block = Buffer.alloc(16 * 1024 * 1024, 0x5a);
    for (let index = 0; index < block.length; index += 4096) block[index] = index % 251;
    blocks.push(block);
  }, 10);
} else if (mode === 'aggregate-memory') {
  for (let index = 0; index < 2; index += 1) {
    spawn(process.execPath, [new URL(import.meta.url).pathname, 'memory-child'], { stdio: 'ignore' });
  }
  hold();
} else if (mode === 'memory-child') {
  const blocks = [];
  setInterval(() => {
    const block = Buffer.alloc(16 * 1024 * 1024, 0x3c);
    for (let index = 0; index < block.length; index += 4096) block[index] = index % 199;
    blocks.push(block);
  }, 20);
} else if (mode === 'ignore-term') {
  process.on('SIGTERM', () => {});
  hold();
} else if (mode === 'hang') {
  hold();
} else if (mode === 'spawn-storm') {
  for (let index = 0; index < 16; index += 1) {
    spawn('/bin/sh', ['-c', 'sleep 10'], { stdio: 'ignore' }).on('error', () => {});
  }
  hold();
} else if (mode === 'output-flood') {
  const chunk = 'x'.repeat(8 * 1024);
  const timer = setInterval(() => {
    process.stdout.write(chunk);
    process.stderr.write(chunk);
  }, 1);
  timer.unref();
  hold();
} else if (mode === 'temp-growth') {
  const directory = process.env.LAMINA_SAFE_RUNNER_TEMP;
  if (!directory) throw new Error('LAMINA_SAFE_RUNNER_TEMP is required');
  const descriptor = fs.openSync(path.join(directory, 'growth.bin'), 'w', 0o600);
  const block = Buffer.alloc(256 * 1024, 0x7f);
  setInterval(() => fs.writeSync(descriptor, block), 5);
} else if (mode === 'signal-controller') {
  const controller = Number(process.env.LAMINA_SAFE_RUNNER_CONTROLLER_PID);
  setTimeout(() => process.kill(controller, 'SIGINT'), 100);
  hold();
} else if (mode === 'detached-child') {
  spawn(process.execPath, [new URL(import.meta.url).pathname, 'socket-child'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  setTimeout(() => process.exit(0), 250);
} else if (mode === 'socket-child') {
  const socket = path.join(process.env.LAMINA_SAFE_RUNNER_TEMP, 'detached.sock');
  try { fs.rmSync(socket, { force: true }); } catch {}
  net.createServer(() => {}).listen(socket);
  process.on('SIGTERM', () => {});
  hold();
} else if (mode === 'success') {
  setTimeout(() => process.stdout.write('tiny success\n'), 150);
} else if (mode === 'failure') {
  process.stderr.write('tiny failure\n');
  process.exit(7);
} else {
  process.stderr.write(`unknown adversary mode: ${mode}\n`);
  process.exit(64);
}
