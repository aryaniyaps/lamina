import { COLLECTIONS } from './contract.mjs';
import { assertValidFixture, validateResult } from './validate.mjs';

function render(value) {
  if (value === undefined) return '<missing>';
  return JSON.stringify(value);
}

function firstDifference(expected, actual, path = '$.semantic') {
  if (Object.is(expected, actual)) return null;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  } else if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      const difference = firstDifference(expected[key], actual[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return { path, expected, actual };
}

function focusedCollectionDiff(expected, actual) {
  const diagnostics = [];
  for (const collection of COLLECTIONS) {
    const expectedById = new Map(expected[collection].map((item) => [item.id, item]));
    const actualById = new Map(actual[collection].map((item) => [item.id, item]));
    for (const id of [...expectedById.keys()].filter((item) => !actualById.has(item)).sort()) {
      diagnostics.push(`missing ${collection.slice(0, -1)} ${id}`);
    }
    for (const id of [...actualById.keys()].filter((item) => !expectedById.has(item)).sort()) {
      diagnostics.push(`unexpected ${collection.slice(0, -1)} ${id}`);
    }
    for (const id of [...expectedById.keys()].filter((item) => actualById.has(item)).sort()) {
      const difference = firstDifference(
        expectedById.get(id),
        actualById.get(id),
        `$.semantic.${collection}[id=${JSON.stringify(id)}]`,
      );
      if (difference) {
        diagnostics.push(`${difference.path}: expected ${render(difference.expected)}, got ${render(difference.actual)}`);
      }
    }
  }
  return diagnostics;
}

export function gradeSemanticResult(fixture, result) {
  assertValidFixture(fixture);
  const candidateValidation = validateResult(result);
  if (!candidateValidation.valid) {
    return {
      passed: false,
      classification: 'candidate_invalid',
      diagnostics: candidateValidation.errors.map((error) => `candidate result: ${error}`),
    };
  }
  if (result.fixture_id !== fixture.id) {
    return {
      passed: false,
      classification: 'product_regression',
      diagnostics: [`fixture id mismatch: expected ${fixture.id}, got ${result.fixture_id}`],
    };
  }
  const diagnostics = focusedCollectionDiff(fixture.expected, result.semantic);
  for (const forbidden of fixture.forbidden) {
    if (result.semantic[forbidden.collection].some((item) => item.id === forbidden.id)) {
      diagnostics.push(`forbidden ${forbidden.collection}.${forbidden.id}: ${forbidden.reason}`);
    }
  }
  return {
    passed: diagnostics.length === 0,
    classification: diagnostics.length ? 'product_regression' : 'pass',
    diagnostics,
  };
}
