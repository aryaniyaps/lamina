#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARBOR_TASKS = path.join(ROOT, 'benchmarks/harbor/tasks');

const r = spawnSync('node', ['benchmarks/scripts/harbor-compile.mjs', '--tasks', 'task001'], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.equal(r.status, 0, `harbor-compile failed: ${r.stderr}`);

const control = path.join(HARBOR_TASKS, 'task001-control');
const treatment = path.join(HARBOR_TASKS, 'task001-treatment');
assert.ok(fs.existsSync(control), 'task001-control missing');
assert.ok(fs.existsSync(treatment), 'task001-treatment missing');

const controlInstr = fs.readFileSync(path.join(control, 'instruction.md'), 'utf8');
assert.ok(!/\/lamina-init/i.test(controlInstr), 'instruction must not name slash commands');
assert.ok(!/lamina-design/i.test(controlInstr), 'instruction must not name skills');

const treatmentAgents = fs.readFileSync(path.join(treatment, 'environment/workspace/AGENTS.md'), 'utf8');
assert.ok(/\/lamina-init/i.test(treatmentAgents), 'treatment AGENTS.md must prescribe workflow');
assert.ok(!fs.existsSync(path.join(control, 'environment/workspace/AGENTS.md')), 'control must not have AGENTS.md');

const treatmentSkills = path.join(treatment, 'environment/workspace/.claude/skills');
assert.ok(fs.existsSync(treatmentSkills), 'treatment must install skills');
assert.ok(!fs.existsSync(path.join(control, 'environment/workspace/.claude/skills')), 'control must not have skills');

assert.ok(fs.existsSync(path.join(control, 'tests/test.sh')));
assert.ok(fs.existsSync(path.join(control, 'tests/harbor-score.mjs')));
assert.ok(fs.existsSync(path.join(control, 'tests/golden.yaml')));

const promptTemplate = fs.readFileSync(path.join(ROOT, 'benchmarks/harbor/prompt_template.j2'), 'utf8');
assert.ok(promptTemplate.includes('{{ instruction }}'));
assert.ok(/unattended/i.test(promptTemplate));

const methodology = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmarks/methodology.json'), 'utf8'));
assert.equal(methodology.id, 'design_b_skillsbench_paired');

const release = fs.readFileSync(path.join(ROOT, 'benchmarks/release.yaml'), 'utf8');
assert.ok(release.includes('results_contract_version: "3.0.0"'));

console.log('harbor_compile_test: ok');
