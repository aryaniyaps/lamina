#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_BUDGET_SEC,
  AGENT_RUNTIME_IMAGE,
  BASELINE_STEPS,
  BENCHMARK_VERSION,
  HARBOR_AGENT,
  HARBOR_MODEL,
  HARBOR_VERSION,
  LAMINA_STEPS,
  PILOT_ARMS,
  REQUIRED_PERSONA_CHILDREN,
  SKILL_RERUN_CAMPAIGN_ID,
} from '../lib/constants.mjs';
import { verifyStagedSkillBundle } from '../lib/skill-bundle.mjs';
import { scanPilotPackage, scoringSensitiveStringsByTaskIdFromManifest } from '../lib/secret-scan.mjs';
import {
  assertBuildSelectionAllowed,
  parseMigrateFrozen,
  parseSelectedTaskIds,
  publishedFrozenTaskIds,
} from '../lib/frozen-tasks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const PILOT_ROOT = path.join(ROOT, 'benchmarks/lb6/pilot');
const tasksRoot = path.join(PILOT_ROOT, 'harbor/tasks-v3');
const privateVerifierRoot = path.join(PILOT_ROOT, 'private-verifier-v3');
const legacyTasksRoot = path.join(PILOT_ROOT, 'harbor/tasks');
const legacyPrivateVerifierRoot = path.join(PILOT_ROOT, 'private-verifier');
const manifestPath = path.join(PILOT_ROOT, 'corpus/manifest.json');
const packageManifestPath = path.join(PILOT_ROOT, 'package.manifest-v3.json');
const errors = [];
const SEMANTIC_CRITERION_KINDS = new Set([
  'entity_present',
  'entity_absent',
  'entities_present',
  'field_equals',
  'field_not_equals',
  'capability_paused',
  'state_unchanged_or_field_equals',
  'field_contains',
  'state_contains',
  'secret_absent',
  'view_changed',
  'state_unchanged',
  'view_unchanged',
]);

function finalStepForArm(arm) {
  return arm === 'lamina' ? 'fix' : 'verify_fix';
}

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function validatePackageManifest(manifest) {
  if (!fs.existsSync(packageManifestPath)) {
    errors.push('missing package.manifest-v3.json — run build-pilot.mjs first');
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(packageManifestPath, 'utf8'));
  for (const key of ['development_only', 'confirmatory', 'child_actual_model_unverified']) {
    if (pkg[key] !== manifest[key]) {
      errors.push(`package.manifest-v3.json ${key} mismatch`);
    }
  }
  if (pkg.benchmark_version !== BENCHMARK_VERSION) {
    errors.push(`package.manifest-v3.json benchmark_version must be ${BENCHMARK_VERSION}`);
  }
  if (pkg.not_claim_ready !== true) {
    errors.push('package.manifest-v3.json must set not_claim_ready=true');
  }
  if (pkg.campaign_id !== SKILL_RERUN_CAMPAIGN_ID) {
    errors.push(`package.manifest-v3.json campaign_id must be ${SKILL_RERUN_CAMPAIGN_ID}`);
  }
  if (!pkg.skill_bundle_digest) {
    errors.push('package.manifest-v3.json must include skill_bundle_digest');
  }
  const bundleCheck = verifyStagedSkillBundle(ROOT);
  if (!bundleCheck.ok) {
    errors.push(`skill bundle verification failed: ${bundleCheck.reason}`);
  }
  const manifestTaskIds = manifest.tasks.map((task) => task.id).sort();
  const packageTaskIds = [...(pkg.task_ids || [])].sort();
  if (JSON.stringify(packageTaskIds) !== JSON.stringify(manifestTaskIds)) {
    errors.push('package.manifest-v3.json task_ids must match manifest.tasks');
  }
}

function validateTaskCount(manifest) {
  const expectedDirs = manifest.tasks.filter(
    (task) => !publishedFrozenTaskIds(manifest).includes(task.id),
  ).length * PILOT_ARMS.length;
  const dirs = fs.existsSync(tasksRoot)
    ? fs.readdirSync(tasksRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  if (dirs.length !== expectedDirs) {
    errors.push(`expected ${expectedDirs} task directories, found ${dirs.length}`);
  }
  if (dirs.some((name) => /checklist/i.test(name))) {
    errors.push('checklist arm/task is forbidden');
  }

  const expectedNames = new Set(
    manifest.tasks
      .filter((task) => !publishedFrozenTaskIds(manifest).includes(task.id))
      .flatMap((task) => PILOT_ARMS.map((arm) => `${task.id}-${arm}-v3`)),
  );
  for (const name of dirs) {
    if (!expectedNames.has(name)) {
      errors.push(`unexpected task directory: ${name}`);
    }
  }
  for (const name of expectedNames) {
    if (!dirs.includes(name)) {
      errors.push(`missing task directory: ${name}`);
    }
  }
}

function validateSemanticRubric(task) {
  if (!task.projection_contract || !Array.isArray(task.projection_contract.actors)) {
    errors.push(`${task.id}: missing typed projection_contract actors`);
  }
  const sequences = task.golden?.sequences ?? [];
  const sequenceIds = sequences.map((sequence) => sequence.id);
  if (sequenceIds.some((id) => !id) || new Set(sequenceIds).size !== sequenceIds.length) {
    errors.push(`${task.id}: semantic sequence ids must be present and unique`);
  }
  const criteria = sequences.flatMap((sequence) => sequence.criteria ?? []);
  const total = criteria.reduce((sum, criterion) => sum + Number(criterion.weight ?? 1), 0);
  if (total !== 10) errors.push(`${task.id}: semantic criterion weights total ${total}; expected 10`);
  const ids = criteria.map((criterion) => criterion.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    errors.push(`${task.id}: semantic criterion ids must be present and unique`);
  }
  for (const criterion of criteria) {
    if (!SEMANTIC_CRITERION_KINDS.has(criterion.kind)) {
      errors.push(`${task.id}: unsupported semantic criterion kind ${criterion.kind}`);
    }
    const weight = Number(criterion.weight ?? 1);
    if (!Number.isFinite(weight) || weight <= 0) {
      errors.push(`${task.id}/${criterion.id}: criterion weight must be positive and finite`);
    }
  }
  for (const sequence of sequences) {
    const actionCount = sequence.actions?.length ?? 0;
    for (const criterion of sequence.criteria ?? []) {
      if (!Number.isInteger(criterion.after) || criterion.after < 1 || criterion.after > actionCount) {
        errors.push(`${task.id}/${criterion.id}: checkpoint after must be within 1..${actionCount}`);
      }
      if (['entity_present', 'entity_absent'].includes(criterion.kind) && !criterion.entity_id) {
        errors.push(`${task.id}/${criterion.id}: ${criterion.kind} requires entity_id`);
      }
      if (criterion.kind === 'entities_present' && (!Array.isArray(criterion.entity_ids) || !criterion.entity_ids.length)) {
        errors.push(`${task.id}/${criterion.id}: entities_present requires entity_ids`);
      }
      if (['field_equals', 'field_not_equals', 'state_unchanged_or_field_equals'].includes(criterion.kind)) {
        if (!Array.isArray(criterion.fields) || !criterion.fields.length || !Array.isArray(criterion.accepted) || !criterion.accepted.length) {
          errors.push(`${task.id}/${criterion.id}: ${criterion.kind} requires fields and accepted values`);
        }
      }
      if (criterion.kind === 'capability_paused') {
        const fields = [...(criterion.paused_fields ?? []), ...(criterion.enabled_fields ?? [])];
        if (!criterion.entity_id || !fields.length) {
          errors.push(`${task.id}/${criterion.id}: capability_paused requires entity_id and capability fields`);
        }
      }
      if (['state_contains', 'secret_absent'].includes(criterion.kind) && criterion.value === undefined) {
        errors.push(`${task.id}/${criterion.id}: ${criterion.kind} requires value`);
      }
    }
  }
  if ((task.golden?.sequences ?? []).some((sequence) => sequence.expect || sequence.must_not_include)) {
    errors.push(`${task.id}: v3 rubric must not use substring expect/must_not_include scoring`);
  }
}

function validateTaskDir(task, arm) {
  const dir = path.join(tasksRoot, `${task.id}-${arm}-v3`);
  const steps = arm === 'lamina' ? LAMINA_STEPS.map((s) => s.name) : BASELINE_STEPS.map((s) => s.name);
  const finalStep = finalStepForArm(arm);

  for (const step of steps) {
    for (const file of [`steps/${step}/instruction.md`, `steps/${step}/tests/test.sh`]) {
      if (!fs.existsSync(path.join(dir, file))) errors.push(`${dir}: missing ${file}`);
    }
    const testFiles = fs.readdirSync(path.join(dir, `steps/${step}/tests`));
    if (testFiles.length !== 1 || testFiles[0] !== 'test.sh') {
      errors.push(`${dir}: step ${step} agent package may contain only the stock-verifier tripwire`);
    }
    const tripwire = fs.readFileSync(path.join(dir, `steps/${step}/tests/test.sh`), 'utf8');
    if (!/protocol_invalid/.test(tripwire) || !/exit 97/.test(tripwire)) {
      errors.push(`${dir}: step ${step} must fail closed if stock Harbor verification runs`);
    }
  }

  for (const file of ['task.toml', 'environment/Dockerfile']) {
    if (!fs.existsSync(path.join(dir, file))) errors.push(`${dir}: missing ${file}`);
  }

  const toml = fs.readFileSync(path.join(dir, 'task.toml'), 'utf8');
  if (!toml.includes(`benchmark_version = "${BENCHMARK_VERSION}"`)) {
    errors.push(`${dir}: expected benchmark_version=${BENCHMARK_VERSION}`);
  }
  if (!toml.includes(`campaign_id = "${SKILL_RERUN_CAMPAIGN_ID}"`)) {
    errors.push(`${dir}: expected campaign_id=${SKILL_RERUN_CAMPAIGN_ID}`);
  }
  if (/harbor-v4|lamina-bench-6/i.test(toml)) {
    errors.push(`${dir}: must not reference harbor-v4 or lamina-bench-6`);
  }
  if (/claude|sonnet|checklist/i.test(toml)) {
    errors.push(`${dir}: forbidden claude/sonnet/checklist vocabulary in task.toml`);
  }
  if (!toml.includes(`development_only = true`)) errors.push(`${dir}: missing development_only=true`);
  if (!toml.includes(`confirmatory = false`)) errors.push(`${dir}: missing confirmatory=false`);
  if (!toml.includes(`child_actual_model_unverified = true`)) {
    errors.push(`${dir}: missing child_actual_model_unverified=true`);
  }
  if (!toml.includes('host_sealed_supervisor_required = true')) {
    errors.push(`${dir}: missing host_sealed_supervisor_required=true`);
  }
  if (!toml.includes(`agent = "${HARBOR_AGENT}"`)) errors.push(`${dir}: expected agent=${HARBOR_AGENT}`);
  if (!toml.includes(`model = "${HARBOR_MODEL}"`)) errors.push(`${dir}: expected model=${HARBOR_MODEL}`);
  if (!toml.includes(`timeout_sec = ${AGENT_BUDGET_SEC}.0`)) {
    errors.push(`${dir}: expected matched agent timeout ${AGENT_BUDGET_SEC}s`);
  }
  if (!toml.includes(`docker_image = "${AGENT_RUNTIME_IMAGE}"`)) {
    errors.push(`${dir}: expected shared prebuilt agent runtime ${AGENT_RUNTIME_IMAGE}`);
  }

  for (const step of steps) {
    const instruction = fs.readFileSync(path.join(dir, `steps/${step}/instruction.md`), 'utf8');
    if (/must_not_include|"expect"\s*:/.test(instruction)) {
      errors.push(`${dir}: step ${step} instruction leaks graded assertions`);
    }
  }

  const shapingStep = arm === 'lamina' ? 'implement' : 'shape_build';
  const shapingInstruction = fs.readFileSync(path.join(dir, `steps/${shapingStep}/instruction.md`), 'utf8');
  if (/Published action schema|add_note|selfcheck\.mjs|\.lb6-abi/i.test(shapingInstruction)) {
    errors.push(`${dir}: pre-seal shaping instruction exposes future ABI material`);
  }

  const abiDir = path.join(dir, `steps/${finalStep}/workdir/.lb6-abi`);
  for (const file of ['public-abi.json', 'selfcheck.mjs', 'behavior-selfcheck.mjs']) {
    if (!fs.existsSync(path.join(abiDir, file))) errors.push(`${dir}: missing ABI payload ${file}`);
  }
  const publicAbiPath = path.join(abiDir, 'public-abi.json');
  if (fs.existsSync(publicAbiPath)) {
    const publicAbi = JSON.parse(fs.readFileSync(publicAbiPath, 'utf8'));
    if (publicAbi.contract_version !== 'lb6-pilot-semantic-abi-v3') {
      errors.push(`${dir}: expected semantic ABI v3`);
    }
    if (publicAbi.scoring_protocol?.behavior_points !== 10) {
      errors.push(`${dir}: public ABI must disclose ten behavior points`);
    }
    if (JSON.stringify(publicAbi).includes('__lb6_unknown_context_probe')) {
      errors.push(`${dir}: public ABI leaked the hidden unknown-action probe`);
    }
  }

  const privateDir = path.join(privateVerifierRoot, task.id, arm);
  for (const file of ['grade.mjs', 'behavior-grade.mjs', 'behavior-replay-worker.mjs', 'pilot-behavior-grade.mjs', 'pilot-treatment.mjs']) {
    if (!fs.existsSync(path.join(privateDir, file))) errors.push(`${dir}: missing private verifier ${file}`);
  }
  const finalGrade = fs.existsSync(path.join(privateDir, 'grade.mjs'))
    ? fs.readFileSync(path.join(privateDir, 'grade.mjs'), 'utf8')
    : '';
  if (!/gradePilotBehavior/.test(finalGrade)) {
    errors.push(`${dir}: private final verifier must use gradePilotBehavior`);
  }
  if (!/base64/.test(finalGrade)) {
    errors.push(`${dir}: private final verifier must embed opaque golden payload`);
  }
  if (/"expect"|must_not_include|"escalat"/.test(finalGrade)) {
    errors.push(`${dir}: private final verifier must not contain plaintext graded expects`);
  }
  if (!/root: '\/candidate'/.test(finalGrade) || !/treatmentRoot: '\/treatment'/.test(finalGrade)) {
    errors.push(`${dir}: private verifier must score only isolated candidate/treatment mounts`);
  }

  if (arm === 'lamina') {
    const design = fs.readFileSync(path.join(dir, 'steps/lamina_design/instruction.md'), 'utf8');
    if (!/\/lamina-design/.test(design)) errors.push(`${dir}: lamina_design must command /lamina-design`);
    if (!/taskToolCall|native Task|Task\/subagent/i.test(design)) {
      errors.push(`${dir}: lamina_design must require native Task persona children`);
    }
    if (!new RegExp(String(REQUIRED_PERSONA_CHILDREN)).test(design)) {
      errors.push(`${dir}: lamina_design must require at least ${REQUIRED_PERSONA_CHILDREN} persona children`);
    }
    if (!/child_actual_model_unverified/i.test(design)) {
      errors.push(`${dir}: lamina_design must document child_actual_model_unverified envelope`);
    }
    const init = fs.readFileSync(path.join(dir, 'steps/lamina_init/instruction.md'), 'utf8');
    if (!/\/lamina-init/.test(init)) errors.push(`${dir}: lamina_init must command /lamina-init`);
  } else {
    if (arm === 'direct') {
      const shape = fs.readFileSync(path.join(dir, 'steps/shape_build/instruction.md'), 'utf8');
      if (/\/lamina-init|\/lamina-design|checklist workflow/i.test(shape)) {
        errors.push(`${dir}: direct arm must not instruct Lamina workflow or checklist`);
      }
    } else if (arm === 'plan') {
      const shape = fs.readFileSync(path.join(dir, 'steps/shape_build/instruction.md'), 'utf8');
      if (!/plan-first|short plan/i.test(shape)) {
        errors.push(`${dir}: plan arm must instruct plan-first workflow`);
      }
    }
  }
}

function validateFrozenTaskDirBasic(task, arm) {
  const dir = path.join(legacyTasksRoot, `${task.id}-${arm}`);
  for (const file of ['task.toml', 'environment/Dockerfile']) {
    if (!fs.existsSync(path.join(dir, file))) errors.push(`${dir}: missing ${file}`);
  }
  const toml = fs.existsSync(path.join(dir, 'task.toml'))
    ? fs.readFileSync(path.join(dir, 'task.toml'), 'utf8')
    : '';
  if (!toml.includes(`development_only = true`)) errors.push(`${dir}: missing development_only=true`);
  if (!toml.includes(`confirmatory = false`)) errors.push(`${dir}: missing confirmatory=false`);
  if (!toml.includes(`child_actual_model_unverified = true`)) {
    errors.push(`${dir}: missing child_actual_model_unverified=true`);
  }
  if (/checklist|claude|sonnet|harbor-v4/i.test(toml)) {
    errors.push(`${dir}: forbidden vocabulary in published frozen task.toml`);
  }
  const privateDir = path.join(legacyPrivateVerifierRoot, task.id, arm);
  if (!fs.existsSync(path.join(privateDir, 'grade.mjs'))) {
    errors.push(`${dir}: missing published frozen private verifier grade.mjs`);
  }
}

const manifest = readManifest();
const selectedTaskIds = parseSelectedTaskIds(process.argv.slice(2));
const migrateFrozen = parseMigrateFrozen(process.argv.slice(2));
const frozenTaskIds = publishedFrozenTaskIds(manifest);
const frozenSet = new Set(frozenTaskIds);

if (selectedTaskIds?.length) {
  assertBuildSelectionAllowed(selectedTaskIds, manifest, { migrateFrozen });
}

validatePackageManifest(manifest);
validateTaskCount(manifest);

for (const task of manifest.tasks) {
  if (!frozenSet.has(task.id)) validateSemanticRubric(task);
  for (const arm of PILOT_ARMS) {
    if (frozenSet.has(task.id)) {
      validateFrozenTaskDirBasic(task, arm);
      continue;
    }
    if (selectedTaskIds?.length && !selectedTaskIds.includes(task.id)) {
      continue;
    }
    validateTaskDir(task, arm);
  }
}

const secretScanTasks = manifest.tasks.filter((task) => {
  if (frozenSet.has(task.id)) return false;
  if (selectedTaskIds?.length) return selectedTaskIds.includes(task.id);
  return true;
});

const secretFindings = scanPilotPackage(
  tasksRoot,
  secretScanTasks.flatMap((task) =>
    PILOT_ARMS.map((arm) => ({
      taskId: task.id,
      arm,
      taskDirName: `${task.id}-${arm}-v3`,
      finalStep: finalStepForArm(arm),
    })),
  ),
  { scoringSensitiveStringsByTaskId: scoringSensitiveStringsByTaskIdFromManifest(manifest) },
);
for (const finding of secretFindings) {
  errors.push(`${finding.task}: ${finding.kind} in ${finding.file}`);
}

if (manifest.harbor_version !== HARBOR_VERSION) {
  errors.push(`manifest.harbor_version must be ${HARBOR_VERSION}`);
}
if (manifest.agent !== HARBOR_AGENT || manifest.model !== HARBOR_MODEL) {
  errors.push(`manifest must pin ${HARBOR_AGENT} / ${HARBOR_MODEL}`);
}
if (JSON.stringify(frozenTaskIds) !== JSON.stringify(['dev-care-circle'])) {
  errors.push('manifest.published_frozen_task_ids must include dev-care-circle');
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

const validatedCount = secretScanTasks.length;
console.log(
  `LB6 pilot valid: ${manifest.tasks.length} tasks × ${PILOT_ARMS.length} arms (${PILOT_ARMS.join(', ')}), ` +
    `full validation on ${validatedCount} task(s), frozen basic checks on ${frozenTaskIds.length}, ` +
    `${AGENT_BUDGET_SEC}s budget, development_only.`,
);
