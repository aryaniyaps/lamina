#!/usr/bin/env node
/* Validate a locally staged release exactly as the public shell installer uses it. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform === 'win32') {
  console.log('release_artifact_smoke_test: Windows installer is covered by workflow source checks');
  process.exit(0);
}
const release = process.env.LAMINA_RELEASE_DIR;
if (!release) {
  console.log('release_artifact_smoke_test: set LAMINA_RELEASE_DIR to validate staged assets');
  process.exit(0);
}
const target = `${process.platform}-${process.arch}`;
const binaryName = `lamina-${target}`;
const workerName = `lamina-cocoindex-worker-${target}`;
for (const name of [binaryName, workerName, 'SHA256SUMS']) assert.ok(fs.existsSync(path.join(release, name)), `missing release asset ${name}`);
const lines = fs.readFileSync(path.join(release, 'SHA256SUMS'), 'utf8');
for (const name of [binaryName, workerName]) {
  // GitHub assets use bare names; accepting an absolute staging path keeps
  // this test convenient for local release rehearsal too.
  const expected = lines.match(new RegExp(`^([a-f0-9]{64})  (?:.*\\/)?${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`, 'm'))?.[1];
  assert.ok(expected, `missing checksum for ${name}`);
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(release, name))).digest('hex'), expected);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-release-smoke-'));
try {
  const installDir = path.join(temp, 'bin');
  const cache = path.join(temp, 'cache');
  const installed = spawnSync('sh', [path.resolve('scripts/install.sh')], {
    encoding: 'utf8', env: { ...process.env, LAMINA_RELEASE_BASE: `file://${release}`, LAMINA_INSTALL_DIR: installDir, XDG_CACHE_HOME: cache, PATH: process.env.PATH },
  });
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  const version = spawnSync(path.join(installDir, 'lamina'), ['--version'], { encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: cache } });
  assert.equal(version.status, 0, version.stderr);
  const privateWorker = path.join(cache, 'lamina', 'runtime', version.stdout.trim(), target, 'app', 'observation-runtime', 'cocoindex-worker');
  assert.equal(fs.existsSync(privateWorker), true);
  const entries = fs.readdirSync(path.dirname(privateWorker));
  assert.deepEqual(entries, ['cocoindex-worker']);

  const corrupt = path.join(temp, 'corrupt');
  fs.cpSync(release, corrupt, { recursive: true });
  fs.appendFileSync(path.join(corrupt, workerName), 'tampered');
  const rejected = spawnSync('sh', [path.resolve('scripts/install.sh')], {
    encoding: 'utf8', env: { ...process.env, LAMINA_RELEASE_BASE: `file://${corrupt}`, LAMINA_INSTALL_DIR: path.join(temp, 'bad-bin'), XDG_CACHE_HOME: path.join(temp, 'bad-cache'), PATH: process.env.PATH },
  });
  assert.notEqual(rejected.status, 0, 'installer must reject a tampered worker');
  assert.match(rejected.stderr, /checksum verification failed for managed CocoIndex worker/i);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log('release_artifact_smoke_test: ok');
