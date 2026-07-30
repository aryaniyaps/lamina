#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gradeAssertion } from '../evals/hooks/grade-lamina.mjs';
import { digest, parseDaemonLock, processIsRunning, runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';

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
    grade('all active persona missions', 'Every active Persona gets a Mission.').passed,
    false,
    'Persona grading must require independent execution isolation',
  );
  assert.equal(
    grade('all active persona missions', 'Every active Persona gets an independent Mission with no cap.').passed,
    true,
  );
  assert.equal(
    grade(
      'all active persona missions',
      'The requested three-person cap conflicts with the contract. I retained all four active Personas and compiled an independent Mission for each.',
    ).passed,
    true,
    'an explicit cap refusal plus all-persona missions must pass',
  );
  const workDir = path.join(workspace, '.git', 'lamina', 'work');
  fs.mkdirSync(workDir, { recursive: true });
  const fixtureWorkMap = {
    schema: 'lamina.work-map/v4',
    packet_id: 'packet_fixture',
    obligations: [{
      obligation_id: 'obligation_fixture',
      status: 'change_required',
      current_evidence: [],
      files: [{ path: 'src/feature.ts', action: 'modify', role: 'implementation' }],
    }],
    experience_cases: [],
  };
  const fixtureWorkMapDigest = digest('work_map', fixtureWorkMap);
  fs.writeFileSync(path.join(workDir, 'packet.started.json'), JSON.stringify({
    schema: 'lamina.work-started/v4',
    receipt_id: 'work_started_fixture',
    packet_id: 'packet_fixture',
    work_map_digest: fixtureWorkMapDigest,
    work_map: fixtureWorkMap,
  }));
  fs.writeFileSync(path.join(workDir, 'packet.verified.json'), JSON.stringify({
    schema: 'lamina.work-verified/v4',
    receipt_id: 'work_verified_fixture',
    verified: true,
    packet_id: 'packet_fixture',
    work_started_receipt_id: 'work_started_fixture',
    work_map_digest: fixtureWorkMapDigest,
  }));
  fs.writeFileSync(path.join(workDir, 'work-map.json'), JSON.stringify(fixtureWorkMap));
  assert.equal(
    grade('complete WorkMap checked', 'packet_id: packet_fixture').passed,
    true,
    'WorkMap grading must require a real WorkStarted receipt',
  );
  const greenfieldWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-greenfield-map-grade-'));
  try {
    const greenfieldWorkDir = path.join(greenfieldWorkspace, '.git', 'lamina', 'work');
    fs.mkdirSync(greenfieldWorkDir, { recursive: true });
    const greenfieldReceipt = {
      schema: 'lamina.work-started/v4',
      receipt_id: 'work_started_greenfield',
      packet_id: 'packet_greenfield',
      work_map: {
        schema: 'lamina.work-map/v4',
        packet_id: 'packet_greenfield',
        obligations: [{
          obligation_id: 'obligation_greenfield',
          status: 'change_required',
          current_evidence: [],
          files: [{
            path: 'src/new-feature/page.tsx',
            action: 'create',
            role: 'implementation',
          }],
        }],
        experience_cases: [{
          case_id: 'case_greenfield',
          status: 'change_required',
          current_evidence: [],
          files: [{
            path: 'src/new-feature/page.test.tsx',
            action: 'create',
            role: 'test',
          }],
        }],
      },
    };
    greenfieldReceipt.work_map_digest = digest('work_map', greenfieldReceipt.work_map);
    fs.writeFileSync(
      path.join(greenfieldWorkDir, 'packet-greenfield.started.json'),
      JSON.stringify(greenfieldReceipt),
    );
    const greenfieldGrade = () => gradeAssertion('complete WorkMap checked', {
      output: '',
      workspace: greenfieldWorkspace,
      preState: state,
      postState: state,
      logs: '',
      evalMeta: {},
      turnOutputs: [],
    });
    assert.equal(
      greenfieldGrade().passed,
      true,
      'v4 grading must accept a CLI-checked greenfield file map',
    );
    greenfieldReceipt.work_map.obligations[0].files = [];
    fs.writeFileSync(
      path.join(greenfieldWorkDir, 'packet-greenfield.started.json'),
      JSON.stringify(greenfieldReceipt),
    );
    assert.equal(
      greenfieldGrade().passed,
      false,
      'v4 grading must reject a change-required obligation with no implementation file',
    );
  } finally {
    fs.rmSync(greenfieldWorkspace, { recursive: true, force: true });
  }
  assert.equal(
    grade('terminal WorkVerified receipt', 'Done').passed,
    true,
    'terminal grading must require a real verified receipt',
  );
  assert.equal(
    grade('all live UI audit classes', 'Done').passed,
    false,
    'standalone files without a published HarnessResult must not prove live UI execution',
  );
  assert.equal(
    grade('independent UI audit artifacts', 'Done').passed,
    false,
    'standalone WorkMap artifacts must not prove runtime UI audits',
  );
  fs.writeFileSync(path.join(workDir, 'work-map.json'), JSON.stringify({
    schema: 'lamina.work-map/v4',
    packet_id: 'packet_unverified',
    obligations: [{
      obligation_id: 'obligation_fixture',
      status: 'change_required',
      current_evidence: [],
      files: [{ path: 'src/feature.ts', action: 'modify', role: 'implementation' }],
    }],
    experience_cases: [],
  }));
  assert.equal(
    grade('all live UI audit classes', 'Done').passed,
    false,
    'an unbound standalone WorkMap must not prove live UI audit completion',
  );
  fs.writeFileSync(path.join(workDir, 'work-map.json'), JSON.stringify({
    schema: 'lamina.work-map/v4',
    packet_id: 'packet_fixture',
    obligations: [{
      obligation_id: 'obligation_fixture',
      status: 'change_required',
      current_evidence: [],
      files: [{ path: 'src/feature.ts', action: 'modify', role: 'implementation' }],
    }],
    experience_cases: [],
  }));
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
    grade('implementation packet present', 'The checked packet yielded the mapped obligations.').passed,
    true,
    'a real WorkStarted packet receipt must be stronger than repeating schema syntax in prose',
  );
  assert.equal(
    grade('implementation-ready graph context', 'The implementation packet is now ready.').passed,
    true,
    'WorkStarted must prove the CLI implementation-ready gate without magic JSON wording',
  );
  assert.equal(
    gradeAssertion('source edits follow WorkStarted', {
      output: '',
      workspace,
      preState: { changed_files: ['app/layout.tsx'] },
      postState: { changed_files: ['app/layout.tsx', 'app/feature/page.tsx'] },
      logs: '',
      evalMeta: {},
      turnOutputs: [],
    }).passed,
    true,
    'ASE changed_files snapshots must detect product edits when file hashes are unavailable',
  );
  assert.equal(
    grade(
      'Output addresses design or problem framing',
      [
        'Blocked before artifact generation.',
        'Clarifying questions: Who is the primary user? What painful moment should improve?',
        'What outcome defines success, what is in scope, and what constraints shape the product direction?',
      ].join('\n'),
    ).passed,
    true,
    'substantive clarification and problem-framing behavior must not require a magic phrase',
  );
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log('grade_transactional_graph_evals_test: ok');

const cleanupWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-grade-cleanup-'));
try {
  spawnSync('git', ['init', '-b', 'main'], { cwd: cleanupWorkspace, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: cleanupWorkspace });
  spawnSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: cleanupWorkspace });
  fs.writeFileSync(path.join(cleanupWorkspace, 'app.txt'), 'fixture\n');
  spawnSync('git', ['add', 'app.txt'], { cwd: cleanupWorkspace });
  spawnSync('git', ['commit', '-m', 'fixture'], { cwd: cleanupWorkspace });
  const status = spawnSync(process.execPath, [
    path.resolve('packages/cli/bin/lamina.mjs'),
    'graph',
    'status',
  ], {
    cwd: cleanupWorkspace,
    encoding: 'utf8',
  });
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const paths = runtimePaths(cleanupWorkspace);
  const daemonPid = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'))?.pid;
  assert.equal(processIsRunning(daemonPid), true);
  const hook = spawnSync(process.execPath, [path.resolve('evals/hooks/grade-lamina.mjs')], {
    cwd: cleanupWorkspace,
    env: {
      ...process.env,
      ASE_WORKSPACE_PATH: cleanupWorkspace,
      ASE_OUTPUT_DIR: cleanupWorkspace,
    },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(hook.status, 0, hook.stderr || hook.stdout);
  assert.equal(processIsRunning(daemonPid), false, 'post-grade cleanup must stop workspace graphd');
} finally {
  fs.rmSync(cleanupWorkspace, { recursive: true, force: true });
}

console.log('grade_transactional_graph_evals_cleanup_test: ok');
