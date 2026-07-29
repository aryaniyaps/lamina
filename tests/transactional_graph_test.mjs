#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GraphEngine } from '../packages/cli/lib/graph-runtime/engine.mjs';
import { digest, runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-transactional-graph-'));
execFileSync('git', ['init', '-b', 'main'], { cwd: root });
execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
execFileSync('git', ['add', 'README.md'], { cwd: root });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

const paths = runtimePaths(root);
const engine = new GraphEngine(paths);
const context = engine.currentContext(root);

try {
  fs.writeFileSync(path.join(root, 'README.md'), '# Dirty one\n');
  const dirtyOne = engine.currentContext(root).source_revision;
  fs.writeFileSync(path.join(root, 'README.md'), '# Dirty two\n');
  const dirtyTwo = engine.currentContext(root).source_revision;
  assert.notEqual(dirtyOne, dirtyTwo, 'dirty source revisions must hash content, not only git status text');
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n');

  const branch = engine.ensureBranch('main', context.source_revision);
  const initialHead = engine.head(branch.id);

  const session = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageResource(session.id, { id: 'product.fixture', kind: 'product', data: { name: 'Fixture' }, alias: 'product.fixture' }, 'intent');
  engine.stageResource(session.id, { id: 'workflow.checkout', kind: 'workflow', data: { name: 'checkout' }, alias: 'workflow.checkout' }, 'intent');
  engine.stageResource(session.id, { id: 'operation.pay', kind: 'operation', data: { name: 'pay' } }, 'intent');
  engine.stageResource(session.id, { id: 'actor.member', kind: 'actor', data: { name: 'member' } }, 'intent');
  for (let index = 1; index <= 4; index += 1) {
    engine.stageResource(session.id, {
      id: `persona.${index}`,
      kind: 'persona',
      data: { name: `persona-${index}` },
    }, 'intent');
    engine.stageStatement(session.id, {
      subject: `persona.${index}`,
      predicate: 'lamina:canAssume',
      object: 'actor.member',
    }, 'intent');
  }
  engine.stageStatement(session.id, {
    subject: 'actor.member',
    predicate: 'lamina:authorizedFor',
    object: 'operation.pay',
  }, 'intent');
  const firstStatement = engine.stageStatement(session.id, {
    subject: 'workflow.checkout',
    predicate: 'lamina:hasStep',
    object: 'operation.pay',
    qualifiers: { position: 1 },
  }, 'agent');
  const duplicateStatement = engine.stageStatement(session.id, {
    qualifiers: { position: 1 },
    object: 'operation.pay',
    predicate: 'lamina:hasStep',
    subject: 'workflow.checkout',
  }, 'agent');
  assert.equal(duplicateStatement.id, firstStatement.id, 'normalized Statement identity must be idempotent');
  const stagedView = engine.graphQuery({ at: session.id, kind: 'workflow' }, context);
  assert.deepEqual(stagedView.resources.map((item) => item.id), ['workflow.checkout'],
    'session queries must include staged Resources before publication');
  assert.ok(stagedView.statements.some((item) => item.id === firstStatement.id),
    'session queries must include staged Statements before publication');
  const stringStatement = engine.stageStatement(session.id, {
    subject: 'workflow.checkout',
    predicate: 'custom:summary',
    literal: 'Owner can recover access',
  }, 'agent');
  assert.equal(
    engine.querySession(session.id).statements.find((item) => item.id === stringStatement.id).literal,
    'Owner can recover access',
    'scalar string literals must round-trip as valid JSON',
  );
  const isolated = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  assert.throws(
    () => engine.stageStatement(isolated.id, {
      subject: 'workflow.checkout',
      predicate: 'custom:mustNotSeeStagedAlias',
      literal: true,
    }),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED',
    'another session must not resolve a Resource staged only in a sibling session',
  );
  engine.abortSession(isolated.id);
  assert.throws(
    () => engine.stageStatement(session.id, {
      subject: 'workflow.checkout',
      predicate: 'custom:spoof',
      literal: true,
      epistemic_class: 'observed',
    }),
    (error) => error.code === 'LAMINA_EPISTEMIC_STATUS_FORBIDDEN',
  );
  assert.throws(
    () => engine.stageResource(session.id, {
      id: 'product.nested-spoof',
      kind: 'product',
      data: { approved: true },
    }),
    (error) => error.code === 'LAMINA_EPISTEMIC_STATUS_FORBIDDEN',
    'approval status must not be smuggled through Resource data',
  );
  assert.throws(
    () => engine.stageResource(session.id, {
      id: 'product.deep-spoof',
      kind: 'product',
      data: { metadata: { approval_status: 'approved' } },
    }),
    (error) => error.code === 'LAMINA_EPISTEMIC_STATUS_FORBIDDEN',
    'engine-owned status must not be smuggled through nested Resource payloads',
  );
  assert.throws(
    () => engine.stageStatement(session.id, {
      subject: 'workflow.checkout',
      predicate: 'custom:nestedSpoof',
      literal: true,
      qualifiers: { epistemic_class: 'observed' },
    }),
    (error) => error.code === 'LAMINA_EPISTEMIC_STATUS_FORBIDDEN',
    'epistemic class must not be smuggled through Statement qualifiers',
  );

  const firstPublish = engine.publishSession(session.id, context.source_revision);
  assert.notEqual(firstPublish.graph_version, initialHead.id);
  assert.equal(firstPublish.validation.ok, true);
  assert.equal(firstPublish.validation.approved, true);
  const initialScope = engine.validateView('HEAD', 'workflow.checkout', context);
  assert.equal(initialScope.approved, true);
  assert.equal(initialScope.validation_scope.mode, 'affected_closure');
  const implementationContext = engine.implementationContext({ workflows: ['workflow.checkout'] }, context);
  assert.equal(implementationContext.implementation_ready, false,
    'coding context must fail closed when the product contract lacks implementation detail');
  assert.ok(implementationContext.readiness_gaps.some((item) => item.code === 'operation_contract_missing'));
  assert.ok(implementationContext.readiness_gaps.some((item) => item.code === 'invariants_missing'));
  assert.ok(implementationContext.readiness_gaps.some((item) => item.code === 'scenarios_missing'));

  const missingProof = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageResource(missingProof.id, {
    id: 'proof.payment',
    kind: 'proof',
    data: { name: 'Payment boundary proof' },
  }, 'intent');
  engine.stageStatement(missingProof.id, {
    subject: 'operation.pay',
    predicate: 'lamina:requiresProof',
    object: 'proof.payment',
  }, 'intent');
  const missingProofPublish = engine.publishSession(missingProof.id, context.source_revision);
  assert.equal(missingProofPublish.validation.approved, false);
  assert.ok(missingProofPublish.validation.readiness_gaps.some((item) =>
    item.code === 'proof_evidence_missing' && item.resource === 'proof.payment'));
  const proofEvidence = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageResource(proofEvidence.id, {
    id: 'evidence.payment',
    kind: 'evidence',
    data: { name: 'Payment boundary evidence' },
  }, 'runtime');
  engine.stageStatement(proofEvidence.id, {
    subject: 'proof.payment',
    predicate: 'lamina:supportedBy',
    object: 'evidence.payment',
  }, 'runtime');
  engine.publishSession(proofEvidence.id, context.source_revision);
  assert.equal(engine.validateView('HEAD', 'operation.pay', context).approved, true,
    'proof evidence should close the affected operation readiness gap');

  const multiStep = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageResource(multiStep.id, {
    id: 'workflow.fulfillment',
    kind: 'workflow',
    data: { name: 'fulfillment' },
  }, 'intent');
  for (const [id, position] of [['operation.pack', 1], ['operation.ship', 2]]) {
    engine.stageResource(multiStep.id, { id, kind: 'operation', data: { name: id } }, 'intent');
    engine.stageStatement(multiStep.id, {
      subject: 'actor.member',
      predicate: 'lamina:authorizedFor',
      object: id,
    }, 'intent');
    engine.stageStatement(multiStep.id, {
      subject: 'workflow.fulfillment',
      predicate: 'lamina:hasStep',
      object: id,
      qualifiers: { position },
    }, 'intent');
  }
  const multiStepPublish = engine.publishSession(multiStep.id, context.source_revision);
  assert.equal(multiStepPublish.validation.ok, true);
  assert.ok(!multiStepPublish.validation.contradictions.some((id) =>
    (engine.resource(id)?.data?.members || []).some((member) =>
      engine.statementDetails(new Set([member]))[0]?.subject === 'workflow.fulfillment')),
  'different qualified workflow-step positions must not be treated as competing facts');

  const unrelatedGap = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageResource(unrelatedGap.id, {
    id: 'workflow.unreachable',
    kind: 'workflow',
    data: { name: 'unreachable' },
  }, 'intent');
  const unrelatedGapPublish = engine.publishSession(unrelatedGap.id, context.source_revision);
  assert.equal(unrelatedGapPublish.validation.approved, false);
  assert.ok(unrelatedGapPublish.validation.readiness_gaps.some((item) =>
    item.code === 'workflow_unreachable' && item.resource === 'workflow.unreachable'));
  assert.equal(engine.validateView('HEAD', 'workflow.checkout', context).approved, true,
    'scoped validation must not be blocked by an unrelated disconnected workflow');

  const preDirtyHead = engine.head(branch.id).id;
  fs.writeFileSync(path.join(root, 'README.md'), '# Dirty branch base\n');
  const dirtyBranchContext = engine.currentContext(root);
  const dirtyBranch = engine.ensureBranch('dirty-feature', dirtyBranchContext.source_revision);
  assert.equal(engine.head(dirtyBranch.id).id, preDirtyHead,
    'a dirty worktree branch must inherit from the closest committed source ancestor');
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n');

  const abandoned = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageResource(abandoned.id, {
    id: 'entity.abandoned',
    kind: 'entity',
    data: {},
    alias: 'entity.reusable',
  });
  engine.abortSession(abandoned.id);
  assert.equal(engine.resource('entity.abandoned'), null, 'aborting must collect session-only graph records');
  assert.equal(engine.resolveResourceId('entity.reusable'), null, 'aborting must not leak aliases');

  // Re-proposal creates no new graph version.
  const headBeforeRepeat = engine.head(branch.id).id;
  const repeat = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageStatement(repeat.id, {
    subject: 'workflow.checkout',
    predicate: 'lamina:hasStep',
    object: 'operation.pay',
    qualifiers: { position: 1 },
  }, 'agent');
  const repeatPublish = engine.publishSession(repeat.id, context.source_revision);
  assert.equal(repeatPublish.graph_version, headBeforeRepeat);
  assert.equal(repeatPublish.idempotent, true);

  // Conflicting facts coexist and produce exactly one stable Contradiction.
  const policyA = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  const a = engine.stageStatement(policyA.id, {
    subject: 'operation.pay',
    predicate: 'custom:refundWindowDays',
    literal: 14,
  }, 'intent');
  engine.publishSession(policyA.id, context.source_revision);
  const policyB = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  const b = engine.stageStatement(policyB.id, {
    subject: 'operation.pay',
    predicate: 'custom:refundWindowDays',
    literal: 30,
  }, 'intent');
  const conflictPublish = engine.publishSession(policyB.id, context.source_revision);
  assert.equal(conflictPublish.contradictions.length, 1);
  assert.equal(conflictPublish.validation.approved, false);
  const conflictQuery = engine.graphQuery({ at: 'HEAD', subject: 'operation.pay', predicate: 'custom:refundWindowDays' }, context);
  assert.deepEqual(new Set(conflictQuery.statements.map((item) => item.id)), new Set([a.id, b.id]));
  assert.equal(conflictQuery.contradictions.length, 1);
  assert.deepEqual(
    engine.query(
      'MATCH (g:GraphVersion {id: $id})-[:VERSION_ADD_RES]->(r:Resource {kind: $kind}) RETURN r.id AS id',
      { id: conflictPublish.graph_version, kind: 'contradiction' },
    ).map((item) => item.id),
    conflictPublish.contradictions,
    'a derived Contradiction must be retained as part of the GraphVersion delta',
  );

  const sameConflict = engine.createContradiction('statement_conflict', [a.id, b.id]);
  assert.equal(sameConflict.id, conflictPublish.contradictions[0]);
  assert.equal(sameConflict.created, false);

  const aliasCollision = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageResource(aliasCollision.id, {
    id: 'entity.alias-collision',
    kind: 'entity',
    data: {},
    alias: 'product.fixture',
  });
  const aliasPublish = engine.publishSession(aliasCollision.id, context.source_revision);
  assert.equal(aliasPublish.validation.approved, false, 'active Resource alias collisions must block approval');
  assert.ok(aliasPublish.validation.contradictions.length >= 1);
  assert.equal(engine.validateView('HEAD', 'product.fixture', context).approved, false,
    'affected-closure validation must include every member of a touching alias contradiction');
  const aliasContradiction = engine.query(
    'MATCH (c:Resource {kind: $kind}) RETURN c.id AS id, c.data AS data',
    { kind: 'contradiction' },
  ).find((item) => item.data?.type === 'alias_collision').id;
  const resolveAliasCollision = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.retireResource(resolveAliasCollision.id, 'entity.alias-collision');
  const resolvedAliasPublish = engine.publishSession(resolveAliasCollision.id, context.source_revision);
  assert.ok(!resolvedAliasPublish.validation.contradictions.includes(aliasContradiction),
    'retiring a conflicting member must stop its historical Contradiction from blocking the active view');

  // Compare-and-swap prevents lost updates; rebase preserves both proposals.
  const concurrentA = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  const concurrentB = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageResource(concurrentA.id, { id: 'entity.a', kind: 'entity', data: {} });
  engine.stageResource(concurrentB.id, { id: 'entity.b', kind: 'entity', data: {} });
  engine.publishSession(concurrentA.id, context.source_revision);
  assert.throws(
    () => engine.publishSession(concurrentB.id, context.source_revision),
    (error) => error.code === 'LAMINA_COMPARE_AND_SWAP_FAILED',
  );
  engine.rebaseSession(concurrentB.id);
  engine.publishSession(concurrentB.id, context.source_revision);
  const afterConcurrent = engine.graphQuery({ at: 'HEAD', kind: 'entity' }, context);
  assert.ok(afterConcurrent.resources.some((item) => item.id === 'entity.a'));
  assert.ok(afterConcurrent.resources.some((item) => item.id === 'entity.b'));

  const retirement = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.retireResource(retirement.id, 'entity.b');
  assert.ok(!engine.querySession(retirement.id).resources.some((item) => item.id === 'entity.b'));
  const retirementPublish = engine.publishSession(retirement.id, context.source_revision);
  assert.ok(!engine.graphQuery({ at: 'HEAD', kind: 'entity' }, context).resources.some((item) => item.id === 'entity.b'));
  assert.deepEqual(
    engine.query(
      'MATCH (g:GraphVersion {id: $id})-[:VERSION_RETIRE_RES]->(r:Resource) RETURN r.id AS id',
      { id: retirementPublish.graph_version },
    ).map((item) => item.id),
    ['entity.b'],
    'retirement must be represented as a GraphVersion delta',
  );

  // Failed publication leaves the branch head unchanged.
  const invalid = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageStatement(invalid.id, {
    subject: 'workflow.checkout',
    predicate: 'lamina:hasStep',
    object: 'operation.pay',
    qualifiers: { position: 1, branch: 'duplicate-position' },
  });
  const headBeforeInvalid = engine.head(branch.id).id;
  assert.throws(
    () => engine.publishSession(invalid.id, context.source_revision),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED',
  );
  assert.equal(engine.head(branch.id).id, headBeforeInvalid);

  // Observation target is isolated and retry-idempotent; canonical Claims do not change.
  const snapshot = {
    product: 'fixture',
    source_revision: context.source_revision,
    source_root: root,
    ignore_policy_digest: 'ignore-v1',
    extractor_set_digest: 'extractor-v1',
  };
  const envelopeBase = {
    source_snapshot: snapshot,
    source_key: 'README.md',
    content_hash: 'abc',
    path: 'README.md',
    extractor: { id: 'test', version: '1' },
    payload: { kind: 'document' },
  };
  const observationId = digest('observation', {
    snapshot,
    source_key: envelopeBase.source_key,
    content_hash: envelopeBase.content_hash,
    extractor: envelopeBase.extractor,
    payload: envelopeBase.payload,
  });
  fs.writeFileSync(path.join(paths.cocoindex, 'target-generation'), 'g1\n');
  const batch = { snapshot, generation: 'g1', upserts: [{ id: observationId, ...envelopeBase }], deletes: [] };
  assert.throws(
    () => engine.applyObservationBatch({
      ...batch,
      upserts: [{ id: observationId, ...envelopeBase, source_snapshot: { ...snapshot, source_revision: 'spoofed' } }],
    }),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED',
    'an observation batch must not mix source snapshots',
  );
  assert.equal(engine.observationStatus({ product: 'fixture', generation: 'g1' }).count, 0,
    'a rejected observation batch must roll back atomically');
  assert.equal(engine.applyObservationBatch(batch).upserted, 1);
  assert.equal(engine.applyObservationBatch(batch).upserted, 1);
  const evidenceIsolation = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageStatement(evidenceIsolation.id, {
    subject: 'workflow.checkout',
    predicate: 'lamina:hasStep',
    object: 'operation.pay',
    qualifiers: { position: 1 },
    evidence: [observationId],
  }, 'agent');
  assert.equal(
    engine.query(
      'MATCH (s:Statement {id: $id})-[:SUPPORTED_BY]->(r:Resource {id: $evidence}) RETURN r.id AS id',
      { id: firstStatement.id, evidence: observationId },
    ).length,
    0,
    'additional evidence for an existing Statement must remain session-local before publication',
  );
  assert.equal(engine.querySession(evidenceIsolation.id).pending_evidence.length, 1);
  engine.abortSession(evidenceIsolation.id);
  assert.equal(
    engine.query(
      'MATCH (s:Statement {id: $id})-[:SUPPORTED_BY]->(r:Resource {id: $evidence}) RETURN r.id AS id',
      { id: firstStatement.id, evidence: observationId },
    ).length,
    0,
    'aborting a session must discard pending evidence links',
  );
  const evidencePublishSession = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageStatement(evidencePublishSession.id, {
    subject: 'workflow.checkout',
    predicate: 'lamina:hasStep',
    object: 'operation.pay',
    qualifiers: { position: 1 },
    evidence: [observationId],
  }, 'agent');
  const headBeforeEvidencePublish = engine.head(branch.id).id;
  const evidencePublish = engine.publishSession(evidencePublishSession.id, context.source_revision);
  assert.notEqual(evidencePublish.graph_version, headBeforeEvidencePublish,
    'publishing new evidence must create a versioned mutation');
  assert.equal(
    engine.query(
      'MATCH (s:Statement {id: $id})-[:SUPPORTED_BY]->(r:Resource {id: $evidence}) RETURN r.id AS id',
      { id: firstStatement.id, evidence: observationId },
    ).length,
    1,
  );
  const observedClaim = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageStatement(observedClaim.id, {
    subject: 'product.fixture',
    predicate: 'custom:hasReadme',
    literal: true,
    evidence: [observationId],
  }, 'agent');
  const observedPublish = engine.publishSession(observedClaim.id, context.source_revision);
  assert.equal(observedPublish.validation.stale_evidence.length, 0);
  assert.equal(observedPublish.validation.approved, false,
    'existing contradictions continue to block overall branch approval');
  const canonicalHead = engine.head(branch.id).id;
  engine.applyObservationBatch({ snapshot, generation: 'g1', upserts: [], deletes: [observationId] });
  assert.equal(engine.head(branch.id).id, canonicalHead);
  const afterObservationDelete = engine.validateSet(
    engine.activeIds(branch.id).resources,
    engine.activeIds(branch.id).statements,
  );
  assert.equal(afterObservationDelete.approved, false);
  assert.ok(afterObservationDelete.stale_evidence.some((item) => item.evidence === observationId));
  const orphanBase = { ...envelopeBase, source_key: 'orphan.txt', content_hash: 'orphan' };
  const orphanId = digest('observation', {
    snapshot,
    source_key: orphanBase.source_key,
    content_hash: orphanBase.content_hash,
    extractor: orphanBase.extractor,
    payload: orphanBase.payload,
  });
  engine.applyObservationBatch({ snapshot, generation: 'g1', upserts: [{ id: orphanId, ...orphanBase }], deletes: [] });
  engine.applyObservationBatch({ snapshot, generation: 'g1', upserts: [], deletes: [orphanId] });
  assert.equal(engine.resource(orphanId), null, 'unreferenced retired Observations should not be retained');
  assert.ok(engine.resource(observationId), 'Claim-referenced retired Observations must remain for provenance');

  // Every relevant Persona receives a Mission; adapter modalities are open strings.
  const manifestSession = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  engine.stageResource(manifestSession.id, {
    id: 'adapter.non-screen',
    kind: 'capability_manifest',
    data: { name: 'non-screen', capabilities: ['device:relay', 'oracle:state'] },
  }, 'intent');
  for (const [id, capabilities] of [
    ['adapter.sdk', ['sdk:invoke', 'oracle:state']],
    ['adapter.background', ['process:background', 'oracle:state']],
    ['adapter.interactive', ['ui:interactive', 'oracle:state']],
  ]) {
    engine.stageResource(manifestSession.id, {
      id,
      kind: 'capability_manifest',
      data: { name: id.slice('adapter.'.length), capabilities },
    }, 'intent');
  }
  engine.stageResource(manifestSession.id, {
    id: 'workflow.device',
    kind: 'workflow',
    data: { name: 'device workflow', capability_requirements: ['device:relay'] },
  }, 'intent');
  engine.stageStatement(manifestSession.id, {
    subject: 'workflow.device',
    predicate: 'lamina:hasStep',
    object: 'operation.pay',
    qualifiers: { position: 1 },
  }, 'intent');
  engine.publishSession(manifestSession.id, context.source_revision);
  assert.equal(engine.graphQuery({ at: 'main', kind: 'capability_manifest' }, context).resources.length, 4,
    'SDK, background, interactive, and non-screen adapters must share the generic manifest model');
  assert.throws(
    () => engine.compileMissions({ workflow: 'workflow.device' }, context),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
      error.details.missing.includes('device:relay'),
    'a workflow with adapter requirements must fail closed when no manifest is selected',
  );
  assert.throws(
    () => engine.compileMissions({ workflow: 'workflow.device', adapter: 'adapter.sdk' }, context),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
      error.details.missing.includes('device:relay'),
    'an adapter manifest that lacks a required capability must fail closed',
  );
  const spoofedRuntimeSession = engine.startSession({
    branch: 'main',
    source_revision: context.source_revision,
  });
  engine.stageResource(spoofedRuntimeSession.id, {
    id: 'harness.agent-spoof',
    kind: 'harness_result',
    data: { events: [{ type: 'oracle_passed' }] },
  });
  assert.throws(
    () => engine.publishSession(spoofedRuntimeSession.id, context.source_revision),
    (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
      error.details.errors.some((message) => message.includes('must come from the Mission runner')),
    'agent-proposed HarnessResults must never masquerade as runtime evidence',
  );
  engine.abortSession(spoofedRuntimeSession.id);
  const missionCompileSession = engine.startSession({ branch: 'main', source_revision: context.source_revision });
  const headBeforeMissionCompile = engine.head(branch.id).id;
  const compiled = engine.compileMissions({
    workflow: 'workflow.checkout',
    adapter: 'adapter.non-screen',
    session: missionCompileSession.id,
  }, context);
  assert.equal(compiled.missions.length, 4, 'Persona Missions must not have a three-persona cap');
  assert.equal(new Set(compiled.missions.map((item) => item.persona)).size, 4);
  assert.deepEqual(compiled.missions[0].closure.operations, ['operation.pay']);
  assert.deepEqual(compiled.missions[0].closure.actors, ['actor.member']);
  assert.deepEqual(compiled.missions[0].closure.proofs, ['proof.payment']);
  assert.deepEqual(compiled.missions[0].closure.evidence, ['evidence.payment', observationId].sort());
  assert.equal(compiled.status, 'staged');
  assert.equal(engine.head(branch.id).id, headBeforeMissionCompile);
  engine.publishSession(missionCompileSession.id, context.source_revision);
  const headBeforeRuns = engine.head(branch.id).id;
  assert.throws(
    () => engine.runMission({
      mission: compiled.missions[0].id,
      events: [{ type: 'audit_passed', audit_kind: 'visual' }],
    }, context),
    (error) => error.code === 'LAMINA_EVIDENCE_MISSING',
    'a claimed live UI audit must carry a real artifact',
  );
  const run1 = engine.runMission({ mission: compiled.missions[0].id, events: [{ type: 'action_attempted' }, { type: 'oracle_passed' }] }, context);
  const run2 = engine.runMission({ mission: compiled.missions[1].id, events: [{ type: 'denial_observed' }, { type: 'recovery_attempted' }, { type: 'oracle_passed' }] }, context);
  const run3 = engine.runMission({ mission: compiled.missions[2].id, events: [{ type: 'state_observed' }, { type: 'oracle_passed' }] }, context);
  const run4 = engine.runMission({ mission: compiled.missions[3].id, events: [{ type: 'outcome_observed' }, { type: 'oracle_passed' }] }, context);
  assert.notEqual(run1.run, run2.run);
  assert.equal(new Set([run1.session, run2.session, run3.session, run4.session]).size, 4);
  assert.equal(run1.status, 'staged');
  assert.equal(engine.head(branch.id).id, headBeforeRuns, 'Mission Runs must remain isolated until explicit publication');
  assert.ok(engine.graphQuery({ at: run1.session, kind: 'run' }, context).resources.some((item) => item.id === run1.run));
  engine.publishSession(run1.session, context.source_revision);
  assert.throws(
    () => engine.publishSession(run2.session, context.source_revision),
    (error) => error.code === 'LAMINA_COMPARE_AND_SWAP_FAILED',
  );
  engine.rebaseSession(run2.session);
  engine.publishSession(run2.session, context.source_revision);
  for (const run of [run3, run4]) {
    engine.rebaseSession(run.session);
    engine.publishSession(run.session, context.source_revision);
  }
  assert.equal(engine.graphQuery({ at: 'main', kind: 'run' }, context).resources.length, 4,
    'every relevant Persona Mission must execute in its own isolated Run');

  // Semantic branch diff uses GraphVersions rather than legacy files.
  execFileSync('git', ['switch', '-c', 'feature'], { cwd: root });
  const featureContext = engine.currentContext(root);
  const featureBranch = engine.ensureBranch('feature', featureContext.source_revision);
  assert.equal(engine.head(featureBranch.id).id, engine.head(branch.id).id, 'new branch must fork the nearest ancestor GraphVersion');
  const featureSession = engine.startSession({ branch: 'feature', source_revision: featureContext.source_revision });
  engine.stageResource(featureSession.id, { id: 'surface.feature', kind: 'surface', data: {} }, 'intent');
  engine.publishSession(featureSession.id, featureContext.source_revision);
  const semanticDiff = engine.diff('main', 'HEAD', featureContext);
  assert.deepEqual(semanticDiff.resources.added, ['surface.feature']);
  assert.equal(semanticDiff.resources.added_details[0].kind, 'surface');
  assert.deepEqual(semanticDiff.statements.added, []);

  // A Git merge combines both branch memberships in a multi-parent GraphVersion.
  fs.writeFileSync(path.join(root, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', 'feature.txt'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'feature source'], { cwd: root });
  const committedFeature = engine.currentContext(root);
  const featureCommitSession = engine.startSession({ branch: 'feature', source_revision: committedFeature.source_revision });
  engine.stageResource(featureCommitSession.id, { id: 'entity.feature-commit', kind: 'entity', data: {} }, 'intent');
  engine.publishSession(featureCommitSession.id, committedFeature.source_revision);

  execFileSync('git', ['switch', 'main'], { cwd: root });
  fs.writeFileSync(path.join(root, 'main.txt'), 'main\n');
  execFileSync('git', ['add', 'main.txt'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'main source'], { cwd: root });
  const committedMain = engine.currentContext(root);
  const mainCommitSession = engine.startSession({ branch: 'main', source_revision: committedMain.source_revision });
  engine.stageResource(mainCommitSession.id, { id: 'entity.main-commit', kind: 'entity', data: {} }, 'intent');
  engine.publishSession(mainCommitSession.id, committedMain.source_revision);
  execFileSync('git', ['merge', '--no-ff', 'feature', '-m', 'merge feature'], { cwd: root });
  const mergeContext = engine.currentContext(root);
  const mergeSession = engine.startSession({ branch: 'main', source_revision: mergeContext.source_revision });
  const mergePublish = engine.publishSession(mergeSession.id, mergeContext.source_revision);
  const graphParents = engine.query(
    'MATCH (g:GraphVersion {id: $id})-[:VERSION_PARENT]->(p:GraphVersion) RETURN p.id AS id',
    { id: mergePublish.graph_version },
  );
  assert.equal(graphParents.length, 2);
  const mergedEntities = engine.graphQuery({ at: 'main', kind: 'entity' }, mergeContext);
  assert.ok(mergedEntities.resources.some((item) => item.id === 'entity.feature-commit'));
  assert.ok(mergedEntities.resources.some((item) => item.id === 'entity.main-commit'));

  // Conflicting facts introduced independently on Git parents reconcile into
  // one canonical Contradiction when the source branches merge.
  execFileSync('git', ['switch', '-c', 'conflict-feature'], { cwd: root });
  fs.writeFileSync(path.join(root, 'conflict-feature.txt'), 'feature\n');
  execFileSync('git', ['add', 'conflict-feature.txt'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'conflict feature source'], { cwd: root });
  const conflictFeatureContext = engine.currentContext(root);
  const conflictFeatureSession = engine.startSession({
    branch: 'conflict-feature',
    source_revision: conflictFeatureContext.source_revision,
  });
  const conflictFeatureStatement = engine.stageStatement(conflictFeatureSession.id, {
    subject: 'operation.pay',
    predicate: 'custom:settlementWindowHours',
    literal: 24,
  }, 'intent');
  engine.publishSession(conflictFeatureSession.id, conflictFeatureContext.source_revision);

  execFileSync('git', ['switch', 'main'], { cwd: root });
  fs.writeFileSync(path.join(root, 'conflict-main.txt'), 'main\n');
  execFileSync('git', ['add', 'conflict-main.txt'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'conflict main source'], { cwd: root });
  const conflictMainContext = engine.currentContext(root);
  const conflictMainSession = engine.startSession({
    branch: 'main',
    source_revision: conflictMainContext.source_revision,
  });
  const conflictMainStatement = engine.stageStatement(conflictMainSession.id, {
    subject: 'operation.pay',
    predicate: 'custom:settlementWindowHours',
    literal: 48,
  }, 'intent');
  engine.publishSession(conflictMainSession.id, conflictMainContext.source_revision);

  execFileSync('git', ['merge', '--no-ff', 'conflict-feature', '-m', 'merge conflicting feature'], { cwd: root });
  const conflictingMergeContext = engine.currentContext(root);
  const conflictingMergeSession = engine.startSession({
    branch: 'main',
    source_revision: conflictingMergeContext.source_revision,
  });
  const conflictingMerge = engine.publishSession(
    conflictingMergeSession.id,
    conflictingMergeContext.source_revision,
  );
  const settlementContradictions = conflictingMerge.validation.contradictions.filter((id) => {
    const members = new Set(engine.resource(id)?.data?.members || []);
    return members.has(conflictFeatureStatement.id) && members.has(conflictMainStatement.id);
  });
  assert.equal(settlementContradictions.length, 1,
    'a Git merge must materialize one stable Contradiction for incompatible parent facts');
  assert.equal(conflictingMerge.validation.approved, false);

  engine.applyObservationBatch(batch);
  const sourceOnlySession = engine.startSession({
    branch: 'main',
    source_revision: conflictingMergeContext.source_revision,
  });
  const sourceOnly = engine.publishSession(sourceOnlySession.id, 'source-only-revision');
  assert.notEqual(sourceOnly.graph_version, conflictingMerge.graph_version,
    'a changed source revision must create a GraphVersion even without graph deltas');
  assert.ok(sourceOnly.validation.stale_evidence.some((item) =>
    item.reason.includes('does not match the GraphVersion source revision')),
  'changed source snapshots must invalidate readiness until observations are refreshed');
  const sourceOnlyRepeat = engine.startSession({ branch: 'main', source_revision: 'source-only-revision' });
  assert.equal(engine.publishSession(sourceOnlyRepeat.id, 'source-only-revision').idempotent, true);

  const pendingBackupSession = engine.startSession({ branch: 'main', source_revision: 'source-only-revision' });
  engine.stageStatement(pendingBackupSession.id, {
    subject: 'workflow.checkout',
    predicate: 'lamina:hasStep',
    object: 'operation.pay',
    qualifiers: { position: 1 },
    evidence: [observationId],
  }, 'agent');
  assert.equal(engine.querySession(pendingBackupSession.id).pending_evidence.length, 1);
  const backupPath = path.join(root, 'graph.backup.json');
  const backup = engine.backup(backupPath);
  assert.ok(fs.existsSync(backup.output));
  assert.match(backup.digest, /^backup_/);
  const tamperedBackupPath = path.join(root, 'graph.tampered.backup.json');
  const tamperedBackup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  tamperedBackup.resources[0].data.tampered = true;
  fs.writeFileSync(tamperedBackupPath, JSON.stringify(tamperedBackup));
  const tamperTarget = new GraphEngine({
    ...paths,
    database: path.join(root, '.git', 'lamina', 'tampered.lbdb'),
  });
  try {
    assert.throws(
      () => tamperTarget.restore(tamperedBackupPath),
      (error) => error.code === 'LAMINA_VALIDATION_FAILED' &&
        error.message.includes('integrity'),
      'restore must reject a tampered deterministic backup before creating graph records',
    );
  } finally {
    tamperTarget.close();
  }
  const restored = new GraphEngine({
    ...paths,
    database: path.join(root, '.git', 'lamina', 'restored.lbdb'),
  });
  try {
    const result = restored.restore(backupPath);
    assert.equal(result.restored, true);
    assert.equal(result.resources, engine.query('MATCH (r:Resource) RETURN count(r) AS count')[0].count);
    assert.equal(result.statements, engine.query('MATCH (s:Statement) RETURN count(s) AS count')[0].count);
    assert.deepEqual(
      restored.graphQuery({ at: 'main', kind: 'entity' }, mergeContext).resources.map((item) => item.id).sort(),
      engine.graphQuery({ at: 'main', kind: 'entity' }, mergeContext).resources.map((item) => item.id).sort(),
    );
    assert.equal(
      restored.observationStatus({ product: 'fixture', generation: 'g1' }).count,
      engine.observationStatus({ product: 'fixture', generation: 'g1' }).count,
      'backup/restore must preserve observation-view membership',
    );
    assert.equal(restored.querySession(pendingBackupSession.id).pending_evidence.length, 1,
      'backup/restore must preserve durable session-local evidence proposals');
    const restoredBackupPath = path.join(root, 'graph.restored.backup.json');
    restored.backup(restoredBackupPath);
    assert.equal(
      fs.readFileSync(restoredBackupPath, 'utf8'),
      fs.readFileSync(backupPath, 'utf8'),
      'backup/restore must reproduce a byte-identical logical graph export',
    );
  } finally {
    restored.close();
  }
  engine.abortSession(pendingBackupSession.id);

  const headBeforeRebuild = engine.head(branch.id).id;
  const invalidated = engine.invalidateObservations('fixture');
  assert.notEqual(invalidated.generation, 'g1');
  assert.equal(engine.observationStatus({ product: 'fixture', generation: 'g1' }).count, 0);
  assert.throws(
    () => engine.applyObservationBatch({ ...batch, generation: 'g1' }),
    (error) => error.code === 'LAMINA_COMPARE_AND_SWAP_FAILED',
    'stale observation generations must not be able to reactivate old views',
  );
  const rebuilt = engine.applyObservationBatch({ ...batch, generation: invalidated.generation });
  assert.equal(rebuilt.upserted, 1, 'a rebuild generation must re-emit unchanged current observations');
  assert.equal(engine.head(branch.id).id, headBeforeRebuild,
    'rebuilding observations must never mutate canonical Claims or the branch head');
} finally {
  engine.close();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('transactional_graph_test: ok');
