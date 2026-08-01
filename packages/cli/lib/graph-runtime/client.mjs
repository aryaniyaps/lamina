import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GRAPH_PROTOCOL_VERSION,
  REQUIRED_GRAPH_CAPABILITIES,
} from './constants.mjs';
import { CLI_VERSION } from '../runtime-identity.mjs';
import { retrievalRuntimeDirectory } from '../retrieval-runtime/assets.mjs';
import { registerManagedGraphdWithSupervisor } from '../safe-runner-context.mjs';
import {
  ensureAuthToken,
  graphSocketPath,
  parseDaemonLock,
  processIsRunning,
  runtimePaths,
} from './util.mjs';

export function daemonCompatibility(identity) {
  const capabilities = new Set(Array.isArray(identity?.capabilities) ? identity.capabilities : []);
  const missingCapabilities = REQUIRED_GRAPH_CAPABILITIES.filter((item) => !capabilities.has(item));
  return {
    compatible: identity?.protocol_version === GRAPH_PROTOCOL_VERSION &&
      identity?.runtime_version === CLI_VERSION &&
      missingCapabilities.length === 0,
    expected_protocol_version: GRAPH_PROTOCOL_VERSION,
    actual_protocol_version: identity?.protocol_version ?? null,
    expected_runtime_version: CLI_VERSION,
    actual_runtime_version: identity?.runtime_version ?? null,
    required_capabilities: [...REQUIRED_GRAPH_CAPABILITIES],
    missing_capabilities: missingCapabilities,
  };
}

function graphdEnvironment() {
  if (process.platform !== 'win32') return process.env;
  // Ladybug loads extensions dynamically. Windows resolves their OpenSSL
  // dependencies from the process search path, which must be established when
  // graphd starts (the extension directory itself is not searched reliably).
  const dependencies = path.join(retrievalRuntimeDirectory(), 'extensions');
  return {
    ...process.env,
    PATH: [dependencies, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
}

export function registerManagedGraphd(child, paths = null) {
  if (process.platform !== 'linux' || !process.env.LAMINA_SAFE_RUNNER_BROKER) return;
  let startTicks = null;
  try {
    const stat = fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    startTicks = stat.slice(close + 2).trim().split(/\s+/)[19] || null;
  } catch {}
  if (!startTicks) return;
  const response = registerManagedGraphdWithSupervisor(
    { pid: child.pid, start_ticks: startTicks },
    paths ? { socket: paths.socket || graphSocketPath(paths), lock: paths.lock } : null,
  );
  if (!response?.ok) {
    try { process.kill(child.pid, 'SIGKILL'); } catch {}
    const error = new Error(`safe-runner refused managed graphd registration: ${response?.error || 'proof broker unavailable'}`);
    error.code = 'LAMINA_SAFE_GRAPHD_UNAUTHORIZED';
    throw error;
  }
  return response.registered;
}

export function exchange(socketPath, payload, timeout = 60_000) {
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

async function waitForServer(paths, token, child = null) {
  const socketPath = graphSocketPath(paths);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      let detail = '';
      try { detail = fs.readFileSync(path.join(paths.runtime_dir, 'graphd.log'), 'utf8').trim(); } catch {}
      throw new Error(
        `graphd exited before becoming ready (status ${child.exitCode}).${detail ? ` ${detail}` : ''}`,
      );
    }
    try {
      const response = await exchange(socketPath, {
        id: 'ready',
        method: 'ping',
        cwd: paths.root,
        auth: token,
      }, 1_000);
      if (response.ok && daemonCompatibility(response.result).compatible) return response.result;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`graphd did not become ready at ${socketPath}`);
}

export async function stopIncompatibleServer(paths, reportedPid = null) {
  let lock = null;
  try { lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8')); } catch {}
  const pid = Number(reportedPid) || lock?.pid || null;
  if (processIsRunning(pid)) {
    try {
      const token = fs.readFileSync(paths.token, 'utf8').trim();
      await exchange(graphSocketPath(paths), {
        id: 'shutdown',
        method: 'shutdown',
        cwd: paths.root,
        auth: token,
      }, 500);
    } catch {}
  }
  let deadline = Date.now() + 2_000;
  while (Date.now() < deadline && processIsRunning(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (processIsRunning(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  deadline = Date.now() + 2_000;
  while (Date.now() < deadline && processIsRunning(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (processIsRunning(pid)) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
    deadline = Date.now() + 5_000;
    while (Date.now() < deadline && processIsRunning(pid)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (processIsRunning(pid)) {
    const error = new Error(`Unable to stop incompatible graphd process ${pid}.`);
    error.code = 'LAMINA_INTERNAL';
    throw error;
  }
}

export async function ensureGraphd(cwd = process.cwd()) {
  const paths = runtimePaths(cwd);
  const socketPath = graphSocketPath(paths);
  const token = ensureAuthToken(paths);
  let response = null;
  try {
    response = await exchange(socketPath, {
      id: 'ping',
      method: 'ping',
      cwd,
      auth: token,
    }, 500);
  } catch {}
  if (response?.ok && daemonCompatibility(response.result).compatible) {
    return { ...paths, auth_token: token, daemon: response.result };
  }
  let lock = null;
  try { lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8')); } catch {}
  if (response || processIsRunning(lock?.pid)) {
    await stopIncompatibleServer(paths, response?.result?.pid);
  }
  const debug = process.env.LAMINA_GRAPHD_DEBUG === '1';
  const logPath = path.join(paths.runtime_dir, 'graphd.log');
  const log = debug ? null : fs.openSync(logPath, 'a', 0o600);
  if (!debug && process.platform !== 'win32') {
    try { fs.chmodSync(logPath, 0o600); } catch {}
  }
  let child;
  try {
    // A standalone build re-enters its own SEA bootstrap.  Source/development
    // execution keeps using the JavaScript server entrypoint.
    const daemonArgs = process.env.LAMINA_STANDALONE === '1'
      ? ['--graphd', paths.root]
      : [path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs'), paths.root];
    const daemonHost = process.env.LAMINA_STANDALONE_GRAPHD_HOST || process.execPath;
    child = spawn(daemonHost, daemonArgs, {
      detached: true,
      stdio: debug ? 'inherit' : ['ignore', 'ignore', log],
      cwd: paths.root,
      env: graphdEnvironment(),
    });
    registerManagedGraphd(child, paths);
  } finally {
    if (log !== null) fs.closeSync(log);
  }
  child.unref();
  const daemon = await waitForServer(paths, token, child);
  return { ...paths, auth_token: token, daemon };
}

export async function graphdIdentity(cwd = process.cwd()) {
  const paths = await ensureGraphd(cwd);
  return paths.daemon;
}

export async function restartGraphd(cwd = process.cwd(), reportedPid = null) {
  const paths = runtimePaths(cwd);
  let pid = reportedPid;
  if (!pid) {
    try {
      const token = ensureAuthToken(paths);
      const response = await exchange(graphSocketPath(paths), {
        id: 'restart-identity',
        method: 'ping',
        cwd,
        auth: token,
      }, 500);
      pid = response?.result?.pid;
    } catch {}
  }
  await stopIncompatibleServer(paths, pid);
  return ensureGraphd(cwd);
}

export async function graphRequest(method, params = {}, cwd = process.cwd()) {
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const paths = await ensureGraphd(cwd);
    try {
      response = await exchange(graphSocketPath(paths), {
        id: `${process.pid}-${Date.now()}-${attempt}`,
        method,
        params,
        cwd,
        auth: paths.auth_token,
      });
      break;
    } catch (error) {
      // A daemon can exit after its readiness ping but before the first client
      // connects. These errors occur before request delivery, so one normal
      // ensureGraphd cycle is safe; never replay a request after an established
      // connection may have reached graphd.
      if (
        attempt > 0 ||
        !['ENOENT', 'ECONNREFUSED'].includes(error.code)
      ) {
        throw error;
      }
    }
  }
  if (!response.ok) {
    const requestError = new Error(response.error.message);
    requestError.code = response.error.code;
    requestError.details = response.error.details;
    throw requestError;
  }
  return response.result;
}
