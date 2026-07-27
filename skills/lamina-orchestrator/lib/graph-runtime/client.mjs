import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { GRAPH_PROTOCOL_VERSION } from './constants.mjs';
import { graphSocketPath, runtimePaths } from './util.mjs';

function exchange(socketPath, payload, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for graphd.'));
    }, timeout);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      clearTimeout(timer);
      socket.end();
      try { resolve(JSON.parse(buffer.slice(0, newline))); } catch (error) { reject(error); }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function waitForServer(paths) {
  const socketPath = graphSocketPath(paths);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(socketPath)) {
      try {
        const response = await exchange(socketPath, { id: 'ready', method: 'ping', cwd: paths.root }, 1_000);
        if (response.ok && response.result?.protocol_version === GRAPH_PROTOCOL_VERSION) return;
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`graphd did not become ready at ${paths.socket}`);
}

async function stopIncompatibleServer(paths) {
  const socketPath = graphSocketPath(paths);
  let pid = null;
  try { pid = Number(fs.readFileSync(paths.lock, 'utf8').trim()); } catch {}
  if (Number.isInteger(pid) && pid > 1) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && fs.existsSync(socketPath)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function ensureGraphd(cwd = process.cwd()) {
  const paths = runtimePaths(cwd);
  const socketPath = graphSocketPath(paths);
  try {
    const response = await exchange(socketPath, { id: 'ping', method: 'ping', cwd }, 500);
    if (response.ok && response.result?.protocol_version === GRAPH_PROTOCOL_VERSION) return paths;
    if (response.ok) await stopIncompatibleServer(paths);
  } catch {}
  const server = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'server.mjs');
  const child = spawn(process.execPath, [server, paths.root], {
    detached: true,
    stdio: 'ignore',
    cwd: paths.root,
  });
  child.unref();
  await waitForServer(paths);
  return paths;
}

export async function graphRequest(method, params = {}, cwd = process.cwd()) {
  const paths = await ensureGraphd(cwd);
  const response = await exchange(graphSocketPath(paths), {
    id: `${process.pid}-${Date.now()}`,
    method,
    params,
    cwd,
  });
  if (!response.ok) {
    const error = new Error(response.error.message);
    error.code = response.error.code;
    error.details = response.error.details;
    throw error;
  }
  return response.result;
}
