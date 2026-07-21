#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildPersonaPacks,
  finalizeReadyRun,
  preflightRun,
  selectPanelPersonas,
} from '../skills/lamina-orchestrator/lib/graph.mjs';

function validRun() {
  const meta = (relevance_reason, criticality = 'critical', source = 'user') => ({
    criticality,
    source,
    confidence: 'high',
    relevance_reason,
  });
  return {
    contract_version: '2.0',
    id: 'wishlist',
    status: 'draft',
    stage: 'shape',
    hook: 'design',
    target: 'wishlist',
    intent: {
      problem: 'Shoppers lose items they want to buy later',
      outcome: 'Shoppers can save items and return to buy them',
      users: ['shopper'],
      critical_promises: [{ id: 'save-item', promise: 'A shopper can save an item to a wishlist', ...meta('Core promise') }],
      success_signals: [],
      constraints: [],
      scope: { in: ['Save item'], out: [] },
    },
    decisions: { assumptions: [], forks: [] },
    actors: [
      {
        id: 'shopper',
        goal: 'Save items for later',
        authority: 'Authenticated shopper',
        entry_path: 'Signed-in product page',
        persona_refs: ['persona.budget-shopper'],
        owns: [],
        permissions: [],
        ...meta('Primary shopper'),
      },
      {
        id: 'support',
        goal: 'Help shoppers recover failed saves',
        authority: 'Support agent',
        entry_path: 'Support console',
        persona_refs: ['persona.support-agent'],
        owns: [],
        permissions: [],
        ...meta('Operational actor', 'supporting'),
      },
    ],
    entities: [],
    operations: [
      {
        id: 'save-item',
        actor_refs: ['actor.shopper'],
        preconditions: ['Shopper is signed in'],
        transitions: [],
        effects: ['Persist wishlist item'],
        enforces: [],
        outcome: 'Item appears on wishlist',
        failures: [{ code: 'offline', outcome: 'Save fails while offline', then: ['Show retry state'] }],
        recovery: 'Retry when online',
        ...meta('Save operation'),
      },
    ],
    workflows: [
      {
        id: 'save-to-wishlist',
        actor_ref: 'actor.shopper',
        steps: [{ operation_ref: 'operation.save-item' }],
        dependency_refs: [],
        terminal_outcomes: ['saved'],
        ...meta('Primary workflow'),
      },
    ],
    invariants: [],
    dependencies: [],
    surfaces: [],
    scenarios: [],
    proof_budget: {
      strategy: 'smallest_complete_slice',
      max_critical_promises: 1,
      max_active_operations: 1,
      max_active_workflows: 1,
      max_active_dependencies: 0,
      max_active_surfaces: 0,
      max_proofs: 1,
      rationale: 'test',
    },
    proofs: [],
    persona_findings: [],
    traceability: [],
    findings: [],
    evidence: [],
  };
}

const personasDoc = {
  contract_version: '2.0',
  personas: [
    {
      id: 'budget-shopper',
      role: 'Budget-conscious shopper',
      goals: ['Save sale items'],
      constraints: ['Limited budget'],
      evidence: ['Brief'],
      confidence: 'high',
      primary: true,
    },
    {
      id: 'support-agent',
      role: 'Support agent',
      goals: ['Resolve save failures'],
      constraints: ['Read-only customer data'],
      evidence: ['Brief'],
      confidence: 'medium',
    },
    {
      id: 'power-shopper',
      role: 'Power shopper',
      goals: ['Manage many lists'],
      constraints: [],
      evidence: ['Brief'],
      confidence: 'low',
    },
  ],
};

{
  const run = validRun();
  const selected = selectPanelPersonas(personasDoc, run, 3);
  assert.equal(selected.length, 3);
  assert.equal(selected[0].id, 'budget-shopper');
  assert.ok(selected.some((p) => p.id === 'support-agent'));
}

{
  const packs = buildPersonaPacks(validRun(), personasDoc, 2);
  assert.equal(packs.length, 2);
  assert.equal(packs[0].persona_ref, 'persona.budget-shopper');
  assert.ok(Array.isArray(packs[0].graph_slice.workflows));
  assert.ok(packs[0].graph_slice.workflows.length >= 1);
  assert.ok(packs[0].critical_promises.length >= 1);
}

{
  const preflight = preflightRun(validRun());
  assert.ok(preflight.coverage);
  assert.ok(Array.isArray(preflight.derive_suggestions));
  assert.equal(preflight.validation_ok, false);
  assert.ok(preflight.validation_errors.length > 0);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-ready-'));
  const runDir = path.join(dir, '.lamina', 'runs', 'wishlist');
  fs.mkdirSync(runDir, { recursive: true });
  const personasPath = path.join(dir, '.lamina', 'personas.json');
  fs.writeFileSync(personasPath, `${JSON.stringify(personasDoc, null, 2)}\n`);
  const runPath = path.join(runDir, 'run.json');
  fs.writeFileSync(runPath, `${JSON.stringify(validRun(), null, 2)}\n`);

  const fail = finalizeReadyRun(runPath);
  assert.equal(fail.ok, false);

  const tool = path.resolve('skills/lamina-orchestrator/lib/graph-tool.mjs');
  const preflight = spawnSync('node', [tool, 'preflight', runPath], { encoding: 'utf8' });
  assert.equal(preflight.status, 0);
  assert.ok(preflight.stdout.includes('derive_suggestions'));

  const packsRetry = spawnSync('node', [tool, 'persona-packs', runPath, `--personas=${personasPath}`, '--max=2'], {
    encoding: 'utf8',
  });
  assert.equal(packsRetry.status, 0);
  const parsed = JSON.parse(packsRetry.stdout);
  assert.equal(parsed.length, 2);

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('graph_fastpath_test: ok');
