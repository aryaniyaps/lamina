#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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
const collection = reviewedCollectionForTier('small');
const baselineTrackedPaths = [
  ...inputs.map((item) => item.path),
  ...Array.from({ length: collection.reviewed_inventory.tracked_files - inputs.length },
    (_, index) => `authority-2/file-${String(index).padStart(4, '0')}.ts`),
];
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
    tracked_paths: [...baselineTrackedPaths, ...trackedCollisions] };
};
const first = discoverCandidateFacts('/unused-by-injected-visitor', collection, injectedVisitor);
const replay = discoverCandidateFacts('/unused-by-injected-visitor', collection, injectedVisitor);
assert.deepEqual(replay, first);
assert.equal(first.schema, CASE_DISCOVERY_SCHEMA);
assert.equal(CASE_DISCOVERY_TRANSPORT_SCHEMA,
  'lamina.real-repository-oracle-discovery-schema-wire/v1');
assert.equal(CASE_DISCOVERY_PAYLOAD_PREFIX, 'LAMINA_REAL_REPOSITORY_CASE_DISCOVERY_V3=');
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
const initialAuthority = destinationAuthority(baselineTrackedPaths);
for (const candidate of first.candidate_index.operation_candidates.rename) {
  assert.equal(candidate.destination_absence.absent, true);
  assert.equal(candidate.destination_absence.basis,
    'complete_stage0_git_paths_and_implied_directories');
  assert.equal(candidate.destination_absence.tracked_path_count, baselineTrackedPaths.length);
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
  ...baselineTrackedPaths, ...trackedCollisions,
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
const legacyLine = `LAMINA_REAL_REPOSITORY_CASE_DISCOVERY_V2=${zlib.brotliCompressSync(
  Buffer.from(JSON.stringify(first)), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } },
).toString('base64url')}`;
assert.equal(Buffer.byteLength(legacyLine), 4_509, 'actual c009 JSON+Brotli baseline is frozen');
assert.equal(Buffer.byteLength(encoded.line), 2_503,
  'same-fixture schema-specific wire measurement is frozen');
assert.ok(Buffer.byteLength(encoded.line) <= 3_840
  && Buffer.byteLength(encoded.line) < Buffer.byteLength(legacyLine),
'schema-specific wire must materially beat the same logical JSON+Brotli fixture');
assert.deepEqual(decodeDiscoveryPayload(encoded.line), first);
const reverseKeys = (value) => Array.isArray(value) ? value.map(reverseKeys)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]))
    : value;
assert.equal(encodeDiscoveryPayload(reverseKeys(first)).line, encoded.line,
  'wire encoding is independent of expanded object insertion order');
assert.throws(() => decodeDiscoveryPayload('bad'), /outside the retained-output contract/);
assert.throws(() => decodeDiscoveryPayload(`${CASE_DISCOVERY_PAYLOAD_PREFIX}AAAA`),
  /payload line is malformed/);
const tamperedCharacters = encoded.line.split('');
const tamperIndex = CASE_DISCOVERY_PAYLOAD_PREFIX.length + 2;
tamperedCharacters[tamperIndex] = tamperedCharacters[tamperIndex] === 'A' ? 'B' : 'A';
assert.throws(() => decodeDiscoveryPayload(tamperedCharacters.join('')),
  /payload line is malformed/, 'transport tampering cannot decode as reviewer facts');
const wireLine = (wire) => `${CASE_DISCOVERY_PAYLOAD_PREFIX}${zlib.brotliCompressSync(
  Buffer.from(JSON.stringify(wire)), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } },
).toString('base64url')}`;
const decodedWire = JSON.parse(zlib.brotliDecompressSync(Buffer.from(
  encoded.line.slice(CASE_DISCOVERY_PAYLOAD_PREFIX.length), 'base64url',
)).toString('utf8'));
const badContract = structuredClone(decodedWire);
badContract[0] = 'A'.repeat(43);
assert.throws(() => decodeDiscoveryPayload(wireLine(badContract)), /payload line is malformed/);
const badSemantic = structuredClone(decodedWire);
badSemantic[1] = 'A'.repeat(43);
assert.throws(() => decodeDiscoveryPayload(wireLine(badSemantic)), /payload line is malformed/);
const badReference = structuredClone(decodedWire);
badReference[9][0][0][0] = 999_999;
assert.throws(() => decodeDiscoveryPayload(wireLine(badReference)), /payload line is malformed/);
assert.throws(() => decodeDiscoveryPayload(wireLine([])), /payload line is malformed/);
const bomb = zlib.brotliCompressSync(Buffer.alloc(512 * 1024 + 1, 0x20), {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
});
assert.throws(() => decodeDiscoveryPayload(
  `${CASE_DISCOVERY_PAYLOAD_PREFIX}${bomb.toString('base64url')}`), /payload line is malformed/,
'compressed amplification beyond the decoded-byte bound is refused');

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const refreshIndexDigest = (value) => {
  const withoutDigest = Object.fromEntries(Object.entries(value.candidate_index)
    .filter(([key]) => key !== 'index_sha256'));
  value.candidate_index.index_sha256 = crypto.createHash('sha256')
    .update(JSON.stringify(canonical(withoutDigest))).digest('hex');
};
const deterministicText = (seed, length) => {
  let text = '';
  for (let index = 0; text.length < length; index += 1) {
    text += crypto.createHash('sha256').update(`${seed}-${index}`).digest('hex');
  }
  return text.slice(0, length);
};
const deterministicUnicodeText = (seed, length) => {
  let text = '';
  for (let index = 0; text.length < length; index += 1) {
    const digest = crypto.createHash('sha256').update(`${seed}-${index}`).digest();
    for (let offset = 0; offset < digest.length && text.length < length; offset += 2) {
      text += String.fromCharCode(0x4e00 + digest.readUInt16BE(offset) % 0x4fff);
    }
  }
  return text;
};
const longSignalValue = structuredClone(first);
const longRouteAnchors = longSignalValue.candidate_index.categories.routes;
assert.ok(longRouteAnchors.length >= 2, 'synthetic long-signal fixture needs two route anchors');
const retainedRoutePreview = `/${deterministicText('long-route-preview', 239)}`;
const completeRouteValues = [
  `${retainedRoutePreview}/${deterministicText('long-route-one', 96)}`,
  `${retainedRoutePreview}/${deterministicText('long-route-two', 96)}`,
];
const commonLineHash = crypto.createHash('sha256').update('shared route line').digest('hex');
for (const [index, anchor] of longRouteAnchors.slice(0, 2).entries()) {
  anchor.category_signal = {
    value: retainedRoutePreview,
    value_sha256: crypto.createHash('sha256').update(completeRouteValues[index]).digest('hex'),
    occurrence: 'exact_literal',
    line: 1,
    line_sha256: commonLineHash,
  };
}
assert.equal(retainedRoutePreview.length, 240);
assert.ok(completeRouteValues.every((value) => value.length > retainedRoutePreview.length));
const retainedPreviewHash = crypto.createHash('sha256').update(retainedRoutePreview).digest('hex');
assert.ok(longRouteAnchors.slice(0, 2).every((anchor) =>
  anchor.category_signal.value_sha256 !== retainedPreviewHash),
'the authoritative full-value digest is intentionally not the retained preview digest');
assert.notEqual(longRouteAnchors[0].category_signal.value_sha256,
  longRouteAnchors[1].category_signal.value_sha256);
refreshIndexDigest(longSignalValue);
const longSignalEncoded = encodeDiscoveryPayload(longSignalValue);
assert.deepEqual(decodeDiscoveryPayload(longSignalEncoded.line), longSignalValue,
  'a 240-byte preview roundtrips exactly with its complete raw-value digest');
const longSignalWire = JSON.parse(zlib.brotliDecompressSync(Buffer.from(
  longSignalEncoded.line.slice(CASE_DISCOVERY_PAYLOAD_PREFIX.length), 'base64url',
)).toString('utf8'));
const retainedPreviewSignalRows = longSignalWire[7]
  .filter((row) => row[0] === retainedRoutePreview);
assert.equal(retainedPreviewSignalRows.length, 2,
  'same-preview signals with different complete-value hashes must not collapse');
assert.notEqual(retainedPreviewSignalRows[0][1], retainedPreviewSignalRows[1][1],
  'the signal table identity includes value_sha256');
const allDiscoveryCategories = ['commands', 'dependencies', 'documentation', 'entities',
  'entry_points', 'events', 'feature_flags', 'handlers', 'permissions', 'personas', 'routes',
  'schemas', 'state_transitions', 'tests'];
const escapedMaxPaths = [0, 1, 2].map((index) => `src/${'"'.repeat(4_091)}${index}`);
assert.ok(escapedMaxPaths.every((candidatePath) => Buffer.byteLength(candidatePath) === 4_096));
const maxRefSignal = {
  value: deterministicText('max-ref-signal', 240),
  value_sha256: crypto.createHash('sha256').update('complete max-ref signal').digest('hex'),
  occurrence: 'exact_literal', line: 1,
  line_sha256: crypto.createHash('sha256').update('max-ref line').digest('hex'),
};
const maxRefAnchor = (candidatePath, category, role) => ({
  path: candidatePath,
  blob_oid: crypto.createHash('sha1').update(candidatePath).digest('hex'),
  stratum: 'source', category,
  category_signal: category === null ? null : { ...maxRefSignal },
  symbol: null, line: null,
  content_sha256: crypto.createHash('sha256').update(candidatePath).digest('hex'),
  role, independent_method: 'sealed_git_blob_static_scan',
});
const maxRefValue = structuredClone(first);
maxRefValue.scan = { ...maxRefValue.scan, candidate_files: 3, candidate_bytes: 1,
  admitted_index_files: 3, excluded_generated_artifacts: 0 };
maxRefValue.candidate_index.categories = Object.fromEntries(allDiscoveryCategories.map((category) => [
  category, escapedMaxPaths.map((candidatePath) => maxRefAnchor(candidatePath, category, 'positive')),
]));
maxRefValue.candidate_index.near_neighbors = allDiscoveryCategories.map((category) => ({
  category, anchor_path: escapedMaxPaths[0],
  candidate: maxRefAnchor(escapedMaxPaths[1], null, 'near_neighbor'),
}));
maxRefValue.candidate_index.negative_decoys = allDiscoveryCategories.map((category) => ({
  category, anchor_path: escapedMaxPaths[0],
  candidate: maxRefAnchor(escapedMaxPaths[1], null, 'negative'),
  basis: 'same_stratum_without_discovered_category',
}));
const scenarioAnchors = escapedMaxPaths.map((candidatePath) =>
  maxRefAnchor(candidatePath, null, 'scenario_before'));
const renameAuthority = first.candidate_index.operation_candidates.rename[0].destination_absence;
maxRefValue.candidate_index.operation_candidates = {
  modify: scenarioAnchors.map((anchor) => structuredClone(anchor)),
  rename: scenarioAnchors.map((anchor) => ({ ...structuredClone(anchor),
    proposed_path: `src/lamina-oracle-rename-${anchor.blob_oid.slice(0, 8)}`,
    destination_absence: structuredClone(renameAuthority) })),
  delete: scenarioAnchors.map((anchor) => structuredClone(anchor)),
  branch: scenarioAnchors.map((anchor) => {
    const id = crypto.createHash('sha256').update(JSON.stringify(canonical({
      path: anchor.path, blob_oid: anchor.blob_oid,
    }))).digest('hex').slice(0, 12);
    return { ...structuredClone(anchor), proposed_branch: `lamina-oracle/${id}`,
      source_commit: maxRefValue.collection.commit, executed: false };
  }),
  logical_worktree: scenarioAnchors.map((anchor) => {
    const id = crypto.createHash('sha256').update(JSON.stringify(canonical({
      path: anchor.path, blob_oid: anchor.blob_oid,
    }))).digest('hex').slice(0, 12);
    return { ...structuredClone(anchor), logical_worktree_id: `oracle-worktree-${id}`,
      source_commit: maxRefValue.collection.commit, executed: false };
  }),
};
refreshIndexDigest(maxRefValue);
const maxRefSemanticBytes = Buffer.byteLength(JSON.stringify(canonical(maxRefValue)));
assert.equal(maxRefSemanticBytes, 977_350,
  'max-ref expanded semantic measurement is frozen above the 512 KiB cap');
assert.throws(() => encodeDiscoveryPayload(maxRefValue),
  /semantic payload exceeds its reconstructed-byte bound/,
  'encoder refuses semantic fan-out before producing an undecodable transport');

const maxRefWire = structuredClone(decodedWire);
maxRefWire[3] = [3, 1, first.scan.tracked_path_count, 3, 0];
maxRefWire[6] = [[escapedMaxPaths[0], decodedWire[6][0][1], 0, null, null,
  decodedWire[6][0][5]]];
maxRefWire[7] = [[maxRefSignal.value, decodedWire[7][0][1], 0, 1,
  decodedWire[7][0][4] ?? 0]];
maxRefWire[8] = [...allDiscoveryCategories].sort(gitByteCompare);
maxRefWire[9] = maxRefWire[8].map(() => [[0, 0], [0, 0], [0, 0]]);
maxRefWire[10] = maxRefWire[8].map((_, index) => [index, 0]);
maxRefWire[11] = maxRefWire[8].map((_, index) => [index, 0]);
maxRefWire[12] = [
  [0, 0, 0],
  [[0, 'src/rename-a'], [0, 'src/rename-b'], [0, 'src/rename-c']],
  [0, 0, 0],
  [[0, 'lamina-oracle/a'], [0, 'lamina-oracle/b'], [0, 'lamina-oracle/c']],
  [[0, 'oracle-worktree-aaaaaaaaaaaa'], [0, 'oracle-worktree-bbbbbbbbbbbb'],
    [0, 'oracle-worktree-cccccccccccc']],
];
const maxRefWireLine = wireLine(maxRefWire);
assert.equal(Buffer.byteLength(maxRefWireLine), 2_296,
  'the compact amplifying mutation measurement is frozen inside the retained-line bound');
assert.throws(() => decodeDiscoveryPayload(maxRefWireLine), /payload line is malformed/,
  'decoder refuses projected semantic amplification before allocating expanded ref objects');
const nearBound = (signalLength) => {
  const value = structuredClone(first);
  let signalIndex = 0;
  for (const anchors of Object.values(value.candidate_index.categories)) {
    for (const anchor of anchors) {
      const currentSignal = signalIndex++;
      anchor.category_signal.value = deterministicUnicodeText(`signal-${currentSignal}`, signalLength);
      anchor.category_signal.value_sha256 = crypto.createHash('sha256')
        .update(anchor.category_signal.value).digest('hex');
      anchor.category_signal.occurrence = 'exact_literal';
      anchor.category_signal.line = 1;
      anchor.category_signal.line_sha256 = crypto.createHash('sha256')
        .update(`line-${currentSignal}-${signalLength}`).digest('hex');
    }
  }
  refreshIndexDigest(value);
  return value;
};
let lower = 0;
let upper = 4_096;
while (lower + 1 < upper) {
  const middle = Math.floor((lower + upper) / 2);
  try { encodeDiscoveryPayload(nearBound(middle)); lower = middle; }
  catch { upper = middle; }
}
const nearBoundValue = nearBound(lower);
const nearBoundEncoded = encodeDiscoveryPayload(nearBoundValue);
assert.ok(Buffer.byteLength(nearBoundEncoded.line) > CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES - 256,
  `the deterministic synthetic payload exercises the retained-line boundary closely: ${Buffer.byteLength(nearBoundEncoded.line)}`);
assert.deepEqual(decodeDiscoveryPayload(nearBoundEncoded.line), nearBoundValue,
  'near-bound transport reconstructs every logical fact exactly');
assert.throws(() => encodeDiscoveryPayload(nearBound(upper)), (error) =>
  error.message === 'complete case-discovery candidate index exceeds the retained report-tail bound',
'overflow refusal is size-only and discloses no candidate content');
const zeroScan = structuredClone(first);
zeroScan.scan = { ...zeroScan.scan, candidate_files: 0, candidate_bytes: 0,
  admitted_index_files: 0, excluded_generated_artifacts: 0 };
refreshIndexDigest(zeroScan);
assert.throws(() => encodeDiscoveryPayload(zeroScan), /indexed facts contradict scan accounting/,
  'a populated index cannot claim an empty scan');
const excludedAnchor = structuredClone(first);
const excludedRoute = structuredClone(excludedAnchor.candidate_index.categories.routes[0]);
excludedRoute.path = 'dist/invented.md';
excludedRoute.stratum = 'docs';
excludedRoute.symbol = null;
excludedRoute.line = null;
excludedAnchor.candidate_index.categories.routes[0] = excludedRoute;
for (const rows of [excludedAnchor.candidate_index.near_neighbors,
  excludedAnchor.candidate_index.negative_decoys]) {
  for (const row of rows) {
    if (row.category === 'routes') row.anchor_path = excludedRoute.path;
  }
}
refreshIndexDigest(excludedAnchor);
assert.throws(() => encodeDiscoveryPayload(excludedAnchor), /anchor is outside the exact schema/,
  'digest-valid anchors still obey generated-artifact exclusion and derived stratum authority');
const duplicateAnchor = structuredClone(first);
duplicateAnchor.candidate_index.categories.routes[1] = structuredClone(
  duplicateAnchor.candidate_index.categories.routes[0],
);
refreshIndexDigest(duplicateAnchor);
assert.throws(() => encodeDiscoveryPayload(duplicateAnchor), /anchor count is outside bounds/,
  'a category cannot repeat the same anchor path');
const oversizedPreview = structuredClone(first);
oversizedPreview.candidate_index.categories.routes[0].category_signal.value = 'r'.repeat(241);
oversizedPreview.candidate_index.categories.routes[0].category_signal.value_sha256 =
  crypto.createHash('sha256').update('r'.repeat(241)).digest('hex');
refreshIndexDigest(oversizedPreview);
assert.throws(() => encodeDiscoveryPayload(oversizedPreview), /category signal is outside/,
  'reviewer signal previews cannot exceed the producer 240-code-unit slice');
const contradictorySignalLine = structuredClone(first);
const contradictorySignal = contradictorySignalLine.candidate_index.categories.routes[0]
  .category_signal;
contradictorySignal.occurrence = 'derived_unresolved';
contradictorySignal.line = 1;
contradictorySignal.line_sha256 = crypto.createHash('sha256')
  .update('contradictory line').digest('hex');
refreshIndexDigest(contradictorySignalLine);
assert.throws(() => encodeDiscoveryPayload(contradictorySignalLine),
  /signal line identity is contradictory/,
  'unresolved signals cannot carry a resolved source-line identity');
const invalidControl = structuredClone(first);
const invalidNeighbor = invalidControl.candidate_index.near_neighbors[0];
const referencedControlAnchor = invalidControl.candidate_index
  .categories[invalidNeighbor.category][0];
invalidNeighbor.candidate = { ...structuredClone(referencedControlAnchor), category: null,
  category_signal: null, role: 'near_neighbor' };
refreshIndexDigest(invalidControl);
assert.throws(() => encodeDiscoveryPayload(invalidControl), /near-neighbor authority is invalid/,
  'a control candidate cannot repeat its referenced positive anchor');
const invalidRename = structuredClone(first);
invalidRename.candidate_index.operation_candidates.rename[0].proposed_path = 'src/invented.ts';
refreshIndexDigest(invalidRename);
assert.throws(() => encodeDiscoveryPayload(invalidRename), /rename absence authority is invalid/,
  'rename proposals must follow the bounded producer derivation');
const invalidBranch = structuredClone(first);
invalidBranch.candidate_index.operation_candidates.branch[0].proposed_branch =
  'lamina-oracle/aaaaaaaaaaaa';
refreshIndexDigest(invalidBranch);
assert.throws(() => encodeDiscoveryPayload(invalidBranch), /branch candidate is invalid/,
  'branch names remain exact derivations of their source file identities');
const mismatchedWorktreeSelection = structuredClone(first);
mismatchedWorktreeSelection.candidate_index.operation_candidates.logical_worktree.reverse();
refreshIndexDigest(mismatchedWorktreeSelection);
assert.throws(() => encodeDiscoveryPayload(mismatchedWorktreeSelection),
  /branch and worktree selections are inconsistent/,
  'branch and logical-worktree candidates must retain the producer-selected file pairing');
const positiveClaim = structuredClone(first);
positiveClaim.quality_claims.observation = true;
assert.throws(() => encodeDiscoveryPayload(positiveClaim), /zero-claim schema/);
const arbitraryField = structuredClone(first);
arbitraryField.arbitrary = true;
assert.throws(() => encodeDiscoveryPayload(arbitraryField), /exact zero-claim schema/);
const indexMutation = structuredClone(first);
indexMutation.candidate_index.index_sha256 = '0'.repeat(64);
assert.throws(() => encodeDiscoveryPayload(indexMutation), /index digest drifted/);

console.log('real repository oracle case-discovery tests passed');
