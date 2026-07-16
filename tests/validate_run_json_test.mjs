#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coverageReport, deriveScenarioSuggestions, renderImplementMarkdown, renderRunMarkdown, scopeRun } from '../skills/lamina-orchestrator/lib/graph.mjs';
import { validateRunFields, validateRunJson, validateWalkthroughPack } from '../skills/lamina-orchestrator/lib/run.mjs';

function validRun() {
  const meta = (relevance_reason, criticality = 'critical', source = 'user') => ({ criticality, source, confidence: 'high', relevance_reason });
  return {
    contract_version: '2.0', id: 'password-reset', status: 'ready_to_build', stage: 'shape', hook: 'design', target: 'password reset',
    intent: {
      problem: 'People lose access to an account', outcome: 'The account owner can safely regain access', users: ['account-owner'],
      critical_promises: [{ id: 'safe-reset', promise: 'Only the account owner can reset access', ...meta('Core trust promise') }],
      success_signals: ['Owner regains access'], constraints: [], scope: { in: ['Request and complete reset'], out: ['Support escalation'] },
    },
    decisions: { assumptions: [{ id: 'email-channel', class: 'reversible_default', source: 'assumed', confidence: 'medium', statement: 'Use email delivery', status: 'proposed' }], forks: [] },
    actors: [{ id: 'owner', goal: 'Regain access', permissions: ['request-reset'], ...meta('Primary user') }],
    entities: [
      { id: 'account', states: ['active', 'locked'], relationships: [], ...meta('Protected resource') },
      { id: 'reset-token', states: ['issued', 'used', 'expired'], relationships: [{ to: 'entity.account', cardinality: 'many-to-one', lifecycle: 'delete when account is deleted' }], ...meta('Authorizes reset') },
    ],
    operations: [{ id: 'complete-reset', actor_refs: ['actor.owner'], transitions: [{ entity_ref: 'entity.reset-token', from: 'issued', to: 'used' }], enforces: ['invariant.one-use-token'], outcome: 'Password changes and token is consumed', failures: [{ code: 'expired', outcome: 'Expired token is rejected', then: ['No password change occurs'] }], ...meta('Completes the critical promise') }],
    workflows: [{ id: 'reset-access', actor_ref: 'actor.owner', steps: [{ operation_ref: 'operation.complete-reset' }], dependency_refs: [], terminal_outcomes: ['access-restored', 'reset-rejected'], ...meta('Primary end-to-end path') }],
    invariants: [{ id: 'one-use-token', rule: 'A reset token can be consumed at most once', ...meta('Prevents replay') }],
    dependencies: [], surfaces: [],
    scenarios: [{ id: 'expired-token', kind: 'failure', risk_key: 'failure:complete-reset:expired', given: ['The token is expired'], when: { operation_ref: 'operation.complete-reset' }, then: ['No password change occurs'], covers: ['operation.complete-reset', 'workflow.reset-access', 'invariant.one-use-token'], ...meta('Critical failure behavior') }],
    persona_findings: [],
    traceability: [{ promise_ref: 'promise.safe-reset', graph_refs: ['actor.owner', 'entity.account', 'operation.complete-reset', 'workflow.reset-access', 'invariant.one-use-token', 'scenario.expired-token'] }],
    findings: [], evidence: [],
  };
}

{
  const run = validRun();
  assert.deepEqual(validateRunFields(run), []);
  assert.match(renderRunMarkdown(run), /Minimum|Password|password reset/i);
  assert.match(renderImplementMarkdown(run), /scenario\.expired-token/);
  assert.equal(coverageReport(run).promises.traced, 1);
}

{
  const run = validRun();
  run.decisions.forks.push({ id: 'identity-policy', class: 'policy_fork', source: 'assumed', confidence: 'low', statement: 'Choose identity proof', blocking: true, status: 'unresolved' });
  assert.ok(validateRunFields(run).some((error) => error.includes('blocking decision fork')));
}

{
  const run = validRun();
  run.operations[0].transitions[0].to = 'unknown';
  assert.ok(validateRunFields(run).some((error) => error.includes('unknown to state')));
}

{
  const run = validRun();
  run.traceability[0].graph_refs = run.traceability[0].graph_refs.filter((ref) => !ref.startsWith('entity.'));
  assert.ok(validateRunFields(run).some((error) => error.includes('lacks a critical entity trace')));
}

{
  const run = validRun();
  run.scenarios[0].covers = run.scenarios[0].covers.filter((ref) => ref !== 'workflow.reset-access');
  assert.ok(validateRunFields(run).some((error) => error.includes('critical workflow.reset-access lacks scenario coverage')));
}

{
  const run = validRun();
  run.scenarios.push({ ...run.scenarios[0], id: 'duplicate-risk' });
  assert.ok(validateRunFields(run).some((error) => error.includes('duplicate scenario risk_key')));
}

{
  const run = validRun();
  run.operations[0].destructive = true;
  const suggestions = deriveScenarioSuggestions(run);
  assert.ok(suggestions.some((item) => item.kind === 'recovery'));
  assert.equal(suggestions.some((item) => item.risk_key === 'failure:complete-reset:expired'), false);
}

{
  const run = validRun();
  run.entities.push({ id: 'audit-log', states: ['current'], relationships: [], criticality: 'supporting', source: 'derived', confidence: 'high', relevance_reason: 'Required by workflow dependency' });
  run.dependencies.push({ id: 'reset-audit', type: 'prerequisite', from: 'workflow.reset-access', to: 'entity.audit-log', unmet_behavior: 'Reset is blocked and the owner sees an audit unavailable error', criticality: 'supporting', source: 'derived', confidence: 'high', relevance_reason: 'Records security-sensitive changes' });
  const scoped = scopeRun(run, ['workflow.reset-access']);
  assert.equal(scoped.operations[0].id, 'complete-reset');
  assert.equal(scoped.entities.some((item) => item.id === 'audit-log'), true);
  assert.equal(scoped.dependencies.some((item) => item.id === 'reset-audit'), true);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-run-json-'));
  const runPath = path.join(dir, 'run.json');
  fs.writeFileSync(runPath, `${JSON.stringify(validRun(), null, 2)}\n`);
  assert.equal(validateRunJson(runPath).ok, true);
  fs.writeFileSync(runPath, '{ nope');
  assert.equal(validateRunJson(runPath).ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-walk-'));
  fs.mkdirSync(path.join(dir, 'walkthrough', 'steps'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'walkthrough', 'index.yaml'), 'mode: live_app\nsource: product\nsteps:\n  - id: one\n    screenshot: steps/one.png\n');
  fs.writeFileSync(path.join(dir, 'walkthrough', 'steps', 'one.png'), 'png');
  assert.deepEqual(validateWalkthroughPack(dir, 'walkthrough/index.yaml'), []);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('validate_run_json_test: ok');
