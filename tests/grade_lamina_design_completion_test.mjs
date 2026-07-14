#!/usr/bin/env node
/**
 * Regression: design must not leave status: designing without implement.md.
 * Grades the same assertions used by lamina-design evals against fixtures.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeAssertion } from '../evals/hooks/grade-lamina.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mkWorkspace(layout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-design-grade-'));
  for (const [rel, body] of Object.entries(layout)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

function gradeCtx(workspace) {
  return {
    output: '### Domain and invariants\n',
    workspace,
    preState: null,
    postState: null,
    logs: '',
    evalMeta: null,
    turnOutputs: [],
  };
}

function run() {
  // Failure mode from task001-treatment: designing + no implement.md
  const stuck = mkWorkspace({
    '.lamina/runs/budgetapp-stuck/run.yaml': `---
id: budgetapp-stuck
status: designing
hook: design
domain:
  entities:
    - id: household
`,
  });

  const ready = mkWorkspace({
    '.lamina/runs/budgetapp-ready/run.yaml': `---
id: budgetapp-ready
status: ready_to_build
hook: design
domain:
  entities:
    - id: household
`,
    '.lamina/runs/budgetapp-ready/implement.md': `# Ship pack\n## Must-implement checklist\n- [ ] Screens\n`,
  });

  const half = mkWorkspace({
    '.lamina/runs/budgetapp-half/run.yaml': `---
id: budgetapp-half
status: ready_to_build
hook: design
`,
  });

  try {
    const stuckCtx = gradeCtx(stuck);
    const readyCtx = gradeCtx(ready);
    const halfCtx = gradeCtx(half);

    const failCompletion = gradeAssertion('design completion on disk', stuckCtx);
    assert.equal(failCompletion.passed, false, failCompletion.evidence);
    assert.match(failCompletion.evidence, /designing/);

    const failNotDesigning = gradeAssertion('not left designing', stuckCtx);
    assert.equal(failNotDesigning.passed, false, failNotDesigning.evidence);

    const failImpl = gradeAssertion('implement.md exists', stuckCtx);
    assert.equal(failImpl.passed, false, failImpl.evidence);

    const passCompletion = gradeAssertion('design completion on disk', readyCtx);
    assert.equal(passCompletion.passed, true, passCompletion.evidence);

    const passNotDesigning = gradeAssertion('not left designing', readyCtx);
    assert.equal(passNotDesigning.passed, true, passNotDesigning.evidence);

    const passImpl = gradeAssertion('implement.md exists', readyCtx);
    assert.equal(passImpl.passed, true, passImpl.evidence);

    const failHalf = gradeAssertion('design completion on disk', halfCtx);
    assert.equal(failHalf.passed, false, failHalf.evidence);
    assert.match(failHalf.evidence, /missing implement/i);

    // Skill text regression — disk emission gate must stay in lamina-design
    const skill = fs.readFileSync(path.join(ROOT, 'skills/lamina-design/SKILL.md'), 'utf8');
    assert.match(skill, /Disk emission \(hard\)/);
    assert.match(skill, /status: designing/);
    assert.match(skill, /failed design/i);
    assert.match(skill, /Finishing sequence/);
    assert.match(skill, /validate-run\.mjs/);

    const designOut = fs.readFileSync(
      path.join(ROOT, 'skills/lamina-orchestrator/prompts/outputs/design.md'),
      'utf8',
    );
    assert.match(designOut, /Only emit this section after disk emission/);
    assert.match(designOut, /will become ready_to_build after validation/);
    assert.match(designOut, /Forbidden/);

    const workflow = fs.readFileSync(
      path.join(ROOT, 'skills/lamina-orchestrator/workflows/design.md'),
      'utf8',
    );
    assert.match(workflow, /Refuse to end/);
    assert.match(workflow, /status: ready_to_build/);

    console.log('grade_lamina_design_completion_test: ok');
  } finally {
    for (const d of [stuck, ready, half]) fs.rmSync(d, { recursive: true, force: true });
  }
}

run();
