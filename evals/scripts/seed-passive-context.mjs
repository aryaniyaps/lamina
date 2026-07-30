#!/usr/bin/env node
import path from 'node:path';
import { graphRequest, stopIncompatibleServer } from '../../packages/cli/lib/graph-runtime/client.mjs';
import { runtimePaths } from '../../packages/cli/lib/graph-runtime/util.mjs';

const evalId = process.env.ASE_EVAL_ID || '';
const workspace = path.resolve(process.env.ASE_WORKSPACE_PATH || process.cwd());

const fixtures = {
  'passive-feature-implementation': {
    slug: 'wishlist-sharing',
    workflow: 'Conflict-safe wishlist sharing',
    operation: 'Share and concurrently update a wishlist',
    actor: 'Storefront shopper and invited collaborator',
    personas: [
      { id: 'persona.eval.wishlist-owner', alias: 'wishlist-owner', name: 'Wishlist owner', goal: 'Share and update a wishlist without losing accepted edits' },
      { id: 'persona.eval.wishlist-collaborator', alias: 'wishlist-collaborator', name: 'Wishlist collaborator', goal: 'Review and contribute through authorized sharing' },
    ],
    invariant: 'Concurrent wishlist edits never silently overwrite another accepted edit',
    scenario: 'Two collaborators update the same wishlist item at the same time',
    surface: 'Storefront wishlist sharing controls',
    proof: 'Conflict merge and collaborator authorization proof',
  },
  'passive-ui-live-verification': {
    slug: 'checkout-recovery',
    workflow: 'Checkout error recovery',
    operation: 'Recover checkout after a failed submission',
    actor: 'Storefront shopper',
    personas: [
      { id: 'persona.eval.checkout-shopper', alias: 'checkout-shopper', name: 'Checkout shopper', goal: 'Recover from a failed checkout without losing the cart or paying twice' },
    ],
    invariant: 'Recovery preserves the cart and never duplicates payment submission',
    scenario: 'Network or payment failure occurs during checkout on desktop or mobile',
    surface: 'Responsive checkout error and recovery UI',
    proof: 'Functional visual responsive and accessibility live UI proof',
  },
  'passive-design-gap-before-edit': {
    slug: 'account-recovery',
    workflow: 'Account recovery',
    operation: 'Recover account access from a recovery link',
    actor: 'Account owner',
    personas: [
      { id: 'persona.eval.account-owner', alias: 'account-owner', name: 'Account owner', goal: 'Regain account access safely and understand every recovery state' },
    ],
    surface: 'Account recovery form and result UI',
    proof: 'Recovery authorization and retry proof',
    // This fixture deliberately omits invariant and scenario resources so the
    // passive design-gap path must fill them before WorkStarted.
  },
};

const fixture = fixtures[evalId];
if (!fixture) process.exit(0);

const id = (kind) => `${kind}.eval.${fixture.slug}`;
let daemonStarted = false;
try {
  const session = await graphRequest('session.start', {}, workspace);
  daemonStarted = true;
  const resources = [
    { id: id('workflow'), alias: fixture.slug, kind: 'workflow', data: { name: fixture.workflow } },
    { id: id('operation'), alias: `${fixture.slug}-operation`, kind: 'operation', data: { name: fixture.operation, description: fixture.operation } },
    { id: id('actor'), alias: `${fixture.slug}-actor`, kind: 'actor', data: { name: fixture.actor } },
    { id: id('surface'), alias: `${fixture.slug}-surface`, kind: 'surface', data: { name: fixture.surface } },
    { id: id('proof'), alias: `${fixture.slug}-proof`, kind: 'proof', data: { name: fixture.proof } },
    ...(fixture.personas || []).map((persona) => ({
      id: persona.id,
      alias: persona.alias,
      kind: 'persona',
      data: { name: persona.name, goal: persona.goal },
    })),
  ];
  if (fixture.invariant) {
    resources.push({ id: id('invariant'), alias: `${fixture.slug}-invariant`, kind: 'invariant', data: { name: fixture.invariant } });
  }
  if (fixture.scenario) {
    resources.push({ id: id('scenario'), alias: `${fixture.slug}-scenario`, kind: 'scenario', data: { name: fixture.scenario } });
  }
  let personaJourneys = [];
  if (fixture.invariant && fixture.scenario) {
    personaJourneys = (fixture.personas || []).map((persona) => ({
      persona_ref: persona.id,
      actor_refs: [id('actor')],
      goal: persona.goal,
      nodes: [{
        id: `node.eval.${fixture.slug}.${persona.alias}`,
        operation_ref: id('operation'),
        intent: persona.goal,
        permission: {
          decision: 'allowed',
          actor_ref: id('actor'),
          rationale: `${persona.name} acts through the authorized ${fixture.actor} role.`,
        },
        inputs: [{
          id: 'primary-input',
          source: 'actor',
          required: true,
          rationale: 'The actor must provide the value changed by this workflow.',
        }],
        relationship_policy: {
          mode: 'none',
          rationale: 'This operation does not create a new identity or ownership relationship.',
        },
        surface_refs: [id('surface')],
        state_coverage: [
          { kind: 'entry', applicable: true, visible_state: 'The primary action is available.' },
          { kind: 'in_progress', applicable: true, visible_state: 'Progress is visible without implying completion.' },
          { kind: 'empty', applicable: false, rationale: 'This focused action has an explicit input state.' },
          { kind: 'success', applicable: true, visible_state: 'The authoritative completed result is visible.' },
          { kind: 'failure', applicable: true, visible_state: 'The failure reason is visible.' },
          { kind: 'denied', applicable: false, rationale: 'This Persona uses an authorized Actor for the seeded flow.' },
          { kind: 'recovery', applicable: true, visible_state: 'The input is preserved and a bounded retry is available.' },
        ],
        scenario_coverage: [{
          scenario_ref: id('scenario'),
          applicable: true,
          trigger: fixture.scenario,
          expected: 'The action cannot silently corrupt or overwrite accepted state.',
          recovery: 'Preserve the actor input and provide a bounded retry.',
          preserves_input: true,
        }],
        edge_case_coverage: [
          { kind: 'validation', applicable: true, trigger: 'The primary input is invalid.', expected: 'Validation is visible before acceptance.', recovery: 'Correct the preserved input.' },
          { kind: 'authorization', applicable: true, trigger: 'The Actor lacks access.', expected: 'The action is denied without side effects.', recovery: 'Use an authorized account or request access.' },
          { kind: 'duplicate', applicable: false, rationale: 'The seeded operation updates one identified workflow value.' },
          { kind: 'self_reference', applicable: false, rationale: 'The seeded operation creates no relationship.' },
          { kind: 'concurrency', applicable: true, trigger: 'Two accepted attempts overlap.', expected: 'Neither accepted result is silently lost.', recovery: 'Resolve against the authoritative state.' },
          { kind: 'stale_data', applicable: true, trigger: 'The Actor submits an old revision.', expected: 'The stale write is rejected visibly.', recovery: 'Reload or merge before retrying.' },
          { kind: 'interruption', applicable: true, trigger: 'The client exits during the action.', expected: 'Only durable state is shown after return.', recovery: 'Retry if completion is not confirmed.' },
          { kind: 'retry', applicable: true, trigger: 'The Actor repeats an uncertain action.', expected: 'The retry does not duplicate effects.', recovery: 'Show the authoritative result.' },
          { kind: 'connectivity', applicable: true, trigger: 'Connectivity fails in progress.', expected: 'No false success is shown.', recovery: 'Preserve input and retry when connected.' },
        ],
        invariant_probes: [{
          invariant_ref: id('invariant'),
          applicable: true,
          attempt: 'Attempt to violate the workflow invariant.',
          expected: 'The product blocks or recovers visibly without corrupting state.',
        }],
        transitions: [
          { outcome: 'success', terminal: true, expected: 'The authoritative result is visible.' },
          { outcome: `scenario:${id('scenario')}`, terminal: true, expected: 'The failure and recovery state is visible.' },
        ],
      }],
    }));
  }
  for (const resource of resources) {
    await graphRequest('resource.propose', { session: session.id, resource }, workspace);
  }

  const statements = [
    { subject: id('workflow'), predicate: 'lamina:hasStep', object: id('operation'), qualifiers: { position: 1 } },
    { subject: id('actor'), predicate: 'lamina:authorizedFor', object: id('operation') },
    { subject: id('surface'), predicate: 'lamina:realizes', object: id('operation') },
    { subject: id('workflow'), predicate: 'lamina:requiresProof', object: id('proof') },
    ...(fixture.personas || []).map((persona) => ({
      subject: persona.id,
      predicate: 'lamina:canAssume',
      object: id('actor'),
    })),
  ];
  if (fixture.invariant) {
    statements.push({ subject: id('workflow'), predicate: 'lamina:constrainedBy', object: id('invariant') });
  }
  if (fixture.scenario) {
    statements.push({ subject: id('workflow'), predicate: 'lamina:hasScenario', object: id('scenario') });
  }
  for (const statement of statements) {
    await graphRequest('statement.propose', { session: session.id, statement }, workspace);
  }
  let published = await graphRequest('session.publish', { id: session.id }, workspace);
  if (personaJourneys.length) {
    for (const journey of personaJourneys) {
      const task = await graphRequest('design.walk.prepare', {
        workflow: id('workflow'),
        persona: journey.persona_ref,
        request: fixture.workflow,
      }, workspace);
      const recorded = await graphRequest('design.walk.record', {
        task,
        result: {
          schema: 'lamina.persona-walk/v1',
          task_id: task.task_id,
          workflow_ref: id('workflow'),
          persona_ref: journey.persona_ref,
          mode: 'subagent',
          isolation_ref: `eval-subagent-${fixture.slug}-${journey.persona_ref}`,
          goal: journey.goal,
          actor_refs: journey.actor_refs,
          nodes: journey.nodes,
          discoveries: {
            personas: [],
            actors: [],
            operations: [],
            scenarios: [],
            invariants: [],
            surfaces: [],
            branches: [],
            open_decisions: [],
          },
        },
      }, workspace);
      published = recorded;
    }
  }
  const version = typeof published.graph_version === 'string'
    ? published.graph_version
    : published.graph_version?.id;
  process.stdout.write(`Seeded ${evalId} at ${version || 'unknown GraphVersion'}\n`);
} finally {
  if (daemonStarted) {
    await stopIncompatibleServer(runtimePaths(workspace)).catch(() => {});
  }
}
