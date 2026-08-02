#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  WORKFLOW_SEED_CANONICAL_SHA256, WORKFLOW_SEED_RAW_SHA256,
  loadWorkflowSeed, parseWorkflowSeedBytes, validateWorkflowSeed,
} from '../benchmarks/real-repository-oracle-v1/workflow-seed.mjs';
import { loadEvidenceSelection } from '../benchmarks/real-repository-oracle-v1/case-evidence.mjs';

const loaded = loadWorkflowSeed();
assert.equal(loaded.raw_sha256, WORKFLOW_SEED_RAW_SHA256);
assert.equal(loaded.canonical_sha256, WORKFLOW_SEED_CANONICAL_SHA256);
assert.deepEqual(validateWorkflowSeed(loaded.seed), { valid: true, errors: [] });
assert.deepEqual(loaded.seed.collections.map((item) => [item.fixture_id, item.workflows.length]), [
  ['small', 5], ['medium', 5], ['large', 5],
]);
assert.equal(loaded.seed.collections.flatMap((item) => item.workflows).length, 15);

const evidence = loadEvidenceSelection().selection;
const evidenceRefs = new Map(Object.entries(evidence.tiers).flatMap(([tier, item]) =>
  item.anchors.map((anchor, index) => [`${tier}.evidence.${index + 1}`, anchor])));
for (const collection of loaded.seed.collections) {
  for (const workflow of collection.workflows) {
    assert.ok(workflow.operations.length >= 1 && workflow.operations.length <= 3);
    assert.ok(workflow.actors.length >= 1);
    assert.ok(workflow.states.length >= 2);
    assert.ok(workflow.transitions.length >= 1);
    assert.ok(workflow.failure_contracts.length >= 1);
    assert.ok(workflow.invariants.length >= 1);
    assert.ok(workflow.scenarios.length >= 1);
    assert.ok(workflow.implementation_ready_input.target_ids.length >= 1);
    assert.deepEqual(workflow.implementation_ready_input.unresolved, []);
    for (const surface of workflow.surfaces) {
      const anchor = evidenceRefs.get(surface.evidence_ref);
      assert.ok(anchor, `${surface.evidence_ref} must exist in reviewed evidence selection`);
      assert.deepEqual(
        { path: surface.path, blob_oid: surface.blob_oid, symbol: surface.symbol, line: surface.line },
        { path: anchor.path, blob_oid: anchor.blob_oid, symbol: anchor.symbol, line: anchor.line },
        `${surface.id} must identify an exact Git target at the pin`,
      );
    }
  }
}

const bytes = fs.readFileSync(new URL('../benchmarks/real-repository-oracle-v1/workflows-v1.json', import.meta.url));
const pathTamper = JSON.parse(bytes);
pathTamper.collections[0].workflows[0].surfaces[0].path = '';
assert.throws(() => parseWorkflowSeedBytes(Buffer.from(JSON.stringify(pathTamper)), { requireReviewedBytes: false }),
  /bounded tier-local evidence target/);
const leak = JSON.parse(bytes);
leak.collections[0].workflows[0].request = 'Which Workflow wins?';
assert.throws(() => parseWorkflowSeedBytes(Buffer.from(JSON.stringify(leak)), { requireReviewedBytes: false }),
  /request-to-answer|unexpected/);
for (const key of ['request_text', 'expected_workflow_ids', 'grading_threshold', 'maximum_rank']) {
  const disguisedLeak = JSON.parse(bytes);
  disguisedLeak.collections[0].workflows[0][key] = 'private controller material';
  assert.throws(
    () => parseWorkflowSeedBytes(Buffer.from(JSON.stringify(disguisedLeak)), { requireReviewedBytes: false }),
    /request-to-answer|unexpected/,
  );
}
for (const [field, value] of [
  ['name', `  ${loaded.seed.collections[0].workflows[0].id.toUpperCase()}  `],
  ['alias', `  ${loaded.seed.collections[0].workflows[0].name.toUpperCase()}  `],
]) {
  const collision = JSON.parse(bytes);
  if (field === 'name') collision.collections[0].workflows[1].name = value;
  else collision.collections[0].workflows[1].aliases[0] = value;
  assert.throws(
    () => parseWorkflowSeedBytes(Buffer.from(JSON.stringify(collision)), { requireReviewedBytes: false }),
    /collides with another Workflow id, name, or alias/,
  );
}
const unsafePath = JSON.parse(bytes);
unsafePath.collections[0].workflows[0].surfaces[0].path = '../outside.ts';
assert.throws(() => parseWorkflowSeedBytes(Buffer.from(JSON.stringify(unsafePath)), { requireReviewedBytes: false }),
  /bounded tier-local evidence target/);
for (const [field, value] of [['symbol', 'bad symbol'], ['line', 1_000_001]]) {
  const invalidSurface = JSON.parse(bytes);
  invalidSurface.collections[0].workflows[0].surfaces[0][field] = value;
  assert.throws(() => parseWorkflowSeedBytes(Buffer.from(JSON.stringify(invalidSurface)), { requireReviewedBytes: false }),
    /bounded tier-local evidence target/);
}
const danglingOperation = JSON.parse(bytes);
danglingOperation.collections[0].workflows[0].operations[0].surface_id = 'small.surface.missing';
assert.throws(() => parseWorkflowSeedBytes(Buffer.from(JSON.stringify(danglingOperation)), { requireReviewedBytes: false }),
  /unknown surfaces/);
const outOfRangeEvidence = JSON.parse(bytes);
outOfRangeEvidence.collections[0].workflows[0].surfaces[0].evidence_ref = 'small.evidence.9';
assert.throws(() => parseWorkflowSeedBytes(Buffer.from(JSON.stringify(outOfRangeEvidence)), { requireReviewedBytes: false }),
  /bounded tier-local evidence target/);
const duplicateNestedId = JSON.parse(bytes);
duplicateNestedId.collections[0].workflows[0].actors[0].id = duplicateNestedId.collections[0].workflows[0].id;
assert.throws(() => parseWorkflowSeedBytes(Buffer.from(JSON.stringify(duplicateNestedId)), { requireReviewedBytes: false }),
  /malformed or duplicated/);
const incompleteReady = JSON.parse(bytes);
incompleteReady.collections[0].workflows[0].implementation_ready_input.target_ids = [];
assert.throws(() => parseWorkflowSeedBytes(Buffer.from(JSON.stringify(incompleteReady)), { requireReviewedBytes: false }),
  /implementation_ready_input is incomplete/);
const excessiveArray = JSON.parse(bytes);
excessiveArray.collections[0].workflows[0].aliases = Array.from({ length: 33 }, (_, index) => `alias ${index}`);
assert.throws(() => parseWorkflowSeedBytes(Buffer.from(JSON.stringify(excessiveArray)), { requireReviewedBytes: false }),
  /bounded arrays|identity/);
assert.throws(() => parseWorkflowSeedBytes(Buffer.alloc(64 * 1024 + 1)), /bounded source contract/);
const digestTamper = Buffer.from(bytes);
digestTamper[digestTamper.length - 2] = digestTamper[digestTamper.length - 2] === 10 ? 32 : 10;
assert.throws(() => parseWorkflowSeedBytes(digestTamper), /reviewed source identity/);

console.log('real repository oracle Workflow seed contracts passed');
