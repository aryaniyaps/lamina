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

// Design C: no AGENTS.md/CLAUDE.md workflow overlays — harness drives phases.
assert.ok(
  !fs.existsSync(path.join(ROOT, 'benchmarks/harbor/overlays')),
  'legacy AGENTS overlays must be removed'
);

assert.ok(fs.existsSync(path.join(control, 'tests/test.sh')));
assert.ok(fs.existsSync(path.join(control, 'tests/criteria.py')));
assert.ok(fs.existsSync(path.join(control, 'tests/llm_judge/product-behavior.toml')));
assert.ok(fs.existsSync(path.join(control, 'tests/judge-context.md')));
assert.ok(!fs.existsSync(path.join(control, 'tests/harbor-score.mjs')), 'legacy harbor-score.mjs must be removed');
assert.ok(!fs.existsSync(path.join(control, 'tests/golden_coverage')), 'phrase golden_coverage must be removed');
assert.ok(fs.existsSync(path.join(control, 'tests/golden.yaml')));
assert.ok(fs.existsSync(path.join(ROOT, 'benchmarks/harbor/verifier/reward.toml')));
assert.ok(!fs.existsSync(path.join(ROOT, 'benchmarks/harbor/verifier/golden_coverage')));
assert.ok(!fs.existsSync(path.join(ROOT, 'benchmarks/harbor/verifier/clarify_stall/check.py')));
assert.ok(fs.existsSync(path.join(ROOT, 'benchmarks/harbor/registry.yaml')));

const testSh = fs.readFileSync(path.join(control, 'tests/test.sh'), 'utf8');
assert.ok(/rewardkit/.test(testSh), 'test.sh must invoke rewardkit');
assert.ok(fs.existsSync(path.join(control, 'tests/run_rewardkit.sh')), 'run_rewardkit.sh must be synced');

const finalize = fs.readFileSync(path.join(control, 'tests/finalize_reward.py'), 'utf8');
assert.ok(/judge-only claim|llm_judge only/i.test(finalize), 'finalize must be judge-only');
assert.ok(!/score_golden|golden_coverage_pct/.test(finalize), 'finalize must not score phrase golden');

const criteria = fs.readFileSync(path.join(control, 'tests/criteria.py'), 'utf8');
assert.ok(!/def score_golden|ALIASES\s*=/.test(criteria), 'criteria must not keep phrase golden helpers');

const taskToml = fs.readFileSync(path.join(control, 'task.toml'), 'utf8');
assert.ok(/\[task\]/.test(taskToml), 'task.toml must include [task] section for Harbor publish');
assert.ok(/name = "aryaniyaps\/task001-control"/.test(taskToml), 'task.toml must set Harbor task name');
assert.ok(/ecological-matched-phases/.test(taskToml), 'task.toml must tag ecological matched phases');
assert.ok(/\[verifier\.env\]/.test(taskToml), 'task.toml must pass verifier env for Rewardkit judge');

const dockerfile = fs.readFileSync(path.join(control, 'environment/Dockerfile'), 'utf8');
assert.ok(/uv/.test(dockerfile), 'Dockerfile must install uv for rewardkit');

assert.ok(
  !fs.existsSync(path.join(ROOT, 'benchmarks/harbor/prompt_template.j2')),
  'legacy Harbor prompt templates must be removed'
);
assert.ok(
  !fs.existsSync(path.join(ROOT, 'benchmarks/README.md')),
  'benchmarks README must be removed'
);

const methodology = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmarks/methodology.json'), 'utf8'));
assert.equal(methodology.id, 'design_c_ecological_matched_phases');

const release = fs.readFileSync(path.join(ROOT, 'benchmarks/release.yaml'), 'utf8');
assert.ok(release.includes('results_contract_version: "1.8.0"'));
assert.ok(release.includes('harness_version: "1.2.0"'));
assert.ok(release.includes('phases_per_trial: 5'));
assert.ok(!/golden_field_weights|golden_coverage:|harbor_prompt_template/.test(release));

assert.ok(fs.existsSync(path.join(control, 'tests/matched-phased-agent.sh')));
const harness = fs.readFileSync(path.join(ROOT, 'benchmarks/harbor/verifier/matched-phased-agent.sh'), 'utf8');
assert.ok(harness.includes('product-plan.md'), 'harness must use product-plan.md for control');
assert.ok(harness.includes('BRIEF_BLOCK'), 'harness must inject brief block into control phases');
assert.ok(harness.includes('unattended trial'), 'harness must say unattended trial not benchmark');
assert.ok(!fs.existsSync(path.join(ROOT, 'benchmarks/harbor/verifier/treatment-phased-agent.sh')));

console.log('harbor_sync_test: ok');
