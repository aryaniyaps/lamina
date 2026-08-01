#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const mode = process.argv[2];
const hold = () => setInterval(() => {}, 1_000);

function allocateBounded(blockCount, fill, intervalMs) {
  const blocks = [];
  setInterval(() => {
    // Keep the interval (and therefore the bounded block array) live so the
    // allocation remains resident long enough for sustained sampling.
    if (blocks.length >= blockCount) return;
    const block = Buffer.alloc(16 * 1024 * 1024, fill);
    for (let index = 0; index < block.length; index += 4096) block[index] = index % 251;
    blocks.push(block);
  }, intervalMs);
}

if (mode === 'direct-memory') {
  allocateBounded(12, 0x5a, 10);
} else if (mode === 'aggregate-memory') {
  for (let index = 0; index < 2; index += 1) {
    spawn(process.execPath, [new URL(import.meta.url).pathname, 'memory-child'], { stdio: 'ignore' });
  }
  hold();
} else if (mode === 'memory-child') {
  allocateBounded(8, 0x3c, 20);
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
  const timer = setInterval(() => {
    try { fs.writeSync(descriptor, block); } catch (error) {
      if (error.code !== 'ENOSPC') throw error;
      clearInterval(timer);
      hold();
    }
  }, 5);
} else if (mode === 'temp-deleted-open') {
  const file = path.join(process.env.LAMINA_SAFE_RUNNER_TEMP, 'deleted-open.bin');
  const descriptor = fs.openSync(file, 'w', 0o600);
  fs.unlinkSync(file);
  const block = Buffer.alloc(256 * 1024, 0x55);
  while (true) {
    try { fs.writeSync(descriptor, block); } catch (error) {
      if (error.code !== 'ENOSPC') throw error;
      break;
    }
  }
  hold();
} else if (mode === 'temp-inode-storm') {
  const directory = process.env.LAMINA_SAFE_RUNNER_TEMP;
  for (let index = 0; index < 2_000; index += 1) {
    fs.closeSync(fs.openSync(path.join(directory, `inode-${index}`), 'w'));
  }
  hold();
} else if (mode === 'temp-symlink') {
  fs.symlinkSync(process.cwd(), path.join(process.env.LAMINA_SAFE_RUNNER_TEMP, 'escape'));
  hold();
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
} else if (mode === 'secret-output') {
  process.stdout.write('Authorization: Bearer supersecret\n');
  setTimeout(() => process.exit(0), 100);
} else if (mode === 'failure') {
  process.stderr.write('tiny failure\n');
  process.exit(7);
} else {
  process.stderr.write(`unknown adversary mode: ${mode}\n`);
  process.exit(64);
}
