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
  laminaDeltaEligible,
} from '../benchmarks/lb6/pilot/scripts/aggregate-results.mjs';
import {
  isFrozenPublicationTask,
  isPublicationEligibleCell,
  makeJobName,
  preparePublicationPlan,
  schedulePilotCells,
} from '../benchmarks/lb6/pilot/scripts/run-three-arm.mjs';
import { EMPTY_INVENTORY_DIGEST } from '../benchmarks/lb6/pilot/lib/pre-model-gate.mjs';
import {
  SKILL_RERUN_CAMPAIGN_ID,
  expectedPilotTaskDirName,
} from '../benchmarks/lb6/pilot/lib/constants.mjs';
import { TASKS_REL } from '../benchmarks/lb6/pilot/scripts/run-three-arm.mjs';
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

const jobsRoot = path.join(tmpRoot, 'jobs');
fs.mkdirSync(jobsRoot, { recursive: true });
const skillBundleManifest = JSON.parse(
  fs.readFileSync(path.join(tmpRoot, 'benchmarks/lb6/pilot/skill-bundle/manifest-v3.json'), 'utf8'),
);
function writeInvalidFixture({ taskId = 'dev-simple-list', arm = 'plan', state = 'protocol_evidence_missing' } = {}) {
  const jobName = makeJobName(taskId, arm, 9001);
  const jobDir = path.join(jobsRoot, jobName);
  const trialDir = path.join(jobDir, `${taskId}-${arm}__test`);
  const finalStep = arm === 'lamina' ? 'fix' : 'verify_fix';
  const verifierDir = path.join(trialDir, 'steps', finalStep, 'verifier');
  fs.mkdirSync(verifierDir, { recursive: true });
  fs.writeFileSync(
    path.join(jobDir, 'config.json'),
    JSON.stringify({
      datasets: [{ path: TASKS_REL, task_names: [expectedPilotTaskDirName(taskId, arm)] }],
    }),
  );
  fs.writeFileSync(path.join(jobDir, 'lock.json'), JSON.stringify({ trials: [{ skills: [] }] }));
  fs.writeFileSync(path.join(trialDir, 'lock.json'), JSON.stringify({ trials: [{ skills: [] }] }));
  fs.writeFileSync(
    path.join(trialDir, 'result.json'),
    JSON.stringify({
      agent_info: { name: 'cursor-cli', model_info: { name: 'cursor/composer-2.5' } },
      step_results: [],
    }),
  );
  fs.writeFileSync(path.join(verifierDir, 'reward.json'), JSON.stringify({ reward: 0.4 }));
  const protocolDir = path.join(trialDir, 'protocol');
  fs.mkdirSync(protocolDir, { recursive: true });
  const ledgerEvents = [
    {
      sequence: 1,
      event: 'pre_model_skill_gate',
      details: {
        arm,
        task_id: taskId,
        passed: true,
        bundle_digest: skillBundleManifest.aggregate_digest,
        container_path: '/home/agent/.cursor/skills',
        container_file_count: 0,
        container_aggregate_digest: arm === 'lamina'
          ? skillBundleManifest.aggregate_digest
          : EMPTY_INVENTORY_DIGEST,
        lamina_skill_absent: arm !== 'lamina',
      },
    },
  ];
  if (state !== 'protocol_evidence_missing') {
    fs.writeFileSync(
      path.join(protocolDir, 'final-seal.json'),
      JSON.stringify({ double_capture_identical: true, candidate_digest: 'candidate-abc' }),
    );
    ledgerEvents.push(
      ...['final_sealed', 'agent_environment_removed', 'scoring_complete'].map((event, index) => ({
        sequence: index + 2,
        event,
      })),
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
  fs.writeFileSync(
    path.join(protocolDir, 'transition-ledger.jsonl'),
    `${ledgerEvents.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
  );
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

const noSkillCell = {
  taskId: 'dev-loan-library',
  arm: 'lamina',
  taskDirName: 'dev-loan-library-lamina',
  jobName: makeJobName('dev-loan-library', 'lamina', 42),
  ok: true,
  measurementValid: false,
  reward: 0.5,
  skillEvidence: { passed: false, priorNoSkill: true },
  priorNoSkill: true,
};
const suppressed = buildTaskCluster('dev-loan-library', [
  { taskId: 'dev-loan-library', arm: 'direct', ok: true, measurementValid: true, reward: 1 },
  { taskId: 'dev-loan-library', arm: 'plan', ok: true, measurementValid: true, reward: 1 },
  noSkillCell,
]);
assert.equal(suppressed.deltas.lamina_minus_direct, null);
assert.equal(suppressed.laminaDeltaSuppressed, true);
assert.equal(laminaDeltaEligible(noSkillCell), false);
assert.equal(isFrozenPublicationTask('dev-care-circle'), true);
assert.equal(isPublicationEligibleCell(noSkillCell), false);

function semanticFields(earned = 8) {
  const criteria = Array.from({ length: 10 }, (_, index) => ({
    id: `criterion-${index + 1}`,
    earned: index < earned ? 1 : 0,
    possible: 1,
  }));
  return {
    criteria,
    earned,
    possible: 10,
    rawBehavior: earned / 10,
    reward: Number(((earned + 1) / 12).toFixed(4)),
    measurementInvalid: false,
    semanticEvidence: {
      passed: true,
      measurement: 'semantic_criteria_v3',
      criteriaCount: 10,
    },
    isolationEvidence: {
      campaignId: SKILL_RERUN_CAMPAIGN_ID,
      measurementContract: 'semantic_criteria_v3',
    },
  };
}

assert.equal(isPublicationEligibleCell({
  taskId: 'dev-loan-library',
  arm: 'direct',
  taskDirName: expectedPilotTaskDirName('dev-loan-library', 'direct'),
  jobName: makeJobName('dev-loan-library', 'direct', 1),
  measurementValid: true,
  skillEvidence: { passed: true, hasLedgerEvidence: true },
}), false, 'asserted booleans without semantic-v3 evidence must not publish');

const invalidRows = semanticFields(10);
invalidRows.criteria[0] = { ...invalidRows.criteria[0], earned: 11 };
invalidRows.criteria[1] = { ...invalidRows.criteria[1], earned: -1 };
const invalidRowCell = {
  taskId: 'dev-loan-library',
  arm: 'direct',
  taskDirName: expectedPilotTaskDirName('dev-loan-library', 'direct'),
  jobName: makeJobName('dev-loan-library', 'direct', 2),
  measurementValid: true,
  skillEvidence: { passed: true, hasLedgerEvidence: true },
  ...invalidRows,
};
assert.equal(
  isPublicationEligibleCell(invalidRowCell),
  false,
  'over-earned and negative criterion rows must fail publication even when totals match',
);
const invalidRowCells = ['direct', 'plan', 'lamina'].map((arm) => ({
  taskId: 'dev-loan-library',
  arm,
  taskDirName: expectedPilotTaskDirName('dev-loan-library', arm),
  jobName: makeJobName('dev-loan-library', arm, 20 + ['direct', 'plan', 'lamina'].indexOf(arm)),
  ok: true,
  measurementValid: true,
  skillEvidence: { passed: true, hasLedgerEvidence: true },
  ...semanticFields(10),
}));
invalidRowCells[0] = { ...invalidRowCells[0], ...invalidRows };
const invalidRowPlan = preparePublicationPlan({
  root: tmpRoot,
  taskIds: ['dev-loan-library'],
  cells: invalidRowCells,
  report: {
    campaignId: SKILL_RERUN_CAMPAIGN_ID,
    campaign: { ok: true },
    gate: 'three_arm_campaign_complete',
    cells: invalidRowCells,
  },
  write: false,
});
assert.equal(invalidRowPlan.plan.benchmark_upload_ready, false);
assert.equal(invalidRowPlan.plan.commands.length, 0);

const publication = preparePublicationPlan({
  root: tmpRoot,
  taskIds: selectedNewTasks,
  cells: selectedNewTasks.flatMap((taskId) =>
    ['direct', 'plan', 'lamina'].map((arm) => ({
      taskId,
      arm,
      taskDirName: expectedPilotTaskDirName(taskId, arm),
      jobName: makeJobName(taskId, arm, 1),
      measurementValid: true,
      skillEvidence: { passed: true, priorNoSkill: false, hasLedgerEvidence: true },
      ...semanticFields(),
    })),
  ),
  reportPaths: null,
  report: {
    campaignId: SKILL_RERUN_CAMPAIGN_ID,
    campaign: { ok: true, campaignId: SKILL_RERUN_CAMPAIGN_ID },
    gate: 'three_arm_campaign_complete',
    cells: selectedNewTasks.flatMap((taskId) =>
      ['direct', 'plan', 'lamina'].map((arm) => ({
        taskId,
        arm,
        taskDirName: expectedPilotTaskDirName(taskId, arm),
        jobName: makeJobName(taskId, arm, 1),
        ok: true,
        measurementValid: true,
        skillEvidence: { passed: true, hasLedgerEvidence: true },
        ...semanticFields(),
      })),
    ),
  },
  write: false,
});
assert.equal(publication.outPath, null);
assert.ok(publication.plan.commands.every((cmd) => !cmd.includes('dev-care-circle')));
assert.equal(publication.plan.campaign_id, SKILL_RERUN_CAMPAIGN_ID);
assert.equal(publication.plan.benchmark_upload_ready, true);
assert.equal(publication.plan.publication_eligible, true);
assert.equal(publication.plan.development_only, true);
assert.equal(publication.plan.confirmatory, false);
assert.equal(
  publication.plan.commands.filter((cmd) => cmd.startsWith('harbor publish')).length,
  selectedNewTasks.length * 3,
);
assert.ok(
  publication.plan.commands
    .filter((cmd) => cmd.startsWith('harbor publish'))
    .every((cmd) => cmd.includes('/harbor/tasks-v3/') && cmd.endsWith('-v3')),
  'v3 publication must use immutable v3 task identities',
);
assert.ok(publication.plan.commands.every((cmd) => cmd.includes('skill-rerun-v3') || cmd.startsWith('harbor publish')));

const mixedCells = [
  {
    taskId: 'dev-loan-library',
    arm: 'direct',
    taskDirName: 'dev-loan-library-direct',
    jobName: 'lb6-pilot-dev-loan-library-direct-100',
    measurementValid: true,
    skillEvidence: { passed: true, hasLedgerEvidence: true },
  },
  {
    taskId: 'dev-loan-library',
    arm: 'plan',
    taskDirName: 'dev-loan-library-plan',
    jobName: 'lb6-pilot-dev-loan-library-plan-101',
    measurementValid: true,
    skillEvidence: { passed: true, hasLedgerEvidence: true },
  },
  {
    taskId: 'dev-loan-library',
    arm: 'lamina',
    taskDirName: 'dev-loan-library-lamina',
    jobName: makeJobName('dev-loan-library', 'lamina', 102),
    measurementValid: true,
    skillEvidence: { passed: true, hasLedgerEvidence: true },
  },
];
const mixedPublication = preparePublicationPlan({
  root: tmpRoot,
  taskIds: ['dev-loan-library'],
  cells: mixedCells,
  report: {
    campaignId: SKILL_RERUN_CAMPAIGN_ID,
    campaign: { ok: true },
    gate: 'three_arm_campaign_complete',
    cells: mixedCells,
  },
  write: false,
});
assert.equal(mixedPublication.plan.benchmark_upload_ready, false);
assert.equal(mixedPublication.plan.publication_eligible, false);
assert.equal(mixedPublication.plan.commands.length, 0);
assert.equal(
  mixedPublication.plan.commands.filter((cmd) => cmd.startsWith('harbor upload')).length,
  0,
);
assert.ok(
  mixedPublication.plan.blocked_reasons.some((reason) => /dev-loan-library\/direct|publication boundary/i.test(reason)),
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
assert.equal(dryPayload.cells.length, 12);
assert.equal(dryPayload.concurrency.effective, 6);
assert.equal(dryPayload.campaignId, SKILL_RERUN_CAMPAIGN_ID);
assert.equal(dryPayload.maxLaminaParents, 1);
assert.equal(dryPayload.schedule[0].taskId, 'dev-loan-library');
assert.equal(dryPayload.schedule[0].arm, 'lamina');
const dryLaminaPerWave = new Map();
for (const slot of dryPayload.schedule) {
  dryLaminaPerWave.set(
    slot.wave,
    (dryLaminaPerWave.get(slot.wave) || 0) + (slot.arm === 'lamina' ? 1 : 0),
  );
}
for (const count of dryLaminaPerWave.values()) {
  assert.ok(count <= 1, `dry-run wave had ${count} Lamina parents`);
}

assertFrozenArtifactsUnchanged(root, manifest, sourceFrozenBefore);
assertGitStatusUnchanged(root, sourceStatusBefore);

const diffCheck = spawnSync('git', ['diff', '--check'], { cwd: root, encoding: 'utf8' });
assert.equal(diffCheck.status, 0, `git diff --check failed:\n${diffCheck.stdout}${diffCheck.stderr}`);

console.log('lb6 pilot launch-gate tests passed');
