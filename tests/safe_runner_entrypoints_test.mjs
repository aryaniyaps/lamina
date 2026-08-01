#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareExecutionSnapshot } from '../scripts/safe-runner/execution-snapshot.mjs';
import { auditedNpxCommand } from '../scripts/safe-runner/npx-authority.mjs';
import { repositoryOutputRefusal } from '../scripts/safe-runner/output-policy.mjs';
import { preflightRun } from '../scripts/safe-runner/preflight.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const portableProbe = {
  id: 'entrypoint-refusal-test', platform: process.platform,
  production_enforcement: false, aggregate_memory: false, aggregate_pids: false,
  complete_descendant_ownership: false, controllers: [], reasons: ['test-only'],
};
const entrypoints = [
  ['benchmarks/retrieval-v1/benchmark.mjs', '--evaluate'],
  ['evals/scripts/run-suite.mjs'],
  ['evals/scripts/run-reference-matrix.mjs'],
  ['evals/scripts/loop-next-batch.mjs'],
  ['evals/scripts/vendor-nextjs-fixture.mjs'],
  ['evals/scripts/vendor-payload-fixture.mjs'],
  ['evals/scripts/vendor-plane-fixture.mjs'],
  ['evals/scripts/vendor-outline-fixture.mjs'],
  ['benchmarks/lb6/pilot/scripts/build-runtime.mjs'],
  ['benchmarks/lb6/pilot/scripts/run-three-arm.mjs'],
  ['scripts/build-standalone-cli.mjs'],
  ['scripts/fetch-retrieval-model.mjs'],
  ['scripts/prepare-retrieval-assets.mjs'],
  ['tests/retrieval_native_index_test.mjs'],
  ['tests/cli_binary_smoke_test.mjs'],
  ['evals/hooks/compatibility-matrix.mjs'],
];

for (const [entrypoint, ...args] of entrypoints) {
  const result = spawnSync(process.execPath, [path.join(ROOT, entrypoint), ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      LAMINA_SAFE_RUNNER_CONTEXT: '',
      LAMINA_SAFE_RUNNER_TOKEN: '',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
    maxBuffer: 64 * 1024,
  });
  assert.notEqual(result.status, 0, `${entrypoint} must refuse a direct launch`);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /must run through the canonical crash-safe command/,
    `${entrypoint} must explain the canonical command`,
  );
}

const compatibilityShell = spawnSync('/bin/bash', [
  path.join(ROOT, 'evals/hooks/compatibility-matrix.sh'),
], {
  cwd: ROOT, env: process.env, encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000, maxBuffer: 64 * 1024,
});
assert.notEqual(compatibilityShell.status, 0,
  'compatibility shell must hand off to a guarded implementation and refuse direct launch');
assert.match(`${compatibilityShell.stdout}\n${compatibilityShell.stderr}`,
  /must run through the canonical crash-safe command/);

const repositoryOutputCases = [
  ['scripts/build-standalone-cli.mjs', [process.execPath,
    path.join(ROOT, 'scripts/build-standalone-cli.mjs')], ['dist']],
  ['scripts/fetch-retrieval-model.mjs', [process.execPath,
    path.join(ROOT, 'scripts/fetch-retrieval-model.mjs')], ['dist']],
  ['scripts/prepare-retrieval-assets.mjs', [process.execPath,
    path.join(ROOT, 'scripts/prepare-retrieval-assets.mjs'), path.join(ROOT, 'dist/g3b-refusal')],
  ['dist']],
  ['evals/hooks/compatibility-matrix.sh', ['/bin/bash',
    path.join(ROOT, 'evals/hooks/compatibility-matrix.sh')], ['evals/reports']],
  ['evals/scripts/run-suite.mjs', [process.execPath,
    path.join(ROOT, 'evals/scripts/run-suite.mjs')],
  ['eval-workspace', 'evals/workspace', 'evals/reports', 'evals/tmp']],
  ['evals/scripts/run-reference-matrix.mjs', [process.execPath,
    path.join(ROOT, 'evals/scripts/run-reference-matrix.mjs')],
  ['eval-workspace', 'evals/workspace', 'evals/reports', 'evals/tmp']],
  ['evals/scripts/vendor-nextjs-fixture.mjs', [process.execPath,
    path.join(ROOT, 'evals/scripts/vendor-nextjs-fixture.mjs')],
  ['evals/fixtures/_base/nextjs-commerce']],
  ['evals/scripts/vendor-payload-fixture.mjs', [process.execPath,
    path.join(ROOT, 'evals/scripts/vendor-payload-fixture.mjs')],
  ['evals/fixtures/_base/payload-website']],
  ['evals/scripts/vendor-plane-fixture.mjs', [process.execPath,
    path.join(ROOT, 'evals/scripts/vendor-plane-fixture.mjs')],
  ['evals/fixtures/_base/plane']],
  ['evals/scripts/vendor-outline-fixture.mjs', [process.execPath,
    path.join(ROOT, 'evals/scripts/vendor-outline-fixture.mjs')],
  ['evals/fixtures/_base/outline']],
];
assert.equal(repositoryOutputCases.length, 10);

const npx = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npx.cmd' : 'npx');
const agentSkillsCommand = [npx, 'agent-skills-eval', '--config', 'evals/agent-skills-eval.yaml'];
const agentSkillsReason = auditedNpxCommand(ROOT, agentSkillsCommand, ROOT).launch_refusal;
const refusalCases = [
  ...repositoryOutputCases.map(([entrypoint, command, targets]) => ({
    entrypoint, command, targets, reason: repositoryOutputRefusal(entrypoint),
  })),
  { entrypoint: 'npx:agent-skills-eval', command: agentSkillsCommand,
    targets: ['eval-workspace', 'evals/workspace'], reason: agentSkillsReason },
];

const shallowState = (relative) => {
  const candidate = path.join(ROOT, relative);
  try {
    const stat = fs.lstatSync(candidate);
    return {
      type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
      size: stat.size,
      entries: stat.isDirectory() ? fs.readdirSync(candidate).sort() : null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { type: 'absent' };
    throw error;
  }
};
const trackedStatus = () => spawnSync('git', ['status', '--short', '--untracked-files=no'], {
  cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).stdout;
const trackedBefore = trackedStatus();
const targetBefore = new Map(refusalCases.flatMap((item) => item.targets)
  .map((target) => [target, shallowState(target)]));

for (const refusal of refusalCases) {
  const preflight = preflightRun({
    tier: 'small', command: refusal.command, cwd: ROOT, adapterInfo: portableProbe,
    injectedExistingProcesses: [],
  });
  assert.equal(preflight.ok, false, `${refusal.entrypoint} preflight must refuse`);
  assert.ok(preflight.reasons.includes(refusal.reason),
    `${refusal.entrypoint} must return its exact actionable refusal`);

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-output-refusal-'));
  try {
    assert.throws(() => prepareExecutionSnapshot({
      cwd: ROOT, command: refusal.command, temporaryDirectory,
    }), (error) => error.message === refusal.reason,
    `${refusal.entrypoint} direct snapshot must enforce the same refusal`);
    assert.equal(fs.existsSync(path.join(temporaryDirectory, 'execution-authority')), false,
      `${refusal.entrypoint} must refuse before snapshot authority creation`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
assert.equal(trackedStatus(), trackedBefore, 'refusal matrix must not change tracked targets');
for (const [target, state] of targetBefore) {
  assert.deepEqual(shallowState(target), state, `refusal must preserve ${target}`);
}

const cliDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-cli-redaction-'));
const cliReport = path.join(cliDirectory, 'report.json');
try {
  const cli = spawnSync(process.execPath, [
    'scripts/safe-runner/cli.mjs', 'run', '--report', cliReport,
    '--token=cli-nested-secret', '--', process.execPath,
    'tests/fixtures/safe-runner-adversary.mjs', 'success',
  ], { cwd: ROOT, encoding: 'utf8', env: process.env });
  assert.equal(cli.status, 2);
  assert.doesNotMatch(
    `${cli.stdout}\n${cli.stderr}\n${fs.readFileSync(cliReport, 'utf8')}`,
    /cli-nested-secret/,
  );
} finally {
  fs.rmSync(cliDirectory, { recursive: true, force: true });
}

process.stdout.write('safe-runner heavy entrypoint guards passed\n');
