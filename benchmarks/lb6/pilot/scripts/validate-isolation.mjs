#!/usr/bin/env node
/**
 * Issue #18 validation: stock Harbor + RewardKit (no host-sealed fork requirement).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MEASUREMENT_CONTRACT } from '../lib/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const pilotRoot = path.join(ROOT, 'benchmarks/lb6/pilot');
const tasksRoot = path.join(pilotRoot, 'harbor/tasks-v3');
const errors = [];

for (const taskName of fs.existsSync(tasksRoot) ? fs.readdirSync(tasksRoot) : []) {
  const taskDir = path.join(tasksRoot, taskName);
  if (!fs.statSync(taskDir).isDirectory()) continue;
  const toml = fs.readFileSync(path.join(taskDir, 'task.toml'), 'utf8');
  if (toml.includes('host_sealed_supervisor_required = true')) {
    errors.push(`${taskName}: host-sealed supervisor must be disabled for RewardKit path`);
  }
  if (!toml.includes(`measurement_contract = "${MEASUREMENT_CONTRACT}"`)) {
    errors.push(`${taskName}: missing measurement_contract=${MEASUREMENT_CONTRACT}`);
  }
  if (!/artifacts\s*=/.test(toml)) {
    errors.push(`${taskName}: missing Harbor artifacts collection`);
  }
  if (!toml.includes('OPENAI_API_KEY')) {
    errors.push(`${taskName}: missing verifier.env OPENAI_API_KEY for RewardKit`);
  }

  const arm = taskName.includes('-lamina-') ? 'lamina' : 'baseline';
  const finalStep = arm === 'lamina' ? 'fix' : 'verify_fix';
  const finalTests = path.join(taskDir, 'steps', finalStep, 'tests');
  for (const required of ['test.sh', 'judge.toml', 'prompt.md', 'judge-context.md']) {
    if (!fs.existsSync(path.join(finalTests, required))) {
      errors.push(`${taskName}: missing RewardKit file steps/${finalStep}/tests/${required}`);
    }
  }
  const testSh = fs.readFileSync(path.join(finalTests, 'test.sh'), 'utf8');
  if (!/rewardkit/i.test(testSh)) {
    errors.push(`${taskName}: final test.sh must invoke Harbor RewardKit`);
  }
  if (/exit 97|protocol_invalid: stock Harbor/.test(testSh)) {
    errors.push(`${taskName}: final test.sh still stubs stock Harbor`);
  }
}

try {
  const version = execFileSync('harbor', ['--version'], { encoding: 'utf8' });
  if (!/0\.18\.0/.test(version)) errors.push(`expected Harbor 0.18.0, observed ${version.trim()}`);
} catch (error) {
  errors.push(`Harbor version check failed: ${error.message}`);
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

const manifest = {
  kind: 'lb6-rewardkit-runtime',
  harbor_version: '0.18.0',
  measurement_contract: MEASUREMENT_CONTRACT,
  claim_surface: 'rewardkit_llm_judge',
  host_sealed_supervisor_required: false,
  task_tests_secret_free: true,
};
fs.writeFileSync(path.join(pilotRoot, 'isolation-runtime.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `LB6 RewardKit runtime valid: measurement=${MEASUREMENT_CONTRACT} harbor=0.18.0 tasks=${tasksRoot}`,
);
