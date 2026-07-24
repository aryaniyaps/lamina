import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gradePilotBehavior } from '../benchmarks/lb6/pilot/lib/pilot-behavior-grade.mjs';
import { checkPilotLaminaTreatment } from '../benchmarks/lb6/pilot/lib/pilot-treatment.mjs';
import { scanPilotPackage, scoringSensitiveStringsByTaskIdFromManifest } from '../benchmarks/lb6/pilot/lib/secret-scan.mjs';
import {
  AGENT_BUDGET_SEC,
  BENCHMARK_VERSION,
  HARBOR_AGENT,
  HARBOR_MODEL,
  LAMINA_STEPS,
  PILOT_ARMS,
} from '../benchmarks/lb6/pilot/lib/constants.mjs';
import { verifyStagedSkillBundle } from '../benchmarks/lb6/pilot/lib/skill-bundle.mjs';
import {
  buildHarborArgs,
  discoverPilotTasks,
  HARBOR_MODEL as RUNNER_MODEL,
  PILOT_ARMS as RUNNER_ARMS,
  schedulePilotCells,
} from '../benchmarks/lb6/pilot/scripts/run-three-arm.mjs';
import { runBehaviorSelfcheck } from '../benchmarks/lib/behavior-selfcheck.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pilotRoot = path.join(root, 'benchmarks/lb6/pilot');
const tasksRoot = path.join(pilotRoot, 'harbor/tasks-v3');
const privateVerifierRoot = path.join(pilotRoot, 'private-verifier-v3');
const legacyTasksRoot = path.join(pilotRoot, 'harbor/tasks');
const manifest = JSON.parse(fs.readFileSync(path.join(pilotRoot, 'corpus/manifest.json'), 'utf8'));

function runNode(scriptRel, args = []) {
  const scriptPath = path.join(root, scriptRel);
  const result = spawnSync(process.execPath, [scriptPath, ...args], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${scriptRel} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`.trim();
}

const selectedNewTasks = manifest.pilot.default_run_tasks;
runNode('benchmarks/lb6/pilot/scripts/build-pilot.mjs', ['--tasks', selectedNewTasks.join(',')]);
const validateOut = runNode('benchmarks/lb6/pilot/scripts/validate-pilot.mjs', [
  '--tasks',
  selectedNewTasks.join(','),
]);
assert.match(validateOut, /LB6 pilot valid/);

const pkg = JSON.parse(fs.readFileSync(path.join(pilotRoot, 'package.manifest-v3.json'), 'utf8'));
assert.equal(pkg.development_only, true);
assert.equal(pkg.confirmatory, false);
assert.equal(pkg.child_actual_model_unverified, true);
assert.equal(pkg.benchmark_version, BENCHMARK_VERSION);
assert.deepEqual(pkg.arms, [...PILOT_ARMS]);
assert.equal(pkg.not_claim_ready, true);
assert.ok(pkg.skill_bundle_digest);
assert.equal(verifyStagedSkillBundle(root).ok, true);
assert.deepEqual(pkg.task_ids, manifest.tasks.map((task) => task.id));
assert.equal(LAMINA_STEPS.reduce((sum, step) => sum + step.agentTimeout, 0), AGENT_BUDGET_SEC);

assert.equal(manifest.tasks.length, 5);
assert.equal(manifest.agent, HARBOR_AGENT);
assert.equal(manifest.model, HARBOR_MODEL);

const discovery = discoverPilotTasks(tasksRoot);
assert.equal(discovery.ok, true);
assert.deepEqual(discovery.taskIds, selectedNewTasks.slice().sort());
assert.deepEqual(discovery.selectedTaskIds, discovery.taskIds);
for (const task of manifest.tasks) {
  if (task.id === 'dev-care-circle') continue;
  for (const arm of RUNNER_ARMS) {
    assert.equal(discovery.byTaskArm[task.id][arm], `${task.id}-${arm}-v3`);
  }
}

const newTasks = manifest.pilot.default_run_tasks;
const schedule = schedulePilotCells(newTasks);
assert.equal(schedule.length, newTasks.length * PILOT_ARMS.length);
assert.equal(schedule[0].taskId, 'dev-loan-library');
assert.equal(schedule[0].arm, 'lamina');
const laminaPerWave = new Map();
for (const slot of schedule) {
  laminaPerWave.set(slot.wave, (laminaPerWave.get(slot.wave) || 0) + (slot.arm === 'lamina' ? 1 : 0));
}
for (const count of laminaPerWave.values()) {
  assert.ok(count <= 1, `wave had ${count} Lamina parents`);
}
assert.ok(schedule.slice(0, 6).every((slot) => slot.wave === 1));

const dryArgs = buildHarborArgs({
  arm: 'direct',
  taskDirName: 'dev-care-circle-direct',
  jobName: 'lb6-pilot-dev-care-circle-direct-test',
  envFile: path.join(root, '.env'),
});
assert.ok(dryArgs.includes('cursor-cli'));
assert.ok(dryArgs.includes('cursor/composer-2.5'));
assert.ok(dryArgs.includes('--n-attempts'));
assert.equal(dryArgs[dryArgs.indexOf('--n-attempts') + 1], '1');
assert.ok(!dryArgs.includes('--skills'));

const laminaDryArgs = buildHarborArgs({
  arm: 'lamina',
  taskDirName: 'dev-loan-library-lamina',
  jobName: 'lb6-pilot-dev-loan-library-lamina-test',
  envFile: path.join(root, '.env'),
  skillPaths: ['benchmarks/lb6/pilot/skill-bundle/staged/lamina'],
});
assert.ok(laminaDryArgs.includes('--skills'));

for (const task of manifest.tasks) {
  if (task.id === 'dev-care-circle') continue;
  for (const arm of PILOT_ARMS) {
    const dir = path.join(tasksRoot, `${task.id}-${arm}-v3`);
    const toml = fs.readFileSync(path.join(dir, 'task.toml'), 'utf8');
    if (task.id !== 'dev-care-circle') {
      assert.match(toml, new RegExp(`benchmark_version = "${BENCHMARK_VERSION}"`));
    }
    assert.match(toml, /development_only = true/);
    assert.match(toml, /confirmatory = false/);
    assert.match(toml, /child_actual_model_unverified = true/);
    assert.match(toml, /host_sealed_supervisor_required = true/);
    assert.match(toml, new RegExp(`timeout_sec = ${AGENT_BUDGET_SEC}\\.0`));
    assert.doesNotMatch(toml, /checklist|claude|sonnet|harbor-v4/i);

    const finalStep = arm === 'lamina' ? 'fix' : 'verify_fix';
    const allSteps = fs
      .readdirSync(path.join(dir, 'steps'), { withFileTypes: true })
      .map((entry) => entry.name);

    for (const step of allSteps) {
      const testsDir = path.join(dir, 'steps', step, 'tests');
      assert.deepEqual(fs.readdirSync(testsDir), ['test.sh']);
      const tripwire = fs.readFileSync(path.join(testsDir, 'test.sh'), 'utf8');
      assert.match(tripwire, /protocol_invalid/);
      assert.match(tripwire, /exit 97/);
    }

    const finalGrade = fs.readFileSync(
      path.join(privateVerifierRoot, task.id, arm, 'grade.mjs'),
      'utf8',
    );
    assert.match(finalGrade, /gradePilotBehavior/);
    assert.match(finalGrade, /base64/);
    assert.doesNotMatch(finalGrade, /"expect"|must_not_include|"escalat"/);
    assert.match(finalGrade, /root: '\/candidate'/);
    assert.match(finalGrade, /treatmentRoot: '\/treatment'/);

    const shapingStep = arm === 'lamina' ? 'implement' : 'shape_build';
    const shapingInstruction = fs.readFileSync(
      path.join(dir, 'steps', shapingStep, 'instruction.md'),
      'utf8',
    );
    assert.doesNotMatch(shapingInstruction, /Published action schema|add_note|selfcheck\.mjs|\.lb6-abi/i);
  }
}

const secretFindings = scanPilotPackage(
  tasksRoot,
  manifest.tasks
    .filter((task) => task.id !== 'dev-care-circle')
    .flatMap((task) =>
      PILOT_ARMS.map((arm) => ({
        taskId: task.id,
        arm,
        taskDirName: `${task.id}-${arm}-v3`,
        finalStep: arm === 'lamina' ? 'fix' : 'verify_fix',
      })),
    ),
  { scoringSensitiveStringsByTaskId: scoringSensitiveStringsByTaskIdFromManifest(manifest) },
);
assert.equal(secretFindings.length, 0);

const reviewAbi = fs.readFileSync(
  path.join(tasksRoot, 'dev-review-room-direct-v3/steps/verify_fix/workdir/.lb6-abi/public-abi.json'),
  'utf8',
);
assert.doesNotMatch(reviewAbi, /looks good|should not appear after/i);

const laminaDesign = fs.readFileSync(
  path.join(legacyTasksRoot, 'dev-care-circle-lamina/steps/lamina_design/instruction.md'),
  'utf8',
);
assert.match(laminaDesign, /taskToolCall|native Task/i);
assert.match(laminaDesign, /child_actual_model_unverified/i);

const golden = manifest.tasks.find((task) => task.id === 'dev-care-circle').golden;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb6-pilot-'));

function writeApp(dir, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.mjs'), body);
}

const goodApp = `export function createInitialState(){return{tasks:{},notes:[],revoked:[]}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.type==='add_task'){s.tasks[action.id]={id:action.id,title:action.title,status:'open'};return s}
  if(action.type==='mark_missed'){if(s.tasks[action.id]) s.tasks[action.id].status='missed_escalated';return s}
  if(action.type==='complete_task'){if(s.tasks[action.id]) s.tasks[action.id].status='done';return s}
  if(action.type==='add_note'){s.notes.push({id:action.id,text:action.text,visibility:'private note'});return s}
  if(action.type==='revoke_caregiver'){s.revoked.push(action.actor);return s}
  return s;
}
export function project(state,actor){
  if(state.revoked.includes(actor)) return {denied:'revoked',access:false};
  return {tasks:state.tasks,notes:state.notes,private:'private note'};
}`;

writeApp(path.join(tmp, 'good'), goodApp);
let directGood = await gradePilotBehavior({
  root: path.join(tmp, 'good'),
  golden,
  arm: 'direct',
  phase: 'verify_fix',
  taskId: 'dev-care-circle',
});
assert.equal(directGood.reward, 0);
assert.equal(directGood.measurement_invalid, true, 'canonical v3 grader must refuse the frozen legacy rubric');

writeApp(path.join(tmp, 'noop'), 'export function createInitialState(){return{}} export function reduce(s){return s} export function project(){return{}}');
let noop = await gradePilotBehavior({
  root: path.join(tmp, 'noop'),
  golden,
  arm: 'direct',
  phase: 'verify_fix',
  taskId: 'dev-care-circle',
});
assert.equal(noop.reward, 0);

const laminaRoot = path.join(tmp, 'lamina-valid', '.lamina');
fs.mkdirSync(path.join(laminaRoot, 'runs/run-1'), { recursive: true });
fs.writeFileSync(path.join(laminaRoot, 'business-context.md'), '# charter');
fs.writeFileSync(path.join(laminaRoot, 'personas.json'), '{"contract_version":"2.0","personas":[]}');
fs.writeFileSync(path.join(laminaRoot, 'runs/run-1/run.json'), JSON.stringify({ status: 'ready_to_build' }));
fs.writeFileSync(path.join(laminaRoot, 'runs/run-1/implement.md'), '# implement');
writeApp(path.join(tmp, 'lamina-valid'), goodApp);

let laminaTreatment = checkPilotLaminaTreatment(path.join(tmp, 'lamina-valid'), 'fix');
assert.equal(laminaTreatment.valid, true);
let laminaGood = await gradePilotBehavior({
  root: path.join(tmp, 'lamina-valid'),
  golden,
  arm: 'lamina',
  phase: 'fix',
  taskId: 'dev-care-circle',
});
assert.equal(laminaGood.reward, 0);
assert.equal(laminaGood.measurement_invalid, true);
assert.equal(laminaGood.child_actual_model_unverified, true);

let laminaMissing = await gradePilotBehavior({
  root: path.join(tmp, 'good'),
  golden,
  arm: 'lamina',
  phase: 'fix',
  taskId: 'dev-care-circle',
});
assert.equal(laminaMissing.reward, 0);
assert.equal(laminaMissing.invalid_treatment, true);

let selfcheck = await runBehaviorSelfcheck({ root: path.join(tmp, 'good'), golden });
assert.equal(selfcheck.ok, true);
assert.ok(!JSON.stringify(selfcheck).includes('escalat'));

const builtSelfcheck = fs.readFileSync(
  path.join(legacyTasksRoot, 'dev-care-circle-direct/steps/verify_fix/workdir/.lb6-abi/selfcheck.mjs'),
  'utf8',
);
assert.doesNotMatch(builtSelfcheck, /"expect"|must_not_include|escalat/);

assert.notEqual(RUNNER_MODEL, 'sonnet');

console.log('lb6 pilot three-arm package tests passed');
