#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewedCollectionForTier } from '../benchmarks/real-repository-oracle-v1/collection-authority.mjs';
import { evidenceAnchorIdentity } from '../benchmarks/real-repository-oracle-v1/materialize.mjs';
import {
  EVIDENCE_EXPANSION_LIMITS, EVIDENCE_EXPANSION_MAX_PAYLOAD_LINE_BYTES,
  EVIDENCE_EXPANSION_PAYLOAD_PREFIX, EVIDENCE_SELECTION_CANONICAL_SHA256,
  EVIDENCE_SELECTION_RAW_SHA256, encodeEvidenceExpansionPayload, expandSelectedEvidence,
  loadEvidenceSelection, parseEvidenceSelectionBytes, validateEvidenceSelection,
} from '../benchmarks/real-repository-oracle-v1/case-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleSource = fs.readFileSync(path.join(ROOT,
  'benchmarks/real-repository-oracle-v1/case-evidence.mjs'), 'utf8');
for (const forbidden of ['./contract.mjs', './evaluate.mjs', './grade.mjs', './controller.mjs',
  './fixture.mjs', './inventory-review-receipt.mjs', 'workflowDocuments', 'expectedByRequest']) {
  assert.equal(moduleSource.includes(forbidden), false, `evidence expansion cannot load ${forbidden}`);
}
const loaded = loadEvidenceSelection();
assert.equal(loaded.raw_sha256, EVIDENCE_SELECTION_RAW_SHA256);
assert.equal(loaded.canonical_sha256, EVIDENCE_SELECTION_CANONICAL_SHA256);
assert.ok(Object.values(loaded.selection.tiers).every((tier) =>
  tier.status === 'reviewer_selection_pending' && tier.anchors.length === 0));
assert.match(loaded.selection.purpose, /not_grade_or_expectation_authority/);

const bytes = Buffer.from([
  'function handler() { return handlerExtra(); }',
  'function handlerExtra() { return true; }',
  'export { handler };',
].join('\n'));
const blob = crypto.createHash('sha1').update(bytes).digest('hex');
const selection = structuredClone(loaded.selection);
selection.tiers.small.status = 'reviewer_selected';
selection.tiers.small.anchors = [
  { path: 'src/handler.ts', blob_oid: blob, symbol: 'handler', line: 1,
    role: 'positive', independent_method: 'sealed_git_blob_exact_identifier' },
  { path: 'src/handler.ts', blob_oid: blob, symbol: 'missingHandler', line: null,
    role: 'negative', independent_method: 'sealed_git_blob_absence' },
  { path: 'src/handler.ts', blob_oid: blob, symbol: null, line: 3,
    role: 'scenario_before', independent_method: 'sealed_git_blob_line_context' },
];
assert.equal(validateEvidenceSelection(selection).valid, true);
const identity = parseEvidenceSelectionBytes(Buffer.from(JSON.stringify(selection)), {
  requireReviewedBytes: false,
});
const collection = reviewedCollectionForTier('small');
const boundedReader = (_repository, _collection, anchors) => anchors.map((anchor) => {
  if (anchor.path !== 'src/handler.ts') throw new Error(`selected evidence path is missing: ${anchor.path}`);
  if (anchor.blob_oid !== blob) throw new Error(`selected evidence blob identity drifted: ${anchor.path}`);
  return { anchor: { path: anchor.path, blob_oid: anchor.blob_oid, symbol: anchor.symbol,
    line: anchor.line, role: anchor.role, independent_method: anchor.independent_method }, bytes };
});
const first = expandSelectedEvidence('/unused', collection, selection.tiers.small, identity, boundedReader);
const replay = expandSelectedEvidence('/unused', collection, selection.tiers.small, identity, boundedReader);
assert.deepEqual(replay, first);
assert.equal(first.records[0].symbol_match_count, 2,
  'exact identifier matching sees handler declaration/export but not handlerExtra');
assert.equal(first.records[1].symbol_match_count, 0);
assert.match(first.records[1].absence_sha256, /^[a-f0-9]{64}$/);
assert.equal(first.records[2].selected_line, 3);
assert.ok(first.records.every((record) => record.path && record.blob_oid
  && record.content_sha256 && record.line_sha256 && record.context_sha256
  && record.requested_role && record.requested_method && record.verified_method));
assert.equal(first.records.some((record) => 'independent_method' in record || 'role' in record), false,
  'reviewer-requested metadata is never relabeled as controller-verified metadata');
assert.ok(Object.values(first.quality_claims).every((claim) => claim === false));
for (const forbidden of ['expected', 'workflow', 'domain', 'golden']) {
  assert.equal(Object.keys(first).some((key) => key.includes(forbidden)), false);
}
const encoded = encodeEvidenceExpansionPayload(first);
assert.ok(encoded.startsWith(EVIDENCE_EXPANSION_PAYLOAD_PREFIX));
assert.ok(Buffer.byteLength(encoded) <= EVIDENCE_EXPANSION_MAX_PAYLOAD_LINE_BYTES);

const malformed = structuredClone(selection);
malformed.tiers.small.anchors[0].path = '../escape.ts';
assert.equal(validateEvidenceSelection(malformed).valid, false);
const duplicate = structuredClone(selection);
duplicate.tiers.small.anchors.push(Object.fromEntries(
  Object.entries(duplicate.tiers.small.anchors[0]).reverse(),
));
assert.equal(evidenceAnchorIdentity(duplicate.tiers.small.anchors[0]),
  evidenceAnchorIdentity(duplicate.tiers.small.anchors.at(-1)),
  'anchor identity is an explicit tuple independent of caller key order');
assert.equal(validateEvidenceSelection(duplicate).valid, false);
const overBudget = structuredClone(selection);
overBudget.tiers.small.anchors = Array.from({ length: EVIDENCE_EXPANSION_LIMITS.max_anchors + 1 },
  (_, index) => ({ ...selection.tiers.small.anchors[0], line: index + 1 }));
assert.equal(validateEvidenceSelection(overBudget).valid, false);
const drift = structuredClone(selection);
drift.tiers.small.reviewed_inventory_sha256 = '0'.repeat(64);
assert.equal(validateEvidenceSelection(drift).valid, false);
const tamperedBlob = structuredClone(selection.tiers.small);
tamperedBlob.anchors[0].blob_oid = '0'.repeat(40);
assert.throws(() => expandSelectedEvidence('/unused', collection, tamperedBlob, identity, boundedReader),
  /blob identity drifted/);
const missing = structuredClone(selection.tiers.small);
missing.anchors[0].path = 'src/missing.ts';
assert.throws(() => expandSelectedEvidence('/unused', collection, missing, identity, boundedReader),
  /path is missing/);
const absentLine = structuredClone(selection.tiers.small);
absentLine.anchors[0].line = 999;
assert.throws(() => expandSelectedEvidence('/unused', collection, absentLine, identity, boundedReader),
  /exact_identifier evidence is absent from the declared line/);
for (const mutate of [
  (anchor) => { anchor.symbol = null; },
  (anchor) => { anchor.line = null; },
]) {
  const invalidExact = structuredClone(selection);
  mutate(invalidExact.tiers.small.anchors[0]);
  assert.equal(validateEvidenceSelection(invalidExact).valid, false);
}
const invalidAbsence = structuredClone(selection);
invalidAbsence.tiers.small.anchors[1].line = 1;
assert.equal(validateEvidenceSelection(invalidAbsence).valid, false);
const invalidContext = structuredClone(selection);
invalidContext.tiers.small.anchors[2].line = null;
assert.equal(validateEvidenceSelection(invalidContext).valid, false);
const postMutation = structuredClone(selection);
postMutation.tiers.small.anchors[2].role = 'scenario_after';
assert.equal(validateEvidenceSelection(postMutation).valid, false);
assert.throws(() => expandSelectedEvidence('/unused', collection,
  postMutation.tiers.small, identity, boundedReader),
/scenario_after requires later post-mutation evidence expansion/);
const controlPath = structuredClone(selection);
controlPath.tiers.small.anchors[0].path = 'src/bad\npath.ts';
assert.equal(validateEvidenceSelection(controlPath).valid, false);
const contradictedAbsence = structuredClone(selection.tiers.small);
contradictedAbsence.anchors[1].symbol = 'handler';
assert.throws(() => expandSelectedEvidence('/unused', collection, contradictedAbsence, identity, boundedReader),
  /absence evidence contradicts exact identifier matches/);
const denseBytes = Buffer.from('handler '.repeat(128 * 1024).slice(0, 1024 * 1024));
const denseBlob = crypto.createHash('sha1').update(denseBytes).digest('hex');
const denseTier = structuredClone(selection.tiers.small);
denseTier.anchors = [{ path: 'src/handler.ts', blob_oid: denseBlob, symbol: 'handler', line: 1,
  role: 'positive', independent_method: 'sealed_git_blob_exact_identifier' }];
const dense = expandSelectedEvidence('/unused', collection, denseTier, identity,
  (_repository, _collection, anchors) => [{ anchor: anchors[0], bytes: denseBytes }]);
assert.ok(dense.records[0].symbol_match_count > 100_000);
assert.deepEqual(dense.records[0].symbol_match_lines, [1],
  'dense scans retain bounded line evidence instead of every match');
assert.ok(Buffer.byteLength(encodeEvidenceExpansionPayload(dense))
  <= EVIDENCE_EXPANSION_MAX_PAYLOAD_LINE_BYTES);
assert.throws(() => parseEvidenceSelectionBytes(Buffer.concat([Buffer.from('{}'),
  Buffer.alloc(64 * 1024)]), { requireReviewedBytes: false }), /source identity/);

console.log('real repository oracle evidence-expansion tests passed');
