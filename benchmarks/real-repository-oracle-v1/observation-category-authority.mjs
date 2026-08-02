import crypto from 'node:crypto';
import fs from 'node:fs';
import { COLLECTION_PINS } from './collection-pins.mjs';
import { AUDITED_DISCOVERY_IDENTITIES } from './scenario-selection.mjs';

const REVIEW_FILE = new URL('./reviews/observation-category-support-v1.json', import.meta.url);
const TIERS = Object.freeze(['small', 'medium', 'large']);
const VOCABULARY = Object.freeze([
  'entry_points', 'commands', 'routes', 'handlers', 'schemas', 'entities',
  'state_transitions', 'permissions', 'events', 'tests', 'documentation',
  'personas', 'feature_flags', 'dependencies',
]);
const EXPECTED_ABSENCE = Object.freeze({
  small: Object.freeze({ handlers: 'bounded_negative_controls', personas: 'complete_candidate_set_absence' }),
  medium: Object.freeze({ personas: 'complete_candidate_set_absence' }),
  large: Object.freeze({ personas: 'complete_candidate_set_absence' }),
});
const EXPECTED_SCAN = Object.freeze({
  small: Object.freeze({ candidate_files: 467, candidate_bytes: 693785, tracked_path_count: 535, tracked_paths_sha256: 'c0edfef62afbea67d63aac73893c42865d5b6d3a102f49ce715b7a8542bf574b', admitted_index_files: 463, excluded_generated_artifacts: 4, complete: true }),
  medium: Object.freeze({ candidate_files: 2419, candidate_bytes: 12907800, tracked_path_count: 2539, tracked_paths_sha256: '3679648363ca1f88b950f576c6dac3bd919241bd3fcc31b0351b622a7dc9e2d1', admitted_index_files: 2418, excluded_generated_artifacts: 1, complete: true }),
  large: Object.freeze({ candidate_files: 4800, candidate_bytes: 21194929, tracked_path_count: 5405, tracked_paths_sha256: 'f8b3322915ac6dee69ad8bdb0b527c6ba1d0f4dec9a25fba11ca2c37a364e01e', admitted_index_files: 4792, excluded_generated_artifacts: 8, complete: true }),
});
const EXPECTED_WITNESS_SHA256 = Object.freeze({
  small: '4a10d7d012664d133ee1559c88cb13e81fb7ca9c5156dc25c8069778cfd83632',
  medium: '3ba8329dd7c03581e9c9f993106b8cc6eb87b8626e81a942589627e886ef0151',
  large: '7105703618dcb335d25fbb80b2258b64b3d9a742ff784c7c28d237c5ace39d08',
});
const EXPECTED_ABSENCE_SHA256 = Object.freeze({
  small: '05d9a43c801720bd1efc75c662adae46f39a126cb32ce1174c69b9293dfc49b9',
  medium: '4cf8c3f43bb4f9f9f7c84cb731221d84bb37d40c769aaa07a3ba6e063b79a626',
  large: 'f58a57012abe7de40449aca5d601d0efc487132237f811e395a4c7a5555a9fc2',
});
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export const OBSERVATION_CATEGORY_SUPPORT_RAW_SHA256 = '787d34398e805366217cedd4bef1ae8d47bea558d05501dfda78f6ddd8d4843c';
export const OBSERVATION_CATEGORY_SUPPORT_CANONICAL_SHA256 = 'd2984ed026e18f7e236d28e881832832dbd1339f51646fc41ebef94c5b4a32d6';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : object(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const safePath = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !value.includes('\\') && !value.startsWith('/') && value.split('/').every((part) => part && part !== '.' && part !== '..');

function validSignal(signal) {
  return exactKeys(signal, ['value', 'value_sha256', 'occurrence', 'line', 'line_sha256'])
    && typeof signal.value === 'string' && signal.value.length <= 512 && SHA256.test(signal.value_sha256 || '')
    && ['exact_literal', 'derived_component_literal', 'derived_unresolved'].includes(signal.occurrence)
    && (signal.line === null || (Number.isSafeInteger(signal.line) && signal.line > 0))
    && (signal.line_sha256 === null || SHA256.test(signal.line_sha256 || ''))
    && ((signal.line === null) === (signal.line_sha256 === null));
}

function validWitness(witness, category) {
  return exactKeys(witness, ['category', 'path', 'blob_oid', 'content_sha256', 'signal'])
    && witness.category === category && safePath(witness.path) && SHA1.test(witness.blob_oid || '')
    && SHA256.test(witness.content_sha256 || '') && validSignal(witness.signal);
}

function validControl(control) {
  return exactKeys(control, ['path', 'blob_oid', 'content_sha256', 'observed_categories'])
    && safePath(control.path) && SHA1.test(control.blob_oid || '') && SHA256.test(control.content_sha256 || '')
    && Array.isArray(control.observed_categories) && control.observed_categories.length > 0
    && new Set(control.observed_categories).size === control.observed_categories.length
    && control.observed_categories.every((category) => VOCABULARY.includes(category));
}

export function validateObservationCategorySupport(value) {
  const errors = [];
  if (!exactKeys(value, ['schema', 'decision', 'vocabulary', 'production', 'tiers'])
    || value.schema !== 'lamina.real-repository-oracle-observation-category-support/v1'
    || value.decision !== 'reviewer_frozen_positive_and_reviewed_absence_authority') {
    return { valid: false, errors: ['observation category support root is not exact'] };
  }
  if (JSON.stringify(value.vocabulary) !== JSON.stringify(VOCABULARY)) errors.push('observation category support does not preserve the exact production vocabulary');
  if (!exactKeys(value.production, ['source', 'source_sha256', 'discovery_rules_sha256', 'persona_rule'])
    || value.production.source !== 'packages/cli/lib/observation-runtime/node.mjs'
    || value.production.source_sha256 !== '0ce0a2b58974f36eca05c748728516526f8d06b8fbe7d61bba2fdf1a62c7f928'
    || value.production.discovery_rules_sha256 !== 'cb8104b44dbf6147ac1d2e9547846b051094891d13cc6d6a96d1e251b9e25349'
    || value.production.persona_rule !== 'lowercase_basename_includes_persona') errors.push('observation category source or discovery-rule authority differs');
  if (!exactKeys(value.tiers, TIERS)) return { valid: false, errors: [...errors, 'observation category support must exactly cover all tiers'] };
  for (const tier of TIERS) {
    const item = value.tiers[tier];
    const pin = COLLECTION_PINS[tier];
    if (!exactKeys(item, ['pin', 'discovery', 'scan', 'positive_witnesses', 'reviewed_absent'])
      || JSON.stringify(item.pin) !== JSON.stringify({ repository_url: pin.repository_url, commit: pin.commit, tree_oid: pin.tree_oid })
      || JSON.stringify(item.discovery) !== JSON.stringify(AUDITED_DISCOVERY_IDENTITIES[tier])
      || JSON.stringify(item.scan) !== JSON.stringify(EXPECTED_SCAN[tier])) {
      errors.push(`${tier} authority differs from its exact pin, discovery identity, or complete scan`);
      continue;
    }
    const absent = EXPECTED_ABSENCE[tier];
    const positive = VOCABULARY.filter((category) => !Object.hasOwn(absent, category));
    if (!Array.isArray(item.positive_witnesses)
      || JSON.stringify(item.positive_witnesses.map((witness) => witness.category)) !== JSON.stringify(positive)
      || item.positive_witnesses.some((witness) => !validWitness(witness, witness.category))
      || sha256(JSON.stringify(canonical(item.positive_witnesses))) !== EXPECTED_WITNESS_SHA256[tier]) {
      errors.push(`${tier} positive witnesses do not exactly support the reviewed categories`);
    }
    if (!Array.isArray(item.reviewed_absent)
      || JSON.stringify(Object.fromEntries(item.reviewed_absent.map((entry) => [entry.category, entry.mode]))) !== JSON.stringify(absent)
      || sha256(JSON.stringify(canonical(item.reviewed_absent))) !== EXPECTED_ABSENCE_SHA256[tier]) {
      errors.push(`${tier} reviewed-absence modes differ`);
      continue;
    }
    for (const entry of item.reviewed_absent) {
      const expectedKeys = entry.mode === 'complete_candidate_set_absence'
        ? ['category', 'mode', 'controls', 'scope'] : ['category', 'mode', 'controls'];
      if (!exactKeys(entry, expectedKeys) || !Array.isArray(entry.controls) || entry.controls.length !== 1
        || !validControl(entry.controls[0]) || entry.controls[0].observed_categories.includes(entry.category)) {
        errors.push(`${tier}.${entry.category} reviewed absence lacks an exact candidate-observable control`);
      }
      if (entry.mode === 'complete_candidate_set_absence'
        && (!exactKeys(entry.scope, ['tracked_path_count', 'tracked_paths_sha256', 'predicate', 'matching_path_count'])
          || entry.scope.tracked_path_count !== item.scan.tracked_path_count
          || entry.scope.tracked_paths_sha256 !== item.scan.tracked_paths_sha256
          || entry.scope.predicate !== value.production.persona_rule || entry.scope.matching_path_count !== 0)) {
        errors.push(`${tier}.${entry.category} complete absence scope is not bound to the complete tracked set and production predicate`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function parseObservationCategorySupportBytes(bytes, { requireReviewedBytes = true } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 128 * 1024
    || (requireReviewedBytes && sha256(bytes) !== OBSERVATION_CATEGORY_SUPPORT_RAW_SHA256)) throw new Error('observation category support bytes do not match the reviewed identity');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('observation category support is not UTF-8 JSON'); }
  const validation = validateObservationCategorySupport(value);
  if (!validation.valid) throw new Error(`observation category support is invalid: ${validation.errors.join('; ')}`);
  const canonicalSha256 = sha256(JSON.stringify(canonical(value)));
  if (requireReviewedBytes && canonicalSha256 !== OBSERVATION_CATEGORY_SUPPORT_CANONICAL_SHA256) throw new Error('observation category support semantic content differs from the reviewed identity');
  return Object.freeze({ value, raw_sha256: sha256(bytes), canonical_sha256: canonicalSha256 });
}

export function loadObservationCategorySupport() {
  return parseObservationCategorySupportBytes(fs.readFileSync(REVIEW_FILE));
}

export const OBSERVATION_CATEGORY_SUPPORT = Object.freeze(Object.fromEntries(
  Object.entries(loadObservationCategorySupport().value.tiers).map(([tier, item]) => [tier, Object.freeze({
    positive: Object.freeze(item.positive_witnesses.map((witness) => witness.category)),
    reviewed_absent: Object.freeze(Object.fromEntries(item.reviewed_absent.map((entry) => [entry.category, Object.freeze(structuredClone(entry))]))),
    forbidden_controls: Object.freeze(item.reviewed_absent.flatMap((entry) => entry.controls.map((control) => Object.freeze({ category: entry.category, path: control.path })))),
  })]),
));
