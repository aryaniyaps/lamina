#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const publicEntries = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, 'skills', entry.name, 'SKILL.md')))
  .map((entry) => entry.name)
  .sort();
assert.equal(publicEntries.length, 59, 'Lamina must expose all 59 skills directly');
assert.ok(publicEntries.includes('lamina'), 'Lamina must expose its command router');
assert.equal(
  publicEntries.filter((name) => name.startsWith('lamina-')).length,
  58,
  'Lamina must expose all 58 focused skills as public siblings',
);
assert.equal(
  fs.existsSync(path.join(root, 'skills/lamina/skills')),
  false,
  'public skills must not be nested inside the lamina router',
);

const expectedSuiteSkills = new Map([
  ['lamina', 'lamina'],
  ['lamina-capabilities', 'lamina-capabilities'],
  ['lamina-design', 'lamina-design'],
  ['lamina-init', 'lamina-init'],
  ['lamina-verify', 'lamina-verify'],
]);
for (const suiteDir of fs.readdirSync(path.join(root, 'evals/suites'))) {
  const suitePath = path.join(root, 'evals/suites', suiteDir, 'evals.json');
  if (!fs.existsSync(suitePath)) continue;
  const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));
  assert.equal(
    suite.skill_name,
    expectedSuiteSkills.get(suiteDir),
    `${suiteDir} must invoke its intended public skill`,
  );
}
assert.equal(
  fs.existsSync(path.join(root, 'evals/lib/run-assertions.mjs')),
  false,
  'the current eval runtime must not retain a legacy run grader',
);
const aseWrapper = fs.readFileSync(path.join(root, 'evals/scripts/ase_run.py'), 'utf8');
assert.match(aseWrapper, /EXPECTED_PUBLIC_SKILLS = 59/);
assert.match(aseWrapper, /SKILL_PATHS\[agent_type\]/);

const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'benchmarks/lb6/pilot/corpus/manifest.json'), 'utf8'),
);
const frozen = new Set(manifest.pilot?.published_frozen_task_ids || []);
for (const task of manifest.tasks.filter((item) => !frozen.has(item.id))) {
  const taskRoot = path.join(
    root,
    'benchmarks/lb6/pilot/harbor/tasks-v3',
    `${task.id}-lamina-v3`,
  );
  const environment = path.join(taskRoot, 'environment');
  const binary = path.join(environment, 'lamina-linux-x64');
  const dockerfile = fs.readFileSync(path.join(environment, 'Dockerfile'), 'utf8');
  // Existing frozen fixtures may predate the binary transition. New builds are
  // required to use the executable asset, never an npm tarball.
  if (fs.existsSync(binary)) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
    assert.ok(dockerfile.includes(sha), `${task.id} Dockerfile must pin the exact CLI binary`);
    assert.match(dockerfile, /COPY lamina-linux-x64 \/usr\/local\/bin\/lamina/);
  }

  const initInstruction = fs.readFileSync(
    path.join(taskRoot, 'steps/lamina_init/instruction.md'),
    'utf8',
  );
  const designInstruction = fs.readFileSync(
    path.join(taskRoot, 'steps/lamina_design/instruction.md'),
    'utf8',
  );
  assert.match(initInstruction, /lamina graph backup --output \.lamina\/benchmark\/init-graph\.json/);
  assert.match(designInstruction, /\.lamina\/projections\/implement\.md/);
  assert.match(designInstruction, /lamina graph backup --output \.lamina\/benchmark\/design-graph\.json/);

  for (const phase of ['lamina_init', 'lamina_design', 'implement', 'fix']) {
    const testsDir = path.join(taskRoot, 'steps', phase, 'tests');
    assert.ok(
      fs.existsSync(path.join(testsDir, 'pilot-treatment.mjs')),
      `${task.id}/${phase} must package the graph treatment verifier`,
    );
    const testScript = fs.readFileSync(path.join(testsDir, 'test.sh'), 'utf8');
    assert.match(
      testScript,
      phase === 'fix' ? /treatment-gate\.mjs/ : /grade\.mjs/,
      `${task.id}/${phase} must execute the graph treatment verifier`,
    );
  }
}

for (const rel of [
  'docs/decisions/001-transactional-product-graph.md',
  'docs/decisions/002-single-public-skill-bundle.md',
  'docs/decisions/003-public-sibling-skills.md',
  'docs/content/reference/transactional-plan-acceptance.mdx',
]) {
  assert.ok(fs.existsSync(path.join(root, rel)), `missing plan documentation: ${rel}`);
}

console.log('transactional_plan_acceptance_test: ok');
