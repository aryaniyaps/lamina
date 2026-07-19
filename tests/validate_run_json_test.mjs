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
    actors: [{ id: 'owner', goal: 'Regain access', authority: 'Authenticated account owner at the trusted service boundary', entry_path: 'The owner reaches reset from the signed-out recovery entry and proves control through the declared email channel', owns: ['entity.account'], permissions: ['request-reset'], ...meta('Primary user') }],
    entities: [
      { id: 'account', identity: 'Stable account id', attributes: [{ name: 'account_id', contract: 'Immutable server-issued identifier' }, { name: 'credential_version', contract: 'Monotonic version changed atomically with a successful reset' }], states: ['active', 'locked'], relationships: [], lifecycle_consequences: ['Deleting the account invalidates every reset token'], ...meta('Protected resource') },
      { id: 'reset-token', identity: 'Opaque one-use token id', attributes: [{ name: 'token_digest', contract: 'One-way digest of the opaque bearer value' }, { name: 'expires_at', contract: 'Authoritative server instant; expiry applies at the exact boundary' }], states: ['issued', 'used', 'expired'], relationships: [{ to: 'entity.account', cardinality: 'many-to-one', lifecycle: 'delete when account is deleted' }], lifecycle_consequences: ['Used and expired tokens remain unusable'], ...meta('Authorizes reset') },
    ],
    operations: [{ id: 'complete-reset', actor_refs: ['actor.owner'], preconditions: ['The requester proves account control', 'The reset token is issued and unexpired'], transitions: [{ entity_ref: 'entity.reset-token', from: 'issued', to: 'used' }], effects: ['Commit the new password and token consumption atomically'], enforces: ['invariant.one-use-token'], outcome: 'Password changes and token is consumed', failures: [{ code: 'expired', outcome: 'Expired token is rejected', then: ['No password change occurs'] }], recovery: 'Request a fresh reset token', ...meta('Completes the critical promise') }],
    workflows: [{ id: 'reset-access', actor_ref: 'actor.owner', steps: [{ operation_ref: 'operation.complete-reset' }], dependency_refs: [], terminal_outcomes: ['access-restored', 'reset-rejected'], ...meta('Primary end-to-end path') }],
    invariants: [{ id: 'one-use-token', rule: 'A reset token can be consumed at most once', ...meta('Prevents replay') }],
    dependencies: [],
    surfaces: [{ id: 'reset-form', purpose: 'Let the owner complete a safe reset', primary_actor_refs: ['actor.owner'], graph_refs: ['entity.account', 'entity.reset-token', 'invariant.one-use-token'], workflow_refs: ['workflow.reset-access'], operation_refs: ['operation.complete-reset'], contract: ['Show expired and successful outcomes distinctly', 'Move focus to the authoritative result'], ...meta('Critical interaction surface') }],
    scenarios: [{ id: 'expired-token', kind: 'failure', risk_key: 'failure:complete-reset:expired', given: ['The token is expired'], when: { operation_ref: 'operation.complete-reset' }, then: ['No password change occurs'], covers: ['operation.complete-reset', 'workflow.reset-access', 'invariant.one-use-token'], ...meta('Critical failure behavior') }],
    proof_budget: {
      strategy: 'smallest_complete_slice',
      max_critical_promises: 1,
      max_active_operations: 1,
      max_active_workflows: 1,
      max_active_dependencies: 0,
      max_active_surfaces: 1,
      max_proofs: 1,
      rationale: 'One complete reset path proves the current product promise without unrelated account-management scope.',
    },
    proofs: [{
      id: 'safe-reset-journey',
      promise_refs: ['promise.safe-reset'],
      workflow_ref: 'workflow.reset-access',
      operation_refs: ['operation.complete-reset'],
      invariant_refs: ['invariant.one-use-token'],
      dependency_refs: [],
      surface_refs: ['surface.reset-form'],
      given: ['The owner has an unexpired one-use token'],
      action: 'Submit a replacement password through the reset form',
      then: ['The token is consumed once', 'A replay is rejected', 'The owner can sign in with the replacement password'],
      authoritative_state: 'The credential version changes atomically with token consumption and remains changed after reload',
      visible_outcome: 'The reset form announces success and offers a reachable sign-in action',
      recovery: 'An expired or consumed token preserves the credential and offers a fresh reset request',
      evidence_levels: ['domain', 'boundary', 'journey'],
      test_requirements: ['restart_or_reload', 'replay_or_concurrency', 'responsive', 'accessibility'],
    }],
    persona_findings: [],
    traceability: [{ promise_ref: 'promise.safe-reset', graph_refs: ['actor.owner', 'entity.account', 'operation.complete-reset', 'workflow.reset-access', 'invariant.one-use-token', 'surface.reset-form', 'scenario.expired-token'] }],
    findings: [], evidence: [],
  };
}

{
  const run = validRun();
  assert.deepEqual(validateRunFields(run, 'run.json', { requireProofPacket: true }), []);
  assert.match(renderRunMarkdown(run), /Minimum|Password|password reset/i);
  const implementation = renderImplementMarkdown(run);
  assert.match(implementation, /Authority and identity proof/);
  assert.match(implementation, /Reachable entry or activation path/);
  assert.match(implementation, /Key field contracts/);
  assert.match(implementation, /Trusted enforcement/);
  assert.match(implementation, /Durable effects and projections/);
  assert.match(implementation, /surface\.reset-form/);
  assert.match(implementation, /scenario\.expired-token/);
  assert.match(implementation, /proof\.safe-reset-journey/);
  assert.match(implementation, /product-proof-manifest\.json/);
  assert.match(implementation, /authoritative post-action state/);
  assert.equal(coverageReport(run).promises.traced, 1);
  assert.equal(coverageReport(run).proofs.operations_covered, 1);
}

{
  const run = validRun();
  run.proofs = [];
  assert.ok(validateRunFields(run, 'run.json', { requireProofPacket: true }).some((error) => error.includes('proofs[] requires at least one')));
}

{
  const run = validRun();
  run.proofs[0].operation_refs = [];
  assert.ok(validateRunFields(run, 'run.json', { requireProofPacket: true }).some((error) => error.includes('critical operation.complete-reset lacks executable proof coverage')));
}

{
  const run = validRun();
  run.proof_budget.max_active_operations = 0;
  assert.ok(validateRunFields(run, 'run.json', { requireProofPacket: true }).some((error) => error.includes('active_operations must be an integer')));
}

{
  const run = validRun();
  delete run.actors[0].entry_path;
  assert.ok(validateRunFields(run).some((error) => error.includes('requires entry_path')));
}

{
  const run = validRun();
  delete run.entities[0].attributes;
  assert.ok(validateRunFields(run).some((error) => error.includes('requires attributes')));
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
  run.proof_budget.max_active_dependencies = 1;
  const scoped = scopeRun(run, ['workflow.reset-access']);
  assert.equal(scoped.operations[0].id, 'complete-reset');
  assert.equal(scoped.entities.some((item) => item.id === 'audit-log'), true);
  assert.equal(scoped.dependencies.some((item) => item.id === 'reset-audit'), true);
  assert.match(renderImplementMarkdown(run), /dependency\.reset-audit/);
  assert.match(renderImplementMarkdown(run), /Reset is blocked and the owner sees an audit unavailable error/);
}

{
  const run = validRun();
  run.actors.push({ id: 'support-agent', goal: 'Handle unrelated support work', authority: 'Authenticated support role', owns: [], permissions: [], criticality: 'critical', source: 'derived', confidence: 'high', relevance_reason: 'Unrelated critical actor for scoping regression' });
  run.operations.push({ id: 'close-ticket', actor_refs: ['actor.support-agent'], preconditions: ['A support ticket exists'], effects: ['Close the ticket'], enforces: ['invariant.one-use-token'], failures: [{ code: 'missing', outcome: 'No ticket changes', then: ['Explain that the ticket is missing'] }], recovery: 'Open an existing ticket', outcome: 'The support ticket closes', criticality: 'critical', source: 'derived', confidence: 'high', relevance_reason: 'Unrelated critical operation for scoping regression' });
  const scoped = scopeRun(run, ['actor.owner']);
  assert.equal(scoped.actors.some((item) => item.id === 'owner'), true);
  assert.equal(scoped.actors.some((item) => item.id === 'support-agent'), false);
  assert.equal(scoped.operations.some((item) => item.id === 'close-ticket'), false);
  assert.equal(scoped.traceability.some((item) => item.graph_refs.includes('operation.close-ticket')), false);
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
