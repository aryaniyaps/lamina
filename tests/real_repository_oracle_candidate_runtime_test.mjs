#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildCandidateRuntimeSnapshot,
  verifyCandidateRuntimeSnapshot,
} from '../benchmarks/real-repository-oracle-v1/candidate-runtime-closure.mjs';

if (process.platform !== 'linux') {
  console.log('real repository oracle candidate runtime requires Linux; portable skip');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_BUILDER_HELPER = path.join(
  ROOT, 'tests/fixtures/real-repository-runtime-builder-helper.mjs',
);
const temporary = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-candidate-runtime-test-'),
));
fs.chmodSync(temporary, 0o700);

let runtimeBuilderHelper;
try {
  const replacedExecutable = path.join(temporary, 'replaceable-running-node');
  fs.copyFileSync(process.execPath, replacedExecutable);
  fs.chmodSync(replacedExecutable, 0o500);
  const runningExecutableStat = fs.statSync(replacedExecutable, { bigint: true });
  const replacementSnapshotRoot = path.join(temporary, 'replaced-path-runtime');
  runtimeBuilderHelper = spawn(replacedExecutable, [
    RUNTIME_BUILDER_HELPER, replacementSnapshotRoot,
  ], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  let builderOutput = '';
  let builderError = '';
  runtimeBuilderHelper.stdout.on('data', (chunk) => { builderOutput += chunk.toString('utf8'); });
  runtimeBuilderHelper.stderr.on('data', (chunk) => { builderError += chunk.toString('utf8'); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`runtime builder timeout: ${builderError}`)), 5_000);
    const ready = (chunk) => {
      if (!builderOutput.includes('READY\n') && !chunk.toString('utf8').includes('READY\n')) return;
      clearTimeout(timer);
      runtimeBuilderHelper.stdout.off('data', ready);
      resolve();
    };
    runtimeBuilderHelper.stdout.on('data', ready);
    runtimeBuilderHelper.once('error', reject);
    runtimeBuilderHelper.once('exit', (code, signal) => reject(new Error(
      `runtime builder exited before READY: ${code}/${signal}: ${builderError}`,
    )));
  });
  const heldExecutable = `${replacedExecutable}.held`;
  fs.renameSync(replacedExecutable, heldExecutable);
  fs.copyFileSync(heldExecutable, replacedExecutable);
  fs.chmodSync(replacedExecutable, 0o500);
  assert.notEqual(String(fs.statSync(replacedExecutable, { bigint: true }).ino),
    String(runningExecutableStat.ino));
  const builderPid = runtimeBuilderHelper.pid;
  const builderExit = new Promise((resolve, reject) => {
    runtimeBuilderHelper.once('error', reject);
    runtimeBuilderHelper.once('exit', (code, signal) => code === 0
      ? resolve() : reject(new Error(`runtime builder failed: ${code}/${signal}: ${builderError}`)));
  });
  runtimeBuilderHelper.stdin.end('GO\n');
  await builderExit;
  runtimeBuilderHelper = null;
  const builderResult = JSON.parse(builderOutput.trim().split('\n').at(-1));
  assert.equal(builderResult.authority, 'running-process-image-fd');
  assert.equal(builderResult.pid, builderPid);
  assert.equal(builderResult.source_ino, String(runningExecutableStat.ino));
  assert.equal(builderResult.source_digest, crypto.createHash('sha256')
    .update(fs.readFileSync(heldExecutable)).digest('hex'));
  assert.equal(builderResult.sealed_digest, builderResult.source_digest,
    'runtime sealing follows the kernel-held executable inode, not its replaced pathname');

  const runtime = buildCandidateRuntimeSnapshot({
    snapshot_root: path.join(temporary, 'runtime'),
  });
  assert.equal(verifyCandidateRuntimeSnapshot(runtime), runtime);
  assert.ok(runtime.files.some((item) => item.role === 'node'));
  assert.ok(runtime.files.some((item) => item.role === 'loader'));
  assert.ok(runtime.files.filter((item) => item.role === 'library').length >= 1);
  assert.match(runtime.closure_sha256, /^[a-f0-9]{64}$/);
  assert.equal(runtime.builder_identities.node.authority, 'running-process-image-fd');
  assert.equal(runtime.builder_identities.node.pid, process.pid);
  for (const field of ['dev', 'ino', 'uid', 'nlink', 'mode', 'bytes', 'sha256']) {
    assert.ok(Object.hasOwn(runtime.records[0], field), `runtime records retain exact ${field}`);
  }

  console.log('real repository oracle candidate runtime closure passed');
} finally {
  if (runtimeBuilderHelper?.exitCode === null && runtimeBuilderHelper?.signalCode === null) {
    try { runtimeBuilderHelper.kill('SIGKILL'); } catch {}
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
