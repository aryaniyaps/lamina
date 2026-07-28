#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const rootPackage = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const cliPackage = JSON.parse(fs.readFileSync('packages/cli/package.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/publish-cli.yml', 'utf8');
const builder = fs.readFileSync('scripts/build-standalone-cli.mjs', 'utf8');

assert.equal(rootPackage.private, true);
assert.equal(rootPackage.bin, undefined);
assert.equal(cliPackage.private, true);
assert.equal(cliPackage.bin, undefined);
assert.equal(cliPackage.version, '0.1.3');
assert.equal(cliPackage.dependencies['@ladybugdb/core'], '0.18.3');
assert.match(builder, /experimental-sea-config/);
assert.match(builder, /NODE_SEA_BLOB/);
assert.match(builder, /@ladybugdb\/core/);
assert.match(builder, /LAMINA_NODE_BINARY/);
assert.match(builder, /Standalone executable smoke failed/);
assert.match(builder, /pyinstaller/);
assert.match(builder, /cocoindex-worker/);
assert.match(builder, /must be built natively/);
assert.match(builder, /--locked/);
assert.doesNotMatch(builder, /observation-runtime', 'python/);
assert.match(builder, /postject.*dist.*cli\.js/s);
assert.match(workflow, /darwin-arm64/);
assert.match(workflow, /darwin-x64/);
assert.match(workflow, /linux-x64/);
assert.match(workflow, /linux-arm64/);
assert.match(workflow, /win32-x64/);
assert.match(workflow, /SHA256SUMS/);
assert.match(workflow, /setup-uv/);
assert.match(workflow, /python-version: '3\.13'/);
assert.match(workflow, /LAMINA_WORKER/);
assert.match(workflow, /transactional_graph_test/);
assert.match(workflow, /graphd_protocol_test/);
assert.doesNotMatch(workflow, /npm publish|npm view|npm audit signatures|npm trust/i);
assert.equal(
  spawnSync(process.execPath, ['scripts/check-cli-release-tag.mjs', 'cli-v0.1.3']).status,
  0,
);
assert.notEqual(
  spawnSync(process.execPath, ['scripts/check-cli-release-tag.mjs', 'cli-v0.1.2']).status,
  0,
);
for (const runtimePath of ['skills/lamina-orchestrator/bin', 'skills/lamina-orchestrator/lib']) {
  assert.equal(fs.existsSync(runtimePath), false, `${runtimePath} must not ship with skills`);
}
console.log('cli_package_test: ok');
