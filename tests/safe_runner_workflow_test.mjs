#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const publish = fs.readFileSync('.github/workflows/publish-cli.yml', 'utf8');
const safeWorkflow = fs.readFileSync('.github/workflows/safe-runner.yml', 'utf8');
const adapter = fs.readFileSync('scripts/safe-runner/adapter.mjs', 'utf8');
const systemd = fs.readFileSync('scripts/safe-runner/linux-systemd.mjs', 'utf8');
const sandbox = fs.readFileSync('scripts/safe-runner/sandbox.mjs', 'utf8');

const safeRuns = publish.split('\n').map((line) => line.trim())
  .filter((line) => line.startsWith('npm run safe:run'));
const evaluateRuns = safeRuns.filter((line) => line.includes('benchmark.mjs --evaluate'));
assert.equal(evaluateRuns.length, 2, 'release must run the exact evaluation at small and medium');
const tier = (line) => line.match(/--tier\s+(\w+)/)?.[1];
const workload = (line) => line.match(/--workload\s+(\S+)/)?.[1];
const payload = (line) => line.slice(line.indexOf(' -- node ') + 4);
assert.deepEqual(evaluateRuns.map(tier), ['small', 'medium']);
assert.equal(workload(evaluateRuns[0]), 'retrieval-v1');
assert.equal(workload(evaluateRuns[1]), 'retrieval-v1');
assert.equal(payload(evaluateRuns[0]), payload(evaluateRuns[1]),
  'promotion must bind the complete frozen evaluation argv across tiers');
assert.match(evaluateRuns[0], /--worker dist\/lamina-cocoindex-worker-\$\{\{ matrix\.target \}\}/,
  'release retrieval must execute the sealed native worker instead of an ignored uv venv');
assert.match(evaluateRuns[0], /--promote\b/);
assert.match(evaluateRuns[1], /--promote\b/);
const calibration = safeRuns.find((line) => line.includes('benchmark.mjs --calibrate'));
assert.ok(calibration);
assert.doesNotMatch(calibration, /--promote\b/);
assert.equal(workload(calibration), 'retrieval-calibration-v1');

assert.match(safeWorkflow, /LAMINA_SAFE_BWRAP_PATH=%s/);
assert.match(safeWorkflow, /LAMINA_SAFE_BWRAP_SHA256=%s/);
assert.doesNotMatch(safeWorkflow, /echo "\$bin_dir" >> "\$GITHUB_PATH"/);
assert.match(adapter, /assertTrustedBinaryIdentity\(binaries\.identities\.bwrap\)[\s\S]*spawnSync\(binaries\.bwrap/);
assert.match(systemd, /assertInfrastructureBinaries\(this\.infrastructure,[\s\S]*staged\.bwrap, bwrapIdentity/);
assert.match(sandbox, /assertTrustedBinaryIdentity\(expectedBwrap\)[\s\S]*spawn\(bwrapExecutable/);

const compatibilityReport = path.resolve('evals/reports/compatibility-matrix.json');
const before = fs.existsSync(compatibilityReport) ? fs.readFileSync(compatibilityReport) : null;
const direct = spawnSync('/bin/bash', ['evals/hooks/compatibility-matrix.sh'], {
  cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000,
});
assert.notEqual(direct.status, 0, 'compatibility matrix must refuse direct execution');
assert.match(`${direct.stdout}\n${direct.stderr}`, /must run through the canonical crash-safe command/);
const after = fs.existsSync(compatibilityReport) ? fs.readFileSync(compatibilityReport) : null;
assert.deepEqual(after, before, 'direct refusal must not perform or overwrite matrix work');
const wrapper = fs.readFileSync('evals/hooks/compatibility-matrix.sh', 'utf8');
assert.match(wrapper, /exec node .*compatibility-matrix\.mjs/);
assert.doesNotMatch(wrapper, /skills_dry_run|AGENTS=|results=/);

process.stdout.write('safe-runner workflow contracts passed\n');
