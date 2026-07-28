#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { platformSupport } from '../packages/cli/lib/doctor.mjs';
import {
  ensureAuthToken,
  graphSocketPath,
  runtimePaths,
} from '../packages/cli/lib/graph-runtime/util.mjs';

const cli = path.resolve('packages/cli/bin/lamina.mjs');
let result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.equal(result.stdout.trim(), '0.1.6');

const nongit = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-doctor-'));
try {
  result = spawnSync(process.execPath, [cli, 'doctor', '--json'], {
    cwd: nongit,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.cli.version, '0.1.6');
  assert.equal(report.cli.api_version, 1);
  assert.equal(report.graph.protocol_version, 3);
  assert.equal(report.node.compatible, true);
  assert.equal(report.git.is_project, false);
  assert.equal(report.observation.required_for_core_graph, false);
  assert.equal(report.observation.backend, 'cocoindex');
  assert.equal(report.observation.external_runtime_required, false);
  assert.equal(report.observation.ready, true);
} finally {
  fs.rmSync(nongit, { recursive: true, force: true });
}

assert.equal(platformSupport('win32', 'x64').supported, true);
assert.equal(platformSupport('win32', 'arm64').supported, false);
assert.equal(platformSupport('linux', 'arm64').transport, 'unix_domain_socket');
const paths = runtimePaths('.');
const pipe = graphSocketPath(paths, 'win32');
assert.match(pipe, /^\\\\\.\\pipe\\laminadev-[a-f0-9]{24}$/);
assert.equal(pipe, graphSocketPath(paths, 'win32'));

const tokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-token-test-'));
try {
  const makePaths = (name) => ({
    runtime_dir: path.join(tokenRoot, name),
    evidence: path.join(tokenRoot, name, 'evidence'),
    cocoindex: path.join(tokenRoot, name, 'cocoindex'),
    token: path.join(tokenRoot, name, 'graphd.token'),
  });
  const firstPaths = makePaths('first');
  const secondPaths = makePaths('second');
  const first = ensureAuthToken(firstPaths);
  const second = ensureAuthToken(secondPaths);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.match(second, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second, 'each repository runtime needs a random token');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(firstPaths.token).mode & 0o777, 0o600);
  }
} finally {
  fs.rmSync(tokenRoot, { recursive: true, force: true });
}

console.log('cli_doctor_test: ok');
