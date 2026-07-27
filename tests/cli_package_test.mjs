#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditPackReport } from '../scripts/audit-cli-pack.mjs';

const rootPackage = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const cliPackage = JSON.parse(fs.readFileSync('packages/cli/package.json', 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const publishWorkflow = fs.readFileSync('.github/workflows/publish-cli.yml', 'utf8');

assert.equal(rootPackage.private, true);
assert.equal(rootPackage.bin, undefined);
assert.equal(rootPackage.dependencies?.['@ladybugdb/core'], undefined);
assert.equal(cliPackage.name, '@laminadev/cli');
assert.equal(cliPackage.version, '0.1.0');
assert.deepEqual(cliPackage.bin, { lamina: './bin/lamina.mjs' });
assert.equal(cliPackage.engines.node, '>=20');
assert.equal(cliPackage.license, 'Apache-2.0');
assert.equal(cliPackage.dependencies['@ladybugdb/core'], '0.18.3');
assert.match(
  publishWorkflow,
  /TARBALL=.*'\.\/dist\/'/,
  'release tarball must use an explicit local path so npm does not parse it as a registry spec',
);

for (const runtimePath of [
  'skills/lamina-orchestrator/bin',
  'skills/lamina-orchestrator/lib',
]) {
  assert.equal(fs.existsSync(runtimePath), false, `${runtimePath} must not ship with skills`);
}

const pack = spawnSync(npm, ['pack', '--dry-run', '--json', './packages/cli'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
assert.equal(pack.status, 0, pack.stderr || pack.stdout);
const audit = auditPackReport(JSON.parse(pack.stdout));
assert.equal(audit.ok, true);

if (process.platform !== 'win32') {
  const binMode = fs.statSync(path.resolve('packages/cli/bin/lamina.mjs')).mode;
  assert.notEqual(binMode & 0o111, 0, 'CLI source entrypoint must be executable');
}
assert.equal(
  spawnSync(process.execPath, [
    'scripts/check-cli-release-tag.mjs',
    'cli-v0.1.0',
  ]).status,
  0,
);
assert.notEqual(
  spawnSync(process.execPath, [
    'scripts/check-cli-release-tag.mjs',
    'cli-v0.1.1',
  ]).status,
  0,
);

console.log('cli_package_test: ok');
