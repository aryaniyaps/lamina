#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewedCollectionForTier } from '../benchmarks/real-repository-oracle-v1/collection-authority.mjs';
import {
  CASE_DISCOVERY_LIMITS, CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES,
  CASE_DISCOVERY_PAYLOAD_PREFIX, CASE_DISCOVERY_SCHEMA, decodeDiscoveryPayload,
  discoverCandidateFacts, discoveryPathDisposition, encodeDiscoveryPayload,
} from '../benchmarks/real-repository-oracle-v1/case-discovery.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT,
  'benchmarks/real-repository-oracle-v1/case-discovery.mjs'), 'utf8');
for (const forbidden of ['./contract.mjs', './evaluate.mjs', './grade.mjs',
  'reviews/inventory-v1.json', 'reviewedCase.expected', 'expectedByRequest']) {
  assert.equal(source.includes(forbidden), false, `discovery cannot load ${forbidden}`);
}

const inputs = [
  ['src/routes/checkout.ts', "function checkoutHandler() { app.post('/checkout', emit); }"],
  ['src/routes/account.ts', "function accountHandler() { app.get('/account', emit); }"],
  ['src/services/checkout.ts', 'class CheckoutService { }'],
  ['tests/checkout.test.ts', "test('checkout', () => expect(true).toBe(true));"],
  ['tests/account.spec.ts', "test('account', () => expect(true).toBe(true));"],
  ['docs/checkout.md', '# Checkout API\nPOST /checkout'],
  ['docs/account.md', '# Account API\nGET /account'],
  ['config/app.json', '{"scripts":{"test":"node test.mjs"},"dependencies":{"express":"1"}}'],
  ['config/routes.yaml', 'route: /checkout'],
  ['src/model.ts', 'interface CheckoutModel { role: string }'],
  ['src/flags.ts', 'const FEATURE_CHECKOUT = true;'],
  ['src/worker.ts', "function worker() { emit('done'); }"],
  ['dist/generated.js', 'function shouldNeverAppear() {}'],
  ['public/workbox-a1b2c3d4.js', 'function generatedServiceWorker() {}'],
].map(([candidatePath, text]) => ({
  path: candidatePath,
  bytes: Buffer.from(text),
  blob_oid: crypto.createHash('sha1').update(text).digest('hex'),
}));
const injectedVisitor = (_repository, _collection, visit) => {
  for (const candidate of inputs) visit(candidate);
  return { candidate_files: inputs.length, candidate_bytes: inputs.reduce((n, item) => n + item.bytes.length, 0) };
};
const collection = reviewedCollectionForTier('small');
const first = discoverCandidateFacts('/unused-by-injected-visitor', collection, injectedVisitor);
const replay = discoverCandidateFacts('/unused-by-injected-visitor', collection, injectedVisitor);
assert.deepEqual(replay, first);
assert.equal(first.schema, CASE_DISCOVERY_SCHEMA);
assert.equal(first.expectations_loaded, false);
assert.equal(first.grade_controller_evidence, false);
assert.ok(Object.values(first.quality_claims).every((claim) => claim === false));
assert.equal(first.scan.excluded_generated_artifacts, 2);
const serialized = JSON.stringify(first.candidate_index);
assert.doesNotMatch(serialized, /dist\/generated|workbox-a1b2c3d4/);
assert.equal(discoveryPathDisposition('public/workbox-a1b2c3d4.js').admitted, false);
assert.equal(discoveryPathDisposition('build/app.js').admitted, false);
for (const stratum of ['source', 'test', 'docs', 'config']) {
  assert.ok(serialized.includes(`\"stratum\":\"${stratum}\"`), `index exposes ${stratum} stratum`);
}
for (const anchors of Object.values(first.candidate_index.categories)) {
  assert.ok(anchors.length >= 1 && anchors.length <= CASE_DISCOVERY_LIMITS.anchors_per_category);
  assert.equal(new Set(anchors.map((item) => item.path)).size, anchors.length);
  assert.ok(anchors.every((item) => item.role === 'positive'
    && item.independent_method === 'sealed_git_blob_static_scan'));
  assert.ok(anchors.every((item) => item.category_signal
    && /^[a-f0-9]{64}$/.test(item.category_signal.value_sha256)
    && ['exact_literal', 'derived_component_literal', 'derived_unresolved']
      .includes(item.category_signal.occurrence)));
}
assert.ok(first.candidate_index.near_neighbors.length <= CASE_DISCOVERY_LIMITS.max_neighbor_records);
assert.ok(first.candidate_index.near_neighbors.every((item) => item.candidate.role === 'near_neighbor'));
assert.ok(first.candidate_index.negative_decoys.length <= CASE_DISCOVERY_LIMITS.max_negative_decoys);
assert.ok(first.candidate_index.negative_decoys.every((item) =>
  item.basis === 'same_stratum_without_discovered_category' && item.candidate.role === 'negative'));
for (const [operation, candidates] of Object.entries(first.candidate_index.operation_candidates)) {
  assert.ok(['modify', 'rename', 'delete'].includes(operation));
  assert.ok(candidates.length <= CASE_DISCOVERY_LIMITS.operation_candidates_per_kind);
  assert.ok(candidates.every((item) => item.role === 'scenario_before' && !item.path.includes('..')));
}
const encoded = encodeDiscoveryPayload(first);
assert.ok(encoded.line.startsWith(CASE_DISCOVERY_PAYLOAD_PREFIX));
assert.ok(Buffer.byteLength(encoded.line) <= CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES);
assert.deepEqual(decodeDiscoveryPayload(encoded.line), first);
assert.throws(() => decodeDiscoveryPayload('bad'), /outside the retained-output contract/);
const oversized = structuredClone(first);
oversized.candidate_index.extra_noise = Array.from({ length: 256 }, () => crypto.randomBytes(96).toString('hex'));
assert.throws(() => encodeDiscoveryPayload(oversized), /exceeds the retained report-tail bound/,
  'oversized complete indexes refuse instead of lossy compaction');

console.log('real repository oracle case-discovery tests passed');
