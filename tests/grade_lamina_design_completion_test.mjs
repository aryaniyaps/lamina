#!/usr/bin/env node
/**
 * Regression: design must not leave a draft without generated implement.md.
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
  // Failure mode: draft + no implement.md
  const stuck = mkWorkspace({
    '.lamina/runs/budgetapp-stuck/run.json': JSON.stringify({ contract_version: '2.0', id: 'budgetapp-stuck', status: 'draft', stage: 'spark', hook: 'design', intent: { problem: 'p', outcome: 'o', users: ['u'] } }),
  });

  const ready = mkWorkspace({
    '.lamina/runs/budgetapp-ready/run.json': JSON.stringify({ contract_version: '2.0', id: 'budgetapp-ready', status: 'ready_to_build', stage: 'shape', hook: 'design' }),
    '.lamina/runs/budgetapp-ready/implement.md': `# Ship pack\n## Must-implement checklist\n- [ ] Screens\n`,
  });

  const half = mkWorkspace({
    '.lamina/runs/budgetapp-half/run.json': JSON.stringify({ contract_version: '2.0', id: 'budgetapp-half', status: 'ready_to_build', stage: 'shape', hook: 'design' }),
  });

  try {
    const stuckCtx = gradeCtx(stuck);
    const readyCtx = gradeCtx(ready);
    const halfCtx = gradeCtx(half);

    const failCompletion = gradeAssertion('design completion on disk', stuckCtx);
    assert.equal(failCompletion.passed, false, failCompletion.evidence);
    assert.match(failCompletion.evidence, /draft|stuck/);

    const failNotDraft = gradeAssertion('not left draft', stuckCtx);
    assert.equal(failNotDraft.passed, false, failNotDraft.evidence);

    const failImpl = gradeAssertion('implement.md exists', stuckCtx);
    assert.equal(failImpl.passed, false, failImpl.evidence);

    const passCompletion = gradeAssertion('design completion on disk', readyCtx);
    assert.equal(passCompletion.passed, true, passCompletion.evidence);

    const passNotDraft = gradeAssertion('not left draft', readyCtx);
    assert.equal(passNotDraft.passed, true, passNotDraft.evidence);

    const passImpl = gradeAssertion('implement.md exists', readyCtx);
    assert.equal(passImpl.passed, true, passImpl.evidence);

    const failHalf = gradeAssertion('design completion on disk', halfCtx);
    assert.equal(failHalf.passed, false, failHalf.evidence);
    assert.match(failHalf.evidence, /missing implement/i);

    // Skill text regression — disk emission gate must stay in lamina-design
    const skill = fs.readFileSync(path.join(ROOT, 'skills/lamina-design/SKILL.md'), 'utf8');
    assert.match(skill, /Completion gate/);
    assert.match(skill, /status: ready_to_build/);
    assert.match(skill, /graph-tool\.mjs validate/);
    assert.match(skill, /implement\.md/);

    const designOut = fs.readFileSync(
      path.join(ROOT, 'skills/lamina-orchestrator/prompts/outputs/design.md'),
      'utf8',
    );
    assert.match(designOut, /ready_to_build|implementation/i);

    const workflow = fs.readFileSync(
      path.join(ROOT, 'skills/lamina-orchestrator/workflows/design.md'),
      'utf8',
    );
    assert.match(workflow, /Validate readiness/);
    assert.match(workflow, /ready_to_build/);

    console.log('grade_lamina_design_completion_test: ok');
  } finally {
    for (const d of [stuck, ready, half]) fs.rmSync(d, { recursive: true, force: true });
  }
}

run();
