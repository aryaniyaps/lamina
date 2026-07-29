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
      predicate: 'lamina:relevantTo',
      object: id('workflow'),
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
  const published = await graphRequest('session.publish', { id: session.id }, workspace);
  const version = typeof published.graph_version === 'string'
    ? published.graph_version
    : published.graph_version?.id;
  process.stdout.write(`Seeded ${evalId} at ${version || 'unknown GraphVersion'}\n`);
} finally {
  if (daemonStarted) {
    await stopIncompatibleServer(runtimePaths(workspace)).catch(() => {});
  }
}
