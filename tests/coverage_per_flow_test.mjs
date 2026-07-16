#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCoverageForRun } from '../skills/lamina-orchestrator/lib/coverage.mjs';
import * as runMod from '../skills/lamina-orchestrator/lib/run.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-coverage-v2-'));
const runDir = path.join(dir, 'runs', 'coverage-test');
fs.mkdirSync(runDir, { recursive: true });
const meta = { criticality: 'critical', source: 'user', confidence: 'high', relevance_reason: 'test' };
fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
  contract_version: '2.0', id: 'coverage-test', status: 'draft', stage: 'shape', hook: 'design',
  intent: { problem: 'test', outcome: 'test', users: ['user'], critical_promises: [], success_signals: [], constraints: [], scope: { in: [], out: [] } },
  decisions: { assumptions: [], forks: [] }, actors: [], entities: [],
  operations: [{ id: 'place-order', ...meta }, { id: 'view-order', ...meta }],
  workflows: [{ id: 'checkout', actor_ref: 'actor.user', steps: [{ operation_ref: 'operation.place-order' }, { operation_ref: 'operation.view-order' }], terminal_outcomes: [], ...meta }],
  invariants: [], dependencies: [], surfaces: [],
  scenarios: [{ id: 'place-order-fails', risk_key: 'failure:place-order', when: { operation_ref: 'operation.place-order' }, then: ['Order is not created'], covers: ['operation.place-order'], ...meta }],
  persona_findings: [], traceability: [], findings: [], evidence: [],
}, null, 2));

try {
  const result = loadCoverageForRun(dir, 'coverage-test', fs, runMod);
  assert.equal(result.ok, true);
  assert.equal(result.flows[0].id, 'checkout');
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].operationId, 'view-order');
  assert.equal(result.score, 50);
  console.log('coverage_per_flow_test: ok');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
