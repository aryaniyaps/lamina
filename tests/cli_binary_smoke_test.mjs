#!/usr/bin/env node
/* A release job may provide LAMINA_BINARY to run the complete isolated smoke
 * suite. Locally this validates the executable build contract without creating
 * a host-specific binary. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const binary = process.env.LAMINA_BINARY && path.resolve(process.env.LAMINA_BINARY);
const worker = process.env.LAMINA_WORKER && path.resolve(process.env.LAMINA_WORKER);
if (!binary) {
  assert.equal(fs.existsSync('scripts/install.sh'), true);
  assert.equal(fs.existsSync('scripts/install.ps1'), true);
  console.log('cli_binary_smoke_test: build contract ok (set LAMINA_BINARY for isolated binary smoke)');
  process.exit(0);
}
assert.ok(worker, 'LAMINA_WORKER is required when exercising an isolated native binary');
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
fs.mkdirSync(runtime, { recursive: true });
fs.copyFileSync(worker, path.join(runtime, workerName));
if (process.platform !== 'win32') fs.chmodSync(path.join(runtime, workerName), 0o755);
assert.deepEqual(fs.readdirSync(runtime), [workerName], 'the private runtime must contain only the native worker');
assert.equal(fs.existsSync(path.join(cache, 'lamina', 'runtime', version.stdout.trim(), target, 'app', 'uv.lock')), false);
assert.equal(fs.existsSync(path.join(cache, 'lamina', 'runtime', version.stdout.trim(), target, 'app', 'pyproject.toml')), false);
const doctor = run(['doctor', '--json']);
assert.equal(doctor.status, 0, doctor.stderr);
assert.equal(JSON.parse(doctor.stdout).cli.api_version, 1);
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
fs.rmSync(temp, { recursive: true, force: true });
console.log('cli_binary_smoke_test: ok');
