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
} from '../lib/constants.mjs';
import { scanPilotPackage } from '../lib/secret-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const PILOT_ROOT = path.join(ROOT, 'benchmarks/lb6/pilot');
const tasksRoot = path.join(PILOT_ROOT, 'harbor/tasks');
const privateVerifierRoot = path.join(PILOT_ROOT, 'private-verifier');
const manifestPath = path.join(PILOT_ROOT, 'corpus/manifest.json');
const packageManifestPath = path.join(PILOT_ROOT, 'package.manifest.json');
const errors = [];

function finalStepForArm(arm) {
  return arm === 'lamina' ? 'fix' : 'verify_fix';
}

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function validatePackageManifest(manifest) {
  if (!fs.existsSync(packageManifestPath)) {
    errors.push('missing package.manifest.json — run build-pilot.mjs first');
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(packageManifestPath, 'utf8'));
  for (const key of ['development_only', 'confirmatory', 'child_actual_model_unverified']) {
    if (pkg[key] !== manifest[key]) {
      errors.push(`package.manifest.json ${key} mismatch`);
    }
  }
  if (pkg.benchmark_version !== BENCHMARK_VERSION) {
    errors.push(`package.manifest.json benchmark_version must be ${BENCHMARK_VERSION}`);
  }
  if (pkg.not_claim_ready !== true) {
    errors.push('package.manifest.json must set not_claim_ready=true');
  }
}

function validateTaskCount(manifest) {
  if (manifest.tasks.length !== 1) {
    errors.push('manifest must contain exactly one task');
  }
  const dirs = fs.existsSync(tasksRoot)
    ? fs.readdirSync(tasksRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  if (dirs.length !== PILOT_ARMS.length) {
    errors.push(`expected ${PILOT_ARMS.length} task directories, found ${dirs.length}`);
  }
  if (dirs.some((name) => /checklist/i.test(name))) {
    errors.push('checklist arm/task is forbidden');
  }
}

function validateTaskDir(task, arm) {
  const dir = path.join(tasksRoot, `${task.id}-${arm}`);
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

  const privateDir = path.join(privateVerifierRoot, task.id, arm);
  for (const file of ['grade.mjs', 'behavior-grade.mjs', 'pilot-behavior-grade.mjs', 'pilot-treatment.mjs']) {
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

const manifest = readManifest();
validatePackageManifest(manifest);
validateTaskCount(manifest);

const task = manifest.tasks[0];
for (const arm of PILOT_ARMS) validateTaskDir(task, arm);

const secretFindings = scanPilotPackage(
  tasksRoot,
  PILOT_ARMS.map((arm) => ({ taskId: task.id, arm, finalStep: finalStepForArm(arm) })),
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

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(
  `LB6 pilot valid: 1 task × ${PILOT_ARMS.length} arms (${PILOT_ARMS.join(', ')}), ` +
    `final-only semantic grading, ${AGENT_BUDGET_SEC}s budget, development_only.`,
);
