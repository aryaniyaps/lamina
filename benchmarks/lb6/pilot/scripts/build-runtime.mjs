#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENT_RUNTIME_IMAGE, CURSOR_CLI_SHA256, CURSOR_CLI_VERSION } from '../lib/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const pilotRoot = path.join(ROOT, 'benchmarks/lb6/pilot');
const runtimeRoot = path.join(pilotRoot, 'runtime');
const dockerfile = path.join(runtimeRoot, 'Dockerfile');
if (!fs.existsSync(dockerfile)) throw new Error('runtime Dockerfile missing; run build-pilot.mjs first');

const cursorVersionDir = process.env.CURSOR_AGENT_VERSION_DIR
  || `/home/aryan/.local/share/cursor-agent/versions/${CURSOR_CLI_VERSION}`;
const cursorBinary = path.join(cursorVersionDir, 'cursor-agent');
if (!fs.existsSync(cursorBinary)) throw new Error(`pinned Cursor CLI directory missing: ${cursorVersionDir}`);
const observedCursorHash = crypto.createHash('sha256').update(fs.readFileSync(cursorBinary)).digest('hex');
if (observedCursorHash !== CURSOR_CLI_SHA256) throw new Error('pinned Cursor CLI binary hash mismatch');

const dockerfileHash = crypto.createHash('sha256').update(fs.readFileSync(dockerfile)).digest('hex');
const manifestPath = path.join(pilotRoot, 'agent-runtime.manifest.json');
let prior = null;
try { prior = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
let imageId = '';
try { imageId = execFileSync('docker', ['image', 'inspect', AGENT_RUNTIME_IMAGE, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim(); } catch {}
if (!imageId || prior?.dockerfile_sha256 !== dockerfileHash || prior?.cursor_cli_sha256 !== CURSOR_CLI_SHA256) {
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
  }, null, 2)}\n`,
);
console.log(`LB6 agent runtime ready: ${AGENT_RUNTIME_IMAGE}@${imageId}`);
