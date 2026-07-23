#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const pilotRoot = path.join(ROOT, 'benchmarks/lb6/pilot');
const forkRoot = path.join(ROOT, 'benchmarks/lb6/harbor-fork');
const tasksRoot = path.join(pilotRoot, 'harbor/tasks');
const privateRoot = path.join(pilotRoot, 'private-verifier');
const verifierImage = process.env.LB6_VERIFIER_IMAGE
  || 'node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0';
const errors = [];

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

for (const file of ['sitecustomize.py', 'lb6_harbor_patch.py']) {
  const target = path.join(forkRoot, file);
  if (!fs.existsSync(target)) errors.push(`missing Harbor patch ${file}`);
}

for (const taskName of fs.existsSync(tasksRoot) ? fs.readdirSync(tasksRoot) : []) {
  const taskDir = path.join(tasksRoot, taskName);
  if (!fs.statSync(taskDir).isDirectory()) continue;
  const toml = fs.readFileSync(path.join(taskDir, 'task.toml'), 'utf8');
  if (!toml.includes('host_sealed_supervisor_required = true')) {
    errors.push(`${taskName}: supervisor requirement missing`);
  }
  for (const step of fs.readdirSync(path.join(taskDir, 'steps'))) {
    const testsDir = path.join(taskDir, 'steps', step, 'tests');
    const files = fs.readdirSync(testsDir);
    if (files.join(',') !== 'test.sh') errors.push(`${taskName}/${step}: private verifier material in task tree`);
  }
}

if (!fs.existsSync(privateRoot)) errors.push('private verifier root missing');

try {
  const version = execFileSync('harbor', ['--version'], { encoding: 'utf8' });
  if (!/0\.18\.0/.test(version)) errors.push(`expected Harbor 0.18.0, observed ${version.trim()}`);
} catch (error) {
  errors.push(`Harbor version check failed: ${error.message}`);
}

let verifierImageId = null;
try {
  verifierImageId = execFileSync(
    'docker',
    ['image', 'inspect', verifierImage, '--format', '{{.Id}}'],
    { encoding: 'utf8' },
  ).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(verifierImageId)) errors.push('verifier image ID is not immutable');
} catch (error) {
  errors.push(`pinned verifier image unavailable: ${verifierImage}`);
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

const manifest = {
  kind: 'lb6-host-seal-runtime',
  harbor_version: '0.18.0',
  patch_version: 'lb6-host-seal-v1',
  patch_sha256: hashFile(path.join(forkRoot, 'lb6_harbor_patch.py')),
  sitecustomize_sha256: hashFile(path.join(forkRoot, 'sitecustomize.py')),
  verifier_image: verifierImage,
  verifier_image_id: verifierImageId,
  task_tests_secret_free: true,
};
fs.writeFileSync(path.join(pilotRoot, 'isolation-runtime.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`LB6 isolation runtime valid: patch=${manifest.patch_sha256.slice(0, 12)} verifier=${verifierImageId}`);
