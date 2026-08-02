#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runCurrentFixture } from '../benchmarks/semantic-oracle-v1/run-current-fixture.mjs';
import { gradeSemanticResult } from '../benchmarks/semantic-oracle-v1/grade.mjs';
import { applySemanticMutation, MUTATION_IDS } from '../benchmarks/semantic-oracle-v1/mutations.mjs';
import { SemanticOracleError, validateFixture } from '../benchmarks/semantic-oracle-v1/validate.mjs';
import {
  validateFixtureSchema,
  validateResultSchema,
} from '../benchmarks/semantic-oracle-v1/schema-validation.mjs';

const fixture = JSON.parse(fs.readFileSync(
  new URL('../benchmarks/semantic-oracle-v1/fixtures/compact-product-lifecycle.json', import.meta.url),
  'utf8',
));
const resultSchema = JSON.parse(fs.readFileSync(
  new URL('../benchmarks/semantic-oracle-v1/schema/result.schema.json', import.meta.url),
  'utf8',
));
const fixtureSchema = JSON.parse(fs.readFileSync(
  new URL('../benchmarks/semantic-oracle-v1/schema/fixture.schema.json', import.meta.url),
  'utf8',
));
assert.equal(resultSchema.$id, 'https://lamina.dev/schemas/semantic-result-v1.json');
assert.equal(fixtureSchema.$id, 'https://lamina.dev/schemas/semantic-fixture-v1.json');
assert.equal(validateFixtureSchema(fixture), true, JSON.stringify(validateFixtureSchema.errors));
assert.deepEqual(validateFixture(fixture), { valid: true, errors: [] });
assert.deepEqual(
  [...fixture.mutations.map((item) => item.id)].sort(),
  MUTATION_IDS,
  'every reviewed mutation must have an executable implementation and vice versa',
);

const current = await runCurrentFixture();
assert.equal(validateResultSchema(current), true, JSON.stringify(validateResultSchema.errors));
assert.deepEqual(gradeSemanticResult(fixture, current), {
  passed: true,
  classification: 'pass',
  diagnostics: [],
});

for (const mutation of fixture.mutations) {
  const mutated = applySemanticMutation(mutation.id, current);
  const grade = gradeSemanticResult(fixture, mutated);
  assert.equal(grade.passed, false, `mutation ${mutation.id} must fail`);
  assert.equal(grade.classification, mutation.expected_classification,
    `mutation ${mutation.id} must fail with its reviewed classification`);
  for (const expected of mutation.diagnostic_includes) {
    assert.ok(grade.diagnostics.some((item) => item.includes(expected)),
      `mutation ${mutation.id} must report reviewed diagnostic ${expected}`);
  }
}

const partial = gradeSemanticResult(fixture, applySemanticMutation('expose-partial-publication', current));
assert.equal(partial.classification, 'product_regression');
assert.ok(partial.diagnostics.some((item) => item.includes('forbidden resources.operation.invalid-partial')));
assert.ok(partial.diagnostics.some((item) => item.includes('forbidden resources.entity.interrupted-partial')));

const missingProvenance = gradeSemanticResult(
  fixture,
  applySemanticMutation('change-provenance', current),
);
assert.equal(missingProvenance.classification, 'product_regression');
assert.ok(missingProvenance.diagnostics.some((item) =>
  item.includes('product.checkout') && item.includes('epistemic_class')));

const missingPermission = gradeSemanticResult(
  fixture,
  applySemanticMutation('remove-permission', current),
);
assert.equal(missingPermission.classification, 'product_regression');
assert.ok(missingPermission.diagnostics.some((item) => item.includes('missing relation')));

const malformedFixture = structuredClone(fixture);
malformedFixture.cases[1].id = malformedFixture.cases[0].id;
assert.throws(
  () => gradeSemanticResult(malformedFixture, current),
  (error) => error instanceof SemanticOracleError
    && error.code === 'LAMINA_SEMANTIC_FIXTURE_INVALID'
    && error.details.errors.some((item) => item.includes('fixture case ids')),
  'fixture defects must be reported separately from product regressions',
);

for (const corrupt of [
  (value) => { value.semantic = null; },
  (value) => { value.semantic.resources = null; },
  (value) => { value.semantic.resources = [null]; },
  (value) => { value.semantic.relations[0].generated_by_ids = null; },
  (value) => { value.semantic.graph_versions[0].validation = null; },
  (value) => { value.adapter.id = ''; },
]) {
  const malformed = structuredClone(current);
  corrupt(malformed);
  assert.doesNotThrow(() => gradeSemanticResult(fixture, malformed));
  assert.equal(gradeSemanticResult(fixture, malformed).classification, 'candidate_invalid');
  assert.equal(validateResultSchema(malformed), false,
    'Ajv and the semantic validator must reject the same malformed candidate envelope');
}

for (const corrupt of [
  (value) => { value.cases = null; },
  (value) => { value.cases = [null]; },
  (value) => { value.forbidden = [null]; },
  (value) => { value.mutations = null; },
  (value) => { value.expected.resources = [null]; },
]) {
  const malformed = structuredClone(fixture);
  corrupt(malformed);
  assert.throws(
    () => gradeSemanticResult(malformed, current),
    (error) => error instanceof SemanticOracleError
      && error.code === 'LAMINA_SEMANTIC_FIXTURE_INVALID',
  );
  assert.equal(validateFixtureSchema(malformed), false,
    'Ajv and the semantic validator must reject the same malformed fixture envelope');
}

console.log(`semantic oracle mutation tests passed (${fixture.mutations.length} seeded regressions)`);
