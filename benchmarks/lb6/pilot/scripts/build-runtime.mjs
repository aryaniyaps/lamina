#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENT_RUNTIME_IMAGE, CURSOR_CLI_SHA256, CURSOR_CLI_VERSION } from '../lib/constants.mjs';
import { applyBenchEnv } from '../../../lib/load-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
applyBenchEnv(ROOT);

const pilotRoot = path.join(ROOT, 'benchmarks/lb6/pilot');
const runtimeRoot = path.join(pilotRoot, 'runtime');
const dockerfile = path.join(runtimeRoot, 'Dockerfile');
if (!fs.existsSync(dockerfile)) throw new Error('runtime Dockerfile missing; run build-pilot.mjs first');

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function dockerRuntimeArch() {
  try {
    return execFileSync('docker', ['info', '--format', '{{.Architecture}}'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  }
}

function linuxDownloadArch() {
  const arch = dockerRuntimeArch();
  if (arch === 'aarch64' || arch === 'arm64') return 'arm64';
  if (arch === 'x86_64' || arch === 'amd64') return 'x64';
  throw new Error(`unsupported Docker architecture for Cursor CLI pin: ${arch}`);
}

function pinnedLinuxVersionDir() {
  return path.join(os.homedir(), '.local/share/cursor-agent/versions-linux', CURSOR_CLI_VERSION);
}

function ensurePinnedLinuxCursorCli() {
  const dest = pinnedLinuxVersionDir();
  const binary = path.join(dest, 'cursor-agent');
  if (fs.existsSync(binary) && hashFile(binary) === CURSOR_CLI_SHA256) {
    // Prefer a directory that already reports the pinned version string inside Linux.
    return dest;
  }

  const downloadArch = linuxDownloadArch();
  const url =
    `https://downloads.cursor.com/lab/${CURSOR_CLI_VERSION}/linux/${downloadArch}/agent-cli-package.tar.gz`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb6-cursor-linux-'));
  const tarball = path.join(tmp, 'agent-cli-package.tar.gz');
  try {
    console.log(`Fetching pinned Linux Cursor CLI: ${url}`);
    execFileSync('curl', ['-L', '--fail', url, '-o', tarball], { stdio: 'inherit' });
    execFileSync('tar', ['-xzf', tarball, '-C', tmp], { stdio: 'inherit' });
    const extracted = path.join(tmp, 'dist-package');
    const extractedBinary = path.join(extracted, 'cursor-agent');
    if (!fs.existsSync(extractedBinary)) {
      throw new Error(`downloaded Cursor CLI package missing cursor-agent (${url})`);
    }
    if (hashFile(extractedBinary) !== CURSOR_CLI_SHA256) {
      throw new Error('downloaded Cursor CLI wrapper hash mismatch');
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(extracted, dest, { recursive: true });
    return dest;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function resolveCursorVersionDir() {
  // Docker runtime is Linux; on macOS/Windows hosts the local install is the wrong ELF.
  // Always bake the pinned Linux package into the agent image.
  if (process.platform !== 'linux' || process.env.LB6_FORCE_LINUX_CURSOR_CLI === '1') {
    return ensurePinnedLinuxCursorCli();
  }

  const candidates = [];
  if (process.env.CURSOR_AGENT_VERSION_DIR) {
    candidates.push(process.env.CURSOR_AGENT_VERSION_DIR);
  }
  candidates.push(pinnedLinuxVersionDir());
  const versionsRoot = path.join(os.homedir(), '.local/share/cursor-agent/versions');
  candidates.push(path.join(versionsRoot, CURSOR_CLI_VERSION));
  if (fs.existsSync(versionsRoot)) {
    for (const name of fs.readdirSync(versionsRoot).sort().reverse()) {
      candidates.push(path.join(versionsRoot, name));
    }
  }

  const seen = new Set();
  for (const dir of candidates) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const binary = path.join(dir, 'cursor-agent');
    if (!fs.existsSync(binary)) continue;
    if (hashFile(binary) !== CURSOR_CLI_SHA256) continue;
    return dir;
  }

  return ensurePinnedLinuxCursorCli();
}

const cursorVersionDir = resolveCursorVersionDir();
const cursorBinary = path.join(cursorVersionDir, 'cursor-agent');
const observedCursorHash = hashFile(cursorBinary);
if (observedCursorHash !== CURSOR_CLI_SHA256) throw new Error('pinned Cursor CLI binary hash mismatch');

const dockerfileHash = hashFile(dockerfile);
const manifestPath = path.join(pilotRoot, 'agent-runtime.manifest.json');
let prior = null;
try { prior = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
let imageId = '';
try { imageId = execFileSync('docker', ['image', 'inspect', AGENT_RUNTIME_IMAGE, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim(); } catch {}
const contentFingerprint = crypto
  .createHash('sha256')
  .update(`${dockerfileHash}\n${CURSOR_CLI_SHA256}\n${cursorVersionDir}\n`)
  .digest('hex');
if (
  !imageId
  || prior?.dockerfile_sha256 !== dockerfileHash
  || prior?.cursor_cli_sha256 !== CURSOR_CLI_SHA256
  || prior?.content_fingerprint !== contentFingerprint
) {
  const context = fs.mkdtempSync(path.join(os.tmpdir(), 'lb6-agent-runtime-'));
  try {
    fs.copyFileSync(dockerfile, path.join(context, 'Dockerfile'));
    fs.cpSync(cursorVersionDir, path.join(context, 'cursor-agent-version'), { recursive: true });
    execFileSync('docker', ['build', '--pull=false', '--tag', AGENT_RUNTIME_IMAGE, context], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } finally {
    fs.rmSync(context, { recursive: true, force: true });
  }
  imageId = execFileSync('docker', ['image', 'inspect', AGENT_RUNTIME_IMAGE, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
}
if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('agent runtime image is not immutable');
fs.writeFileSync(
  manifestPath,
  `${JSON.stringify({
    image: AGENT_RUNTIME_IMAGE,
    image_id: imageId,
    dockerfile_sha256: dockerfileHash,
    cursor_cli_version: CURSOR_CLI_VERSION,
    cursor_cli_sha256: CURSOR_CLI_SHA256,
    content_fingerprint: contentFingerprint,
  }, null, 2)}\n`,
);
console.log(`LB6 agent runtime ready: ${AGENT_RUNTIME_IMAGE}@${imageId}`);
console.log(`Cursor CLI source: ${cursorVersionDir}`);
