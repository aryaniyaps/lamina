import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  BASELINE_MANIFEST_SHA256, CANDIDATE_POLICY_SHA256, COLLECTION_PINS,
} from './collection-pins.mjs';
import {
  EVIDENCE_SELECTION_CANONICAL_SHA256, EVIDENCE_SELECTION_RAW_SHA256,
} from './reviewed-selection-identities.mjs';
export {
  EVIDENCE_SELECTION_CANONICAL_SHA256, EVIDENCE_SELECTION_RAW_SHA256,
} from './reviewed-selection-identities.mjs';
import { assertSafeRunnerContext } from '../../packages/cli/lib/safe-runner-context.mjs';
import { REVIEWED_INVENTORIES } from './collection-authority.mjs';
import {
  EVIDENCE_EXPANSION_LIMITS, candidateInventoryDigest, evidenceAnchorIdentity,
  readReviewedEvidenceAnchors, safeEvidencePath, withSignedReviewedRepository,
} from './materialize.mjs';
export { EVIDENCE_EXPANSION_LIMITS } from './materialize.mjs';

const SELECTION_FILE = new URL('./reviews/evidence-selection-v1.json', import.meta.url);
const MODULE_FILE = new URL('./case-evidence.mjs', import.meta.url);
const BLOB = /^[a-f0-9]{40}$/;
const TIERS = Object.freeze(['small', 'medium', 'large']);
const MAX_SELECTION_BYTES = 64 * 1024;
const MAX_SELECTION_PATH_BYTES = 32 * 1024;
const EVIDENCE_ROLES = new Set(['positive', 'negative', 'scenario_before']);
const EVIDENCE_METHODS = new Set([
  'sealed_git_blob_exact_identifier', 'sealed_git_blob_line_context', 'sealed_git_blob_absence',
]);
const NO_QUALITY_CLAIMS = Object.freeze({
  workflow_selection: false, observation: false, obligations: false,
  source_localization: false, retrieval_ranking: false, end_to_end_runtime: false,
});
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonicalDigest = (value) => sha256(JSON.stringify(canonical(value)));

export const EVIDENCE_EXPANSION_SCHEMA = 'lamina.real-repository-oracle-evidence-expansion/v1';
export const EVIDENCE_EXPANSION_PAYLOAD_PREFIX = 'LAMINA_REAL_REPOSITORY_EVIDENCE_EXPANSION_V1=';
export const EVIDENCE_EXPANSION_MAX_PAYLOAD_LINE_BYTES = 7_680;
export const EVIDENCE_EXPANSION_WORKLOAD_ID = 'real-repository-oracle-v1:evidence-expansion';

export function validateEvidenceSelection(selection) {
  const errors = [];
  if (!exactKeys(selection, ['schema', 'purpose', 'authority', 'tiers'])
    || selection.schema !== 'lamina.real-repository-oracle-evidence-selection/v1') {
    return { valid: false, errors: ['selection root is not the exact evidence-selection schema'] };
  }
  if (selection.purpose !== 'pending_authoring_selection_only_not_grade_or_expectation_authority') {
    errors.push('selection purpose must deny grade and expectation authority');
  }
  if (!exactKeys(selection.authority, ['baseline_manifest_sha256', 'candidate_policy_sha256'])
    || selection.authority.baseline_manifest_sha256 !== BASELINE_MANIFEST_SHA256
    || selection.authority.candidate_policy_sha256 !== CANDIDATE_POLICY_SHA256) {
    errors.push('selection authority differs from the reviewed manifest or candidate policy');
  }
  if (!exactKeys(selection.tiers, TIERS)) {
    errors.push('selection must exactly cover all three reviewed pins');
    return { valid: false, errors };
  }
  for (const tier of TIERS) {
    const item = selection.tiers[tier];
    const pin = COLLECTION_PINS[tier];
    if (!exactKeys(item, ['status', 'pin', 'reviewed_inventory_sha256', 'anchors'])
      || !['reviewer_selection_pending', 'reviewer_selected'].includes(item.status)
      || !exactKeys(item.pin, ['repository_url', 'commit', 'tree_oid'])
      || JSON.stringify(item.pin) !== JSON.stringify({
        repository_url: pin.repository_url, commit: pin.commit, tree_oid: pin.tree_oid,
      })
      || item.reviewed_inventory_sha256 !== candidateInventoryDigest(REVIEWED_INVENTORIES[tier])
      || !Array.isArray(item.anchors)) {
      errors.push(`${tier} selection does not bind the exact pin and reviewed inventory`);
      continue;
    }
    if ((item.status === 'reviewer_selection_pending' && item.anchors.length !== 0)
      || (item.status === 'reviewer_selected'
        && (item.anchors.length < 1 || item.anchors.length > EVIDENCE_EXPANSION_LIMITS.max_anchors))) {
      errors.push(`${tier} selection status contradicts its bounded anchor set`);
    }
    const identities = new Set();
    let totalPathBytes = 0;
    for (const [index, anchor] of item.anchors.entries()) {
      totalPathBytes += Buffer.byteLength(String(anchor?.path || ''));
      if (!exactKeys(anchor, ['path', 'blob_oid', 'symbol', 'line', 'role', 'independent_method'])
        || !safeEvidencePath(anchor.path) || !BLOB.test(anchor.blob_oid || '')
        || !EVIDENCE_ROLES.has(anchor.role) || !EVIDENCE_METHODS.has(anchor.independent_method)
        || !(anchor.symbol === null || (typeof anchor.symbol === 'string'
          && /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(anchor.symbol)))
        || !(anchor.line === null || (Number.isSafeInteger(anchor.line)
          && anchor.line >= 1 && anchor.line <= 1_000_000))) {
        errors.push(`${tier} anchor ${index} is malformed or unsafe`);
        continue;
      }
      if ((anchor.independent_method === 'sealed_git_blob_exact_identifier'
          && (anchor.symbol === null || anchor.line === null))
        || (anchor.independent_method === 'sealed_git_blob_absence'
          && (anchor.symbol === null || anchor.line !== null))
        || (anchor.independent_method === 'sealed_git_blob_line_context' && anchor.line === null)) {
        errors.push(`${tier} anchor ${index} contradicts its requested evidence method`);
      }
      const identity = evidenceAnchorIdentity(anchor);
      if (identities.has(identity)) errors.push(`${tier} anchor ${index} is duplicated`);
      identities.add(identity);
    }
    if (totalPathBytes > MAX_SELECTION_PATH_BYTES) errors.push(`${tier} anchor paths exceed the fixed byte bound`);
  }
  return { valid: errors.length === 0, errors };
}

export function parseEvidenceSelectionBytes(bytes, { requireReviewedBytes = true } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_SELECTION_BYTES
    || (requireReviewedBytes && sha256(bytes) !== EVIDENCE_SELECTION_RAW_SHA256)) {
    throw new Error('evidence selection bytes do not match the reviewed source identity');
  }
  let selection;
  try { selection = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('evidence selection is not UTF-8 JSON'); }
  const validation = validateEvidenceSelection(selection);
  if (!validation.valid) throw new Error(`evidence selection is invalid: ${validation.errors.join('; ')}`);
  if (requireReviewedBytes && canonicalDigest(selection) !== EVIDENCE_SELECTION_CANONICAL_SHA256) {
    throw new Error('evidence selection semantic content differs from the reviewed source identity');
  }
  return Object.freeze({
    selection,
    raw_sha256: sha256(bytes),
    canonical_sha256: canonicalDigest(selection),
  });
}

export function loadEvidenceSelection() {
  return parseEvidenceSelectionBytes(fs.readFileSync(SELECTION_FILE));
}

function exactSymbolEvidence(text, symbol, targetLine) {
  if (symbol === null) return { count: 0, lines: [], target_line_present: null };
  let count = 0;
  const lines = [];
  let targetLinePresent = false;
  let cursor = 0;
  let lineCursor = 0;
  let line = 1;
  while (cursor <= text.length - symbol.length) {
    const found = text.indexOf(symbol, cursor);
    if (found < 0) break;
    while (lineCursor < found) {
      if (text.charCodeAt(lineCursor) === 10) line += 1;
      lineCursor += 1;
    }
    const before = found === 0 ? '' : text[found - 1];
    const after = found + symbol.length === text.length ? '' : text[found + symbol.length];
    if (!/[A-Za-z0-9_$]/.test(before) && !/[A-Za-z0-9_$]/.test(after)) {
      count += 1;
      if (lines.length < 32 && lines.at(-1) !== line) lines.push(line);
      if (line === targetLine) targetLinePresent = true;
    }
    cursor = found + symbol.length;
  }
  return { count, lines, target_line_present: targetLinePresent };
}

function expandRecord(value) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(value.bytes); }
  catch { throw new Error(`selected evidence blob is not UTF-8: ${value.anchor.path}`); }
  const lines = text.split(/\r?\n/);
  if (value.anchor.role === 'scenario_after') {
    throw new Error('scenario_after requires later post-mutation evidence expansion');
  }
  if (!['positive', 'negative', 'scenario_before'].includes(value.anchor.role)) {
    throw new Error('evidence role is outside the pre-scenario expansion contract');
  }
  const method = value.anchor.independent_method;
  if (!EVIDENCE_METHODS.has(method)) throw new Error('requested evidence method is not supported');
  const matches = exactSymbolEvidence(text, value.anchor.symbol, value.anchor.line || 1);
  if (method === 'sealed_git_blob_exact_identifier'
    && (value.anchor.symbol === null || value.anchor.line === null
      || matches.target_line_present !== true)) {
    throw new Error('exact_identifier evidence is absent from the declared line');
  }
  if (method === 'sealed_git_blob_absence'
    && (value.anchor.symbol === null || value.anchor.line !== null || matches.count !== 0)) {
    throw new Error('absence evidence contradicts exact identifier matches');
  }
  if (method === 'sealed_git_blob_line_context' && value.anchor.line === null) {
    throw new Error('line_context evidence requires a declared line');
  }
  const selectedLine = value.anchor.line || matches.lines[0] || 1;
  if (selectedLine > lines.length) throw new Error(`selected evidence line is absent: ${value.anchor.path}:${selectedLine}`);
  const lineText = lines[selectedLine - 1];
  const contextText = lines.slice(Math.max(0, selectedLine - 2), Math.min(lines.length, selectedLine + 1)).join('\n');
  const lineSymbolPresent = value.anchor.symbol === null
    ? null : matches.target_line_present;
  const verifiedMethod = method === 'sealed_git_blob_exact_identifier'
    ? 'exact_identifier_present_at_declared_line'
    : method === 'sealed_git_blob_absence' ? 'exact_identifier_absent_from_blob'
      : 'declared_line_context_present';
  return Object.freeze({
    path: value.anchor.path,
    blob_oid: value.anchor.blob_oid,
    content_sha256: sha256(value.bytes),
    byte_length: value.bytes.length,
    symbol: value.anchor.symbol,
    line: value.anchor.line,
    selected_line: selectedLine,
    line_text: lineText.slice(0, 240),
    line_sha256: sha256(lineText),
    context_text: contextText.slice(0, 480),
    context_sha256: sha256(contextText),
    symbol_match_count: matches.count,
    symbol_match_lines: matches.lines,
    line_symbol_present: lineSymbolPresent,
    requested_role: value.anchor.role,
    requested_method: method,
    verified_method: verifiedMethod,
    absence_sha256: method === 'sealed_git_blob_absence' && matches.count === 0
      ? canonicalDigest({ path: value.anchor.path, blob_oid: value.anchor.blob_oid,
        symbol: value.anchor.symbol, content_sha256: sha256(value.bytes) }) : null,
  });
}

export function expandSelectedEvidence(
  repository, collection, tierSelection, selectionIdentity,
  evidenceReader = readReviewedEvidenceAnchors,
) {
  if (tierSelection.status !== 'reviewer_selected') {
    throw new Error(`reviewer evidence selection is pending for ${collection.fixture_id}`);
  }
  if (tierSelection.reviewed_inventory_sha256 !== candidateInventoryDigest(collection.reviewed_inventory)) {
    throw new Error('reviewer evidence selection inventory identity drifted');
  }
  if (typeof evidenceReader !== 'function') throw new Error('evidence expansion requires a bounded evidence reader');
  const records = evidenceReader(repository, collection, tierSelection.anchors)
    .map(expandRecord);
  const sourceSha256 = sha256(fs.readFileSync(MODULE_FILE));
  const workloadSha256 = canonicalDigest({
    workload_id: EVIDENCE_EXPANSION_WORKLOAD_ID,
    source_sha256: sourceSha256,
    selection_raw_sha256: selectionIdentity.raw_sha256,
    selection_canonical_sha256: selectionIdentity.canonical_sha256,
    tier_selection_sha256: canonicalDigest(tierSelection),
  });
  return Object.freeze({
    schema: EVIDENCE_EXPANSION_SCHEMA,
    workload_id: EVIDENCE_EXPANSION_WORKLOAD_ID,
    status: 'reviewer_selected_evidence_expanded',
    collection: Object.freeze({
      fixture_id: collection.fixture_id, repository_url: collection.repository_url,
      commit: collection.commit, tree_oid: collection.tree_oid,
    }),
    reviewed_inventory_sha256: candidateInventoryDigest(collection.reviewed_inventory),
    selection_raw_sha256: selectionIdentity.raw_sha256,
    selection_canonical_sha256: selectionIdentity.canonical_sha256,
    tier_selection_sha256: canonicalDigest(tierSelection),
    source_sha256: sourceSha256,
    workload_sha256: workloadSha256,
    bounds: EVIDENCE_EXPANSION_LIMITS,
    records,
    records_sha256: canonicalDigest(records),
    expectations_loaded: false,
    grade_controller_evidence: false,
    quality_claims: NO_QUALITY_CLAIMS,
    limitation: 'This expansion verifies reviewer-selected Git blob, line, context, and exact identifier evidence only. Presence and absence are lexical facts, not Workflow, domain, retrieval, golden, or quality claims.',
  });
}

export function encodeEvidenceExpansionPayload(result) {
  const compressed = zlib.brotliCompressSync(Buffer.from(JSON.stringify(result)), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const line = `${EVIDENCE_EXPANSION_PAYLOAD_PREFIX}${compressed.toString('base64url')}`;
  if (Buffer.byteLength(line) > EVIDENCE_EXPANSION_MAX_PAYLOAD_LINE_BYTES) {
    throw new Error('complete evidence expansion exceeds the retained report-tail bound');
  }
  return line;
}

export function expandSignedTier() {
  const loaded = loadEvidenceSelection();
  const tier = assertSafeRunnerContext('real-repository evidence expansion').tier;
  const tierSelection = loaded.selection.tiers[tier];
  if (!tierSelection || tierSelection.status !== 'reviewer_selected') {
    throw new Error(`reviewer evidence selection is pending for ${tier || 'unknown tier'}`);
  }
  return withSignedReviewedRepository(
    'real-repository evidence expansion',
    ({ repository, collection }) => expandSelectedEvidence(repository, collection, tierSelection, loaded),
  );
}
