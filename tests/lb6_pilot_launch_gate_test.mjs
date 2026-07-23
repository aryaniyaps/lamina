import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPilot } from '../benchmarks/lb6/pilot/scripts/build-pilot.mjs';
import {
  buildTaskCluster,
  extractCellRecord,
} from '../benchmarks/lb6/pilot/scripts/aggregate-results.mjs';
import { preparePublicationPlan } from '../benchmarks/lb6/pilot/scripts/run-three-arm.mjs';
import {
  assertBuildSelectionAllowed,
  assertCampaignSelectionAllowed,
  assertFrozenArtifactsUnchanged,
  frozenPathsMatchHead,
  listFrozenArtifactRelPaths,
  snapshotFrozenArtifacts,
} from '../benchmarks/lb6/pilot/lib/frozen-tasks.mjs';
import { collectScoringSensitiveStrings } from '../benchmarks/lb6/pilot/lib/public-golden.mjs';
import { scanPilotTaskSecrets } from '../benchmarks/lb6/pilot/lib/secret-scan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pilotRoot = path.join(root, 'benchmarks/lb6/pilot');
const buildPilotScript = path.join(root, 'benchmarks/lb6/pilot/scripts/build-pilot.mjs');
const manifest = JSON.parse(fs.readFileSync(path.join(pilotRoot, 'corpus/manifest.json'), 'utf8'));
const selectedNewTasks = manifest.pilot.default_run_tasks;

function snapshotGitStatus(cwd) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z'], { cwd, encoding: 'buffer' });
  assert.equal(result.status, 0, `git status failed in ${cwd}`);
  return result.stdout;
}

function assertGitStatusUnchanged(cwd, before) {
  assert.deepEqual(snapshotGitStatus(cwd), before, 'source worktree status changed');
}

function runNode(cwd, scriptRel, args = []) {
  const result = spawnSync(process.execPath, [path.join(cwd, scriptRel), ...args], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${scriptRel} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`.trim();
}

function runNodeExpectFail(cwd, scriptRel, args = []) {
  const result = spawnSync(process.execPath, [path.join(cwd, scriptRel), ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, `${scriptRel} should have failed`);
  return `${result.stdout}${result.stderr}`.trim();
}

function copyPilotWorkspace(sourceRoot, destRoot) {
  for (const rel of ['benchmarks/lb6/pilot', 'benchmarks/lib']) {
    const src = path.join(sourceRoot, rel);
    const dest = path.join(destRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
  }
}

const sourceStatusBefore = snapshotGitStatus(root);

const importProbe = spawnSync(
  process.execPath,
  ['--input-type=module', '-e', `import ${JSON.stringify(pathToFileURL(buildPilotScript).href)};`],
  { cwd: root, encoding: 'utf8' },
);
assert.equal(importProbe.status, 0, importProbe.stderr);
assert.equal(importProbe.stdout, '');
assert.equal(importProbe.stderr, '');
assertGitStatusUnchanged(root, sourceStatusBefore);

const frozenPaths = listFrozenArtifactRelPaths(root, manifest);
assert.ok(frozenPaths.length > 1, 'expected nonempty frozen artifact path set');
assert.ok(
  frozenPaths.some((rel) => rel.includes('dev-care-circle-direct')),
  'frozen paths must include published care task dirs',
);
assert.ok(
  frozenPaths.some((rel) => rel.includes('private-verifier/dev-care-circle')),
  'frozen paths must include published care private verifier',
);
assert.ok(
  frozenPaths.includes('benchmarks/lb6/pilot/publication/publication-result.json'),
  'frozen paths must include publication receipt',
);

const sourceFrozenBefore = snapshotFrozenArtifacts(root, manifest);
if (frozenPathsMatchHead(root, manifest)) {
  for (const rel of frozenPaths) {
    const head = spawnSync('git', ['show', `HEAD:${rel}`], { cwd: root, encoding: 'buffer' });
    if (head.status !== 0) continue;
    assert.deepEqual(
      fs.readFileSync(path.join(root, rel)),
      head.stdout,
      `${rel} differs from HEAD while worktree is clean`,
    );
  }
}

assert.throws(
  () => assertBuildSelectionAllowed(['dev-care-circle'], manifest),
  /refusing to build published frozen task/,
);
assert.throws(
  () => assertCampaignSelectionAllowed(['dev-care-circle', 'dev-simple-list'], manifest),
  /refusing to build published frozen task/,
);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lb6-launch-gate-workspace-'));
copyPilotWorkspace(root, tmpRoot);
const tmpPilotRoot = path.join(tmpRoot, 'benchmarks/lb6/pilot');
const tmpTasksRoot = path.join(tmpPilotRoot, 'harbor/tasks');
const tmpManifest = JSON.parse(fs.readFileSync(path.join(tmpPilotRoot, 'corpus/manifest.json'), 'utf8'));
const tmpFrozenBefore = snapshotFrozenArtifacts(tmpRoot, tmpManifest);
const manualPlanPath = path.join(tmpPilotRoot, 'publication/manual-publish-plan.json');
const manualPlanBefore = fs.existsSync(manualPlanPath) ? fs.readFileSync(manualPlanPath) : null;

runNodeExpectFail(tmpRoot, 'benchmarks/lb6/pilot/scripts/build-pilot.mjs', [
  '--tasks',
  'dev-care-circle',
]);
runNodeExpectFail(tmpRoot, 'benchmarks/lb6/pilot/scripts/validate-pilot.mjs', [
  '--tasks',
  'dev-care-circle',
]);

buildPilot({ root: tmpRoot, selectedTaskIds: selectedNewTasks });
assertFrozenArtifactsUnchanged(tmpRoot, tmpManifest, tmpFrozenBefore);

runNode(tmpRoot, 'benchmarks/lb6/pilot/scripts/validate-pilot.mjs', [
  '--tasks',
  selectedNewTasks.join(','),
]);
assertFrozenArtifactsUnchanged(tmpRoot, tmpManifest, tmpFrozenBefore);

const reviewSensitive = collectScoringSensitiveStrings(
  tmpManifest.tasks.find((task) => task.id === 'dev-review-room').golden,
);
const abiPath = path.join(
  tmpTasksRoot,
  'dev-review-room-direct/steps/verify_fix/workdir/.lb6-abi/public-abi.json',
);
const abiText = fs.readFileSync(abiPath, 'utf8');
for (const term of reviewSensitive) {
  assert.doesNotMatch(
    abiText,
    new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    `public ABI leaked scoring-sensitive string "${term}"`,
  );
}
const selfcheckFindings = scanPilotTaskSecrets(
  path.join(tmpTasksRoot, 'dev-review-room-direct'),
  { finalStep: 'verify_fix', scoringSensitiveStrings: reviewSensitive },
);
assert.equal(
  selfcheckFindings.filter((finding) => finding.kind === 'graded_leak').length,
  0,
  JSON.stringify(selfcheckFindings, null, 2),
);

const jobsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lb6-launch-gate-jobs-'));
function writeInvalidFixture({ taskId = 'dev-simple-list', arm = 'plan', state = 'protocol_evidence_missing' } = {}) {
  const jobName = `lb6-pilot-${taskId}-${arm}-9001`;
  const jobDir = path.join(jobsRoot, jobName);
  const trialDir = path.join(jobDir, `${taskId}-${arm}__test`);
  const finalStep = arm === 'lamina' ? 'fix' : 'verify_fix';
  const verifierDir = path.join(trialDir, 'steps', finalStep, 'verifier');
  fs.mkdirSync(verifierDir, { recursive: true });
  fs.writeFileSync(
    path.join(jobDir, 'config.json'),
    JSON.stringify({
      datasets: [{ path: 'benchmarks/lb6/pilot/harbor/tasks', task_names: [`${taskId}-${arm}`] }],
    }),
  );
  fs.writeFileSync(
    path.join(trialDir, 'result.json'),
    JSON.stringify({
      agent_info: { name: 'cursor-cli', model_info: { name: 'cursor/composer-2.5' } },
      step_results: [],
    }),
  );
  fs.writeFileSync(path.join(verifierDir, 'reward.json'), JSON.stringify({ reward: 0.4 }));
  if (state !== 'protocol_evidence_missing') {
    const protocolDir = path.join(trialDir, 'protocol');
    fs.mkdirSync(protocolDir, { recursive: true });
    fs.writeFileSync(
      path.join(protocolDir, 'final-seal.json'),
      JSON.stringify({ double_capture_identical: true, candidate_digest: 'candidate-abc' }),
    );
    fs.writeFileSync(
      path.join(protocolDir, 'transition-ledger.jsonl'),
      ['final_sealed', 'agent_environment_removed', 'scoring_complete']
        .map((event, index) => JSON.stringify({ sequence: index + 1, event }))
        .join('\n') + '\n',
    );
    fs.writeFileSync(
      path.join(verifierDir, 'verifier-abi.json'),
      JSON.stringify({
        candidate_digest: state === 'digest_mismatch' ? 'other-digest' : 'candidate-abc',
        network_mode: 'none',
        read_only_rootfs: true,
      }),
    );
  }
  return jobName;
}

const invalidJob = writeInvalidFixture();
const invalidCell = extractCellRecord({ jobsRoot, jobName: invalidJob });
assert.equal(invalidCell.observedReward, 0.4);
assert.equal(invalidCell.reward, null);
assert.equal(invalidCell.measurementValid, false);

const digestJob = writeInvalidFixture({ state: 'digest_mismatch' });
const digestCell = extractCellRecord({ jobsRoot, jobName: digestJob });
assert.equal(digestCell.observedReward, 0.4);
assert.equal(digestCell.reward, null);

const breachJob = writeInvalidFixture({ arm: 'direct', state: 'completed' });
const agentDir = path.join(
  jobsRoot,
  breachJob,
  'dev-simple-list-direct__test/steps/verify_fix/agent',
);
fs.mkdirSync(agentDir, { recursive: true });
fs.writeFileSync(
  path.join(agentDir, 'cursor-cli.txt'),
  '{"type":"tool_call","tool_call":{"readToolCall":{"args":{"path":"/tests/grade.mjs"},"result":{"success":{"content":"hidden"}}}}}\n',
);
const breachCell = extractCellRecord({ jobsRoot, jobName: breachJob });
assert.equal(breachCell.state, 'verifier_isolation_breach');
assert.equal(breachCell.reward, null);

const cluster = buildTaskCluster('dev-simple-list', [invalidCell, digestCell, breachCell]);
assert.equal(cluster.rewards.plan, null);
assert.equal(cluster.deltas.plan_minus_direct, null);
assert.equal(cluster.deltas.lamina_minus_direct, null);

const publication = preparePublicationPlan({
  root: tmpRoot,
  taskIds: selectedNewTasks,
  cells: selectedNewTasks.flatMap((taskId) =>
    ['direct', 'plan', 'lamina'].map((arm) => ({
      taskId,
      arm,
      taskDirName: `${taskId}-${arm}`,
      jobName: `lb6-pilot-${taskId}-${arm}-1`,
    })),
  ),
  reportPaths: null,
  report: null,
  write: false,
});
assert.equal(publication.outPath, null);
const TASKS_REL = 'benchmarks/lb6/pilot/harbor/tasks';
assert.ok(publication.plan.commands.every((cmd) => cmd !== `harbor publish --public ${TASKS_REL}`));
assert.ok(publication.plan.commands.every((cmd) => !cmd.includes('dev-care-circle')));
assert.equal(
  publication.plan.commands.filter((cmd) => cmd.startsWith('harbor publish')).length,
  selectedNewTasks.length * 3,
);
if (manualPlanBefore === null) {
  assert.equal(fs.existsSync(manualPlanPath), false);
} else {
  assert.deepEqual(fs.readFileSync(manualPlanPath), manualPlanBefore);
}

const dry = spawnSync(
  process.execPath,
  [
    path.join(root, 'benchmarks/lb6/pilot/scripts/run-three-arm.mjs'),
    '--dry-run',
    '--skip-package-scripts',
    '--concurrency',
    '6',
    '--tasks',
    selectedNewTasks.join(','),
  ],
  { cwd: root, encoding: 'utf8' },
);
assert.equal(dry.status, 0, dry.stderr);
const dryPayload = JSON.parse(dry.stdout);
assert.equal(dryPayload.cells.length, 9);
assert.equal(dryPayload.concurrency.effective, 6);
assert.deepEqual(
  dryPayload.schedule.slice(0, 3).map((slot) => slot.arm),
  ['lamina', 'lamina', 'lamina'],
);

assertFrozenArtifactsUnchanged(root, manifest, sourceFrozenBefore);
assertGitStatusUnchanged(root, sourceStatusBefore);

const diffCheck = spawnSync('git', ['diff', '--check'], { cwd: root, encoding: 'utf8' });
assert.equal(diffCheck.status, 0, `git diff --check failed:\n${diffCheck.stdout}${diffCheck.stderr}`);

console.log('lb6 pilot launch-gate tests passed');
