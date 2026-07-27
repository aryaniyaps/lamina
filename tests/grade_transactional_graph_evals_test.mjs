#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gradeAssertion } from '../evals/hooks/grade-lamina.mjs';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-graph-eval-grade-'));
const state = { files: [], tracked_files: [], file_hashes: {} };

function grade(assertion, output) {
  return gradeAssertion(assertion, {
    output,
    workspace,
    preState: state,
    postState: state,
    logs: '',
    evalMeta: {},
    turnOutputs: [],
  });
}

try {
  assert.equal(
    grade('transactional graph workflow', 'We use graphd and a GraphVersion.').passed,
    false,
    'mentioning graphd must not masquerade as a successful transactional mutation',
  );
  assert.equal(
    grade('graph publication receipt present', 'GraphVersion validated successfully.').passed,
    false,
    'publication grading must require a concrete version/source/validation receipt',
  );
  assert.equal(
    grade('agent proposal remains inferred', 'Epistemic status and approval are engine-derived.').passed,
    false,
    'generic epistemic prose must not prove ingress spoof rejection',
  );
  assert.equal(
    grade(
      'agent proposal remains inferred',
      'The agent-authored proposal remains inferred; graphd rejects attempts to mark it intended, observed, or approved.',
    ).passed,
    true,
  );
  assert.equal(
    grade('all relevant persona missions', 'Every relevant Persona gets a Mission.').passed,
    false,
    'Persona grading must require independent execution isolation',
  );
  assert.equal(
    grade('all relevant persona missions', 'Every relevant Persona gets an independent Mission with no cap.').passed,
    true,
  );
  assert.equal(
    grade(
      'all relevant persona missions',
      'The requested three-person cap conflicts with the contract. I retained all four relevant personas and compiled an independent Mission for each.',
    ).passed,
    true,
    'an explicit cap refusal plus all-persona missions must pass',
  );
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log('grade_transactional_graph_evals_test: ok');
