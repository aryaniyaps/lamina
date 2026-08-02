#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  OBSERVATION_CATEGORY_SUPPORT,
  OBSERVATION_CATEGORY_SUPPORT_CANONICAL_SHA256,
  OBSERVATION_CATEGORY_SUPPORT_RAW_SHA256,
  loadObservationCategorySupport,
  parseObservationCategorySupportBytes,
} from '../benchmarks/real-repository-oracle-v1/observation-category-authority.mjs';

const file = new URL('../benchmarks/real-repository-oracle-v1/reviews/observation-category-support-v1.json', import.meta.url);
const bytes = fs.readFileSync(file);
const loaded = loadObservationCategorySupport();
assert.equal(loaded.raw_sha256, OBSERVATION_CATEGORY_SUPPORT_RAW_SHA256);
assert.equal(loaded.canonical_sha256, OBSERVATION_CATEGORY_SUPPORT_CANONICAL_SHA256);
assert.deepEqual(OBSERVATION_CATEGORY_SUPPORT.small.positive.length, 12);
assert.deepEqual(OBSERVATION_CATEGORY_SUPPORT.medium.positive.length, 13);
assert.deepEqual(OBSERVATION_CATEGORY_SUPPORT.large.positive.length, 13);
assert.equal(OBSERVATION_CATEGORY_SUPPORT.small.reviewed_absent.handlers.mode, 'bounded_negative_controls');
assert.equal(OBSERVATION_CATEGORY_SUPPORT.small.reviewed_absent.personas.mode, 'complete_candidate_set_absence');
assert.equal(OBSERVATION_CATEGORY_SUPPORT.medium.reviewed_absent.personas.scope.matching_path_count, 0);

function rejects(mutator, message) {
  const value = JSON.parse(bytes);
  mutator(value);
  assert.throws(
    () => parseObservationCategorySupportBytes(Buffer.from(JSON.stringify(value)), { requireReviewedBytes: false }),
    /observation category support is invalid/,
    message,
  );
}

rejects((value) => { value.production.source_sha256 = '0'.repeat(64); }, 'source digest tamper');
rejects((value) => { value.production.discovery_rules_sha256 = '0'.repeat(64); }, 'discovery rules tamper');
for (const [field, replacement] of [
  ['category', 'handlers'], ['path', '../escape.ts'], ['blob_oid', '0'.repeat(40)],
  ['content_sha256', '0'.repeat(64)],
]) rejects((value) => { value.tiers.small.positive_witnesses[1][field] = replacement; }, `witness ${field} tamper`);
rejects((value) => { value.tiers.small.positive_witnesses[1].signal.value_sha256 = '0'.repeat(64); }, 'signal digest tamper');
rejects((value) => { value.tiers.small.positive_witnesses[1].signal.line_sha256 = '0'.repeat(64); }, 'signal line hash tamper');
rejects((value) => { value.tiers.small.scan.candidate_files += 1; }, 'scan count tamper');
rejects((value) => { value.tiers.small.scan.tracked_paths_sha256 = '0'.repeat(64); }, 'tracked path digest tamper');
rejects((value) => { value.tiers.small.reviewed_absent[1].scope.predicate = 'any_persona_text'; }, 'complete-scope predicate tamper');
rejects((value) => { value.tiers.small.reviewed_absent[1].scope.matching_path_count = 1; }, 'complete-scope count tamper');
rejects((value) => { value.tiers.small.reviewed_absent[0].mode = 'complete_candidate_set_absence'; }, 'bounded/category-wide mode substitution');
rejects((value) => { value.tiers.small.positive_witnesses.pop(); }, 'missing positive category');
rejects((value) => { value.tiers.small.positive_witnesses.push(structuredClone(value.tiers.small.positive_witnesses[0])); }, 'duplicate positive category');
rejects((value) => { value.tiers.small.positive_witnesses.reverse(); }, 'reordered positive categories');
rejects((value) => { value.tiers.small.reviewed_absent[0].controls[0].path = '../unsafe.ts'; }, 'unsafe control path');
assert.throws(() => parseObservationCategorySupportBytes(Buffer.alloc(128 * 1024 + 1)), /reviewed identity/);
const changedBytes = Buffer.from(bytes);
changedBytes[changedBytes.length - 2] = changedBytes[changedBytes.length - 2] === 10 ? 32 : 10;
assert.throws(() => parseObservationCategorySupportBytes(changedBytes), /reviewed identity/);

console.log('real repository oracle observation category authority contracts passed');
