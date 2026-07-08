import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

export function defaultStateFile(blueprintRoot) {
  return path.join(path.resolve(blueprintRoot, '..'), 'preview-state.yaml');
}

export function previewUrl(port, id, runId) {
  const params = new URLSearchParams();
  if (runId) params.set('run', runId);
  if (id) params.set('id', id);
  const q = params.toString();
  return `http://localhost:${port}${q ? `?${q}` : ''}`;
}

function parseStateYaml(source) {
  const state = {};
  for (const line of source.split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (m[1] === 'port' || m[1] === 'pid') state[m[1]] = Number(val);
    else state[m[1]] = val;
  }
  return state;
}

export function readPreviewState(stateFile) {
  if (!fs.existsSync(stateFile)) return null;
  return parseStateYaml(fs.readFileSync(stateFile, 'utf8'));
}

export function writePreviewState(stateFile, state) {
  const dir = path.dirname(stateFile);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    `id: ${state.id}`,
    `port: ${state.port}`,
    `url: "${state.url}"`,
    `pid: ${state.pid}`,
    `root: "${state.root.replace(/\\/g, '/')}"`,
    `startedAt: "${state.startedAt}"`,
  ];
  fs.writeFileSync(stateFile, `${lines.join('\n')}\n`);
}

export function isProcessAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function healthCheck(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/__lamina/config`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function findAvailablePort(startPort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await healthCheck(port)) continue;
    return port;
  }
  return startPort;
}

export function openInBrowser(url) {
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

export function spawnPreviewServer({ root, id, runId, port, detached }) {
  const configPath = path.join(os.tmpdir(), `lamina-studio-${port}.json`);
  fs.writeFileSync(configPath, JSON.stringify({ root, id, runId, port }));

  const viteBin = path.join(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const configFile = path.join(packageRoot, 'preview', 'vite.config.ts');

  return spawn(process.execPath, [viteBin, '--config', configFile, '--port', String(port)], {
    cwd: packageRoot,
    stdio: detached ? 'ignore' : 'inherit',
    detached,
    env: {
      ...process.env,
      SUB_PREVIEW: '1',
      LAMINA_BLUEPRINT_CONFIG: configPath,
    },
  });
}

export async function ensurePreviewRunning({
  root,
  id,
  runId,
  port,
  stateFile,
  open,
  foreground,
}) {
  const existing = readPreviewState(stateFile);
  if (existing?.port && existing?.pid && isProcessAlive(existing.pid)) {
    const healthy = await healthCheck(existing.port);
    if (healthy) {
      const url = previewUrl(existing.port, existing.id ?? id, runId ?? existing.runId);
      console.log(`Lamina UX Review Studio (already running)`);
      console.log(`  Run:       ${runId ?? existing.runId ?? '—'}`);
      console.log(`  Blueprint: ${existing.id ?? id}`);
      console.log(`  URL:       ${url}`);
      console.log(`  State:     ${stateFile}`);
      if (open) openInBrowser(url);
      return { url, port: existing.port, pid: existing.pid, reused: true };
    }
  }

  const resolvedPort = await findAvailablePort(port);
  const url = previewUrl(resolvedPort, id, runId);
  const startedAt = new Date().toISOString();

  if (foreground) {
    console.log(`Lamina UX Review Studio`);
    console.log(`  Run:       ${runId ?? '—'}`);
    console.log(`  Blueprint: ${id}`);
    console.log(`  URL:       ${url}`);
    if (open) openInBrowser(url);

    const child = spawnPreviewServer({ root, id, runId, port: resolvedPort, detached: false });
    writePreviewState(stateFile, {
      id,
      runId,
      port: resolvedPort,
      url,
      pid: child.pid,
      root,
      startedAt,
    });

    await new Promise((resolve, reject) => {
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`vite exited ${code}`)),
      );
    });
    return { url, port: resolvedPort, pid: child.pid, reused: false };
  }

  const child = spawnPreviewServer({ root, id, runId, port: resolvedPort, detached: true });
  child.unref();

  writePreviewState(stateFile, {
    id,
    runId,
    port: resolvedPort,
    url,
    pid: child.pid,
    root,
    startedAt,
  });

  for (let i = 0; i < 30; i++) {
    if (await healthCheck(resolvedPort)) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (open) openInBrowser(url);

  console.log(`Lamina UX Review Studio (background)`);
  console.log(`  Run:       ${runId ?? '—'}`);
  console.log(`  Blueprint: ${id}`);
  console.log(`  URL:       ${url}`);
  console.log(`  State:     ${stateFile}`);

  return { url, port: resolvedPort, pid: child.pid, reused: false };
}
