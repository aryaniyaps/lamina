import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_BUDGET_SEC,
  LAMINA_STEPS,
  MAX_LAMINA_PARENTS,
  SKILL_RERUN_CAMPAIGN_ID,
} from '../benchmarks/lb6/pilot/lib/constants.mjs';
import {
  EMPTY_INVENTORY_DIGEST,
  evaluatePreModelSkillGate,
} from '../benchmarks/lb6/pilot/lib/pre-model-gate.mjs';
import { buildExpectedHarborSkillDigests } from '../benchmarks/lb6/pilot/lib/skill-lock.mjs';
import {
  loadSkillBundleManifest,
  stageSkillBundle,
  verifyStagedSkillBundle,
} from '../benchmarks/lb6/pilot/lib/skill-bundle.mjs';
import {
  buildTaskCluster,
  laminaDeltaEligible,
  parsePilotJobName,
} from '../benchmarks/lb6/pilot/scripts/aggregate-results.mjs';
import {
  buildHarborArgs,
  classifyCellFailure,
  makeJobName,
  orderCellsForAdmission,
  schedulePilotCells,
} from '../benchmarks/lb6/pilot/scripts/run-three-arm.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'benchmarks/lb6/pilot/corpus/manifest.json'), 'utf8'),
);
const selectedTasks = manifest.pilot.default_run_tasks;

assert.equal(LAMINA_STEPS.reduce((sum, step) => sum + step.agentTimeout, 0), AGENT_BUDGET_SEC);
assert.match(makeJobName('dev-loan-library', 'lamina', 123), /^lb6-pilot-skill-rerun-v2-dev-loan-library-lamina-123$/);

const bundle = loadSkillBundleManifest(root);
assert.equal(bundle.manifest.campaign_id, SKILL_RERUN_CAMPAIGN_ID);
assert.equal(verifyStagedSkillBundle(root).ok, true);
assert.ok(bundle.manifest.harbor_skill_digests?.lamina);

function buildLaminaLock(manifest, stagedRoot) {
  const digests = manifest.harbor_skill_digests
    ?? buildExpectedHarborSkillDigests(stagedRoot, manifest.skills);
  return {
    trials: [{
      skills: manifest.skills.map((name) => ({
        name,
        source: path.join(stagedRoot, name),
        digest: digests[name],
      })),
    }],
  };
}

const laminaGate = evaluatePreModelSkillGate({
  arm: 'lamina',
  taskId: 'dev-loan-library',
  lock: buildLaminaLock(bundle.manifest, bundle.stagedRoot),
  stagedRoot: bundle.stagedRoot,
  manifest: bundle.manifest,
  root,
});
assert.equal(laminaGate.passed, true);

const missingSkills = evaluatePreModelSkillGate({
  arm: 'lamina',
  taskId: 'dev-loan-library',
  lock: { trials: [{ skills: [] }] },
  stagedRoot: bundle.stagedRoot,
  manifest: bundle.manifest,
  root,
});
assert.equal(missingSkills.passed, false);
assert.equal(missingSkills.priorNoSkill, true);

const baselineContaminated = evaluatePreModelSkillGate({
  arm: 'direct',
  taskId: 'dev-loan-library',
  lock: buildLaminaLock(bundle.manifest, bundle.stagedRoot),
  stagedRoot: bundle.stagedRoot,
  manifest: bundle.manifest,
  root,
});
assert.equal(baselineContaminated.passed, false);

const ledgerEntry = {
  event: 'pre_model_skill_gate',
  arm: 'lamina',
  task_id: 'dev-loan-library',
  passed: true,
  bundle_digest: bundle.manifest.aggregate_digest,
  container_path: '/home/agent/.cursor/skills',
  container_file_count: bundle.manifest.file_count,
  container_aggregate_digest: bundle.manifest.aggregate_digest,
  lamina_skill_absent: false,
};
const withLedger = evaluatePreModelSkillGate({
  arm: 'lamina',
  taskId: 'dev-loan-library',
  lock: buildLaminaLock(bundle.manifest, bundle.stagedRoot),
  ledgerEntries: [ledgerEntry],
  stagedRoot: bundle.stagedRoot,
  manifest: bundle.manifest,
  root,
  requireLedgerEvidence: true,
});
assert.equal(withLedger.passed, true);

for (const invalidLedger of [
  { ...ledgerEntry, container_file_count: 999 },
  { ...ledgerEntry, container_aggregate_digest: 'sha256:wrong' },
  { ...ledgerEntry, lamina_skill_absent: true },
]) {
  const invalidEvidence = evaluatePreModelSkillGate({
    arm: 'lamina',
    taskId: 'dev-loan-library',
    lock: buildLaminaLock(bundle.manifest, bundle.stagedRoot),
    ledgerEntries: [invalidLedger],
    stagedRoot: bundle.stagedRoot,
    manifest: bundle.manifest,
    root,
    requireLedgerEvidence: true,
  });
  assert.equal(invalidEvidence.passed, false);
  assert.equal(invalidEvidence.hasLedgerEvidence, false);
}

const baselineLedger = {
  ...ledgerEntry,
  arm: 'direct',
  container_file_count: 0,
  container_aggregate_digest: EMPTY_INVENTORY_DIGEST,
  lamina_skill_absent: true,
};
const baselineWithLedger = evaluatePreModelSkillGate({
  arm: 'direct',
  taskId: 'dev-loan-library',
  lock: { trials: [{ skills: [] }] },
  ledgerEntries: [baselineLedger],
  stagedRoot: bundle.stagedRoot,
  manifest: bundle.manifest,
  root,
  requireLedgerEvidence: true,
});
assert.equal(baselineWithLedger.passed, true);

const contaminatedBaselineLedger = {
  ...baselineLedger,
  container_file_count: bundle.manifest.file_count,
  container_aggregate_digest: bundle.manifest.aggregate_digest,
};
const contaminatedBaselineEvidence = evaluatePreModelSkillGate({
  arm: 'direct',
  taskId: 'dev-loan-library',
  lock: { trials: [{ skills: [] }] },
  ledgerEntries: [contaminatedBaselineLedger],
  stagedRoot: bundle.stagedRoot,
  manifest: bundle.manifest,
  root,
  requireLedgerEvidence: true,
});
assert.equal(contaminatedBaselineEvidence.passed, false);

const missingLedger = evaluatePreModelSkillGate({
  arm: 'lamina',
  taskId: 'dev-loan-library',
  lock: buildLaminaLock(bundle.manifest, bundle.stagedRoot),
  ledgerEntries: [],
  stagedRoot: bundle.stagedRoot,
  manifest: bundle.manifest,
  root,
  requireLedgerEvidence: true,
});
assert.equal(missingLedger.passed, false);
assert.equal(missingLedger.gate, 'pre_model_skill_gate_missing');

assert.equal(parsePilotJobName('lb6-pilot-dev-loan-library-direct-1'), null);
assert.equal(parsePilotJobName(makeJobName('dev-loan-library', 'direct', 1)).taskId, 'dev-loan-library');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb6-skill-bundle-'));
const tmpBundleRoot = path.join(tmp, 'benchmarks/lb6/pilot/skill-bundle');
fs.cpSync(path.join(root, 'benchmarks/lb6/pilot/skill-bundle'), tmpBundleRoot, { recursive: true });
const tampered = JSON.parse(fs.readFileSync(path.join(tmpBundleRoot, 'manifest.json'), 'utf8'));
tampered.files[0].sha256 = 'deadbeef';
assert.equal(verifyStagedSkillBundle(tmp, tampered).ok, false);

const schedule = schedulePilotCells(selectedTasks, 6, MAX_LAMINA_PARENTS);
assert.equal(schedule.length, 12);
assert.equal(schedule[0].taskId, 'dev-loan-library');
assert.equal(schedule[0].arm, 'lamina');
const laminaPerWave = new Map();
for (const slot of schedule) {
  laminaPerWave.set(slot.wave, (laminaPerWave.get(slot.wave) || 0) + (slot.arm === 'lamina' ? 1 : 0));
}
for (const count of laminaPerWave.values()) {
  assert.ok(count <= MAX_LAMINA_PARENTS);
}

const laminaArgs = buildHarborArgs({
  arm: 'lamina',
  taskDirName: 'dev-loan-library-lamina',
  jobName: makeJobName('dev-loan-library', 'lamina', 1),
  envFile: '/tmp/.env',
  skillPaths: [path.join(root, 'benchmarks/lb6/pilot/skill-bundle/staged/lamina')],
});
assert.ok(laminaArgs.includes('--skills'));
assert.ok(!buildHarborArgs({
  arm: 'direct',
  taskDirName: 'dev-loan-library-direct',
  jobName: makeJobName('dev-loan-library', 'direct', 1),
  envFile: '/tmp/.env',
}).includes('--skills'));

assert.equal(classifyCellFailure({ stderr: 'resource_exhausted from provider' }).failFast, true);
assert.equal(classifyCellFailure({ stderr: 'usage limit exceeded' }).failFast, true);
assert.equal(classifyCellFailure({ stderr: 'model mismatch for child_actual_model' }).failFast, true);
assert.equal(classifyCellFailure({ stderr: 'skill injection digest mismatch' }).failFast, true);

const cluster = buildTaskCluster('dev-loan-library', [
  { taskId: 'dev-loan-library', arm: 'direct', ok: true, measurementValid: true, reward: 1 },
  { taskId: 'dev-loan-library', arm: 'plan', ok: true, measurementValid: true, reward: 1 },
  {
    taskId: 'dev-loan-library',
    arm: 'lamina',
    ok: true,
    measurementValid: false,
    reward: 0.8,
    skillEvidence: { passed: false, priorNoSkill: true },
    priorNoSkill: true,
  },
]);
assert.equal(cluster.deltas.lamina_minus_direct, null);
assert.equal(cluster.laminaDeltaSuppressed, true);
assert.equal(laminaDeltaEligible(cluster.cells[2]), false);

assert.deepEqual(
  orderCellsForAdmission(['dev-loan-library', 'dev-toggle-preference']).map((cell) => `${cell.taskId}/${cell.arm}`).slice(0, 2),
  ['dev-loan-library/lamina', 'dev-loan-library/direct'],
);

console.log('lb6 pilot skill-rerun tests passed');
