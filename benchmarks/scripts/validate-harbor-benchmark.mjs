#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmarks/corpus/manifest.json'), 'utf8'));
const taskRoot = path.join(ROOT, 'benchmarks/harbor/tasks');
const errors = [];

const baselineSteps = ['shape_build', 'verify_fix'];
const laminaSteps = ['lamina_init', 'lamina_design', 'implement', 'lamina_verify', 'fix'];

function finalStepForArm(arm) {
  return arm === 'lamina' ? 'fix' : 'verify_fix';
}

for (const task of manifest.tasks) {
  for (const arm of manifest.arms) {
    const dir = path.join(taskRoot, task.id + '-' + arm);
    const steps = arm === 'lamina' ? laminaSteps : baselineSteps;
    const finalStep = finalStepForArm(arm);

    for (const step of steps) {
      for (const file of [
        `steps/${step}/instruction.md`,
        `steps/${step}/tests/test.sh`,
        `steps/${step}/tests/grade.mjs`,
        `steps/${step}/tests/behavior-grade.mjs`,
      ]) {
        if (!fs.existsSync(path.join(dir, file))) errors.push(dir + ': missing ' + file);
      }
    }

    for (const file of ['task.toml', 'environment/Dockerfile']) {
      if (!fs.existsSync(path.join(dir, file))) errors.push(dir + ': missing ' + file);
    }

    const toml = fs.readFileSync(path.join(dir, 'task.toml'), 'utf8');
    if (!/benchmark_version = "harbor-v4"/.test(toml)) errors.push(dir + ': expected harbor-v4 metadata');
    if (/claude|sonnet|treatment/i.test(toml)) errors.push(dir + ': legacy vocabulary remains');

    if (!/timeout_sec = 4200\.0/.test(toml)) errors.push(dir + ': expected matched agent timeout 4200s');

    if (arm === 'lamina') {
      const init = fs.readFileSync(path.join(dir, 'steps/lamina_init/instruction.md'), 'utf8');
      if (!/\/lamina-init/.test(init)) errors.push(dir + ': lamina_init must command /lamina-init');
      if (/product-contract\.json|product-brief\.md/.test(init)) {
        errors.push(dir + ': dual-contract files must not be required');
      }
      const design = fs.readFileSync(path.join(dir, 'steps/lamina_design/instruction.md'), 'utf8');
      if (!/\/lamina-design/.test(design)) errors.push(dir + ': lamina_design must command /lamina-design');
      if (!/persona-panel/.test(design)) errors.push(dir + ': lamina_design must require persona-panel');
      if (/≤2 workflows|≤4 proofs|≤3 operations/.test(design)) {
        errors.push(dir + ': lamina_design must not over-shrink proof_budget below design ceilings');
      }
      if (/not `harden`/.test(design)) errors.push(dir + ': must not forbid harden-level boundary rigor');
      const verify = fs.readFileSync(path.join(dir, 'steps/lamina_verify/instruction.md'), 'utf8');
      if (!/\/lamina-verify/.test(verify)) errors.push(dir + ': lamina_verify must command /lamina-verify');
      if (/\(static-only\)|Verify:\s*\*\*static-only\*\*|static-only verify/i.test(verify)) {
        errors.push(dir + ': lamina_verify must not force static-only');
      }
      if (!/persona-panel|persona_findings/.test(verify)) {
        errors.push(dir + ': lamina_verify must require persona-panel subagents');
      }
      if (!/walkthrough|visual-walkthrough|UI/.test(verify)) {
        errors.push(dir + ': lamina_verify must require UI walkthrough audit');
      }
      const implement = fs.readFileSync(path.join(dir, 'steps/implement/instruction.md'), 'utf8');
      if (!/selfcheck\.mjs/.test(implement)) errors.push(dir + ': implement must require structural self-check');
      if (!fs.existsSync(path.join(dir, 'steps/implement/tests/selfcheck.mjs'))) {
        errors.push(dir + ': missing implement selfcheck.mjs');
      }
      const selfcheck = fs.readFileSync(path.join(dir, 'steps/implement/tests/selfcheck.mjs'), 'utf8');
      if (/"expect"|must_not_include|escalat/.test(selfcheck)) {
        errors.push(dir + ': selfcheck.mjs must not embed graded expect substrings');
      }
      const grade = fs.readFileSync(path.join(dir, 'steps/fix/tests/grade.mjs'), 'utf8');
      if (/"expect"|must_not_include|"escalat"/.test(grade)) {
        errors.push(dir + ': grade.mjs must not embed plaintext graded expects');
      }
    } else {
      if (!/timeout_sec = 2100\.0/.test(toml)) {
        errors.push(dir + ': expected shape_build=2100s and verify_fix=2100s timeouts');
      }
      const shape = fs.readFileSync(path.join(dir, 'steps/shape_build/instruction.md'), 'utf8');
      if (/product-contract\.json|product-brief\.md/.test(shape)) {
        errors.push(dir + ': dual-contract files must not be required');
      }
    }

    const grade = fs.readFileSync(path.join(dir, `steps/${finalStep}/tests/grade.mjs`), 'utf8');
    if (!/behavior_report\.json/.test(grade)) errors.push(dir + ': grader must write behavior_report.json');
    if (!/reward\.json/.test(grade)) errors.push(dir + ': grader must write Harbor numeric reward.json');
  }
}

const expected = manifest.tasks.length * manifest.arms.length;
const actual = fs.readdirSync(taskRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
if (actual !== expected) errors.push('expected ' + expected + ' tasks, found ' + actual);

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log(
  'Harbor v4 valid: ' +
    actual +
    ' tasks (baseline 2-step, lamina 5-step) across ' +
    manifest.arms.join(', ') +
    ' arms.'
);
