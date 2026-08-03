#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MAX_INSTALL_FOOTPRINT_BYTES } from '../packages/cli/lib/runtime-lifecycle.mjs';

const workflow = fs.readFileSync('.github/workflows/publish-cli.yml', 'utf8');
const installDoc = fs.readFileSync('docs/content/getting-started/installation.mdx', 'utf8');
const adr015 = fs.readFileSync('docs/decisions/015-practical-runtime-architecture.md', 'utf8');
const cutover = fs.readFileSync('packages/cli/lib/runtime-lifecycle.mjs', 'utf8');

assert.match(workflow, /linux-x64/);
assert.match(workflow, /linux-arm64/);
assert.match(workflow, /SHA256SUMS/);
assert.match(workflow, /release_artifact_smoke_test/);
assert.match(workflow, /measure-linux-install-footprint/);
assert.equal(fs.existsSync('scripts/measure-linux-install-footprint.mjs'), true);
assert.equal(MAX_INSTALL_FOOTPRINT_BYTES, 750 * 1024 * 1024);
assert.match(cutover, /graph\.lbdb/);
assert.doesNotMatch(cutover, /rmSync\(paths\.database/);
assert.match(adr015, /750 MiB/);
assert.match(installDoc, /checksum/i);
assert.match(installDoc, /offline|network/i);

if (process.env.LAMINA_RELEASE_DIR && process.platform === 'linux') {
  const measured = spawnSync(process.execPath, ['scripts/measure-linux-install-footprint.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, LAMINA_RELEASE_DIR: process.env.LAMINA_RELEASE_DIR },
  });
  assert.equal(measured.status, 0, measured.stderr || measured.stdout);
  const report = JSON.parse(measured.stdout.trim().split('\n').pop());
  assert.equal(report.within_limit, true);
  assert.ok(report.total_bytes <= MAX_INSTALL_FOOTPRINT_BYTES);
}

if (process.platform === 'linux' && process.env.LAMINA_OFFLINE_SMOKE === '1') {
  const unshareProbe = spawnSync('unshare', ['-n', 'true'], { encoding: 'utf8' });
  if (unshareProbe.status !== 0) {
    console.log('linux_packaging_contract_test: skip offline smoke (unshare -n unavailable on this host)');
  } else {
    const release = process.env.LAMINA_RELEASE_DIR;
    assert.ok(release, 'LAMINA_OFFLINE_SMOKE requires LAMINA_RELEASE_DIR');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-offline-packaging-'));
  const installDir = path.join(temp, 'bin');
  const cache = path.join(temp, 'cache');
  const fixture = path.join(temp, 'fixture');
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
  const binary = path.join(installDir, 'lamina');
  fs.mkdirSync(fixture);
  const tools = path.join(temp, 'tools');
  fs.mkdirSync(tools);
  fs.symlinkSync('/usr/bin/git', path.join(tools, 'git'));
  const isolatedPath = tools;
  const runOffline = (args) => spawnSync('unshare', ['-n', binary, ...args], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, PATH: isolatedPath, XDG_CACHE_HOME: cache, LAMINA_OBSERVATION_BACKEND: 'node' },
  });
  execGitInit(fixture);
  const doctor = runOffline(['doctor', '--json']);
  assert.equal(doctor.status, 0, doctor.stderr);
  const status = runOffline(['graph', 'status']);
  assert.equal(status.status, 0, status.stderr);
  const observed = runOffline(['graph', 'observe']);
  assert.equal(observed.status, 0, observed.stderr || observed.stdout);
  const context = runOffline(['context', 'rebuild']);
  assert.equal(context.status, 0, context.stderr || context.stdout);
  fs.rmSync(temp, { recursive: true, force: true });
  }
}

function execGitInit(fixture) {
  spawnSync('git', ['init', '-b', 'main'], { cwd: fixture, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: fixture });
  spawnSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: fixture });
  fs.writeFileSync(path.join(fixture, 'README.md'), '# offline\n');
  spawnSync('git', ['add', 'README.md'], { cwd: fixture });
  spawnSync('git', ['commit', '-m', 'fixture'], { cwd: fixture });
}

console.log('linux_packaging_contract_test: ok');
