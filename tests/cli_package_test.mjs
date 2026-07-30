#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const rootPackage = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const cliPackage = JSON.parse(fs.readFileSync('packages/cli/package.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/publish-cli.yml', 'utf8');
const builder = fs.readFileSync('scripts/build-standalone-cli.mjs', 'utf8');
const bootstrap = fs.readFileSync('packages/cli/sea/bootstrap.cjs', 'utf8');
const graphClient = fs.readFileSync('packages/cli/lib/graph-runtime/client.mjs', 'utf8');
const binarySmoke = fs.readFileSync('tests/cli_binary_smoke_test.mjs', 'utf8');
const cocoWorker = fs.readFileSync('packages/cli/cocoindex_worker.py', 'utf8');

assert.equal(rootPackage.private, true);
assert.equal(rootPackage.bin, undefined);
assert.equal(cliPackage.private, true);
assert.equal(cliPackage.bin, undefined);
assert.equal(cliPackage.version, '0.2.0');
assert.equal(cliPackage.dependencies['@ladybugdb/core'], '0.19.0');
assert.match(builder, /experimental-sea-config/);
assert.match(builder, /NODE_SEA_BLOB/);
assert.match(builder, /@ladybugdb\/core/);
assert.match(builder, /LAMINA_NODE_BINARY/);
assert.match(builder, /Standalone executable smoke failed/);
assert.match(builder, /pyinstaller/);
assert.match(builder, /cocoindex-worker/);
assert.match(builder, /\['pywintypes', 'win32file', 'win32pipe'\]/);
assert.match(builder, /buildArgs\.push\('--hidden-import', module\)/);
assert.match(builder, /must be built natively/);
assert.match(builder, /--locked/);
assert.doesNotMatch(builder, /observation-runtime', 'python/);
assert.match(builder, /postject.*dist.*cli\.js/s);
assert.match(builder, /codesign.*--remove-signature/s);
assert.match(builder, /--macho-segment-name/);
assert.match(builder, /codesign.*--sign.*--force/s);
assert.match(bootstrap, /process\.platform === 'win32'/);
assert.match(bootstrap, /path\.join\(runtime, 'node\.exe'\)/);
assert.match(bootstrap, /LAMINA_STANDALONE_GRAPHD_HOST/);
assert.match(graphClient, /LAMINA_STANDALONE_GRAPHD_HOST \|\| process\.execPath/);
assert.match(graphClient, /identity\?\.runtime_version === CLI_VERSION/);
assert.match(binarySmoke, /process\.platform === 'win32'/);
assert.match(binarySmoke, /LOCALAPPDATA: cache/);
assert.match(binarySmoke, /XDG_CACHE_HOME: cache/);
assert.match(cocoWorker, /multiprocessing\.freeze_support\(\)/);
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
  spawnSync(process.execPath, ['scripts/check-cli-release-tag.mjs', 'cli-v0.2.0']).status,
  0,
);
assert.notEqual(
  spawnSync(process.execPath, ['scripts/check-cli-release-tag.mjs', 'cli-v0.1.4']).status,
  0,
);
assert.equal(
  spawnSync(process.execPath, ['scripts/check-cli-version-discipline.mjs']).status,
  0,
);
const disciplineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-version-discipline-'));
try {
  fs.mkdirSync(path.join(disciplineRoot, 'packages', 'cli'), { recursive: true });
  fs.writeFileSync(
    path.join(disciplineRoot, 'packages', 'cli', 'package.json'),
    JSON.stringify({ version: '1.2.3' }),
  );
  fs.writeFileSync(path.join(disciplineRoot, 'packages', 'cli', 'runtime.mjs'), 'export const value = 1;\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: disciplineRoot });
  execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: disciplineRoot });
  execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: disciplineRoot });
  execFileSync('git', ['add', '.'], { cwd: disciplineRoot });
  execFileSync('git', ['commit', '-m', 'release'], { cwd: disciplineRoot });
  execFileSync('git', ['tag', 'cli-v1.2.3'], { cwd: disciplineRoot });
  fs.writeFileSync(path.join(disciplineRoot, 'packages', 'cli', 'runtime.mjs'), 'export const value = 2;\n');
  const reused = spawnSync(
    process.execPath,
    [path.resolve('scripts/check-cli-version-discipline.mjs')],
    { cwd: disciplineRoot, encoding: 'utf8' },
  );
  assert.equal(reused.status, 1);
  assert.match(reused.stderr, /Bump the CLI version/);
  fs.writeFileSync(
    path.join(disciplineRoot, 'packages', 'cli', 'package.json'),
    JSON.stringify({ version: '1.2.4' }),
  );
  const bumped = spawnSync(
    process.execPath,
    [path.resolve('scripts/check-cli-version-discipline.mjs')],
    { cwd: disciplineRoot, encoding: 'utf8' },
  );
  assert.equal(bumped.status, 0, bumped.stderr);
} finally {
  fs.rmSync(disciplineRoot, { recursive: true, force: true });
}
for (const runtimePath of ['skills/lamina-orchestrator/bin', 'skills/lamina-orchestrator/lib']) {
  assert.equal(fs.existsSync(runtimePath), false, `${runtimePath} must not ship with skills`);
}
console.log('cli_package_test: ok');
