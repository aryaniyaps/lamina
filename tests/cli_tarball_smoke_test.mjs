#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { auditPackReport } from '../scripts/audit-cli-pack.mjs';
import { stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';
import { runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-cli-tarball-'));
const packDirectory = path.join(temp, 'pack');
const installPrefix = path.join(temp, 'install');
const fixture = path.join(temp, 'fixture');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
fs.mkdirSync(packDirectory);
fs.mkdirSync(fixture);

function run(command, args, options = {}) {
  const commandScript = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: commandScript,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`,
  );
  return result;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

let installSource = argument('--package');
let tarball = argument('--tarball');
let daemonPid = null;
try {
  if (!installSource && !tarball) {
    const packed = run(npm, [
      'pack',
      '--json',
      '--pack-destination',
      packDirectory,
      './packages/cli',
    ], { cwd: path.resolve('.') });
    const report = JSON.parse(packed.stdout);
    auditPackReport(report);
    tarball = path.join(packDirectory, report[0].filename);
  } else if (tarball) {
    tarball = path.resolve(tarball);
  }
  installSource ||= tarball;

  run(npm, [
    'install',
    '--prefix',
    installPrefix,
    '--no-audit',
    '--no-fund',
    installSource,
  ]);

  const executable = path.join(
    installPrefix,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'lamina.cmd' : 'lamina',
  );
  assert.equal(fs.existsSync(executable), true);
  assert.equal(run(executable, ['--version']).stdout.trim(), '0.1.0');

  execFileSync('git', ['init', '-b', 'main'], { cwd: fixture });
  execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: fixture });
  execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: fixture });
  fs.writeFileSync(path.join(fixture, 'README.md'), '# Installed CLI fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: fixture });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: fixture });

  const doctor = JSON.parse(run(executable, ['doctor', '--json'], { cwd: fixture }).stdout);
  assert.equal(doctor.cli.api_version, 1);
  assert.equal(doctor.graph.protocol_version, 3);
  assert.equal(doctor.git.is_project, true);

  const status = JSON.parse(run(executable, ['graph', 'status'], { cwd: fixture }).stdout);
  assert.equal(status.branch, 'main');
  const input = path.join(fixture, 'product.json');
  fs.writeFileSync(input, JSON.stringify({
    id: 'product.cli-only',
    kind: 'product',
    data: { name: 'CLI only' },
  }));
  const session = JSON.parse(
    run(executable, ['session', 'start'], { cwd: fixture }).stdout,
  ).id;
  run(executable, [
    'graph',
    'propose',
    'resource.add',
    '--input',
    input,
    '--session',
    session,
  ], { cwd: fixture });
  run(executable, ['session', 'publish', session], { cwd: fixture });
  const query = JSON.parse(
    run(executable, ['graph', 'query', '--kind', 'product'], { cwd: fixture }).stdout,
  );
  assert.equal(query.resources[0].id, 'product.cli-only');
  const scopedValidation = JSON.parse(
    run(executable, [
      'graph', 'validate', '--at', 'HEAD', '--scope', 'product.cli-only',
    ], { cwd: fixture }).stdout,
  );
  assert.equal(scopedValidation.ok, true);
  assert.equal(scopedValidation.validation_scope.mode, 'affected_closure');
  assert.equal(scopedValidation.validation_scope.resource, 'product.cli-only');
  run(executable, ['graph', 'observe'], {
    cwd: fixture,
    timeout: 180_000,
  });

  const lock = JSON.parse(
    fs.readFileSync(path.join(fixture, '.git', 'lamina', 'graphd.lock'), 'utf8'),
  );
  daemonPid = lock.pid;
} finally {
  if (!daemonPid) {
    try {
      daemonPid = JSON.parse(
        fs.readFileSync(path.join(fixture, '.git', 'lamina', 'graphd.lock'), 'utf8'),
      ).pid;
    } catch {}
  }
  if (daemonPid) {
    try { await stopIncompatibleServer(runtimePaths(fixture), daemonPid); } catch {}
  }
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('cli_tarball_smoke_test: ok');
