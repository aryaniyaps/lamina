#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewedCollectionForTier } from '../benchmarks/real-repository-oracle-v1/collection-authority.mjs';
import {
  CASE_DISCOVERY_LIMITS, CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES,
  CASE_DISCOVERY_PAYLOAD_PREFIX, CASE_DISCOVERY_SCHEMA, CASE_DISCOVERY_TRANSPORT_SCHEMA,
  decodeDiscoveryPayload,
  discoverCandidateFacts, discoveryPathDisposition, encodeDiscoveryPayload, gitByteCompare,
  validAuthoringBranchName, validLogicalWorktreeId,
} from '../benchmarks/real-repository-oracle-v1/case-discovery.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT,
  'benchmarks/real-repository-oracle-v1/case-discovery.mjs'), 'utf8');
for (const forbidden of ['./contract.mjs', './evaluate.mjs', './grade.mjs',
  'reviews/inventory-v1.json', 'reviewedCase.expected', 'expectedByRequest', 'localeCompare']) {
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
const trackedCollisions = new Set();
const destinationAuthority = (trackedPaths) => {
  const orderedTracked = [...new Set(trackedPaths)].sort(gitByteCompare);
  const occupied = new Set(['']);
  for (const trackedPath of orderedTracked) {
    occupied.add(trackedPath);
    let parent = path.posix.dirname(trackedPath);
    while (parent !== '.') { occupied.add(parent); parent = path.posix.dirname(parent); }
  }
  const orderedOccupied = [...occupied].sort(gitByteCompare);
  const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return { tracked: orderedTracked, occupied: orderedOccupied,
    tracked_sha256: digest(orderedTracked), occupied_sha256: digest(orderedOccupied) };
};
const injectedVisitor = (_repository, _collection, visit) => {
  for (const candidate of inputs) visit(candidate);
  return { candidate_files: inputs.length,
    candidate_bytes: inputs.reduce((n, item) => n + item.bytes.length, 0),
    tracked_paths: [...inputs.map((item) => item.path), ...trackedCollisions] };
};
const collection = reviewedCollectionForTier('small');
const first = discoverCandidateFacts('/unused-by-injected-visitor', collection, injectedVisitor);
const replay = discoverCandidateFacts('/unused-by-injected-visitor', collection, injectedVisitor);
assert.deepEqual(replay, first);
assert.equal(first.schema, CASE_DISCOVERY_SCHEMA);
assert.equal(CASE_DISCOVERY_TRANSPORT_SCHEMA,
  'lamina.real-repository-oracle-discovery-transport/v1');
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
  assert.ok(['modify', 'rename', 'delete', 'branch', 'logical_worktree'].includes(operation));
  assert.ok(candidates.length <= CASE_DISCOVERY_LIMITS.operation_candidates_per_kind);
  assert.ok(candidates.every((item) => item.role === 'scenario_before' && !item.path.includes('..')));
}
const initialAuthority = destinationAuthority(inputs.map((item) => item.path));
for (const candidate of first.candidate_index.operation_candidates.rename) {
  assert.equal(candidate.destination_absence.absent, true);
  assert.equal(candidate.destination_absence.basis,
    'complete_stage0_git_paths_and_implied_directories');
  assert.equal(candidate.destination_absence.tracked_path_count, inputs.length);
  assert.equal(candidate.destination_absence.tracked_paths_sha256, initialAuthority.tracked_sha256);
  assert.equal(candidate.destination_absence.occupied_destination_count,
    initialAuthority.occupied.length);
  assert.equal(candidate.destination_absence.occupied_destinations_sha256,
    initialAuthority.occupied_sha256);
  assert.equal(initialAuthority.occupied.includes(candidate.proposed_path), false);
}
assert.ok(first.candidate_index.operation_candidates.branch.every((candidate) =>
  validAuthoringBranchName(candidate.proposed_branch) && candidate.executed === false));
assert.equal(validAuthoringBranchName('bad..branch'), false);
assert.equal(validAuthoringBranchName('bad branch'), false);
assert.equal(new Set(first.candidate_index.operation_candidates.branch
  .map((candidate) => candidate.proposed_branch)).size,
first.candidate_index.operation_candidates.branch.length);
assert.ok(first.candidate_index.operation_candidates.logical_worktree.every((candidate) =>
  validLogicalWorktreeId(candidate.logical_worktree_id) && candidate.executed === false));
assert.equal(validLogicalWorktreeId('oracle-worktree-NOT-A-DIGEST'), false);
assert.equal(new Set(first.candidate_index.operation_candidates.logical_worktree
  .map((candidate) => candidate.logical_worktree_id)).size,
first.candidate_index.operation_candidates.logical_worktree.length);
const initialRename = first.candidate_index.operation_candidates.rename[0];
trackedCollisions.add(`${initialRename.proposed_path}/child.ts`);
const collisionAware = discoverCandidateFacts('/unused-by-injected-visitor', collection, injectedVisitor);
assert.notEqual(collisionAware.candidate_index.operation_candidates.rename[0].proposed_path,
  initialRename.proposed_path,
  'a tracked descendant makes its implied parent directory an occupied rename destination');
const collisionAuthority = destinationAuthority([
  ...inputs.map((item) => item.path), ...trackedCollisions,
]);
const collisionProof = collisionAware.candidate_index.operation_candidates.rename[0]
  .destination_absence;
assert.equal(collisionProof.tracked_path_count, collisionAuthority.tracked.length);
assert.equal(collisionProof.tracked_paths_sha256, collisionAuthority.tracked_sha256);
assert.equal(collisionProof.occupied_destination_count, collisionAuthority.occupied.length);
assert.equal(collisionProof.occupied_destinations_sha256, collisionAuthority.occupied_sha256);
trackedCollisions.clear();
assert.deepEqual(['z', 'ä', 'a', 'Z'].sort(gitByteCompare), ['Z', 'a', 'z', 'ä'],
  'candidate ordering is exact UTF-8 byte order and does not depend on process locale');
const encoded = encodeDiscoveryPayload(first);
assert.ok(encoded.line.startsWith(CASE_DISCOVERY_PAYLOAD_PREFIX));
assert.ok(Buffer.byteLength(encoded.line) <= CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES);
assert.deepEqual(decodeDiscoveryPayload(encoded.line), first);
assert.throws(() => decodeDiscoveryPayload('bad'), /outside the retained-output contract/);
assert.throws(() => decodeDiscoveryPayload(`${CASE_DISCOVERY_PAYLOAD_PREFIX}AAAA`),
  /payload line is malformed/);
const tamperedCharacters = encoded.line.split('');
const tamperIndex = CASE_DISCOVERY_PAYLOAD_PREFIX.length + 2;
tamperedCharacters[tamperIndex] = tamperedCharacters[tamperIndex] === 'A' ? 'B' : 'A';
assert.throws(() => decodeDiscoveryPayload(tamperedCharacters.join('')),
  /payload line is malformed/, 'transport tampering cannot decode as reviewer facts');

const nearBound = (count) => {
  const value = structuredClone(first);
  value.candidate_index.transport_near_bound_probe = Array.from({ length: count }, (_, index) =>
    crypto.createHash('sha256').update(`near-bound-${index}`).digest('hex'));
  return value;
};
let lower = 0;
let upper = 32;
while (upper <= 4_096) {
  try { encodeDiscoveryPayload(nearBound(upper)); lower = upper; upper *= 2; }
  catch { break; }
}
assert.ok(upper <= 4_096, 'synthetic transport probe must reach the retained-line refusal');
while (lower + 1 < upper) {
  const middle = Math.floor((lower + upper) / 2);
  try { encodeDiscoveryPayload(nearBound(middle)); lower = middle; }
  catch { upper = middle; }
}
const nearBoundValue = nearBound(lower);
const nearBoundEncoded = encodeDiscoveryPayload(nearBoundValue);
assert.ok(Buffer.byteLength(nearBoundEncoded.line) > CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES - 256,
  'the deterministic synthetic payload exercises the retained-line boundary closely');
assert.deepEqual(decodeDiscoveryPayload(nearBoundEncoded.line), nearBoundValue,
  'near-bound transport reconstructs every logical fact exactly');
assert.throws(() => encodeDiscoveryPayload(nearBound(upper)),
  /exceeds the retained report-tail bound/);
const oversized = structuredClone(first);
oversized.candidate_index.extra_noise = Array.from({ length: 256 }, () => crypto.randomBytes(96).toString('hex'));
assert.throws(() => encodeDiscoveryPayload(oversized), /exceeds the retained report-tail bound/,
  'oversized complete indexes refuse instead of lossy compaction');

console.log('real repository oracle case-discovery tests passed');
