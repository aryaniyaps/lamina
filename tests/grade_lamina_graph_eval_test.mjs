#!/usr/bin/env node
/**
 * Unit tests for Contract v2 eval graders (proof packet, traceability, persona, verify artifacts).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gradeAssertion } from '../evals/hooks/grade-lamina.mjs';

function meta(relevance_reason, criticality = 'critical', source = 'user') {
  return { criticality, source, confidence: 'high', relevance_reason };
}

function validRun() {
  return {
    contract_version: '2.0',
    id: 'password-reset',
    status: 'ready_to_build',
    stage: 'shape',
    hook: 'design',
    target: 'password reset',
    intent: {
      problem: 'People lose access to an account',
      outcome: 'The account owner can safely regain access',
      users: ['account-owner'],
      critical_promises: [{ id: 'safe-reset', promise: 'Only the account owner can reset access', ...meta('Core trust promise') }],
      success_signals: [],
      constraints: [],
      scope: { in: ['Request and complete reset'], out: [] },
    },
    decisions: { assumptions: [], forks: [] },
    actors: [{
      id: 'owner',
      goal: 'Regain access',
      authority: 'Authenticated account owner',
      entry_path: 'Signed-out recovery entry',
      owns: [],
      permissions: [],
      ...meta('Primary user'),
    }],
    entities: [{
      id: 'account',
      identity: 'Stable account id',
      attributes: [{ name: 'account_id', contract: 'Immutable identifier' }],
      states: ['active'],
      relationships: [],
      lifecycle_consequences: ['Deletion invalidates tokens'],
      ...meta('Protected resource'),
    }],
    operations: [{
      id: 'complete-reset',
      actor_refs: ['actor.owner'],
      preconditions: ['Token is valid'],
      transitions: [],
      effects: ['Password changes'],
      enforces: ['invariant.one-use-token'],
      outcome: 'Access restored',
      failures: [{ code: 'expired', outcome: 'Rejected', then: ['No change'] }],
      recovery: 'Request new token',
      ...meta('Completes promise'),
    }],
    workflows: [{
      id: 'reset-access',
      actor_ref: 'actor.owner',
      steps: [{ operation_ref: 'operation.complete-reset' }],
      dependency_refs: [],
      terminal_outcomes: ['restored'],
      ...meta('Primary path'),
    }],
    invariants: [{ id: 'one-use-token', rule: 'Token consumed once', ...meta('Replay guard') }],
    dependencies: [],
    surfaces: [{
      id: 'reset-form',
      purpose: 'Complete reset',
      primary_actor_refs: ['actor.owner'],
      graph_refs: ['entity.account'],
      workflow_refs: ['workflow.reset-access'],
      operation_refs: ['operation.complete-reset'],
      contract: ['Show outcomes distinctly'],
      ...meta('Critical surface'),
    }],
    scenarios: [{
      id: 'expired-token',
      kind: 'failure',
      risk_key: 'failure:complete-reset:expired',
      given: ['Token expired'],
      when: { operation_ref: 'operation.complete-reset' },
      then: ['No password change'],
      covers: ['operation.complete-reset', 'workflow.reset-access', 'invariant.one-use-token'],
      ...meta('Failure path'),
    }],
    proof_budget: {
      strategy: 'smallest_complete_slice',
      max_critical_promises: 1,
      max_active_operations: 1,
      max_active_workflows: 1,
      max_active_dependencies: 0,
      max_active_surfaces: 1,
      max_proofs: 1,
      rationale: 'Single complete slice',
    },
    proofs: [{
      id: 'safe-reset-journey',
      promise_refs: ['promise.safe-reset'],
      workflow_ref: 'workflow.reset-access',
      operation_refs: ['operation.complete-reset'],
      invariant_refs: ['invariant.one-use-token'],
      dependency_refs: [],
      surface_refs: ['surface.reset-form'],
      given: ['Valid token'],
      action: 'Submit password',
      then: ['Token consumed'],
      authoritative_state: 'Credential version changes',
      visible_outcome: 'Success message',
      recovery: 'Request fresh token',
      evidence_levels: ['domain', 'boundary', 'journey'],
      test_requirements: ['restart_or_reload', 'responsive', 'accessibility'],
    }],
    persona_findings: [
      {
        id: 'pf-1',
        persona_ref: 'persona.owner',
        classification: 'friction',
        source: 'persona_hypothesis',
        statement: 'Unclear expiry messaging',
        graph_refs: ['surface.reset-form'],
      },
      {
        id: 'pf-2',
        persona_ref: 'persona.support',
        classification: 'risk',
        source: 'persona_hypothesis',
        statement: 'Replay attempts need audit trail',
        graph_refs: ['invariant.one-use-token'],
      },
    ],
    traceability: [{
      promise_ref: 'promise.safe-reset',
      graph_refs: ['actor.owner', 'entity.account', 'operation.complete-reset', 'workflow.reset-access', 'invariant.one-use-token', 'surface.reset-form', 'scenario.expired-token'],
    }],
    findings: [],
    evidence: [],
  };
}

function mkWorkspace(layout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-graph-grade-'));
  for (const [rel, body] of Object.entries(layout)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return dir;
}

function gradeCtx(workspace, extra = {}) {
  return { output: '### Domain and invariants\n', workspace, preState: null, postState: null, logs: '', evalMeta: null, turnOutputs: [], ...extra };
}

function run() {
  const run = validRun();
  const implementMd = '# Ship pack\n\nRecord proofs in product-proof-manifest.json.\n';
  const workspace = mkWorkspace({
    '.lamina/runs/password-reset/run.json': run,
    '.lamina/runs/password-reset/implement.md': implementMd,
  });

  try {
    assert.equal(gradeAssertion('proofs[] present', gradeCtx(workspace)).passed, true);
    assert.equal(gradeAssertion('implement.md mentions proof manifest', gradeCtx(workspace)).passed, true);
    assert.equal(gradeAssertion('proof packet complete', gradeCtx(workspace)).passed, true);
    assert.equal(gradeAssertion('traceability complete', gradeCtx(workspace)).passed, true);
    assert.equal(gradeAssertion('persona findings count >= 2', gradeCtx(workspace)).passed, true);
    assert.equal(gradeAssertion('persona_findings valid', gradeCtx(workspace)).passed, true);

    const noProofs = mkWorkspace({
      '.lamina/runs/password-reset/run.json': { ...run, proofs: [] },
      '.lamina/runs/password-reset/implement.md': implementMd,
    });
    assert.equal(gradeAssertion('proofs[] present', gradeCtx(noProofs)).passed, false);

    const verifyRun = {
      ...run,
      hook: 'verify',
      status: 'complete',
      findings: [{
        id: 'finding-1',
        fix_target: 'product',
        title: 'Missing empty state',
        evidence: 'Screenshot shows blank cart',
        acceptance: ['Empty cart message visible'],
      }],
    };
    const verifyWs = mkWorkspace({
      '.lamina/runs/audit-checkout/run.json': verifyRun,
      '.lamina/runs/audit-checkout/fix.md': '# Fix tickets\n\n- finding-1\n',
      '.lamina/runs/audit-checkout/report.md': '# Report\n\nNarrative only.\n',
    });
    assert.equal(gradeAssertion('fix.md exists', gradeCtx(verifyWs)).passed, true);
    assert.equal(gradeAssertion('findings present', gradeCtx(verifyWs)).passed, true);

    fs.rmSync(noProofs, { recursive: true, force: true });
    fs.rmSync(verifyWs, { recursive: true, force: true });
    console.log('grade_lamina_graph_eval_test: ok');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

run();
