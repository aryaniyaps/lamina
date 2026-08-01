#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const publish = fs.readFileSync('.github/workflows/publish-cli.yml', 'utf8');
const safeWorkflow = fs.readFileSync('.github/workflows/safe-runner.yml', 'utf8');
const evalNightly = fs.readFileSync('.github/workflows/eval-nightly.yml', 'utf8');
const evalSmoke = fs.readFileSync('.github/workflows/eval-smoke.yml', 'utf8');
const packageManifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const adapter = fs.readFileSync('scripts/safe-runner/adapter.mjs', 'utf8');
const systemd = fs.readFileSync('scripts/safe-runner/linux-systemd.mjs', 'utf8');
const sandbox = fs.readFileSync('scripts/safe-runner/sandbox.mjs', 'utf8');
const runner = fs.readFileSync('scripts/safe-runner/runner.mjs', 'utf8');
const executionSnapshot = fs.readFileSync('scripts/safe-runner/execution-snapshot.mjs', 'utf8');
const npxAuthority = fs.readFileSync('scripts/safe-runner/npx-authority.mjs', 'utf8');
const outputPolicy = fs.readFileSync('scripts/safe-runner/output-policy.mjs', 'utf8');
const retrievalAuthority = fs.readFileSync(
  'scripts/safe-runner/retrieval-authority.mjs', 'utf8',
);
const retrievalBenchmark = fs.readFileSync('benchmarks/retrieval-v1/benchmark.mjs', 'utf8');
const supervisionDecision = fs.readFileSync(
  'docs/decisions/014-crash-safe-resource-supervision.md', 'utf8',
);

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
for (const flag of ['--worker', '--model', '--tokenizer', '--model-digest']) {
  assert.equal(evaluateRuns[0].match(new RegExp(`${flag}\\s+\\S+`, 'g'))?.length, 1,
    `release retrieval must provide exactly one ${flag}`);
}
assert.match(evaluateRuns[0], /--promote\b/);
assert.match(evaluateRuns[1], /--promote\b/);
const calibration = safeRuns.find((line) => line.includes('benchmark.mjs --calibrate'));
assert.ok(calibration);
assert.doesNotMatch(calibration, /--promote\b/);
assert.equal(workload(calibration), 'retrieval-calibration-v1');
assert.match(calibration, /--worker\s+\S+[\s\S]*--model\s+\S+[\s\S]*--tokenizer\s+\S+[\s\S]*--model-digest\s+[a-f0-9]{64}/);
assert.match(packageManifest.scripts['bench:retrieval'], /--tier small[\s\S]*--promote[\s\S]*benchmark\.mjs --evaluate$/,
  'public retrieval wrapper must be a small promotion precursor with caller-appended exact assets');
assert.doesNotMatch(packageManifest.scripts['bench:retrieval'], /--worker|--model|--tokenizer|--model-digest/,
  'base retrieval wrapper must refuse actionably instead of pretending repository assets exist');

assert.match(safeWorkflow, /LAMINA_SAFE_BWRAP_PATH=%s/);
assert.match(safeWorkflow, /LAMINA_SAFE_BWRAP_SHA256=%s/);
assert.doesNotMatch(safeWorkflow, /echo "\$bin_dir" >> "\$GITHUB_PATH"/);
assert.match(adapter, /assertTrustedBinaryIdentity\(binaries\.identities\.bwrap\)[\s\S]*spawnSync\(binaries\.bwrap/);
assert.match(systemd, /assertInfrastructureBinaries\(this\.infrastructure,[\s\S]*staged\.bwrap, bwrapIdentity/);
assert.match(sandbox, /assertTrustedBinaryIdentity\(expectedBwrap\)[\s\S]*spawn\(bwrapExecutable/);
assert.doesNotMatch(executionSnapshot, /EXPLICIT_ENTRYPOINT_WRITABLE_ROOTS/);
assert.doesNotMatch(executionSnapshot,
  /prepare-retrieval-assets\.mjs[^\n]*index:\s*2/);
assert.match(executionSnapshot,
  /repositoryOutputRefusal\(auditedEntrypoint\)[\s\S]*throw new Error\(repositoryOutputReason\)/);
assert.match(executionSnapshot,
  /EXPLICIT_ENTRYPOINT_ARGV_OUTPUTS[\s\S]*safe-runner-graphd-client\.mjs[\s\S]*safe-runner-mutable\.mjs/);
assert.match(executionSnapshot,
  /if \(EXPLICIT_ENTRYPOINT_ARGV_OUTPUTS\.has\(entrypoint\)\)[\s\S]*kind: 'git-common-runtime'/,
  'Git-common writable binding must be reachable only for the two scratch fixtures');
assert.match(retrievalAuthority,
  /requires exactly one[\s\S]*nlink !== 1n[\s\S]*canonical model manifest[\s\S]*physical --model bytes/);
assert.doesNotMatch(retrievalBenchmark,
  /process\.env\.LAMINA_RETRIEVAL_(?:MODEL_PATH|TOKENIZER_PATH|MODEL_DIGEST)|LAMINA_UV_BINARY \|\| 'uv'/,
  'retrieval qualification must not recover inherited semantic or uv fallback inputs');
assert.match(retrievalBenchmark,
  /Object\.keys\(childEnvironment\)[\s\S]*startsWith\('LAMINA_TEST_'\)[\s\S]*startsWith\('LAMINA_RETRIEVAL_'\)/,
  'benchmark worker environment must strip inherited test and retrieval semantic families');
assert.doesNotMatch(executionSnapshot, /snapshot_target/);
assert.match(npxAuthority,
  /package_name:\s*'agent-skills-eval'[\s\S]*launch_admitted:\s*false/);
assert.match(outputPolicy, /private tmpfs/);
assert.match(supervisionDecision,
  /Atomic publication is also refused in issue #59[\s\S]*sampled usage[\s\S]*hard enforcement/);
assert.match(runner,
  /if \(!preflight\.ok\)[\s\S]*return finishAndWrite\(\);[\s\S]*temporaryDirectory = fs\.mkdtempSync[\s\S]*startCrashWatchdog/,
  'preflight refusal must precede temporary, watchdog, and snapshot authority creation');

for (const scriptName of ['test:eval:portable', 'test:eval:redteam']) {
  const script = packageManifest.scripts[scriptName];
  assert.match(script, /^npm run safe:run -- /,
    `${scriptName} must enter the canonical refusal before any workload preparation`);
  assert.doesNotMatch(script, /merge-evals|build-skill-context|&&/,
    `${scriptName} must not mutate repository inputs before safe-runner refusal`);
}
assert.doesNotMatch(evalNightly, /test:eval:validate/,
  'nightly must not merge eval inputs before the refused full-eval wrapper');
assert.doesNotMatch(evalSmoke, /test:eval:validate/,
  'smoke must not merge eval inputs before the refused smoke-eval wrapper');

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
