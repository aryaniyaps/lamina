#!/usr/bin/env node
/* Build one native Node SEA. Run this on the target operating system/CPU. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'packages/cli');
const dist = path.resolve(process.env.LAMINA_DIST_DIR || path.join(root, 'dist'));
const target = process.env.LAMINA_SEA_TARGET || `${process.platform}-${process.arch}`;
const supported = new Set(['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64']);
if (!supported.has(target)) throw new Error(`Unsupported standalone target ${target}.`);
const nativeTarget = `${process.platform}-${process.arch}`;
if (target !== nativeTarget) {
  throw new Error(`CocoIndex workers must be built natively; requested ${target} on ${nativeTarget}.`);
}
const version = JSON.parse(fs.readFileSync(path.join(cli, 'package.json'))).version;
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-sea-'));
const payload = path.join(stage, 'payload');
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, dereference: true });

function usableNode(candidate) {
  try {
    // Distribution launchers such as Debian's /usr/bin/node are a tiny shim
    // around libnode. SEA injection needs the complete executable, including
    // the sentinel fuse, not that shim.
    return candidate && fs.statSync(candidate).isFile() && fs.statSync(candidate).size > 10_000_000;
  } catch { return false; }
}

function seaNode() {
  if (process.env.LAMINA_NODE_BINARY) {
    if (!usableNode(process.env.LAMINA_NODE_BINARY)) {
      throw new Error(`LAMINA_NODE_BINARY is not a full SEA-capable Node executable: ${process.env.LAMINA_NODE_BINARY}`);
    }
    return process.env.LAMINA_NODE_BINARY;
  }
  if (usableNode(process.execPath)) return process.execPath;
  // Developers commonly have an official Node installation managed by nvm
  // while their shell resolves a distro launcher first. Prefer its newest
  // installed version before asking for an explicit override.
  const nvmVersions = process.env.NVM_DIR && path.join(process.env.NVM_DIR, 'versions', 'node');
  if (nvmVersions && fs.existsSync(nvmVersions)) {
    const candidate = fs.readdirSync(nvmVersions).sort().reverse()
      .map((versionDir) => path.join(nvmVersions, versionDir, 'bin', process.platform === 'win32' ? 'node.exe' : 'node'))
      .find(usableNode);
    if (candidate) return candidate;
  }
  throw new Error('A full Node executable is required to build a standalone Lamina binary. Install an official Node release or set LAMINA_NODE_BINARY.');
}

function buildManagedCocoWorker() {
  const uv = process.env.LAMINA_UV_BINARY || (process.platform === 'win32' ? 'uv.exe' : 'uv');
  const extension = process.platform === 'win32' ? '.exe' : '';
  const worker = path.join(dist, `lamina-cocoindex-worker-${target}${extension}`);
  const build = spawnSync(uv, ['run', '--locked', '--project', cli, '--python', '3.13', '--with', 'pyinstaller==6.14.1', 'pyinstaller', '--noconfirm', '--clean', '--onefile', '--name', 'cocoindex-worker', '--collect-all', 'cocoindex', '--collect-all', 'watchdog', '--collect-all', 'numpy', '--distpath', stage, '--workpath', path.join(stage, 'pyinstaller-work'), path.join(cli, 'cocoindex_worker.py')], { cwd: root, encoding: 'utf8' });
  if (build.error || build.status !== 0) throw new Error(`Unable to build managed CocoIndex worker: ${build.error?.message || build.stderr || build.stdout}`);
  fs.mkdirSync(dist, { recursive: true });
  fs.copyFileSync(path.join(stage, `cocoindex-worker${extension}`), worker);
  if (process.platform !== 'win32') fs.chmodSync(worker, 0o755);
  return worker;
}

try {
  copy(path.join(cli, 'bin'), path.join(payload, 'app/bin'));
  copy(path.join(cli, 'lib'), path.join(payload, 'app/lib'));
  // The PyInstaller worker is published as a separate asset. The standalone
  // executable only needs the observation definition, never Python, uv, a
  // lockfile, or a virtual environment.
  for (const name of ['cocoindex_app.py', 'package.json']) copy(path.join(cli, name), path.join(payload, 'app', name));
  copy(path.join(cli, 'node_modules/@ladybugdb/core'), path.join(payload, 'node_modules/@ladybugdb/core'));
  const files = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else { const relative = path.relative(payload, full); files.push({ path: relative, asset: `payload/${relative}`, mode: fs.statSync(full).mode & 0o777 }); } } };
  walk(payload);
  const digest = createHash('sha256').update(files.map((f) => `${f.path}:${createHash('sha256').update(fs.readFileSync(path.join(payload, f.path))).digest('hex')}`).join('\n')).digest('hex');
  const manifest = { version, target, digest, files };
  const manifestPath = path.join(stage, 'manifest.json'); fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const assets = { 'lamina-manifest': manifestPath };
  for (const file of files) assets[file.asset] = path.join(payload, file.path);
  const config = { main: path.join(cli, 'sea/bootstrap.cjs'), output: path.join(stage, 'sea-prep.blob'), disableExperimentalSEAWarning: true, useCodeCache: false, assets };
  const configPath = path.join(stage, 'sea-config.json'); fs.writeFileSync(configPath, JSON.stringify(config));
  const node = seaNode();
  const prep = spawnSync(node, ['--experimental-sea-config', configPath], { cwd: root, encoding: 'utf8' });
  if (prep.status !== 0) throw new Error(prep.stderr || prep.stdout);
  fs.mkdirSync(dist, { recursive: true });
  const ext = target.startsWith('win32') ? '.exe' : '';
  const out = path.join(dist, `lamina-${target}${ext}`);
  fs.copyFileSync(node, out);
  // Run postject with the same full Node selected for SEA creation.
  const inject = spawnSync(node, [path.join(root, 'node_modules', 'postject', 'dist', 'cli.js'), out, 'NODE_SEA_BLOB', path.join(stage, 'sea-prep.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], { cwd: root, encoding: 'utf8' });
  if (inject.status !== 0) throw new Error(inject.stderr || inject.stdout);
  if (process.platform !== 'win32') fs.chmodSync(out, 0o755);
  const smoke = spawnSync(out, ['--version'], {
    encoding: 'utf8',
    env: { ...process.env, XDG_CACHE_HOME: path.join(stage, 'cache') },
  });
  if (smoke.status !== 0 || smoke.stdout.trim() !== version) {
    throw new Error(`Standalone executable smoke failed: ${smoke.stderr || smoke.stdout}`);
  }
  const observationWorker = buildManagedCocoWorker();
  process.stdout.write(`${out}\n${observationWorker}\n`);
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
