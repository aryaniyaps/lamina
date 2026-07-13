#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARBOR_TASKS = path.join(ROOT, 'benchmarks/harbor/tasks');

const r = spawnSync(
  'node',
  ['benchmarks/scripts/harbor-sync.mjs', '--tasks', 'task001,task003', '--tests-only'],
  { cwd: ROOT, encoding: 'utf8' }
);
assert.equal(r.status, 0, `harbor-sync failed: ${r.stderr}`);

const control = path.join(HARBOR_TASKS, 'task001-control');
const treatment = path.join(HARBOR_TASKS, 'task001-treatment');
assert.ok(fs.existsSync(control), 'task001-control missing');
assert.ok(fs.existsSync(treatment), 'task001-treatment missing');

const controlInstr = fs.readFileSync(path.join(control, 'instruction.md'), 'utf8');
assert.ok(!/\/lamina-init/i.test(controlInstr), 'instruction must not name slash commands');
assert.ok(!/lamina-design/i.test(controlInstr), 'instruction must not name skills');

const controlAgents = path.join(control, 'environment/workspace/AGENTS.md');
if (fs.existsSync(controlAgents)) {
  const text = fs.readFileSync(controlAgents, 'utf8');
  assert.ok(!/\/lamina-init/i.test(text), 'control AGENTS.md must not prescribe Lamina workflow');
}

const treatmentAgentsPath = path.join(treatment, 'environment/workspace/AGENTS.md');
const treatmentAgents = fs.existsSync(treatmentAgentsPath)
  ? fs.readFileSync(treatmentAgentsPath, 'utf8')
  : fs.readFileSync(path.join(ROOT, 'benchmarks/harbor/overlays/treatment/AGENTS.md'), 'utf8');
assert.ok(/\/lamina-init/i.test(treatmentAgents), 'treatment AGENTS.md must prescribe workflow');

const ossTreatment = path.join(HARBOR_TASKS, 'task003-treatment', 'environment/workspace/AGENTS.md');
if (fs.existsSync(ossTreatment)) {
  const ossAgents = fs.readFileSync(ossTreatment, 'utf8');
  assert.ok(/\/lamina-init/i.test(ossAgents), 'OSS treatment must prepend Lamina workflow');
  assert.ok(/Agent Development Guide/i.test(ossAgents), 'OSS treatment must preserve upstream AGENTS.md');
  assert.ok(ossAgents.indexOf('/lamina-init') < ossAgents.indexOf('Agent Development Guide'), 'Lamina overlay must precede upstream AGENTS.md');
}

const treatmentSkills = path.join(treatment, 'environment/workspace/.claude/skills');
if (fs.existsSync(treatmentSkills)) {
  assert.ok(fs.existsSync(treatmentSkills), 'treatment must install skills');
  assert.ok(!fs.existsSync(path.join(control, 'environment/workspace/.claude/skills')), 'control must not have skills');
}

assert.ok(fs.existsSync(path.join(control, 'tests/test.sh')));
assert.ok(fs.existsSync(path.join(control, 'tests/criteria.py')));
assert.ok(fs.existsSync(path.join(control, 'tests/llm_judge/product-behavior.toml')));
assert.ok(fs.existsSync(path.join(control, 'tests/judge-context.md')));
assert.ok(!fs.existsSync(path.join(control, 'tests/harbor-score.mjs')), 'legacy harbor-score.mjs must be removed');
assert.ok(fs.existsSync(path.join(control, 'tests/golden.yaml')));
assert.ok(fs.existsSync(path.join(ROOT, 'benchmarks/harbor/verifier/reward.toml')));
assert.ok(!fs.existsSync(path.join(ROOT, 'benchmarks/harbor/verifier/clarify_stall/check.py')));
assert.ok(fs.existsSync(path.join(ROOT, 'benchmarks/harbor/registry.yaml')));

const testSh = fs.readFileSync(path.join(control, 'tests/test.sh'), 'utf8');
assert.ok(/rewardkit/.test(testSh), 'test.sh must invoke rewardkit');
assert.ok(fs.existsSync(path.join(control, 'tests/run_rewardkit.sh')), 'run_rewardkit.sh must be synced');

const taskToml = fs.readFileSync(path.join(control, 'task.toml'), 'utf8');
assert.ok(/\[task\]/.test(taskToml), 'task.toml must include [task] section for Harbor publish');
assert.ok(/name = "aryaniyaps\/task001-control"/.test(taskToml), 'task.toml must set Harbor task name');
assert.ok(/ecological-matched-phases/.test(taskToml), 'task.toml must tag ecological matched phases');
assert.ok(/\[verifier\.env\]/.test(taskToml), 'task.toml must pass verifier env for Rewardkit judge');

const dockerfile = fs.readFileSync(path.join(control, 'environment/Dockerfile'), 'utf8');
assert.ok(/uv/.test(dockerfile), 'Dockerfile must install uv for rewardkit');

const promptTemplate = fs.readFileSync(path.join(ROOT, 'benchmarks/harbor/prompt_template.j2'), 'utf8');
assert.ok(promptTemplate.includes('{{ instruction }}'));
assert.ok(/unattended/i.test(promptTemplate));

const methodology = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmarks/methodology.json'), 'utf8'));
assert.equal(methodology.id, 'design_c_ecological_matched_phases');

const release = fs.readFileSync(path.join(ROOT, 'benchmarks/release.yaml'), 'utf8');
assert.ok(release.includes('results_contract_version: "1.4.0"'));
assert.ok(release.includes('harness_version: "1.2.0"'));
assert.ok(release.includes('phases_per_trial: 5'));

assert.ok(fs.existsSync(path.join(control, 'tests/matched-phased-agent.sh')));
const harness = fs.readFileSync(path.join(ROOT, 'benchmarks/harbor/verifier/matched-phased-agent.sh'), 'utf8');
assert.ok(harness.includes('product-plan.md'), 'harness must use product-plan.md for control');
assert.ok(harness.includes('BRIEF_BLOCK'), 'harness must inject brief block into control phases');
assert.ok(harness.includes('unattended trial'), 'harness must say unattended trial not benchmark');
assert.ok(!fs.existsSync(path.join(ROOT, 'benchmarks/harbor/verifier/treatment-phased-agent.sh')));

console.log('harbor_sync_test: ok');
