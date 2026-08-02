import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  BASELINE_MANIFEST_SHA256, CANDIDATE_POLICY_SHA256, COLLECTION_PINS,
} from './collection-pins.mjs';

const RECEIPT_FILE = new URL('./reviews/inventory-v1.json', import.meta.url);
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const TIERS = Object.freeze(['small', 'medium', 'large']);
const INVENTORY_KEYS = Object.freeze([
  'tracked_files', 'tracked_bytes', 'tracked_source_files', 'tracked_source_bytes',
  'tracked_source_loc', 'observation_indexed_files', 'observation_indexed_bytes',
  'observation_paths_digest', 'retrieval_candidate_files', 'retrieval_candidate_bytes',
  'retrieval_paths_digest',
]);
const REPORT_KEYS = Object.freeze([
  'report_sha256', 'stdout_tail_sha256_including_newline', 'outcome', 'cleanup_verified',
]);
const COMMON_RUN_KEYS = Object.freeze([
  'repository_source_sha256', 'runner_build_sha256', 'source_identity_sha256',
  'execution_snapshot_sha256', 'execution_identity_sha256', 'reports',
]);
const REVIEW_RUN_KEYS = Object.freeze([
  ...COMMON_RUN_KEYS, 'attestation_sha256', 'promotion_sha256',
]);
const ALIAS_KEYS = Object.freeze([
  'path', 'link_oid', 'link_target_text', 'link_byte_length', 'traversal_hops',
  'traversal_limit', 'outcome', 'skip_reason', 'target_kind', 'target_path',
  'target_oid', 'target_size', 'contribution',
]);
const CONTRIBUTION_KEYS = Object.freeze([
  'tracked_bytes', 'observation_included', 'observation_bytes', 'retrieval_included',
  'retrieval_bytes', 'source_included', 'source_bytes', 'source_loc',
]);

export const INVENTORY_REVIEW_RECEIPT_SHA256 = 'f49bda9037a02e7c64ee42aebbee09847a265158ba03f4b9d1f34951f63658c6';
export const INVENTORY_REVIEW_RECEIPT_CANONICAL_SHA256 = '6a9e551fd1563023d0aeb5ee3f21a3f0ef8c0bd8ad4f38bab462e439e89d5761';
export const RECONSTRUCTION_REVIEWED_COMMIT = '053f430667c21ea6453174ee1f289b9dea08ddb7';
export const INDEPENDENT_REVIEWED_COMMIT = 'beffb5b59628b4699e2599ac59e476e2e3733bd7';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const canonicalInventorySha256 = (inventory) => crypto.createHash('sha256').update(JSON.stringify(
  Object.fromEntries(Object.keys(inventory).sort().map((key) => [key, inventory[key]])),
)).digest('hex');

function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function safeRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
    && !value.includes('\\') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value)
    && value.split('/').every((piece) => piece && piece !== '.' && piece !== '..');
}

function validateReportSet(reports, at, errors) {
  if (!exactKeys(reports, TIERS)) {
    errors.push(`${at} must exactly cover small, medium, and large`);
    return;
  }
  for (const tier of TIERS) {
    const report = reports[tier];
    if (!exactKeys(report, REPORT_KEYS) || !SHA256.test(report.report_sha256 || '')
      || !SHA256.test(report.stdout_tail_sha256_including_newline || '')
      || report.outcome !== 'success' || report.cleanup_verified !== true) {
      errors.push(`${at}.${tier} is not a complete successful cleaned report identity`);
    }
  }
}

function validateRun(run, at, review, errors) {
  if (!exactKeys(run, review ? REVIEW_RUN_KEYS : COMMON_RUN_KEYS)) {
    errors.push(`${at} has unexpected or missing run identity fields`);
    return;
  }
  for (const key of COMMON_RUN_KEYS.filter((candidate) => candidate !== 'reports')) {
    if (!SHA256.test(run[key] || '')) errors.push(`${at}.${key} is not SHA-256`);
  }
  if (review && (!SHA256.test(run.attestation_sha256 || '')
    || !SHA256.test(run.promotion_sha256 || ''))) {
    errors.push(`${at} lacks exact attestation or promotion artifact hashes`);
  }
  validateReportSet(run.reports, `${at}.reports`, errors);
}

function validateAlias(record, at, errors) {
  if (!exactKeys(record, ALIAS_KEYS) || !exactKeys(record?.contribution, CONTRIBUTION_KEYS)
    || !safeRelativePath(record?.path) || !COMMIT.test(record?.link_oid || '')
    || typeof record.link_target_text !== 'string' || record.link_target_text.length === 0
    || !Number.isSafeInteger(record.link_byte_length) || record.link_byte_length <= 0
    || !Number.isSafeInteger(record.traversal_hops) || record.traversal_hops <= 0
    || record.traversal_limit !== 40 || !['file', 'directory'].includes(record.outcome)
    || record.skip_reason !== null || record.target_kind !== record.outcome
    || !safeRelativePath(record.target_path)) {
    errors.push(`${at} is not a complete normalized successful alias record`);
    return;
  }
  const contribution = record.contribution;
  for (const key of ['tracked_bytes', 'observation_bytes', 'retrieval_bytes', 'source_bytes', 'source_loc']) {
    if (!Number.isSafeInteger(contribution[key]) || contribution[key] < 0) {
      errors.push(`${at}.contribution.${key} is not a non-negative integer`);
    }
  }
  for (const key of ['observation_included', 'retrieval_included', 'source_included']) {
    if (typeof contribution[key] !== 'boolean') errors.push(`${at}.contribution.${key} is not boolean`);
  }
  if (record.target_kind === 'file') {
    if (!COMMIT.test(record.target_oid || '') || !Number.isSafeInteger(record.target_size)
      || record.target_size < 0 || contribution.tracked_bytes !== record.target_size) {
      errors.push(`${at} file target identity contradicts its contribution`);
    }
  } else if (record.target_oid !== null || record.target_size !== null
    || Object.values(contribution).some((value) => value !== false && value !== 0)) {
    errors.push(`${at} directory alias must have a zero inventory contribution`);
  }
}

export function validateInventoryReviewReceipt(receipt, reviewedInventories) {
  const errors = [];
  if (!exactKeys(receipt, ['schema', 'decision', 'equality', 'code', 'authority', 'runs', 'tiers'])) {
    return { valid: false, errors: ['receipt root has unexpected or missing fields'] };
  }
  if (receipt.schema !== 'lamina.real-repository-oracle-inventory-review-receipt/v1'
    || receipt.decision !== 'reviewer_approved_manual_freeze'
    || receipt.equality !== 'reconstruction_equals_review_a_equals_review_b') {
    errors.push('receipt is not an explicit triple-equality manual-freeze decision');
  }
  if (!exactKeys(receipt.code, ['reconstruction_commit', 'review_commit'])
    || receipt.code.reconstruction_commit !== RECONSTRUCTION_REVIEWED_COMMIT
    || receipt.code.review_commit !== INDEPENDENT_REVIEWED_COMMIT) {
    errors.push('receipt code identities do not match the audited reconstruction and review commits');
  }
  if (!exactKeys(receipt.authority, ['baseline_manifest_sha256', 'candidate_policy_sha256'])
    || receipt.authority.baseline_manifest_sha256 !== BASELINE_MANIFEST_SHA256
    || receipt.authority.candidate_policy_sha256 !== CANDIDATE_POLICY_SHA256) {
    errors.push('receipt manifest or candidate policy does not match live pin authority');
  }
  if (!exactKeys(receipt.runs, ['reconstruction', 'review_a', 'review_b'])) {
    errors.push('receipt must contain exactly reconstruction and independent review A/B runs');
  } else {
    validateRun(receipt.runs.reconstruction, 'receipt.runs.reconstruction', false, errors);
    validateRun(receipt.runs.review_a, 'receipt.runs.review_a', true, errors);
    validateRun(receipt.runs.review_b, 'receipt.runs.review_b', true, errors);
    for (const key of COMMON_RUN_KEYS.filter((candidate) => candidate !== 'reports')) {
      if (receipt.runs.review_a[key] !== receipt.runs.review_b[key]) {
        errors.push(`independent review A/B ${key} identities differ`);
      }
    }
    for (const tier of TIERS) {
      if (receipt.runs.review_a.reports?.[tier]?.stdout_tail_sha256_including_newline
        !== receipt.runs.review_b.reports?.[tier]?.stdout_tail_sha256_including_newline) {
        errors.push(`independent review A/B ${tier} payload hashes differ`);
      }
      if (receipt.runs.review_a.reports?.[tier]?.report_sha256
        === receipt.runs.review_b.reports?.[tier]?.report_sha256) {
        errors.push(`independent review A/B ${tier} raw reports are not distinct`);
      }
    }
  }
  if (!exactKeys(receipt.tiers, TIERS) || !exactKeys(reviewedInventories, TIERS)) {
    errors.push('receipt and reviewed inventory authority must exactly cover all tiers');
  } else for (const tier of TIERS) {
    const item = receipt.tiers[tier];
    const pin = COLLECTION_PINS[tier];
    if (!exactKeys(item, ['pin', 'inventory', 'inventory_sha256', 'link_evidence', 'equality', 'signoff'])
      || item.equality !== 'triple_match' || item.signoff !== 'reviewer_approved') {
      errors.push(`receipt.tiers.${tier} lacks explicit triple-match reviewer signoff`);
      continue;
    }
    if (!exactKeys(item.pin, ['repository_url', 'commit', 'tree_oid'])
      || !same(item.pin, {
        repository_url: pin.repository_url, commit: pin.commit, tree_oid: pin.tree_oid,
      })) errors.push(`receipt.tiers.${tier}.pin differs from live immutable pin authority`);
    if (!exactKeys(item.inventory, INVENTORY_KEYS)
      || INVENTORY_KEYS.slice(0, 7).concat(INVENTORY_KEYS.slice(8, 10))
        .some((key) => !Number.isSafeInteger(item.inventory[key]) || item.inventory[key] < 0)
      || !SHA256.test(item.inventory.observation_paths_digest || '')
      || !SHA256.test(item.inventory.retrieval_paths_digest || '')) {
      errors.push(`receipt.tiers.${tier}.inventory is not an exact all-11 inventory`);
    }
    if (!same(item.inventory, reviewedInventories[tier])) {
      errors.push(`receipt.tiers.${tier}.inventory differs from hardcoded reviewed authority`);
    }
    if (item.inventory_sha256 !== canonicalInventorySha256(item.inventory)) {
      errors.push(`receipt.tiers.${tier}.inventory_sha256 is not canonical`);
    }
    const link = item.link_evidence;
    if (!exactKeys(link, ['reconstruction_sha256', 'review_sha256', 'normalized_records'])
      || !SHA256.test(link.reconstruction_sha256 || '') || !SHA256.test(link.review_sha256 || '')
      || !Array.isArray(link.normalized_records)) {
      errors.push(`receipt.tiers.${tier}.link_evidence is incomplete`);
    } else {
      link.normalized_records.forEach((record, index) =>
        validateAlias(record, `receipt.tiers.${tier}.link_evidence.normalized_records[${index}]`, errors));
      if (link.normalized_records.length !== (tier === 'small' ? 0 : 1)) {
        errors.push(`receipt.tiers.${tier} has an unexpected normalized alias count`);
      }
    }
  }
  const encoded = JSON.stringify(receipt);
  if (crypto.createHash('sha256').update(encoded).digest('hex')
    !== INVENTORY_REVIEW_RECEIPT_CANONICAL_SHA256) {
    errors.push('receipt semantic content differs from the manually reviewed identity');
  }
  if (encoded.includes('/tmp/') || encoded.includes('/home/') || encoded.includes('lamina-safe-runner-')) {
    errors.push('receipt contains an ephemeral machine-local path');
  }
  return { valid: errors.length === 0, errors };
}

export function parseInventoryReviewReceiptBytes(bytes, reviewedInventories) {
  if (!Buffer.isBuffer(bytes) || crypto.createHash('sha256').update(bytes).digest('hex')
    !== INVENTORY_REVIEW_RECEIPT_SHA256) {
    throw new Error('inventory review receipt bytes do not match the manually reviewed identity');
  }
  let receipt;
  try {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('noncanonical UTF-8');
    receipt = JSON.parse(text);
  } catch {
    throw new Error('inventory review receipt is not canonical UTF-8 JSON');
  }
  const validation = validateInventoryReviewReceipt(receipt, reviewedInventories);
  if (!validation.valid) {
    throw new Error(`inventory review receipt is invalid: ${validation.errors.join('; ')}`);
  }
  return deepFreeze(receipt);
}

export function loadInventoryReviewReceipt(reviewedInventories) {
  return parseInventoryReviewReceiptBytes(fs.readFileSync(RECEIPT_FILE), reviewedInventories);
}
