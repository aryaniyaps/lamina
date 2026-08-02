#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCurrentFixture } from '../benchmarks/semantic-oracle-v1/run-current-fixture.mjs';
import { semanticDigest } from '../benchmarks/semantic-oracle-v1/contract.mjs';
import { validateResult } from '../benchmarks/semantic-oracle-v1/validate.mjs';
import { adaptAlternateRecords } from '../benchmarks/semantic-oracle-v1/adapters/alternate-records-v1.mjs';

const first = runCurrentFixture();
const runner = fileURLToPath(new URL('../benchmarks/semantic-oracle-v1/run-current-fixture.mjs', import.meta.url));
const firstChild = execFileSync(process.execPath, [runner], { encoding: 'utf8' });
const secondChild = execFileSync(process.execPath, [runner], { encoding: 'utf8' });
const second = JSON.parse(secondChild);

assert.deepEqual(validateResult(first), { valid: true, errors: [] });
assert.equal(secondChild, firstChild,
  'fresh processes must emit byte-identical normalized JSON for identical inputs');
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
const nullLiteral = first.semantic.relations.find((item) => item.predicate === 'custom:nullablePolicy');
const falseLiteral = first.semantic.relations.find((item) => item.predicate === 'custom:enabled');
assert.deepEqual(
  { value_kind: nullLiteral.value_kind, object_id: nullLiteral.object_id, literal: nullLiteral.literal },
  { value_kind: 'literal', object_id: null, literal: null },
  'literal null must remain distinct from a missing object value',
);
assert.deepEqual(
  { value_kind: falseLiteral.value_kind, object_id: falseLiteral.object_id, literal: falseLiteral.literal },
  { value_kind: 'literal', object_id: null, literal: false },
  'falsy literal values must survive normalization',
);
assert.ok(first.semantic.obligations.some((item) => item.category === 'authority'));
assert.ok(first.semantic.obligations.every((item) => item.complete === false),
  'the current WorkMap must preserve unresolved completeness instead of inventing passes');
assert.ok(first.semantic.derived_state.every((item) =>
  item.rebuildable && !item.authoritative
  && item.rebuild_digest_before === item.rebuild_digest_after
  && item.canonical_head_before === item.canonical_head_after));

const alternateFormatResult = adaptAlternateRecords({
  format: 'example.alternate-semantic-records/v1',
  case: first.fixture_id,
  nodes: first.semantic.resources,
  edges: first.semantic.relations,
  commits: first.semantic.graph_versions,
  refs: first.semantic.branches,
  conflicts: first.semantic.contradictions,
  duties: first.semantic.obligations,
  transactions: first.semantic.publication_attempts,
  projections: first.semantic.derived_state,
});
assert.deepEqual(validateResult(alternateFormatResult), { valid: true, errors: [] },
  'alternate storage formats may compare through their own explicit adapter');
assert.deepEqual(alternateFormatResult.semantic, first.semantic,
  'differently keyed raw records must normalize to identical semantics');

console.log('semantic oracle contract tests passed');
