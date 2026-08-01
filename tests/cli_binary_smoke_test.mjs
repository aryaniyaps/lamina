#!/usr/bin/env node
/* A release job may provide LAMINA_BINARY to run the complete isolated smoke
 * suite. Locally this validates the executable build contract without creating
 * a host-specific binary. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSafeRunnerContext } from '../scripts/safe-runner/context.mjs';

assertSafeRunnerContext('standalone CLI smoke test');
import { execFileSync, spawnSync } from 'node:child_process';
const { stopIncompatibleServer } = await import('../packages/cli/lib/graph-runtime/client.mjs');
const { parseDaemonLock, runtimePaths } = await import('../packages/cli/lib/graph-runtime/util.mjs');

const binary = process.env.LAMINA_BINARY && path.resolve(process.env.LAMINA_BINARY);
const worker = process.env.LAMINA_WORKER && path.resolve(process.env.LAMINA_WORKER);
const model = process.env.LAMINA_MODEL && path.resolve(process.env.LAMINA_MODEL);
if (!binary) {
  assert.notEqual(process.env.LAMINA_SAFE_RUNNER, '1',
    'safe-runner native qualification must retain its snapshot-sealed LAMINA_BINARY');
  assert.equal(fs.existsSync('scripts/install.sh'), true);
  assert.equal(fs.existsSync('scripts/install.ps1'), true);
  console.log('cli_binary_smoke_test: build contract ok (set LAMINA_BINARY for isolated binary smoke)');
  process.exit(0);
}
assert.ok(worker, 'LAMINA_WORKER is required when exercising an isolated native binary');
assert.ok(model, 'LAMINA_MODEL is required when exercising isolated hybrid retrieval');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-binary-smoke-'));
const tools = path.join(temp, 'tools');
const fixture = path.join(temp, 'fixture');
fs.mkdirSync(tools); fs.mkdirSync(fixture);
// The isolated executable sees git, but neither node nor npm is on PATH.
let isolatedPath = tools;
if (process.platform === 'win32') {
  const git = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
  assert.ok(git, 'Git must be available on the Windows runner');
  isolatedPath = `${path.dirname(git)}${path.delimiter}${tools}`;
} else {
  fs.symlinkSync('/usr/bin/git', path.join(tools, 'git'));
}
const cache = path.join(temp, 'cache');
const cacheEnv = process.platform === 'win32'
  ? { LOCALAPPDATA: cache }
  : { XDG_CACHE_HOME: cache };
const run = (args) => spawnSync(binary, args, {
  cwd: fixture,
  encoding: 'utf8',
  env: { ...process.env, PATH: isolatedPath, ...cacheEnv },
});
execFileSync('git', ['init', '-b', 'main'], { cwd: fixture });
execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: fixture });
execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: fixture });
fs.writeFileSync(path.join(fixture, 'README.md'), '# binary smoke\n');
execFileSync('git', ['add', 'README.md'], { cwd: fixture });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: fixture });
const version = run(['--version']);
assert.equal(version.status, 0, version.error?.message || version.stderr);
const target = `${process.platform}-${process.arch}`;
const workerName = process.platform === 'win32' ? 'cocoindex-worker.exe' : 'cocoindex-worker';
const runtime = path.join(cache, 'lamina', 'runtime', version.stdout.trim(), target, 'app', 'observation-runtime');
const retrievalRuntime = path.join(cache, 'lamina', 'runtime', version.stdout.trim(), target, 'app', 'retrieval-runtime');
fs.mkdirSync(runtime, { recursive: true });
fs.copyFileSync(worker, path.join(runtime, workerName));
if (process.platform !== 'win32') fs.chmodSync(path.join(runtime, workerName), 0o755);
assert.deepEqual(fs.readdirSync(runtime), [workerName], 'the private runtime must contain only the native worker');
const extracted = spawnSync(path.join(runtime, workerName), [
  'retrieval', 'extract-assets', '--destination', retrievalRuntime,
], { encoding: 'utf8' });
assert.equal(extracted.status, 0, extracted.stderr || extracted.stdout);
fs.copyFileSync(model, path.join(retrievalRuntime, 'model.onnx'));
assert.deepEqual(
  fs.readdirSync(retrievalRuntime).sort(),
  ['asset-manifest.json', 'extensions', 'model.onnx', 'tokenizer.json'],
);
assert.equal(fs.existsSync(path.join(cache, 'lamina', 'runtime', version.stdout.trim(), target, 'app', 'uv.lock')), false);
assert.equal(fs.existsSync(path.join(cache, 'lamina', 'runtime', version.stdout.trim(), target, 'app', 'pyproject.toml')), false);
const doctor = run(['doctor', '--json']);
assert.equal(doctor.status, 0, doctor.stderr);
assert.equal(JSON.parse(doctor.stdout).cli.api_version, 1);
const setup = run(['setup', '--agent', 'codex']);
assert.equal(setup.status, 0, setup.stderr || setup.stdout);
assert.equal(JSON.parse(setup.stdout).installed, true);
assert.match(
  fs.readFileSync(path.join(fixture, 'AGENTS.md'), 'utf8'),
  /lamina:managed-agent-rules:start/,
);
const setupCheck = run(['setup', '--agent', 'codex', '--check']);
assert.equal(setupCheck.status, 0, setupCheck.stderr || setupCheck.stdout);
assert.equal(JSON.parse(setupCheck.stdout).installed, true);
const setupRemove = run(['setup', '--agent', 'codex', '--remove']);
assert.equal(setupRemove.status, 0, setupRemove.stderr || setupRemove.stdout);
assert.equal(JSON.parse(setupRemove.stdout).removed, true);
const status = run(['graph', 'status']);
assert.equal(status.status, 0, status.stderr);
const session = run(['session', 'start']);
assert.equal(session.status, 0, session.stderr);
assert.ok(JSON.parse(session.stdout).id);
const observed = run(['graph', 'observe']);
assert.equal(observed.status, 0, observed.stderr || observed.stdout);
fs.writeFileSync(path.join(fixture, 'README.md'), '# changed binary smoke\n');
const rebuilt = run(['graph', 'rebuild-observations']);
assert.equal(rebuilt.status, 0, rebuilt.stderr || rebuilt.stdout);
const contextRebuild = run(['context', 'rebuild']);
assert.equal(contextRebuild.status, 0, contextRebuild.stderr || contextRebuild.stdout);
const contextStatus = run(['context', 'status']);
assert.equal(contextStatus.status, 0, contextStatus.stderr || contextStatus.stdout);
assert.equal(JSON.parse(contextStatus.stdout).fresh, true);
fs.rmSync(path.join(retrievalRuntime, 'model.onnx'));
const missingModel = run(['context', 'rebuild']);
assert.notEqual(missingModel.status, 0, 'a missing model must fail with an integrity error');
assert.match(missingModel.stderr, /LAMINA_RETRIEVAL_INTEGRITY|retrieval model is missing/i);
const generationBeforeMissingWorker = fs.readFileSync(path.join(fixture, '.git', 'lamina', 'cocoindex', 'target-generation'), 'utf8');
fs.rmSync(path.join(runtime, workerName));
const missingWorker = run(['graph', 'observe']);
assert.notEqual(missingWorker.status, 0, 'a missing worker must not fall back to a host runtime');
assert.match(missingWorker.stderr + missingWorker.stdout, /LAMINA_OBSERVATION_UNAVAILABLE|Reinstall this Lamina release/i);
assert.equal(
  fs.readFileSync(path.join(fixture, '.git', 'lamina', 'cocoindex', 'target-generation'), 'utf8'),
  generationBeforeMissingWorker,
  'a missing worker must not mutate the observation generation',
);
const graphPaths = runtimePaths(fixture);
const graphdPid = parseDaemonLock(fs.readFileSync(graphPaths.lock, 'utf8'))?.pid;
if (Number.isInteger(graphdPid) && graphdPid > 1) {
  await stopIncompatibleServer(graphPaths, graphdPid);
}
fs.rmSync(temp, { recursive: true, force: true });
console.log('cli_binary_smoke_test: ok');
