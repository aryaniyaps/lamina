#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runCurrentFixture } from '../benchmarks/semantic-oracle-v1/run-current-fixture.mjs';
import { gradeSemanticResult } from '../benchmarks/semantic-oracle-v1/grade.mjs';
import { applySemanticMutation, MUTATION_IDS } from '../benchmarks/semantic-oracle-v1/mutations.mjs';
import { SemanticOracleError, validateFixture } from '../benchmarks/semantic-oracle-v1/validate.mjs';

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
assert.deepEqual(validateFixture(fixture), { valid: true, errors: [] });
assert.deepEqual(
  [...fixture.mutations.map((item) => item.id)].sort(),
  MUTATION_IDS,
  'every reviewed mutation must have an executable implementation and vice versa',
);

const current = runCurrentFixture();
assert.deepEqual(gradeSemanticResult(fixture, current), {
  passed: true,
  classification: 'pass',
  diagnostics: [],
});

for (const mutation of fixture.mutations) {
  const mutated = applySemanticMutation(mutation.id, current);
  const grade = gradeSemanticResult(fixture, mutated);
  assert.equal(grade.passed, false, `mutation ${mutation.id} must fail`);
  assert.ok(['candidate_invalid', 'product_regression'].includes(grade.classification));
  assert.ok(grade.diagnostics.length > 0, `mutation ${mutation.id} needs a focused diagnostic`);
}

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

console.log(`semantic oracle mutation tests passed (${fixture.mutations.length} seeded regressions)`);
