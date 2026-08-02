#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runCurrentFixture } from '../benchmarks/semantic-oracle-v1/run-current-fixture.mjs';
import { semanticDigest } from '../benchmarks/semantic-oracle-v1/contract.mjs';
import { validateResult } from '../benchmarks/semantic-oracle-v1/validate.mjs';

const first = runCurrentFixture();
const second = runCurrentFixture();

assert.deepEqual(validateResult(first), { valid: true, errors: [] });
assert.deepEqual(second, first, 'identical fixture inputs must produce byte-stable normalized semantics');
assert.equal(first.semantic_digest, semanticDigest(first.semantic));

const resourceById = new Map(first.semantic.resources.map((item) => [item.id, item]));
assert.equal(resourceById.has('operation.invalid-partial'), false,
  'a validation failure must not expose staged Resources');
assert.equal(resourceById.has('entity.interrupted-partial'), false,
  'an interruption after internal publication writes must roll back staged Resources');
assert.deepEqual(
  new Set(first.semantic.resources.map((item) => item.epistemic_class)),
  new Set(['intended', 'observed', 'inferred', 'simulated', 'human_evidence', 'runtime_evidence']),
  'the adapter must preserve every current epistemic class',
);

const main = first.semantic.branches.find((item) => item.id === 'branch:main');
const feature = first.semantic.branches.find((item) => item.id === 'branch:feature/semantic-isolation');
assert.ok(main && feature);
assert.equal(main.active_resource_ids.includes('surface.feature-only'), false);
assert.equal(feature.active_resource_ids.includes('surface.feature-only'), true);

const interrupted = first.semantic.publication_attempts
  .find((item) => item.id === 'attempt:interrupted-publication');
assert.equal(interrupted.outcome, 'interrupted');
assert.equal(interrupted.base_version_id, interrupted.head_version_id_after);
assert.equal(interrupted.error_code, 'LAMINA_INJECTED_INTERRUPTION');

const cas = first.semantic.publication_attempts
  .find((item) => item.id === 'attempt:concurrent-b-conflict');
assert.equal(cas.outcome, 'compare_and_swap_failed');
assert.equal(cas.error_code, 'LAMINA_COMPARE_AND_SWAP_FAILED');
assert.ok(main.active_resource_ids.includes('entity.concurrent-a'));
assert.ok(main.active_resource_ids.includes('entity.concurrent-b'));

assert.ok(first.semantic.contradictions.some((item) => item.type === 'statement_conflict'));
assert.ok(first.semantic.obligations.some((item) => item.category === 'authority'));
assert.ok(first.semantic.obligations.every((item) => item.complete === false),
  'the current WorkMap must preserve unresolved completeness instead of inventing passes');
assert.ok(first.semantic.derived_state.every((item) =>
  item.rebuildable && !item.authoritative
  && item.rebuild_digest_before === item.rebuild_digest_after
  && item.canonical_head_before === item.canonical_head_after));

const alternateFormatResult = structuredClone(first);
alternateFormatResult.adapter = {
  schema: 'lamina.semantic-adapter/v1',
  id: 'alternate-storage-example',
  version: '1',
  input_format: 'example.alternate-graph/v1',
};
assert.deepEqual(validateResult(alternateFormatResult), { valid: true, errors: [] },
  'alternate storage formats may compare through their own explicit adapter');

console.log('semantic oracle contract tests passed');
