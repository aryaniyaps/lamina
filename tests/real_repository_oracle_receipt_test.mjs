#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INVENTORY_REVIEW_RECEIPT, REVIEWED_INVENTORIES,
} from '../benchmarks/real-repository-oracle-v1/collection-authority.mjs';
import {
  INDEPENDENT_REVIEWED_COMMIT, INVENTORY_REVIEW_RECEIPT_CANONICAL_SHA256,
  INVENTORY_REVIEW_RECEIPT_SHA256, RECONSTRUCTION_REVIEWED_COMMIT,
  parseInventoryReviewReceiptBytes, validateInventoryReviewReceipt,
} from '../benchmarks/real-repository-oracle-v1/inventory-review-receipt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPT_PATH = path.join(
  ROOT, 'benchmarks/real-repository-oracle-v1/reviews/inventory-v1.json',
);
const bytes = fs.readFileSync(RECEIPT_PATH);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const clone = () => structuredClone(INVENTORY_REVIEW_RECEIPT);
const rejected = (mutate, pattern) => {
  const candidate = clone();
  mutate(candidate);
  const validation = validateInventoryReviewReceipt(candidate, REVIEWED_INVENTORIES);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('; '), pattern);
};

assert.equal(sha256(bytes), INVENTORY_REVIEW_RECEIPT_SHA256);
assert.equal(sha256(JSON.stringify(INVENTORY_REVIEW_RECEIPT)),
  INVENTORY_REVIEW_RECEIPT_CANONICAL_SHA256);
assert.equal(INVENTORY_REVIEW_RECEIPT.code.reconstruction_commit,
  RECONSTRUCTION_REVIEWED_COMMIT);
assert.equal(INVENTORY_REVIEW_RECEIPT.code.review_commit, INDEPENDENT_REVIEWED_COMMIT);
assert.deepEqual(validateInventoryReviewReceipt(
  INVENTORY_REVIEW_RECEIPT, REVIEWED_INVENTORIES,
), { valid: true, errors: [] });
assert.deepEqual(parseInventoryReviewReceiptBytes(bytes, REVIEWED_INVENTORIES),
  INVENTORY_REVIEW_RECEIPT);
assert.equal(Object.isFrozen(INVENTORY_REVIEW_RECEIPT), true);
assert.equal(Object.isFrozen(INVENTORY_REVIEW_RECEIPT.runs.review_a.reports), true);
assert.equal(Object.isFrozen(INVENTORY_REVIEW_RECEIPT.tiers.medium.inventory), true);
assert.equal(Object.isFrozen(INVENTORY_REVIEW_RECEIPT.tiers.medium.link_evidence.normalized_records), true);
assert.doesNotMatch(bytes.toString('utf8'), /\/tmp\/|\/home\/|lamina-safe-runner-/);

assert.deepEqual(Object.keys(INVENTORY_REVIEW_RECEIPT.tiers), ['small', 'medium', 'large']);
for (const tier of ['small', 'medium', 'large']) {
  const evidence = INVENTORY_REVIEW_RECEIPT.tiers[tier];
  assert.deepEqual(evidence.inventory, REVIEWED_INVENTORIES[tier]);
  assert.equal(evidence.equality, 'triple_match');
  assert.equal(evidence.signoff, 'reviewer_approved');
  assert.match(evidence.inventory_sha256, /^[a-f0-9]{64}$/);
  assert.match(evidence.link_evidence.reconstruction_sha256, /^[a-f0-9]{64}$/);
  assert.match(evidence.link_evidence.review_sha256, /^[a-f0-9]{64}$/);
}

rejected((receipt) => { receipt.decision = 'automatic_freeze'; }, /manual-freeze decision/);
rejected((receipt) => { receipt.extra = true; }, /receipt root/);
rejected((receipt) => { receipt.code.review_commit = '0'.repeat(40); }, /code identities/);
rejected((receipt) => {
  receipt.authority.candidate_policy_sha256 = '0'.repeat(64);
}, /manifest or candidate policy/);
rejected((receipt) => { receipt.tiers.medium.pin.commit = '0'.repeat(40); }, /immutable pin/);
rejected((receipt) => { receipt.tiers.medium.inventory.tracked_files += 1; },
  /hardcoded reviewed authority/);
rejected((receipt) => { receipt.tiers.medium.inventory_sha256 = '0'.repeat(64); },
  /inventory_sha256 is not canonical/);
rejected((receipt) => {
  receipt.runs.review_b.reports.medium.stdout_tail_sha256_including_newline = '0'.repeat(64);
}, /A\/B medium payload hashes differ/);
rejected((receipt) => {
  receipt.runs.review_a.reports.large.report_sha256 =
    receipt.runs.review_b.reports.large.report_sha256;
}, /raw reports are not distinct/);
rejected((receipt) => {
  receipt.tiers.medium.link_evidence.normalized_records[0].contribution.tracked_bytes += 1;
}, /file target identity contradicts/);
rejected((receipt) => {
  receipt.runs.reconstruction.repository_source_sha256 = '/tmp/ephemeral-source';
}, /ephemeral machine-local path/);

const changedAuthority = structuredClone(REVIEWED_INVENTORIES);
changedAuthority.large.tracked_bytes += 1;
const authorityValidation = validateInventoryReviewReceipt(
  INVENTORY_REVIEW_RECEIPT, changedAuthority,
);
assert.equal(authorityValidation.valid, false);
assert.match(authorityValidation.errors.join('; '), /hardcoded reviewed authority/);

const tamperedBytes = Buffer.from(bytes);
tamperedBytes[tamperedBytes.indexOf(Buffer.from('reviewer_approved_manual_freeze'))] ^= 1;
assert.throws(() => parseInventoryReviewReceiptBytes(tamperedBytes, REVIEWED_INVENTORIES),
  /bytes do not match the manually reviewed identity/);

console.log('real repository oracle inventory review receipt test passed');
