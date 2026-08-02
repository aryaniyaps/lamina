#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  OBSERVATION_CATEGORY_SUPPORT,
  OBSERVATION_CATEGORY_SUPPORT_CANONICAL_SHA256,
  OBSERVATION_CATEGORY_SUPPORT_RAW_SHA256,
  loadObservationCategorySupport,
  parseObservationCategorySupportBytes,
} from '../benchmarks/real-repository-oracle-v1/observation-category-authority.mjs';
import { brownfieldSignals } from '../packages/cli/lib/observation-runtime/node.mjs';

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
const controlContentBytes = fs.readFileSync(new URL(
  './fixtures/real-repository-oracle-observation-negative-controls-v1.json', import.meta.url,
));
function parseControlContentBytes(raw) {
  assert.ok(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 16 * 1024,
    'negative-control test content remains byte bounded');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  assert.deepEqual(Object.keys(value), ['schema', 'controls']);
  assert.equal(value.schema, 'lamina.real-repository-oracle-observation-negative-control-content/v1');
  assert.equal(value.controls.length, 3);
  assert.deepEqual(value.controls.map((item) => item.tier), ['small', 'medium', 'large']);
  assert.equal(new Set(value.controls.map((item) => item.tier)).size, 3);
  assert.equal(new Set(value.controls.map((item) => item.path)).size, 3);
  let decodedBytes = 0;
  for (const item of value.controls) {
    assert.deepEqual(Object.keys(item), ['tier', 'path', 'content_base64']);
    assert.ok(typeof item.path === 'string' && Buffer.byteLength(item.path) <= 512
      && !item.path.includes('\0') && !item.path.includes('\\') && !item.path.startsWith('/')
      && !/^[A-Za-z]:/.test(item.path)
      && item.path.split('/').every((part) => part && part !== '.' && part !== '..'));
    assert.match(item.content_base64, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
    const decoded = Buffer.from(item.content_base64, 'base64');
    assert.equal(decoded.toString('base64'), item.content_base64);
    assert.ok(decoded.length > 0 && decoded.length <= 4096);
    decodedBytes += decoded.length;
  }
  assert.ok(decodedBytes <= 12 * 1024);
  return value;
}
const controlContents = parseControlContentBytes(controlContentBytes);
for (const item of controlContents.controls) {
  const bytesAtPin = Buffer.from(item.content_base64, 'base64');
  assert.equal(bytesAtPin.toString('base64'), item.content_base64, `${item.tier} control bytes are canonical`);
  const control = Object.values(OBSERVATION_CATEGORY_SUPPORT[item.tier].reviewed_absent)[0].controls[0];
  assert.equal(item.path, control.path);
  assert.equal(crypto.createHash('sha1').update(`blob ${bytesAtPin.length}\0`).update(bytesAtPin).digest('hex'),
    control.blob_oid, `${item.tier} control Git blob identity is reconstructed from bytes`);
  assert.equal(crypto.createHash('sha256').update(bytesAtPin).digest('hex'), control.content_sha256,
    `${item.tier} control content identity is reconstructed from bytes`);
  assert.deepEqual(brownfieldSignals(item.path, bytesAtPin).categories, control.observed_categories,
    `${item.tier} control categories come from the production extractor in production order`);
}
function rejectsControlContent(mutator) {
  const value = structuredClone(controlContents);
  mutator(value);
  assert.throws(() => parseControlContentBytes(Buffer.from(JSON.stringify(value))));
}
rejectsControlContent((value) => { value.controls = []; });
rejectsControlContent((value) => { value.controls.pop(); });
rejectsControlContent((value) => { value.controls.push(structuredClone(value.controls[0])); });
rejectsControlContent((value) => { value.controls.reverse(); });
rejectsControlContent((value) => { value.extra = true; });
rejectsControlContent((value) => { value.controls[0].extra = true; });
rejectsControlContent((value) => { value.controls[0].path = '../unsafe.ts'; });
rejectsControlContent((value) => { value.controls[0].path = 'C:outside.ts'; });
rejectsControlContent((value) => { value.controls[0].path = 'bad\0path.ts'; });
rejectsControlContent((value) => { value.controls[0].content_base64 = 'not canonical'; });
rejectsControlContent((value) => { value.controls[0].content_base64 = Buffer.alloc(4097).toString('base64'); });
assert.throws(() => parseControlContentBytes(Buffer.alloc(16 * 1024 + 1)));

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
