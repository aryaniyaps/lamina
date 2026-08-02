import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  BASELINE_MANIFEST_SHA256, CANDIDATE_POLICY_SHA256, COLLECTION_PINS,
} from './collection-pins.mjs';
import { REVIEWED_INVENTORIES } from './collection-authority.mjs';
import { candidateInventoryDigest } from './materialize.mjs';
import {
  EVIDENCE_SELECTION_CANONICAL_SHA256, EVIDENCE_SELECTION_RAW_SHA256,
} from './case-evidence.mjs';

const SELECTION_FILE = new URL('./reviews/scenario-selection-v1.json', import.meta.url);
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const HEX12 = /^[a-f0-9]{12}$/;
const TIERS = Object.freeze(['small', 'medium', 'large']);
const KINDS = Object.freeze(['clean', 'modify', 'rename', 'delete', 'branch', 'logical_worktree']);
const MAX_SELECTION_BYTES = 128 * 1024;
const MAX_PATH_BYTES = 4 * 1024;
const MAX_APPEND_BYTES = 64;
const PURPOSE = 'reviewer_selected_selection_only_no_execution_fixture_expectation_grade_or_quality_authority';
const STATUS = 'reviewer_selected';
const EXPECTED_PROVENANCE = Object.freeze({
  small: Object.freeze({ modify: ['delete', 0], rename: ['rename', 0], delete: ['delete', 1],
    branch: ['branch', 0], logical_worktree: ['logical_worktree', 0] }),
  medium: Object.freeze({ modify: ['delete', 0], rename: ['rename', 1], delete: ['delete', 1],
    branch: ['branch', 0], logical_worktree: ['logical_worktree', 0] }),
  large: Object.freeze({ modify: ['modify', 0], rename: ['rename', 0], delete: ['delete', 0],
    branch: ['branch', 0], logical_worktree: ['logical_worktree', 0] }),
});
const FORBIDDEN_AUTHORITY_KEYS = new Set([
  'argv', 'env', 'environment', 'expected', 'expectation', 'git_argv', 'gold', 'golden',
  'grade', 'grader', 'lease', 'operation', 'operations', 'physical_path', 'quality', 'request',
  'scenario_after',
]);
const RESERVED_WINDOWS_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const SCENARIO_SELECTION_RAW_SHA256 = 'f04cce5a644807dc6804ff6bc020a6daca1972ec5a2631434105e260066bcf03';
export const SCENARIO_SELECTION_CANONICAL_SHA256 = '57ee96a80f0b12e33f8614577cada1c21a84b02d41216ea7741acfd2017f15b1';
export const SCENARIO_SELECTION_STATUS = STATUS;
export const SCENARIO_SELECTION_KINDS = KINDS;
export const AUDITED_DISCOVERY_IDENTITIES = Object.freeze({
  small: Object.freeze({
    report_sha256: '995eaae757b8922d5a9d24d2e7a674956b5ab1a84740b0904578a055d38b2b7e',
    semantic_sha256: '7e2977cd7a2dcb8b027c04a82d5e5ac91ffd0812fd7457ca4c0eab42da981683',
    index_sha256: '89fe791a8389485feace8cb89958e12d967b6dc8d82b922c62b4abce403d0876',
  }),
  medium: Object.freeze({
    report_sha256: '10c0be4eef9eab4e7313ea186245200f7c71477e7b23c807f5df7def6222a70d',
    semantic_sha256: '21353264c7874121d57a88a72d95ad2761c49a4453f8feaff70ccf04bad449b5',
    index_sha256: '725bf790d9b0b9d3ff7592c79e4d739636910cb5a52ceacd67a0f88c3095bce2',
  }),
  large: Object.freeze({
    report_sha256: '31f5aafc6e58fff76bbf6590c4a88fa7d9b7e88702e4c79694422b45484795de',
    semantic_sha256: 'd2805fee3f92fa756a60dcda81a502fbba788d46d3f4bdca2ef1b35e9e122520',
    index_sha256: 'b8024a8eb044b9778c467e30ae6265f87cbf13c3b4455d365cd37c21bd50c97e',
  }),
});

export function scenarioSelectionCanonicalDigest(value) {
  return sha256(JSON.stringify(canonical(value)));
}

export function scenarioSelectionIdentity(tier, scenario) {
  const semantic = Object.fromEntries(Object.entries(scenario)
    .filter(([key]) => key !== 'identity_sha256'));
  return scenarioSelectionCanonicalDigest({ tier, order: scenario.order, scenario: semantic });
}

function portablePath(value) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > MAX_PATH_BYTES
    || value.normalize('NFC') !== value || value.normalize('NFKC') !== value
    || /[\u0000-\u001f\u007f<>:"|?*]/.test(value) || value.includes('\\')
    || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((segment) => {
    const folded = segment.normalize('NFKC').toLocaleLowerCase('en-US');
    return segment.length > 0 && segment !== '.' && segment !== '..'
      && !/[. ]$/.test(segment) && !RESERVED_WINDOWS_NAMES.test(segment)
      && folded !== '.git' && !/^\.?git~[1-9][0-9]*$/.test(folded);
  });
}

function portablePathKey(value) {
  return value.split('/').map((segment) => segment.normalize('NFKC')
    .toLocaleLowerCase('en-US')).join('/');
}

function safeBranch(value, kind, pairId) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 240
    || value.normalize('NFC') !== value || value.normalize('NFKC') !== value
    || /[\u0000-\u0020\u007f~^:?*[\\]/.test(value) || value.includes('..')
    || value.includes('@{') || value.includes('//') || value.startsWith('/')
    || value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock') || value === '@') return false;
  const expected = kind === 'branch'
    ? `lamina-oracle/${pairId}` : `lamina-oracle/worktree-${pairId}`;
  return HEX12.test(pairId || '') && value === expected;
}

function authorityLeak(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(authorityLeak);
  return Object.entries(value).some(([key, child]) =>
    FORBIDDEN_AUTHORITY_KEYS.has(key.toLocaleLowerCase('en-US')) || authorityLeak(child));
}

function exactPin(pin, expected) {
  return exactKeys(pin, ['repository_url', 'commit', 'tree_oid'])
    && pin.repository_url === expected.repository_url && pin.commit === expected.commit
    && pin.tree_oid === expected.tree_oid;
}

function validateAbsence(value) {
  return exactKeys(value, [
    'basis', 'tracked_path_count', 'tracked_paths_sha256', 'occupied_destination_count',
    'occupied_destinations_sha256', 'portable_root_included', 'absent',
  ]) && value.basis === 'complete_stage0_git_paths_and_implied_directories'
    && Number.isSafeInteger(value.tracked_path_count) && value.tracked_path_count > 0
    && SHA256.test(value.tracked_paths_sha256 || '')
    && Number.isSafeInteger(value.occupied_destination_count)
    && value.occupied_destination_count >= value.tracked_path_count
    && SHA256.test(value.occupied_destinations_sha256 || '')
    && value.portable_root_included === true && value.absent === true;
}

function commonFileFields(value) {
  return portablePath(value.path) && SHA1.test(value.blob_oid || '')
    && SHA256.test(value.original_content_sha256 || '');
}

function exactProvenance(value) {
  return ['modify', 'rename', 'delete', 'branch', 'logical_worktree']
    .includes(value.discovery_operation_kind)
    && Number.isSafeInteger(value.discovery_index) && value.discovery_index >= 0
    && value.discovery_index <= 2 && value.authored_operation_kind === value.kind;
}

function scenarioShape(value) {
  switch (value?.kind) {
    case 'clean':
      return exactKeys(value, ['order', 'identity_sha256', 'kind', 'source_commit'])
        && SHA1.test(value.source_commit || '');
    case 'modify':
      return exactKeys(value, ['order', 'identity_sha256', 'kind', 'path', 'blob_oid',
        'original_content_sha256', 'append_utf8', 'append_bytes', 'result_bytes',
        'result_content_sha256', 'discovery_operation_kind', 'discovery_index',
        'authored_operation_kind']) && commonFileFields(value) && exactProvenance(value)
        && typeof value.append_utf8 === 'string' && value.append_utf8.length > 0
        && Buffer.byteLength(value.append_utf8) === value.append_bytes
        && value.append_bytes <= MAX_APPEND_BYTES && Number.isSafeInteger(value.result_bytes)
        && value.result_bytes > value.append_bytes && SHA256.test(value.result_content_sha256 || '');
    case 'rename':
      return exactKeys(value, ['order', 'identity_sha256', 'kind', 'path', 'blob_oid',
        'original_content_sha256', 'destination', 'destination_absence',
        'discovery_operation_kind', 'discovery_index', 'authored_operation_kind'])
        && commonFileFields(value) && exactProvenance(value) && portablePath(value.destination)
        && portablePathKey(value.path) !== portablePathKey(value.destination)
        && validateAbsence(value.destination_absence);
    case 'delete':
      return exactKeys(value, ['order', 'identity_sha256', 'kind', 'path', 'blob_oid',
        'original_content_sha256', 'discovery_operation_kind', 'discovery_index',
        'authored_operation_kind']) && commonFileFields(value) && exactProvenance(value);
    case 'branch':
      return exactKeys(value, ['order', 'identity_sha256', 'kind', 'path', 'blob_oid',
        'original_content_sha256', 'source_commit', 'pair_id', 'branch', 'executed',
        'discovery_operation_kind', 'discovery_index', 'authored_operation_kind'])
        && commonFileFields(value) && exactProvenance(value) && SHA1.test(value.source_commit || '')
        && value.executed === false && safeBranch(value.branch, value.kind, value.pair_id);
    case 'logical_worktree':
      return exactKeys(value, ['order', 'identity_sha256', 'kind', 'path', 'blob_oid',
        'original_content_sha256', 'source_commit', 'pair_id', 'logical_worktree_id',
        'derived_branch', 'executed', 'discovery_operation_kind', 'discovery_index',
        'authored_operation_kind']) && commonFileFields(value) && exactProvenance(value)
        && SHA1.test(value.source_commit || '') && value.executed === false
        && value.logical_worktree_id === `oracle-worktree-${value.pair_id}`
        && safeBranch(value.derived_branch, value.kind, value.pair_id);
    default: return false;
  }
}

export function validateScenarioSelection(selection) {
  const errors = [];
  if (!exactKeys(selection, ['schema', 'purpose', 'authority', 'bounds', 'tiers'])
    || selection.schema !== 'lamina.real-repository-oracle-scenario-selection/v1') {
    return { valid: false, errors: ['selection root is not the exact scenario-selection schema'] };
  }
  if (selection.purpose !== PURPOSE) errors.push('selection purpose does not preserve pending-only authority');
  if (!exactKeys(selection.authority, ['baseline_manifest_sha256', 'candidate_policy_sha256',
    'evidence_selection_raw_sha256', 'evidence_selection_canonical_sha256'])
    || selection.authority.baseline_manifest_sha256 !== BASELINE_MANIFEST_SHA256
    || selection.authority.candidate_policy_sha256 !== CANDIDATE_POLICY_SHA256
    || selection.authority.evidence_selection_raw_sha256 !== EVIDENCE_SELECTION_RAW_SHA256
    || selection.authority.evidence_selection_canonical_sha256 !== EVIDENCE_SELECTION_CANONICAL_SHA256) {
    errors.push('selection authority differs from its reviewed inputs');
  }
  if (!exactKeys(selection.bounds, ['tiers', 'scenarios_per_tier', 'scenario_kinds',
    'maximum_selection_bytes', 'maximum_path_bytes', 'maximum_append_bytes'])
    || selection.bounds.tiers !== TIERS.length || selection.bounds.scenarios_per_tier !== KINDS.length
    || JSON.stringify(selection.bounds.scenario_kinds) !== JSON.stringify(KINDS)
    || selection.bounds.maximum_selection_bytes !== MAX_SELECTION_BYTES
    || selection.bounds.maximum_path_bytes !== MAX_PATH_BYTES
    || selection.bounds.maximum_append_bytes !== MAX_APPEND_BYTES) {
    errors.push('selection bounds differ from the fixed parser contract');
  }
  if (!exactKeys(selection.tiers, TIERS)) return { valid: false, errors: [...errors, 'selection must exactly cover all tiers'] };
  if (authorityLeak(selection.tiers)) errors.push('selection contains later-stage or execution authority');
  const allIdentities = new Set();
  for (const tier of TIERS) {
    const item = selection.tiers[tier];
    const pin = COLLECTION_PINS[tier];
    if (!exactKeys(item, ['status', 'pin', 'reviewed_inventory_sha256', 'discovery', 'scenarios'])
      || item.status !== STATUS || !exactPin(item.pin, pin)
      || item.reviewed_inventory_sha256 !== candidateInventoryDigest(REVIEWED_INVENTORIES[tier])
      || !exactKeys(item.discovery, ['report_sha256', 'semantic_sha256', 'index_sha256'])
      || JSON.stringify(item.discovery) !== JSON.stringify(AUDITED_DISCOVERY_IDENTITIES[tier])
      || !Array.isArray(item.scenarios) || item.scenarios.length !== KINDS.length) {
      errors.push(`${tier} does not bind the pending reviewed inputs`);
      continue;
    }
    const paths = new Map();
    const scenarioByKind = new Map();
    for (const [order, scenario] of item.scenarios.entries()) {
      if (!scenarioShape(scenario) || scenario.order !== order || scenario.kind !== KINDS[order]
        || !SHA256.test(scenario.identity_sha256 || '')
        || scenario.identity_sha256 !== scenarioSelectionIdentity(tier, scenario)) {
        errors.push(`${tier} scenario ${order} is malformed, reordered, or identity-drifted`);
        continue;
      }
      if (allIdentities.has(scenario.identity_sha256)) errors.push(`${tier} scenario ${order} identity is duplicated`);
      allIdentities.add(scenario.identity_sha256);
      scenarioByKind.set(scenario.kind, scenario);
      for (const selectedPath of [scenario.path, scenario.destination].filter(Boolean)) {
        const key = portablePathKey(selectedPath);
        const existing = paths.get(key);
        const deliberatePair = existing && existing.path === selectedPath
          && existing.kind === 'branch' && scenario.kind === 'logical_worktree';
        if (existing && !deliberatePair) errors.push(`${tier} paths conflict under portable normalization`);
        paths.set(key, { path: selectedPath, kind: scenario.kind });
      }
    }
    const modify = scenarioByKind.get('modify');
    const rename = scenarioByKind.get('rename');
    const remove = scenarioByKind.get('delete');
    const branch = scenarioByKind.get('branch');
    const worktree = scenarioByKind.get('logical_worktree');
    for (const kind of KINDS.slice(1)) {
      const scenario = scenarioByKind.get(kind);
      const expected = EXPECTED_PROVENANCE[tier][kind];
      if (!scenario || scenario.discovery_operation_kind !== expected[0]
        || scenario.discovery_index !== expected[1]
        || scenario.authored_operation_kind !== kind) {
        errors.push(`${tier} ${kind} does not preserve exact discovery provenance`);
      }
    }
    if (new Set([modify?.path, rename?.path, remove?.path]).size !== 3) {
      errors.push(`${tier} modify, rename, and delete must use distinct sources`);
    }
    if (!branch || !worktree || branch.pair_id !== worktree.pair_id
      || branch.path !== worktree.path || branch.blob_oid !== worktree.blob_oid
      || branch.original_content_sha256 !== worktree.original_content_sha256
      || branch.source_commit !== worktree.source_commit || branch.source_commit !== pin.commit
      || branch.branch === worktree.derived_branch) {
      errors.push(`${tier} branch/worktree pair is not deliberate and separately materializable`);
    }
    if (scenarioByKind.get('clean')?.source_commit !== pin.commit) {
      errors.push(`${tier} clean scenario does not bind the exact pin`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function parseScenarioSelectionBytes(bytes, { requireReviewedBytes = true } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_SELECTION_BYTES
    || (requireReviewedBytes && sha256(bytes) !== SCENARIO_SELECTION_RAW_SHA256)) {
    throw new Error('scenario selection bytes do not match the reviewed source identity');
  }
  let selection;
  try { selection = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('scenario selection is not UTF-8 JSON'); }
  const validation = validateScenarioSelection(selection);
  if (!validation.valid) throw new Error(`scenario selection is invalid: ${validation.errors.join('; ')}`);
  const canonicalSha256 = scenarioSelectionCanonicalDigest(selection);
  if (requireReviewedBytes && canonicalSha256 !== SCENARIO_SELECTION_CANONICAL_SHA256) {
    throw new Error('scenario selection semantic content differs from the reviewed source identity');
  }
  return Object.freeze({ selection, raw_sha256: sha256(bytes), canonical_sha256: canonicalSha256 });
}

export function loadScenarioSelection() {
  return parseScenarioSelectionBytes(fs.readFileSync(SELECTION_FILE));
}
