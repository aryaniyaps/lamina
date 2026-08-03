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
assert.equal(validateEvidenceSelection(loaded.selection).valid, true);
assert.deepEqual(Object.fromEntries(Object.entries(loaded.selection.tiers)
  .map(([tier, item]) => [tier, { status: item.status, count: item.anchors.length }])), {
  small: { status: 'reviewer_selected', count: 8 },
  medium: { status: 'reviewer_selected', count: 10 },
  large: { status: 'reviewer_selected', count: 12 },
});
assert.match(loaded.selection.purpose, /not_grade_or_expectation_authority/);

const anchorTuple = (anchor) => [anchor.role, anchor.path, anchor.blob_oid,
  anchor.symbol ?? '-', anchor.line ?? '-', anchor.independent_method].join('|');
const expectedAnchorTuples = {
  small: [
    'positive|apps/nextjs-app/src/app/app/_components/dashboard-layout.tsx|a84797b64b77a2f8c9b9aa19b8a55ee8e2d7fbb2|SideNavigationItem|22|sealed_git_blob_exact_identifier',
    'positive|apps/nextjs-app/src/app/app/profile/_components/profile.tsx|e9b25ecc97e78d10238645e264feeb9ac227406d|EntryProps|6|sealed_git_blob_exact_identifier',
    'positive|apps/nextjs-pages/src/components/layouts/dashboard-layout.tsx|a9f472b15efd759fac789adbfbbdc2276a1c8267|routeChangeComplete|72|sealed_git_blob_exact_identifier',
    'positive|apps/nextjs-app/src/hooks/use-disclosure.ts|e386356cbb7a0b33494e0dc7777aff9793453629|useDisclosure|3|sealed_git_blob_exact_identifier',
    'positive|apps/nextjs-app/src/lib/__tests__/authorization.test.tsx|973526d27fbc060e77cba13c74dfbe09cbeafdff|Authorization|11|sealed_git_blob_exact_identifier',
    'negative|apps/nextjs-pages/src/components/layouts/auth-layout.tsx|336ba5f5e20cd0ae747414b1bff96a494b546382|routeChangeComplete|-|sealed_git_blob_absence',
    'scenario_before|.github/workflows/nextjs-app-ci.yml|3d641fca6655dfd7c84c89393cd4bb0ed342f0f6|-|1|sealed_git_blob_line_context',
    'scenario_before|apps/nextjs-app/.storybook/preview.tsx|9d181d43cce5b51b538d452653ec42fb4d8c7bd3|parameters|4|sealed_git_blob_exact_identifier',
  ],
  medium: [
    'positive|app/actions/definitions/apiKeys.tsx|4f0f29afaa38bef914292e5362a6a78be6226597|ApiKey|6|sealed_git_blob_exact_identifier',
    'positive|plugins/oidc/server/oidcDiscovery.test.ts|654eaf44873adbfd2bce67dac684a7fe01facc7b|DefaultBodyType|4|sealed_git_blob_exact_identifier',
    'positive|app/actions/definitions/developer.tsx|7ac3629987be55bf75b633a7c665d4f281b5f0b8|keydown|119|sealed_git_blob_exact_identifier',
    'positive|app/components/Analytics.tsx|333c1761589cfa2536d09e61ca24a69e61108f6f|appinstalled|37|sealed_git_blob_exact_identifier',
    'positive|app/components/DesktopEventHandler.tsx|28ca23249c144d0183ed2be3c5bd295316d92faa|DesktopEventHandler|10|sealed_git_blob_exact_identifier',
    'positive|app/components/Menu/transformer.tsx|0ede28d900496c03852db0b24f9ad580ebbbccde|preventCloseHandler|91|sealed_git_blob_exact_identifier',
    'positive|app/actions/definitions/collections.tsx|08729e4bda4cd6f2225e8388d6dfdd7cbde9b567|Permissions|122|sealed_git_blob_exact_identifier',
    'negative|app/components/ActionButton.tsx|1fbed3eee3c44dc9a504ecfc44c37b31c3aadcf6|DesktopEventHandler|-|sealed_git_blob_absence',
    'scenario_before|.github/ISSUE_TEMPLATE/bug_report.yml|eedb16f6463ca5d2b7089a5c653b5bc507c68429|-|1|sealed_git_blob_line_context',
    'scenario_before|.github/actions/install/action.yml|3cd311d5015c6fde715deed942b74400f9dbaa24|-|1|sealed_git_blob_line_context',
  ],
  large: [
    'positive|apps/admin/app/(all)/(dashboard)/ai/form.tsx|affbda4808b24bf13fd502e65ffbe9f89554be33|AIFormValues|22|sealed_git_blob_exact_identifier',
    'positive|apps/live/tests/lib/pdf/pdf-rendering.test.ts|507c6f900a2539e53aa536c90dcac5859bf47b82|PDF_HEADER|12|sealed_git_blob_exact_identifier',
    'positive|packages/decorators/README.md|f607ca2b9c7ed229d47e4aa81f9950ca52bb907e|UserController|34|sealed_git_blob_exact_identifier',
    'positive|.github/workflows/feature-deployment.yml|f7ade5e169d74bdfcd72ca1dc36225aa032f2d11|FEATURE_PREVIEW_HELM_CHART_NAME|167|sealed_git_blob_exact_identifier',
    'positive|apps/admin/app/(all)/(home)/auth-helpers.tsx|ea18dc995992c4c3ebd4338fef79329f1154a2d8|authErrorHandler|78|sealed_git_blob_exact_identifier',
    'positive|packages/decorators/README.md|f607ca2b9c7ed229d47e4aa81f9950ca52bb907e|ChatController|60|sealed_git_blob_exact_identifier',
    'positive|apps/api/plane/authentication/adapter/exception.py|c8d28762a90f7043d852f29aaf45bc38a5a09a99|auth_exception_handler|17|sealed_git_blob_exact_identifier',
    'positive|apps/api/plane/api/serializers/invite.py|18c1c0206657a2df68f9b1f0dcbe2ed2729281ab|WorkspaceInviteSerializer|16|sealed_git_blob_exact_identifier',
    'positive|apps/api/plane/tests/TESTING_GUIDE.md|98f4a1dba7c8bd5e149ccfcfb136c90cd679a9b0|TestCriticalFlow|81|sealed_git_blob_exact_identifier',
    'negative|apps/admin/app/(all)/(home)/auth-banner.tsx|43df781bbb0eac0187ed40fb7cd37a5d2c5ee368|authErrorHandler|-|sealed_git_blob_absence',
    'scenario_before|apps/admin/app/(all)/(dashboard)/ai/form.tsx|affbda4808b24bf13fd502e65ffbe9f89554be33|IInstanceAIForm|18|sealed_git_blob_exact_identifier',
    'scenario_before|.github/ISSUE_TEMPLATE/--bug-report.yaml|277a3bdfa8999d263e1577fb6a625261773e0a80|-|1|sealed_git_blob_line_context',
  ],
};
for (const [tier, expected] of Object.entries(expectedAnchorTuples)) {
  assert.deepEqual(loaded.selection.tiers[tier].anchors.map(anchorTuple), expected,
    `${tier} reviewer anchors retain exact reviewed values and order`);
}

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
absentLine.anchors[0].line = 2;
assert.throws(() => expandSelectedEvidence('/unused', collection, absentLine, identity, boundedReader),
  /exact_identifier evidence is absent from the declared line/,
  'an exact symbol elsewhere in the blob and a longer identifier on the declared line do not satisfy the anchor');
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
const exactBoundaryAbsence = structuredClone(selection.tiers.small);
exactBoundaryAbsence.anchors[1].symbol = 'handle';
const boundaryResult = expandSelectedEvidence('/unused', collection, exactBoundaryAbsence,
  identity, boundedReader);
assert.equal(boundaryResult.records[1].symbol_match_count, 0,
  'absence scans exact identifier boundaries across the complete bounded blob');
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
