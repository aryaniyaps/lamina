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
const renameProposalFor = (anchor, attempt = 0) => {
  const candidateId = crypto.createHash('sha256').update(JSON.stringify({
    blob_oid: anchor.blob_oid, path: anchor.path,
  })).digest('hex').slice(0, 12);
  const sourceExtension = path.posix.extname(anchor.path);
  const extension = Buffer.byteLength(sourceExtension) <= 16
      && /^\.[A-Za-z0-9]{1,15}$/.test(sourceExtension)
    ? sourceExtension : '';
  return `lamina-oracle-rename-${candidateId}${attempt === 0 ? '' : `-${attempt}`}${extension}`;
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
const pinnedCleanRoomExclusions = [
  'AGENTS.md',
  'apps/nextjs-app/public/mockServiceWorker.js',
  'apps/nextjs-pages/public/mockServiceWorker.js',
  'apps/react-vite/public/mockServiceWorker.js',
];
for (const excludedPath of pinnedCleanRoomExclusions) {
  assert.equal(discoveryPathDisposition(excludedPath).admitted, false,
    `pinned-tree clean-room exclusion: ${excludedPath}`);
}
for (const excludedPath of [
  'AGENTS.override.md', 'nested/AGENTS.OVERRIDE.MD',
  'nested/CLAUDE.MD', 'nested/Gemini.md', 'nested/codex.md', 'nested/CURSOR.md',
  'nested/.cursorrules', '.agents/state.json', 'nested/.claude/settings.json',
  'nested/.codex/config.toml', 'nested/.cursor/state.json', 'nested/.gemini/state.json',
  'nested/.OPENCODE/state.json', '.opencode/skills/x.md',
  '.github/copilot-instructions.md', '.github/instructions/security.instructions.md',
  '.github/agents/reviewer.md', 'mockServiceWorker.js', 'nested/public/MOCKSERVICEWORKER.JS',
]) {
  assert.deepEqual(discoveryPathDisposition(excludedPath), {
    admitted: false, stratum: null, reason: excludedPath.toLowerCase().endsWith('mockserviceworker.js')
      ? 'generated_or_build_artifact' : 'agent_instruction_or_state',
  });
}
assert.equal(discoveryPathDisposition('package-lock.json').admitted, false,
  'dependency lock exclusions remain intact');
assert.deepEqual(discoveryPathDisposition('README.md'),
  { admitted: true, stratum: 'docs', reason: null });
assert.deepEqual(discoveryPathDisposition('.github/workflows/test.yml'),
  { admitted: true, stratum: 'config', reason: null },
  'agent exclusions do not swallow ordinary GitHub workflows');

const cleanRoomExcludedPaths = [
  ...pinnedCleanRoomExclusions,
  'mockServiceWorker.js',
  'nested/public/MOCKSERVICEWORKER.JS',
  'AGENTS.override.md',
  'nested/AGENTS.OVERRIDE.MD',
  'nested/CLAUDE.MD',
  '.github/copilot-instructions.md',
  'nested/.cursor/state.json',
  'nested/.OPENCODE/state.json',
  '.opencode/skills/x.md',
  '.github/instructions/security.instructions.md',
  '.github/agents/reviewer.md',
];
const cleanRoomProductPaths = ['README.md', 'src/app.ts'];
const cleanRoomCandidates = [
  ...cleanRoomExcludedPaths.map((candidatePath) => [candidatePath,
    candidatePath.toLowerCase().endsWith('mockserviceworker.js')
      ? 'function mockServiceWorker() { app.get("/mock", emit); }'
      : '# Agent permissions role instructions']),
  ['README.md', '# Product documentation'],
  ['src/app.ts', 'const featureFlag = true; app.get("/product", emit);'],
].map(([candidatePath, text]) => ({
  path: candidatePath, bytes: Buffer.from(text),
  blob_oid: crypto.createHash('sha1').update(text).digest('hex'),
}));
const cleanRoomTrackedPaths = [
  ...cleanRoomCandidates.map((candidate) => candidate.path),
  ...Array.from({ length: collection.reviewed_inventory.tracked_files
      - cleanRoomCandidates.length },
  (_, index) => `clean-room-authority/file-${String(index).padStart(4, '0')}.ts`),
];
const cleanRoomDiscovery = discoverCandidateFacts('/unused-clean-room-visitor', collection,
  (_repository, _collection, visit) => {
    for (const candidate of cleanRoomCandidates) visit(candidate);
    return { candidate_files: cleanRoomCandidates.length,
      candidate_bytes: cleanRoomCandidates.reduce((total, candidate) =>
        total + candidate.bytes.length, 0),
      tracked_paths: cleanRoomTrackedPaths };
  });
assert.equal(cleanRoomDiscovery.scan.candidate_files, cleanRoomCandidates.length);
assert.equal(cleanRoomDiscovery.scan.admitted_index_files, cleanRoomProductPaths.length);
assert.equal(cleanRoomDiscovery.scan.excluded_generated_artifacts, cleanRoomExcludedPaths.length,
  'legacy umbrella counter includes generated and agent-instruction non-product artifacts');
const cleanRoomSerialized = JSON.stringify(cleanRoomDiscovery.candidate_index);
for (const excludedPath of cleanRoomExcludedPaths) {
  assert.equal(cleanRoomSerialized.includes(excludedPath), false,
    `excluded path cannot contaminate any index surface: ${excludedPath}`);
}
const cleanRoomIndexedPaths = [
  ...Object.values(cleanRoomDiscovery.candidate_index.categories).flat(),
  ...cleanRoomDiscovery.candidate_index.near_neighbors.map((row) => row.candidate),
  ...cleanRoomDiscovery.candidate_index.negative_decoys.map((row) => row.candidate),
  ...Object.values(cleanRoomDiscovery.candidate_index.operation_candidates).flat(),
].map((anchor) => anchor.path);
assert.ok(cleanRoomIndexedPaths.length > 0
  && cleanRoomIndexedPaths.every((candidatePath) => cleanRoomProductPaths.includes(candidatePath)));
assert.deepEqual(decodeDiscoveryPayload(encodeDiscoveryPayload(cleanRoomDiscovery).line),
  cleanRoomDiscovery,
  'clean-room exclusions survive exact transport without entering categories, controls, or operations');
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
  assert.equal(candidate.proposed_path, renameProposalFor(candidate));
  assert.equal(candidate.proposed_path.includes('/'), false);
}
assert.equal(new Set(first.candidate_index.operation_candidates.rename
  .map((candidate) => candidate.proposed_path)).size,
first.candidate_index.operation_candidates.rename.length,
'accepted rename proposals remain pairwise distinct');
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
assert.equal(collisionAware.candidate_index.operation_candidates.rename[0].proposed_path,
  renameProposalFor(initialRename, 1),
  'the bounded root-level collision search advances to the next deterministic attempt');
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
assert.equal(Buffer.byteLength(legacyLine), 4_517,
  'c009-format same-logical-result JSON+Brotli baseline is frozen');
assert.equal(Buffer.byteLength(encoded.line), 2_527,
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
const longRenameSegments = [
  ...Array.from({ length: 20 }, () => 'x'.repeat(200)),
  `${'z'.repeat(69)}.ts`,
];
const longRenameSourcePath = `src/${longRenameSegments.join('/')}`;
assert.equal(Buffer.byteLength(longRenameSourcePath), 4_096);
assert.ok(longRenameSourcePath.split('/').every((segment) => Buffer.byteLength(segment) <= 200));
const gitBlobOid = (bytes) => crypto.createHash('sha1').update(Buffer.concat([
  Buffer.from(`blob ${bytes.length}\0`), bytes,
])).digest('hex');
const longRenameInputs = [
  ['src/a.ts', 'const featureFlag = true; // a'],
  ['src/b.ts', 'const featureFlag = true; // b'],
  ['src/c.ts', 'const featureFlag = true; // c'],
  [longRenameSourcePath, 'const featureFlag = true; // long'],
].map(([candidatePath, text]) => {
  const bytes = Buffer.from(text);
  return { path: candidatePath, bytes, blob_oid: gitBlobOid(bytes) };
});
assert.ok(longRenameInputs.every((candidate) => candidate.bytes.length > 0
  && candidate.blob_oid === gitBlobOid(candidate.bytes)));
assert.equal(collection.reviewed_inventory.tracked_files, 535);
const longRenameTrackedPaths = (collisions = []) => [
  ...longRenameInputs.map((candidate) => candidate.path),
  ...collisions,
  ...Array.from({ length: collection.reviewed_inventory.tracked_files
      - longRenameInputs.length - collisions.length },
  (_, index) => `long-rename-authority/file-${String(index).padStart(4, '0')}.ts`),
];
const discoverLongRename = (collisions = []) => discoverCandidateFacts(
  '/unused-long-rename-visitor', collection, (_repository, _collection, visit) => {
    for (const candidate of longRenameInputs) visit(candidate);
    const trackedPaths = longRenameTrackedPaths(collisions);
    assert.equal(new Set(trackedPaths).size, 535);
    return { candidate_files: longRenameInputs.length,
      candidate_bytes: longRenameInputs.reduce((total, candidate) => total + candidate.bytes.length, 0),
      tracked_paths: trackedPaths };
  },
);
const longRenameDiscovery = discoverLongRename();
const longRenameCandidate = longRenameDiscovery.candidate_index.operation_candidates.rename[0];
assert.equal(longRenameCandidate.path, longRenameSourcePath,
  'the maximum-length source is the first record in the rename producer slice');
assert.equal(longRenameCandidate.proposed_path, renameProposalFor(longRenameCandidate));
assert.equal(longRenameCandidate.proposed_path.includes('/'), false);
assert.ok(Buffer.byteLength(longRenameCandidate.proposed_path) <= 64);
assert.ok(longRenameCandidate.proposed_path.endsWith('.ts'),
  'a safe short source extension is preserved exactly');
assert.equal(longRenameCandidate.destination_absence.tracked_path_count, 535);
const longRenameEncoded = encodeDiscoveryPayload(longRenameDiscovery);
assert.deepEqual(decodeDiscoveryPayload(longRenameEncoded.line), longRenameDiscovery,
  'a legal maximum-length rename source roundtrips with a bounded root-level proposal');
const firstCollisionPath = `${renameProposalFor(longRenameCandidate)}/child.ts`;
const secondCollisionPath = `${renameProposalFor(longRenameCandidate, 1)}/child.ts`;
const progressedRenameDiscovery = discoverLongRename([firstCollisionPath, secondCollisionPath]);
const progressedRename = progressedRenameDiscovery.candidate_index.operation_candidates.rename[0];
assert.equal(progressedRename.proposed_path, renameProposalFor(longRenameCandidate, 2),
  'complete tracked and implied-directory authority advances collision attempts in order');
const progressedAuthority = destinationAuthority(longRenameTrackedPaths([
  firstCollisionPath, secondCollisionPath,
]));
assert.equal(progressedRename.destination_absence.tracked_paths_sha256,
  progressedAuthority.tracked_sha256);
assert.equal(progressedRename.destination_absence.occupied_destinations_sha256,
  progressedAuthority.occupied_sha256);
assert.deepEqual(decodeDiscoveryPayload(encodeDiscoveryPayload(progressedRenameDiscovery).line),
  progressedRenameDiscovery);
const oldSameParentRename = structuredClone(longRenameDiscovery);
const oldSameParentCandidate = oldSameParentRename.candidate_index.operation_candidates.rename[0];
oldSameParentCandidate.proposed_path = `${path.posix.dirname(oldSameParentCandidate.path)}`
  + `/lamina-oracle-rename-${oldSameParentCandidate.blob_oid.slice(0, 8)}.ts`;
refreshIndexDigest(oldSameParentRename);
assert.throws(() => encodeDiscoveryPayload(oldSameParentRename),
  /rename absence authority is invalid/,
  'the former source-depth-dependent same-parent proposal is refused');
const wrongRenameExtension = structuredClone(longRenameDiscovery);
wrongRenameExtension.candidate_index.operation_candidates.rename[0].proposed_path =
  renameProposalFor(longRenameCandidate).replace(/\.ts$/, '.js');
refreshIndexDigest(wrongRenameExtension);
assert.throws(() => encodeDiscoveryPayload(wrongRenameExtension),
  /rename absence authority is invalid/,
  'a proposal cannot substitute a different extension');
const wrongRenameDigest = structuredClone(longRenameDiscovery);
wrongRenameDigest.candidate_index.operation_candidates.rename[0].proposed_path =
  `lamina-oracle-rename-${'0'.repeat(12)}.ts`;
refreshIndexDigest(wrongRenameDigest);
assert.throws(() => encodeDiscoveryPayload(wrongRenameDigest),
  /rename absence authority is invalid/,
  'a proposal cannot substitute an unrelated digest-derived identity');
const discoverSingleSyntheticFile = (candidatePath, bytes) => {
  const candidate = {
    path: candidatePath, bytes,
    blob_oid: crypto.createHash('sha1').update(bytes).digest('hex'),
  };
  const trackedPaths = [candidatePath, ...baselineTrackedPaths
    .filter((trackedPath) => trackedPath !== candidatePath)]
    .slice(0, collection.reviewed_inventory.tracked_files);
  return discoverCandidateFacts('/unused-single-file-visitor', collection,
    (_repository, _collection, visit) => {
      visit(candidate);
      return { candidate_files: 1, candidate_bytes: bytes.length, tracked_paths: trackedPaths };
    });
};
for (const [candidatePath, expectedCategory] of [
  ['src/routes/index.ts', 'routes'],
  ['docs/empty.md', 'documentation'],
  ['tests/empty.test.ts', 'tests'],
]) {
  const emptyDiscovery = discoverSingleSyntheticFile(candidatePath, Buffer.alloc(0));
  assert.deepEqual(emptyDiscovery.scan, {
    candidate_files: 1, candidate_bytes: 0,
    tracked_path_count: collection.reviewed_inventory.tracked_files,
    admitted_index_files: 1, excluded_generated_artifacts: 0,
  });
  assert.ok(emptyDiscovery.candidate_index.categories[expectedCategory]
    .some((anchor) => anchor.path === candidatePath
      && anchor.category_signal.occurrence === 'derived_unresolved'
      && anchor.category_signal.line === null));
  assert.ok(Object.values(emptyDiscovery.candidate_index.operation_candidates)
    .every((rows) => rows.length === 0));
  const emptyEncoded = encodeDiscoveryPayload(emptyDiscovery);
  assert.deepEqual(decodeDiscoveryPayload(emptyEncoded.line), emptyDiscovery,
    `zero-byte path-derived ${expectedCategory} discovery roundtrips exactly`);
}

const lateDefinitionBytes = Buffer.from(
  `${'\n'.repeat(1_000_000)}function lateDefinition() { app.get('/late', emit); }`,
);
assert.ok(lateDefinitionBytes.length > 1_000_000);
assert.ok(lateDefinitionBytes.length <= CASE_DISCOVERY_LIMITS.max_file_bytes);
const lateDefinitionDiscovery = discoverSingleSyntheticFile('src/routes/late-definition.ts',
  lateDefinitionBytes);
const lateDefinitionAnchors = Object.values(lateDefinitionDiscovery.candidate_index.categories)
  .flat().filter((anchor) => anchor.path === 'src/routes/late-definition.ts');
assert.ok(lateDefinitionAnchors.length > 0);
assert.ok(lateDefinitionAnchors.every((anchor) =>
  anchor.symbol === 'lateDefinition' && anchor.line === 1_000_001));
const lateDefinitionEncoded = encodeDiscoveryPayload(lateDefinitionDiscovery);
assert.deepEqual(decodeDiscoveryPayload(lateDefinitionEncoded.line), lateDefinitionDiscovery,
  'a definition beyond the former arbitrary million-line cap roundtrips exactly');
const acceptedLateSignalLine = structuredClone(lateDefinitionDiscovery);
const acceptedLateSignal = Object.values(acceptedLateSignalLine.candidate_index.categories)[0][0]
  .category_signal;
acceptedLateSignal.occurrence = 'exact_literal';
acceptedLateSignal.line = 1_000_001;
acceptedLateSignal.line_sha256 = crypto.createHash('sha256').update('late signal line').digest('hex');
refreshIndexDigest(acceptedLateSignalLine);
const acceptedLateSignalEncoded = encodeDiscoveryPayload(acceptedLateSignalLine);
assert.deepEqual(decodeDiscoveryPayload(acceptedLateSignalEncoded.line), acceptedLateSignalLine,
  'signal lines beyond the former arbitrary million-line cap roundtrip exactly');
const excessiveDefinitionLine = structuredClone(lateDefinitionDiscovery);
Object.values(excessiveDefinitionLine.candidate_index.categories)[0][0].line =
  CASE_DISCOVERY_LIMITS.max_file_bytes + 2;
refreshIndexDigest(excessiveDefinitionLine);
assert.throws(() => encodeDiscoveryPayload(excessiveDefinitionLine),
  /anchor is outside the exact schema/,
  'definition line authority cannot exceed the maximum possible line for a bounded file');
const excessiveSignalLine = structuredClone(acceptedLateSignalLine);
const excessiveSignal = Object.values(excessiveSignalLine.candidate_index.categories)
  .flat().find((anchor) => anchor.category_signal.line !== null).category_signal;
excessiveSignal.line = CASE_DISCOVERY_LIMITS.max_file_bytes + 2;
refreshIndexDigest(excessiveSignalLine);
assert.throws(() => encodeDiscoveryPayload(excessiveSignalLine),
  /category signal is outside the exact schema/,
  'signal line authority cannot exceed the maximum possible line for a bounded file');
const excessiveLineWire = JSON.parse(zlib.brotliDecompressSync(Buffer.from(
  lateDefinitionEncoded.line.slice(CASE_DISCOVERY_PAYLOAD_PREFIX.length), 'base64url',
)).toString('utf8'));
const lateFileRow = excessiveLineWire[6]
  .find((row) => row[0] === 'src/routes/late-definition.ts');
lateFileRow[4] = CASE_DISCOVERY_LIMITS.max_file_bytes + 2;
assert.throws(() => decodeDiscoveryPayload(wireLine(excessiveLineWire)),
  /payload line is malformed/,
  'wire decoding applies the same file-derived line-number bound before expansion');
const excessiveSignalWire = JSON.parse(zlib.brotliDecompressSync(Buffer.from(
  acceptedLateSignalEncoded.line.slice(CASE_DISCOVERY_PAYLOAD_PREFIX.length), 'base64url',
)).toString('utf8'));
const lateSignalRow = excessiveSignalWire[7].find((row) => row[3] === 1_000_001);
lateSignalRow[3] = CASE_DISCOVERY_LIMITS.max_file_bytes + 2;
assert.throws(() => decodeDiscoveryPayload(wireLine(excessiveSignalWire)),
  /payload line is malformed/,
  'wire decoding applies the same file-derived signal-line bound before expansion');
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
const escapedMaxPaths = Array.from({ length: 12 }, (_, index) => {
  const suffix = String(index);
  return `src/${'"'.repeat(4_092 - suffix.length)}${suffix}`;
});
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
maxRefValue.scan = { ...maxRefValue.scan, candidate_files: 12, candidate_bytes: 1,
  admitted_index_files: 12, excluded_generated_artifacts: 0 };
maxRefValue.candidate_index.categories = Object.fromEntries(allDiscoveryCategories.map((category) => [
  category, escapedMaxPaths.slice(0, 3)
    .map((candidatePath) => maxRefAnchor(candidatePath, category, 'positive')),
]));
maxRefValue.candidate_index.near_neighbors = allDiscoveryCategories.map((category) => ({
  category, anchor_path: escapedMaxPaths[0],
  candidate: maxRefAnchor(escapedMaxPaths[3], null, 'near_neighbor'),
}));
maxRefValue.candidate_index.negative_decoys = allDiscoveryCategories.map((category) => ({
  category, anchor_path: escapedMaxPaths[0],
  candidate: maxRefAnchor(escapedMaxPaths[3], null, 'negative'),
  basis: 'same_stratum_without_discovered_category',
}));
const scenarioAnchors = escapedMaxPaths.map((candidatePath) =>
  maxRefAnchor(candidatePath, null, 'scenario_before'));
const renameAuthority = first.candidate_index.operation_candidates.rename[0].destination_absence;
maxRefValue.candidate_index.operation_candidates = {
  modify: scenarioAnchors.slice(0, 3).map((anchor) => structuredClone(anchor)),
  rename: scenarioAnchors.slice(3, 6).map((anchor) => ({ ...structuredClone(anchor),
    proposed_path: renameProposalFor(anchor),
    destination_absence: structuredClone(renameAuthority) })),
  delete: scenarioAnchors.slice(6, 9).map((anchor) => structuredClone(anchor)),
  branch: scenarioAnchors.slice(9, 12).map((anchor) => {
    const id = crypto.createHash('sha256').update(JSON.stringify(canonical({
      path: anchor.path, blob_oid: anchor.blob_oid,
    }))).digest('hex').slice(0, 12);
    return { ...structuredClone(anchor), proposed_branch: `lamina-oracle/${id}`,
      source_commit: maxRefValue.collection.commit, executed: false };
  }),
  logical_worktree: scenarioAnchors.slice(9, 12).map((anchor) => {
    const id = crypto.createHash('sha256').update(JSON.stringify(canonical({
      path: anchor.path, blob_oid: anchor.blob_oid,
    }))).digest('hex').slice(0, 12);
    return { ...structuredClone(anchor), logical_worktree_id: `oracle-worktree-${id}`,
      source_commit: maxRefValue.collection.commit, executed: false };
  }),
};
refreshIndexDigest(maxRefValue);
const maxRefSemanticBytes = Buffer.byteLength(JSON.stringify(canonical(maxRefValue)));
assert.equal(maxRefSemanticBytes, 977_348,
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
const positiveAsNegative = structuredClone(first);
const promotedNegative = positiveAsNegative.candidate_index.negative_decoys
  .find((row) => positiveAsNegative.candidate_index.categories[row.category].length >= 2);
assert.ok(promotedNegative);
const promotedCategoryAnchors = positiveAsNegative.candidate_index
  .categories[promotedNegative.category];
promotedCategoryAnchors[1] = {
  ...structuredClone(promotedNegative.candidate),
  category: promotedNegative.category,
  category_signal: structuredClone(promotedCategoryAnchors[0].category_signal),
  role: 'positive',
};
refreshIndexDigest(positiveAsNegative);
assert.throws(() => encodeDiscoveryPayload(positiveAsNegative),
  /negative-decoy authority is invalid/,
  'a negative decoy must be absent from every positive path for its category');
const reversedNeighbors = structuredClone(first);
assert.ok(reversedNeighbors.candidate_index.near_neighbors.length > 1);
reversedNeighbors.candidate_index.near_neighbors.reverse();
refreshIndexDigest(reversedNeighbors);
assert.throws(() => encodeDiscoveryPayload(reversedNeighbors),
  /controls contain duplicate category tuples/,
  'near-neighbor rows retain producer git-byte category order');
const reversedDecoys = structuredClone(first);
assert.ok(reversedDecoys.candidate_index.negative_decoys.length > 1);
reversedDecoys.candidate_index.negative_decoys.reverse();
refreshIndexDigest(reversedDecoys);
assert.throws(() => encodeDiscoveryPayload(reversedDecoys),
  /controls contain duplicate category tuples/,
  'negative-decoy rows retain producer git-byte category order');
const invalidRename = structuredClone(first);
invalidRename.candidate_index.operation_candidates.rename[0].proposed_path = 'src/invented.ts';
refreshIndexDigest(invalidRename);
assert.throws(() => encodeDiscoveryPayload(invalidRename), /rename absence authority is invalid/,
  'rename proposals must follow the bounded producer derivation');
const overlappingOperationSlices = structuredClone(first);
const overlappingSource = structuredClone(
  overlappingOperationSlices.candidate_index.operation_candidates.modify[0],
);
overlappingOperationSlices.candidate_index.operation_candidates.rename[0] = {
  ...overlappingSource,
  proposed_path: renameProposalFor(overlappingSource),
  destination_absence: structuredClone(
    overlappingOperationSlices.candidate_index.operation_candidates.rename[1].destination_absence,
  ),
};
refreshIndexDigest(overlappingOperationSlices);
assert.throws(() => encodeDiscoveryPayload(overlappingOperationSlices),
  /operation slices overlap/,
  'modify, rename, delete, and branch slices cannot reuse producer-selected paths');
const operationSliceGap = structuredClone(first);
operationSliceGap.candidate_index.operation_candidates.rename.pop();
refreshIndexDigest(operationSliceGap);
assert.throws(() => encodeDiscoveryPayload(operationSliceGap),
  /operation counts are not contiguous producer slices/,
  'a partial producer slice cannot be followed by a non-empty later slice');
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
