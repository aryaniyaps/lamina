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
  const workDir = path.join(workspace, '.git', 'lamina', 'work');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'packet.started.json'), JSON.stringify({
    schema: 'lamina.work-started/v1',
    receipt_id: 'work_started_fixture',
    work_map: {
      schema: 'lamina.work-map/v1',
      obligations: [{
        obligation_id: 'obligation_fixture',
        status: 'change_required',
        targets: ['src/feature.ts'],
        verification: [{ kind: 'functional', status: 'planned' }],
      }],
    },
  }));
  fs.writeFileSync(path.join(workDir, 'packet.verified.json'), JSON.stringify({
    schema: 'lamina.work-verified/v1',
    receipt_id: 'work_verified_fixture',
    verified: true,
  }));
  assert.equal(
    grade('complete WorkMap checked', 'packet_id: packet_fixture').passed,
    true,
    'WorkMap grading must require a real WorkStarted receipt',
  );
  assert.equal(
    grade('terminal WorkVerified receipt', 'Done').passed,
    true,
    'terminal grading must require a real verified receipt',
  );
  assert.equal(
    grade('passive implementation workflow', 'Implemented from packet_fixture without a command handoff.').passed,
    true,
  );
  assert.equal(
    grade('passive implementation workflow', 'Next step is to run /lamina-verify.').passed,
    false,
    'normal flow must fail when it recommends an explicit phase command',
  );
  assert.equal(
    grade('implementation packet present', 'schema: lamina.implementation-packet/v1; packet_id: packet_fixture').passed,
    true,
  );
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log('grade_transactional_graph_evals_test: ok');
