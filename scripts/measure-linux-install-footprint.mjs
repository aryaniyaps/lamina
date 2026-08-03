#!/usr/bin/env node
/** Measure mandatory installed Lamina footprint for Linux release qualification (#77). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MAX_INSTALL_FOOTPRINT_BYTES } from '../packages/cli/lib/runtime-lifecycle.mjs';

const release = process.env.LAMINA_RELEASE_DIR;
if (!release) {
  console.log('measure-linux-install-footprint: set LAMINA_RELEASE_DIR to staged release assets');
  process.exit(0);
}

if (process.platform !== 'linux') {
  console.log('measure-linux-install-footprint: Linux-only qualification path');
  process.exit(0);
}

const target = `${process.platform}-${process.arch}`;
const binaryName = `lamina-${target}`;
const workerName = `lamina-cocoindex-worker-${target}`;
const modelName = 'lamina-retrieval-model-int8-v1.onnx';
for (const name of [binaryName, workerName, modelName, 'SHA256SUMS', 'install.sh']) {
  assert.ok(fs.existsSync(path.join(release, name)), `missing release asset ${name}`);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-footprint-'));
const installDir = path.join(temp, 'bin');
const cache = path.join(temp, 'cache');
const installed = spawnSync('sh', [path.resolve('scripts/install.sh')], {
  encoding: 'utf8',
  env: {
    ...process.env,
    LAMINA_RELEASE_BASE: `file://${release}`,
    LAMINA_INSTALL_DIR: installDir,
    XDG_CACHE_HOME: cache,
    PATH: process.env.PATH,
  },
});
assert.equal(installed.status, 0, installed.stderr || installed.stdout);

function directoryBytes(root) {
  let bytes = 0;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) bytes += fs.statSync(full).size;
    }
  };
  if (fs.existsSync(root)) visit(root);
  return bytes;
}

const binaryBytes = directoryBytes(installDir);
const runtimeBytes = directoryBytes(path.join(cache, 'lamina'));
const totalBytes = binaryBytes + runtimeBytes;

const report = {
  schema: 'lamina.linux-install-footprint/v1',
  target,
  binary_bytes: binaryBytes,
  runtime_cache_bytes: runtimeBytes,
  total_bytes: totalBytes,
  max_bytes: MAX_INSTALL_FOOTPRINT_BYTES,
  within_limit: totalBytes <= MAX_INSTALL_FOOTPRINT_BYTES,
};

assert.ok(report.within_limit, JSON.stringify(report));
fs.rmSync(temp, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(report)}\n`);
