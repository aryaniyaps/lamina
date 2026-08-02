import crypto from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { brownfieldSignals } from '../../packages/cli/lib/observation-runtime/node.mjs';
import { reviewedCollectionForTier } from './collection-authority.mjs';
import {
  CASE_DISCOVERY_SCAN_LIMITS, visitReviewedDiscoveryCandidates,
  withSignedReviewedRepository,
} from './materialize.mjs';

export const CASE_DISCOVERY_SCHEMA = 'lamina.real-repository-oracle-case-discovery/v2';
export const CASE_DISCOVERY_PAYLOAD_PREFIX = 'LAMINA_REAL_REPOSITORY_CASE_DISCOVERY_V3=';
export const CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES = 7_680;
export const CASE_DISCOVERY_TRANSPORT_SCHEMA = 'lamina.real-repository-oracle-discovery-schema-wire/v1';
export const CASE_DISCOVERY_LIMITS = Object.freeze({
  ...CASE_DISCOVERY_SCAN_LIMITS,
  anchors_per_category: 3,
  max_neighbor_records: 16,
  max_negative_decoys: 16,
  operation_candidates_per_kind: 3,
  max_rename_destination_attempts: 16,
  max_definition_anchors_per_file: 3,
});
export const DISCOVERY_PATH_RULES = Object.freeze({
  excluded_segments: Object.freeze([
    '.next', 'build', 'coverage', 'dist', 'generated', 'node_modules', 'out', 'target', 'vendor',
  ]),
  excluded_basenames: Object.freeze([
    'bun.lock', 'cargo.lock', 'mockserviceworker.js', 'package-lock.json', 'pnpm-lock.yaml',
    'yarn.lock',
  ]),
  excluded_agent_basenames: Object.freeze([
    '.cursorrules', 'agents.md', 'claude.md', 'codex.md', 'copilot-instructions.md', 'cursor.md',
    'gemini.md',
  ]),
  excluded_agent_segments: Object.freeze(['.agents', '.claude', '.codex', '.cursor', '.gemini']),
  excluded_github_agent_directories: Object.freeze(['agents', 'instructions']),
  excluded_suffixes: Object.freeze(['.generated.js', '.generated.ts', '.map', '.min.js']),
  strata: Object.freeze(['source', 'test', 'docs', 'config']),
});
const NO_QUALITY_CLAIMS = Object.freeze({
  workflow_selection: false,
  observation: false,
  obligations: false,
  source_localization: false,
  retrieval_ranking: false,
  end_to_end_runtime: false,
});
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digestObject = (value) => sha256(JSON.stringify(canonical(value)));
export const gitByteCompare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
export const validAuthoringBranchName = (value) => typeof value === 'string'
  && value.length > 0 && Buffer.byteLength(value) <= 240
  && !/[\u0000-\u0020\u007f~^:?*[\\]/.test(value) && !value.includes('..')
  && !value.includes('//') && !value.startsWith('/') && !value.endsWith('/')
  && !value.endsWith('.') && !value.endsWith('.lock');
export const validLogicalWorktreeId = (value) =>
  typeof value === 'string' && /^oracle-worktree-[a-f0-9]{12}$/.test(value);
const DISCOVERY_TRANSPORT_MAX_BYTES = 512 * 1024;
const DISCOVERY_RECONSTRUCTED_MAX_BYTES = 512 * 1024;
const MAX_SIGNAL_PREVIEW_CODE_UNITS = 240;
const MAX_SIGNAL_PREVIEW_BYTES = MAX_SIGNAL_PREVIEW_CODE_UNITS * 3;
const MAX_DISCOVERY_LINE_NUMBER = CASE_DISCOVERY_LIMITS.max_file_bytes + 1;
const RENAME_DESTINATION_ID_HEX_LENGTH = 12;
const RENAME_DESTINATION_PREFIX = 'lamina-oracle-rename-';
const FILE_KEYS = Object.freeze(['path', 'blob_oid', 'stratum', 'category', 'category_signal',
  'symbol', 'line', 'content_sha256', 'role', 'independent_method']);
const SIGNAL_KEYS = Object.freeze(['value', 'value_sha256', 'occurrence', 'line', 'line_sha256']);
const STRATA = Object.freeze(['source', 'test', 'docs', 'config']);
const OCCURRENCES = Object.freeze(['exact_literal', 'derived_component_literal', 'derived_unresolved']);
const DISCOVERY_CATEGORIES = Object.freeze(['commands', 'dependencies', 'documentation', 'entities',
  'entry_points', 'events', 'feature_flags', 'handlers', 'permissions', 'personas', 'routes',
  'schemas', 'state_transitions', 'tests']);
const OPERATION_KEYS = Object.freeze(['modify', 'rename', 'delete', 'branch', 'logical_worktree']);
const MAX_WIRE_FILE_FACTS = DISCOVERY_CATEGORIES.length * CASE_DISCOVERY_LIMITS.anchors_per_category
  + CASE_DISCOVERY_LIMITS.max_neighbor_records + CASE_DISCOVERY_LIMITS.max_negative_decoys
  + OPERATION_KEYS.length * CASE_DISCOVERY_LIMITS.operation_candidates_per_kind;
const MAX_WIRE_SIGNAL_FACTS = DISCOVERY_CATEGORIES.length
  * CASE_DISCOVERY_LIMITS.anchors_per_category;
const STATIC_LIMITATION = 'This deterministic index contains non-semantic reviewer candidates only. Categories are static-scan signals, neighbors and decoys are lexical path controls, and operation paths are unexecuted authoring candidates. It defines no Workflow, domain meaning, golden expectation, quality grade, retrieval result, or runtime claim.';
const TRANSPORT_CONTRACT = Object.freeze({
  schema: CASE_DISCOVERY_TRANSPORT_SCHEMA,
  root_arity: 14,
  file_tuple: FILE_KEYS.slice(0, 3).concat(['symbol', 'line', 'content_sha256']),
  signal_tuple: SIGNAL_KEYS,
  category_row: ['category_ref', 'file_signal_refs'],
  control_row: ['category_ref', 'file_ref'],
  operation_order: OPERATION_KEYS,
  digest_encoding: 'unique-canonical-base64url-raw-byte-tables',
});

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort(gitByteCompare))
    === JSON.stringify([...keys].sort(gitByteCompare));
const canonicalSemantic = (value) => Array.isArray(value) ? value.map(canonicalSemantic)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort(gitByteCompare)
      .map((key) => [key, canonicalSemantic(value[key])])) : value;
const canonicalSemanticBytes = (value) => Buffer.from(JSON.stringify(canonicalSemantic(value)));
const semanticDigest = (value) => sha256(canonicalSemanticBytes(value));
const jsonArrayByteLength = (valueLengths) => 2 + Math.max(0, valueLengths.length - 1)
  + valueLengths.reduce((total, length) => total + length, 0);
const jsonObjectByteLength = (entries) => 2 + Math.max(0, entries.length - 1)
  + entries.reduce((total, [key, valueLength]) => total
    + Buffer.byteLength(JSON.stringify(key)) + 1 + valueLength, 0);
const scalarJsonByteLength = (value) => Buffer.byteLength(JSON.stringify(value));
const TRANSPORT_CONTRACT_SHA256 = semanticDigest(TRANSPORT_CONTRACT);
const digestToWire = (value, length) => {
  if (typeof value !== 'string' || value.length !== length * 2
    || !/^[a-f0-9]+$/.test(value)) throw new Error('case-discovery digest is malformed');
  return Buffer.from(value, 'hex').toString('base64url');
};
const digestFromWire = (value, length) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('case-discovery wire digest is malformed');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) {
    throw new Error('case-discovery wire digest is non-canonical');
  }
  return bytes.toString('hex');
};
const safeDiscoveryPath = (value) => typeof value === 'string' && value.length > 0
  && Buffer.byteLength(value) <= 4_096 && !/[\u0000-\u001f\u007f]/.test(value)
  && !value.includes('\\') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value)
  && value.split('/').every((piece) => piece && piece !== '.' && piece !== '..');
const boundedInteger = (value, maximum = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const tupleIdentity = (value) => JSON.stringify(value);
const compareTuples = (left, right) => gitByteCompare(tupleIdentity(left), tupleIdentity(right));
const safeRenameExtension = (sourcePath) => {
  const extension = path.posix.extname(sourcePath);
  return Buffer.byteLength(extension) <= 16 && /^\.[A-Za-z0-9]{1,15}$/.test(extension)
    ? extension : '';
};
const renameDestinationAt = ({ path: sourcePath, blob_oid: blobOid }, attempt) => {
  const candidateId = digestObject({ path: sourcePath, blob_oid: blobOid })
    .slice(0, RENAME_DESTINATION_ID_HEX_LENGTH);
  const suffix = attempt === 0 ? '' : `-${attempt}`;
  return `${RENAME_DESTINATION_PREFIX}${candidateId}${suffix}${safeRenameExtension(sourcePath)}`;
};

function exactFileFact(anchor) {
  return [anchor.path, anchor.blob_oid, anchor.stratum, anchor.symbol, anchor.line,
    anchor.content_sha256];
}

function exactSignalFact(signal) {
  return [signal.value, signal.value_sha256, signal.occurrence, signal.line, signal.line_sha256];
}

function validateAnchor(anchor, { category, role, extras = [] }) {
  const disposition = typeof anchor?.path === 'string'
    ? discoveryPathDisposition(anchor.path) : { admitted: false, stratum: null };
  if (!exactKeys(anchor, [...FILE_KEYS, ...extras]) || !safeDiscoveryPath(anchor.path)
    || !/^[a-f0-9]{40}$/.test(anchor.blob_oid || '') || !STRATA.includes(anchor.stratum)
    || !disposition.admitted || disposition.stratum !== anchor.stratum
    || anchor.category !== category || anchor.role !== role
    || anchor.independent_method !== 'sealed_git_blob_static_scan'
    || !(anchor.symbol === null || /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(anchor.symbol))
    || !(anchor.line === null || boundedInteger(anchor.line - 1, MAX_DISCOVERY_LINE_NUMBER - 1))
    || ((anchor.symbol === null) !== (anchor.line === null))
    || !/^[a-f0-9]{64}$/.test(anchor.content_sha256 || '')) {
    throw new Error('case-discovery anchor is outside the exact schema');
  }
  if (category === null && anchor.category_signal !== null) {
    throw new Error('non-category discovery anchor carries a category signal');
  }
  if (category !== null) {
    const signal = anchor.category_signal;
    if (!exactKeys(signal, SIGNAL_KEYS) || typeof signal.value !== 'string' || signal.value.length === 0
      || signal.value.length > MAX_SIGNAL_PREVIEW_CODE_UNITS
      || Buffer.byteLength(signal.value) > MAX_SIGNAL_PREVIEW_BYTES
      || !/^[a-f0-9]{64}$/.test(signal.value_sha256 || '')
      || !OCCURRENCES.includes(signal.occurrence)
      || !(signal.line === null || boundedInteger(signal.line - 1, MAX_DISCOVERY_LINE_NUMBER - 1))
      || !(signal.line_sha256 === null || /^[a-f0-9]{64}$/.test(signal.line_sha256))) {
      throw new Error('case-discovery category signal is outside the exact schema');
    }
    if ((signal.line === null) !== (signal.line_sha256 === null)
      || (signal.occurrence === 'derived_unresolved') !== (signal.line === null)) {
      throw new Error('case-discovery category signal line identity is contradictory');
    }
  }
}

export function validateDiscoveryResult(result) {
  const rootKeys = ['schema', 'workload_id', 'status', 'admission', 'collection', 'inventory',
    'bounds', 'scan', 'candidate_index', 'authoring_handoff', 'expectations_loaded',
    'grade_controller_evidence', 'quality_claims', 'limitation'];
  if (!exactKeys(result, rootKeys) || result.schema !== CASE_DISCOVERY_SCHEMA
    || result.workload_id !== 'real-repository-oracle-v1:case-discovery'
    || result.status !== 'unreviewed_case_discovery_candidate'
    || result.admission !== 'reviewed_inventory_verified'
    || result.expectations_loaded !== false || result.grade_controller_evidence !== false
    || result.limitation !== STATIC_LIMITATION
    || !exactKeys(result.quality_claims, Object.keys(NO_QUALITY_CLAIMS))
    || Object.values(result.quality_claims).some((value) => value !== false)) {
    throw new Error('case-discovery result root is outside the exact zero-claim schema');
  }
  const reviewed = reviewedCollectionForTier(result.collection?.fixture_id);
  const expectedCollection = {
    fixture_id: reviewed.fixture_id, fixture_class: reviewed.fixture_class,
    repository_url: reviewed.repository_url, commit: reviewed.commit, tree_oid: reviewed.tree_oid,
    baseline_manifest_sha256: reviewed.baseline_manifest_sha256,
    candidate_policy_sha256: reviewed.candidate_policy_sha256,
  };
  if (semanticDigest(result.collection) !== semanticDigest(expectedCollection)
    || semanticDigest(result.inventory) !== semanticDigest(reviewed.reviewed_inventory)
    || semanticDigest(result.bounds) !== semanticDigest(CASE_DISCOVERY_LIMITS)
    || !exactKeys(result.scan, ['candidate_files', 'candidate_bytes', 'tracked_path_count',
      'admitted_index_files', 'excluded_generated_artifacts'])
    || !Object.values(result.scan).every((value) => boundedInteger(value))
    || result.scan.tracked_path_count !== result.inventory.tracked_files
    || result.scan.candidate_files > CASE_DISCOVERY_LIMITS.max_candidate_files
    || result.scan.candidate_bytes > CASE_DISCOVERY_LIMITS.max_candidate_bytes
    || result.scan.admitted_index_files + result.scan.excluded_generated_artifacts
      !== result.scan.candidate_files
    || semanticDigest(result.authoring_handoff) !== semanticDigest({
      next_action: 'reviewer_selects_bounded_evidence_anchors', freeze_allowed: false,
      selection_schema: 'lamina.real-repository-oracle-evidence-selection/v1',
    })) throw new Error('case-discovery authority, inventory, scan, or bounds drifted');

  const index = result.candidate_index;
  if (!exactKeys(index, ['schema', 'rules_sha256', 'categories', 'near_neighbors',
    'negative_decoys', 'operation_candidates', 'index_sha256'])
    || index.schema !== 'lamina.real-repository-oracle-discovery-index/v1'
    || index.rules_sha256 !== digestObject(DISCOVERY_PATH_RULES)
    || !exactKeys(index.operation_candidates, OPERATION_KEYS)
    || !exactKeys(index.categories, Object.keys(index.categories))) {
    throw new Error('case-discovery candidate index is outside the exact schema');
  }
  const categories = Object.keys(index.categories);
  if (categories.length === 0 || categories.length > DISCOVERY_CATEGORIES.length
    || categories.some((category) => !DISCOVERY_CATEGORIES.includes(category))) {
    throw new Error('case-discovery categories are outside the production enum and bounds');
  }
  for (const category of categories) {
    const anchors = index.categories[category];
    if (!Array.isArray(anchors) || anchors.length < 1
      || anchors.length > CASE_DISCOVERY_LIMITS.anchors_per_category
      || new Set(anchors.map((anchor) => anchor.path)).size !== anchors.length) {
      throw new Error('case-discovery category anchor count is outside bounds');
    }
    anchors.forEach((anchor) => validateAnchor(anchor, { category, role: 'positive' }));
  }
  if (!Array.isArray(index.near_neighbors)
    || index.near_neighbors.length > CASE_DISCOVERY_LIMITS.max_neighbor_records
    || !Array.isArray(index.negative_decoys)
    || index.negative_decoys.length > CASE_DISCOVERY_LIMITS.max_negative_decoys) {
    throw new Error('case-discovery control rows exceed bounds');
  }
  for (const row of index.near_neighbors) {
    const referencedAnchor = index.categories[row?.category]?.[0];
    if (!exactKeys(row, ['category', 'anchor_path', 'candidate'])
      || !referencedAnchor || row.anchor_path !== referencedAnchor.path
      || row.candidate?.path === row.anchor_path
      || row.candidate?.stratum !== referencedAnchor.stratum) {
      throw new Error('case-discovery near-neighbor authority is invalid');
    }
    validateAnchor(row.candidate, { category: null, role: 'near_neighbor' });
  }
  for (const row of index.negative_decoys) {
    const referencedAnchor = index.categories[row?.category]?.[0];
    const positivePaths = new Set(
      (index.categories[row?.category] || []).map((anchor) => anchor.path),
    );
    if (!exactKeys(row, ['category', 'anchor_path', 'candidate', 'basis'])
      || !referencedAnchor || row.anchor_path !== referencedAnchor.path
      || positivePaths.has(row.candidate?.path)
      || row.candidate?.stratum !== referencedAnchor.stratum
      || row.basis !== 'same_stratum_without_discovered_category') {
      throw new Error('case-discovery negative-decoy authority is invalid');
    }
    validateAnchor(row.candidate, { category: null, role: 'negative' });
  }
  const strictlyOrderedControlCategories = (rows) => rows.every((row, indexValue) =>
    indexValue === 0 || gitByteCompare(rows[indexValue - 1].category, row.category) < 0);
  if (new Set(index.near_neighbors.map((row) => row.category)).size
      !== index.near_neighbors.length
    || new Set(index.negative_decoys.map((row) => row.category)).size
      !== index.negative_decoys.length
    || !strictlyOrderedControlCategories(index.near_neighbors)
    || !strictlyOrderedControlCategories(index.negative_decoys)) {
    throw new Error('case-discovery controls contain duplicate category tuples');
  }
  const operations = index.operation_candidates;
  for (const kind of OPERATION_KEYS) {
    if (!Array.isArray(operations[kind])
      || operations[kind].length > CASE_DISCOVERY_LIMITS.operation_candidates_per_kind
      || new Set(operations[kind].map((anchor) => anchor.path)).size !== operations[kind].length) {
      throw new Error('case-discovery operation candidates exceed bounds');
    }
  }
  operations.modify.forEach((anchor) => validateAnchor(anchor,
    { category: null, role: 'scenario_before' }));
  operations.delete.forEach((anchor) => validateAnchor(anchor,
    { category: null, role: 'scenario_before' }));
  for (const anchor of operations.rename) {
    validateAnchor(anchor, { category: null, role: 'scenario_before',
      extras: ['proposed_path', 'destination_absence'] });
    const generatedDestinations = Array.from(
      { length: CASE_DISCOVERY_LIMITS.max_rename_destination_attempts }, (_, attempt) =>
        renameDestinationAt(anchor, attempt),
    );
    if (!safeDiscoveryPath(anchor.proposed_path)
      || !generatedDestinations.includes(anchor.proposed_path)
      || !exactKeys(anchor.destination_absence, ['basis', 'tracked_path_count',
        'tracked_paths_sha256', 'occupied_destination_count', 'occupied_destinations_sha256',
        'portable_root_included', 'absent'])
      || anchor.destination_absence.basis !== 'complete_stage0_git_paths_and_implied_directories'
      || anchor.destination_absence.tracked_path_count !== result.inventory.tracked_files
      || !/^[a-f0-9]{64}$/.test(anchor.destination_absence.tracked_paths_sha256 || '')
      || !boundedInteger(anchor.destination_absence.occupied_destination_count)
      || anchor.destination_absence.occupied_destination_count
        < anchor.destination_absence.tracked_path_count + 1
      || !/^[a-f0-9]{64}$/.test(anchor.destination_absence.occupied_destinations_sha256 || '')
      || anchor.destination_absence.portable_root_included !== true
      || anchor.destination_absence.absent !== true) {
      throw new Error('case-discovery rename absence authority is invalid');
    }
  }
  if (new Set(operations.rename.map((anchor) => anchor.proposed_path)).size
      !== operations.rename.length) {
    throw new Error('case-discovery rename proposals are not distinct');
  }
  for (const anchor of operations.branch) {
    validateAnchor(anchor, { category: null, role: 'scenario_before',
      extras: ['proposed_branch', 'source_commit', 'executed'] });
    const candidateId = digestObject({ path: anchor.path, blob_oid: anchor.blob_oid }).slice(0, 12);
    if (!validAuthoringBranchName(anchor.proposed_branch)
      || anchor.proposed_branch !== `lamina-oracle/${candidateId}`
      || anchor.source_commit !== result.collection.commit || anchor.executed !== false) {
      throw new Error('case-discovery branch candidate is invalid');
    }
  }
  for (const anchor of operations.logical_worktree) {
    validateAnchor(anchor, { category: null, role: 'scenario_before',
      extras: ['logical_worktree_id', 'source_commit', 'executed'] });
    const candidateId = digestObject({ path: anchor.path, blob_oid: anchor.blob_oid }).slice(0, 12);
    if (!validLogicalWorktreeId(anchor.logical_worktree_id)
      || anchor.logical_worktree_id !== `oracle-worktree-${candidateId}`
      || anchor.source_commit !== result.collection.commit || anchor.executed !== false) {
      throw new Error('case-discovery worktree candidate is invalid');
    }
  }
  if (operations.branch.length !== operations.logical_worktree.length
    || operations.branch.some((anchor, indexValue) => tupleIdentity(exactFileFact(anchor))
      !== tupleIdentity(exactFileFact(operations.logical_worktree[indexValue])))) {
    throw new Error('case-discovery branch and worktree selections are inconsistent');
  }
  const producerSliceCounts = [operations.modify.length, operations.rename.length,
    operations.delete.length, operations.branch.length];
  const firstPartialSlice = producerSliceCounts.findIndex((count) => count < 3);
  if ((firstPartialSlice >= 0
      && producerSliceCounts.slice(firstPartialSlice + 1).some((count) => count !== 0))) {
    throw new Error('case-discovery operation counts are not contiguous producer slices');
  }
  const selectedOperationPaths = new Set();
  for (const kind of ['modify', 'rename', 'delete', 'branch']) {
    for (const anchor of operations[kind]) {
      if (selectedOperationPaths.has(anchor.path)) {
        throw new Error('case-discovery operation slices overlap');
      }
      selectedOperationPaths.add(anchor.path);
    }
  }
  if (operations.rename.length > 1 && operations.rename.some((anchor) =>
    semanticDigest(anchor.destination_absence)
      !== semanticDigest(operations.rename[0].destination_absence))) {
    throw new Error('case-discovery rename authority was not hoisted consistently');
  }
  const indexedAnchors = [
    ...categories.flatMap((category) => index.categories[category]),
    ...index.near_neighbors.map((row) => row.candidate),
    ...index.negative_decoys.map((row) => row.candidate),
    ...OPERATION_KEYS.flatMap((kind) => operations[kind]),
  ];
  const canonicalFileByPath = new Map();
  for (const anchor of indexedAnchors) {
    const identity = tupleIdentity(exactFileFact(anchor));
    if (canonicalFileByPath.has(anchor.path)
      && canonicalFileByPath.get(anchor.path) !== identity) {
      throw new Error('case-discovery path has conflicting canonical file facts');
    }
    canonicalFileByPath.set(anchor.path, identity);
  }
  if (canonicalFileByPath.size > result.scan.admitted_index_files
    || (result.scan.candidate_files === 0 && result.scan.candidate_bytes !== 0)) {
    throw new Error('case-discovery indexed facts contradict scan accounting');
  }
  const withoutDigest = Object.fromEntries(Object.entries(index)
    .filter(([key]) => key !== 'index_sha256'));
  if (index.index_sha256 !== digestObject(withoutDigest)) {
    throw new Error('case-discovery candidate index digest drifted');
  }
  return true;
}

function packDiscoveryResult(result) {
  validateDiscoveryResult(result);
  const index = result.candidate_index;
  const categories = Object.keys(index.categories).sort(gitByteCompare);
  const allAnchors = [
    ...categories.flatMap((category) => index.categories[category]),
    ...index.near_neighbors.map((row) => row.candidate),
    ...index.negative_decoys.map((row) => row.candidate),
    ...OPERATION_KEYS.flatMap((kind) => index.operation_candidates[kind]),
  ];
  const files = [...new Map(allAnchors.map((anchor) => {
    const tuple = exactFileFact(anchor); return [tupleIdentity(tuple), tuple];
  })).values()].sort(compareTuples);
  const fileRefs = new Map(files.map((tuple, indexValue) => [tupleIdentity(tuple), indexValue]));
  const signals = [...new Map(categories.flatMap((category) =>
    index.categories[category].map((anchor) => {
      const tuple = exactSignalFact(anchor.category_signal); return [tupleIdentity(tuple), tuple];
    }))).values()].sort(compareTuples);
  const signalRefs = new Map(signals.map((tuple, indexValue) => [tupleIdentity(tuple), indexValue]));
  const fileRef = (anchor) => fileRefs.get(tupleIdentity(exactFileFact(anchor)));
  const signalRef = (anchor) => signalRefs.get(tupleIdentity(exactSignalFact(anchor.category_signal)));
  const categoryRefs = new Map(categories.map((category, indexValue) => [category, indexValue]));
  const destination = index.operation_candidates.rename[0]?.destination_absence || null;
  const sha1s = [...new Set(files.map((tuple) => tuple[1]))].sort(gitByteCompare);
  const sha256s = [...new Set([
    ...files.map((tuple) => tuple[5]),
    ...signals.flatMap((tuple) => [tuple[1], tuple[4]].filter(Boolean)),
    ...(destination === null ? []
      : [destination.tracked_paths_sha256, destination.occupied_destinations_sha256]),
  ])].sort(gitByteCompare);
  const sha1Refs = new Map(sha1s.map((value, indexValue) => [value, indexValue]));
  const sha256Refs = new Map(sha256s.map((value, indexValue) => [value, indexValue]));
  return [
    digestToWire(TRANSPORT_CONTRACT_SHA256, 32),
    digestToWire(semanticDigest(result), 32),
    result.collection.fixture_id,
    [result.scan.candidate_files, result.scan.candidate_bytes, result.scan.tracked_path_count,
      result.scan.admitted_index_files, result.scan.excluded_generated_artifacts],
    sha1s.map((value) => digestToWire(value, 20)),
    sha256s.map((value) => digestToWire(value, 32)),
    files.map(([pathValue, blob, stratum, symbol, line, content]) =>
      [pathValue, sha1Refs.get(blob), STRATA.indexOf(stratum), symbol, line,
        sha256Refs.get(content)]),
    signals.map(([value, valueHash, occurrence, line, lineHash]) =>
      [value, sha256Refs.get(valueHash), OCCURRENCES.indexOf(occurrence), line,
        lineHash === null ? null : sha256Refs.get(lineHash)]),
    categories,
    categories.map((category) => index.categories[category]
      .map((anchor) => [fileRef(anchor), signalRef(anchor)])),
    index.near_neighbors.map((row) => [categoryRefs.get(row.category), fileRef(row.candidate)]),
    index.negative_decoys.map((row) => [categoryRefs.get(row.category), fileRef(row.candidate)]),
    [
      index.operation_candidates.modify.map(fileRef),
      index.operation_candidates.rename.map((anchor) => [fileRef(anchor), anchor.proposed_path]),
      index.operation_candidates.delete.map(fileRef),
      index.operation_candidates.branch.map((anchor) => [fileRef(anchor), anchor.proposed_branch]),
      index.operation_candidates.logical_worktree
        .map((anchor) => [fileRef(anchor), anchor.logical_worktree_id]),
    ],
    destination === null ? null : [destination.tracked_path_count,
      sha256Refs.get(destination.tracked_paths_sha256),
      destination.occupied_destination_count,
      sha256Refs.get(destination.occupied_destinations_sha256)],
  ];
}

function unpackDiscoveryResult(wire, rawBytes) {
  const arity = (value, length, label) => {
    if (!Array.isArray(value) || value.length !== length) {
      throw new Error(`case-discovery wire ${label} arity is invalid`);
    }
    return value;
  };
  arity(wire, TRANSPORT_CONTRACT.root_arity, 'root');
  if (wire[0] !== digestToWire(TRANSPORT_CONTRACT_SHA256, 32)
    || rawBytes.length > DISCOVERY_TRANSPORT_MAX_BYTES
    || !Buffer.from(JSON.stringify(wire)).equals(rawBytes)) {
    throw new Error('case-discovery wire contract or canonical encoding is invalid');
  }
  const reviewed = reviewedCollectionForTier(wire[2]);
  const scanTuple = arity(wire[3], 5, 'scan');
  if (!scanTuple.every((value) => boundedInteger(value))) {
    throw new Error('case-discovery wire scan is invalid');
  }
  const digestTable = (values, length, maximum, label) => {
    if (!Array.isArray(values) || values.length > maximum) {
      throw new Error(`case-discovery wire ${label} table is invalid`);
    }
    const decoded = values.map((value) => digestFromWire(value, length));
    if (decoded.some((value, indexValue) => indexValue > 0
      && gitByteCompare(decoded[indexValue - 1], value) >= 0)) {
      throw new Error(`case-discovery wire ${label} table is not ordered and unique`);
    }
    return decoded;
  };
  const sha1s = digestTable(wire[4], 20, MAX_WIRE_FILE_FACTS, 'sha1');
  const sha256s = digestTable(wire[5], 32,
    MAX_WIRE_FILE_FACTS + MAX_WIRE_SIGNAL_FACTS * 2 + 2, 'sha256');
  const usedSha1s = new Set();
  const usedSha256s = new Set();
  const digestAt = (table, used, reference) => {
    if (!boundedInteger(reference, table.length - 1)) throw new Error('invalid digest reference');
    used.add(reference); return table[reference];
  };
  const usedFiles = new Set();
  const files = wire[6];
  if (!Array.isArray(files) || files.length > MAX_WIRE_FILE_FACTS) {
    throw new Error('case-discovery wire file table is invalid');
  }
  const decodedFiles = files.map((row) => {
    arity(row, 6, 'file');
    const decoded = [row[0], digestAt(sha1s, usedSha1s, row[1]), STRATA[row[2]], row[3], row[4],
      digestAt(sha256s, usedSha256s, row[5])];
    if (!safeDiscoveryPath(decoded[0]) || !STRATA.includes(decoded[2])
      || !(decoded[3] === null || /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(decoded[3]))
      || !(decoded[4] === null
        || boundedInteger(decoded[4] - 1, MAX_DISCOVERY_LINE_NUMBER - 1))) {
      throw new Error('case-discovery wire file fact is invalid');
    }
    return decoded;
  });
  if (decodedFiles.some((tuple, indexValue) => indexValue > 0
    && compareTuples(decodedFiles[indexValue - 1], tuple) >= 0)) {
    throw new Error('case-discovery wire file table is not ordered and unique');
  }
  const signals = wire[7];
  if (!Array.isArray(signals) || signals.length > MAX_WIRE_SIGNAL_FACTS) {
    throw new Error('case-discovery wire signal table is invalid');
  }
  const decodedSignals = signals.map((row) => {
    arity(row, 5, 'signal');
    const decoded = [row[0], digestAt(sha256s, usedSha256s, row[1]), OCCURRENCES[row[2]], row[3],
      row[4] === null ? null : digestAt(sha256s, usedSha256s, row[4])];
    if (typeof decoded[0] !== 'string' || decoded[0].length === 0
      || decoded[0].length > MAX_SIGNAL_PREVIEW_CODE_UNITS
      || Buffer.byteLength(decoded[0]) > MAX_SIGNAL_PREVIEW_BYTES
      || !OCCURRENCES.includes(decoded[2])
      || !(decoded[3] === null
        || boundedInteger(decoded[3] - 1, MAX_DISCOVERY_LINE_NUMBER - 1))
      || ((decoded[3] === null) !== (decoded[4] === null))
      || (decoded[2] === 'derived_unresolved') !== (decoded[3] === null)) {
      throw new Error('case-discovery wire signal fact is invalid');
    }
    return decoded;
  });
  if (decodedSignals.some((tuple, indexValue) => indexValue > 0
    && compareTuples(decodedSignals[indexValue - 1], tuple) >= 0)) {
    throw new Error('case-discovery wire signal table is not ordered and unique');
  }
  const categories = wire[8];
  if (!Array.isArray(categories) || categories.length === 0
    || categories.length > DISCOVERY_CATEGORIES.length
    || categories.some((value) => typeof value !== 'string')
    || categories.some((value) => !DISCOVERY_CATEGORIES.includes(value))
    || JSON.stringify(categories) !== JSON.stringify([...new Set(categories)].sort(gitByteCompare))) {
    throw new Error('case-discovery wire category table is not ordered and unique');
  }
  const fileAt = (reference) => {
    if (!boundedInteger(reference, decodedFiles.length - 1)) throw new Error('invalid file reference');
    usedFiles.add(reference); return decodedFiles[reference];
  };
  const usedSignals = new Set();
  const signalAt = (reference) => {
    if (!boundedInteger(reference, decodedSignals.length - 1)) throw new Error('invalid signal reference');
    usedSignals.add(reference); return decodedSignals[reference];
  };
  const categoryAt = (reference) => {
    if (!boundedInteger(reference, categories.length - 1)) throw new Error('invalid category reference');
    return categories[reference];
  };
  const signalObject = (tuple) => ({ value: tuple[0], value_sha256: tuple[1],
    occurrence: tuple[2], line: tuple[3], line_sha256: tuple[4] });
  const anchor = (fileTuple, category, categorySignal, role) => ({
    path: fileTuple[0], blob_oid: fileTuple[1], stratum: fileTuple[2], category,
    category_signal: categorySignal, symbol: fileTuple[3], line: fileTuple[4],
    content_sha256: fileTuple[5], role, independent_method: 'sealed_git_blob_static_scan',
  });
  const categoryRows = wire[9];
  if (!Array.isArray(categoryRows) || categoryRows.length !== categories.length) {
    throw new Error('case-discovery wire category rows are invalid');
  }
  for (const rows of categoryRows) {
    if (!Array.isArray(rows) || rows.length < 1
      || rows.length > CASE_DISCOVERY_LIMITS.anchors_per_category) {
      throw new Error('case-discovery wire category anchor count is invalid');
    }
    for (const row of rows) {
      arity(row, 2, 'category anchor'); fileAt(row[0]); signalAt(row[1]);
    }
  }
  const controlRows = [
    [wire[10], CASE_DISCOVERY_LIMITS.max_neighbor_records],
    [wire[11], CASE_DISCOVERY_LIMITS.max_negative_decoys],
  ];
  for (const [rows, maximum] of controlRows) {
    if (!Array.isArray(rows) || rows.length > maximum) throw new Error('invalid control row count');
    for (const row of rows) {
      arity(row, 2, 'control'); categoryAt(row[0]); fileAt(row[1]);
    }
  }
  const operationRows = arity(wire[12], OPERATION_KEYS.length, 'operations');
  if (operationRows.some((rows) => !Array.isArray(rows)
    || rows.length > CASE_DISCOVERY_LIMITS.operation_candidates_per_kind)) {
    throw new Error('case-discovery wire operation row count is invalid');
  }
  operationRows[0].forEach(fileAt);
  operationRows[2].forEach(fileAt);
  for (const operationIndex of [1, 3, 4]) {
    for (const row of operationRows[operationIndex]) {
      arity(row, 2, 'operation'); fileAt(row[0]);
      if (typeof row[1] !== 'string') throw new Error('case-discovery wire operation value is invalid');
    }
  }
  const destinationTuple = wire[13];
  if ((operationRows[1].length === 0) !== (destinationTuple === null)) {
    throw new Error('case-discovery wire destination authority presence is invalid');
  }
  const destination = destinationTuple === null ? null : (() => {
    arity(destinationTuple, 4, 'destination authority');
    return { basis: 'complete_stage0_git_paths_and_implied_directories',
      tracked_path_count: destinationTuple[0],
      tracked_paths_sha256: digestAt(sha256s, usedSha256s, destinationTuple[1]),
      occupied_destination_count: destinationTuple[2],
      occupied_destinations_sha256: digestAt(sha256s, usedSha256s, destinationTuple[3]),
      portable_root_included: true, absent: true };
  })();

  // Count the exact expanded semantic JSON before materializing reference fan-out. Each
  // temporary object is one bounded fact; repeated references add only byte cardinality.
  const valueBytes = (value) => canonicalSemanticBytes(value).length;
  const projectedAnchorBytes = (fileReference, category, signalReference, role, extras = {}) =>
    valueBytes({ ...anchor(fileAt(fileReference), category,
      signalReference === null ? null : signalObject(signalAt(signalReference)), role), ...extras });
  const categoryEntries = categories.map((category, categoryIndex) => [category,
    jsonArrayByteLength(categoryRows[categoryIndex].map((row) =>
      projectedAnchorBytes(row[0], category, row[1], 'positive')))]);
  const projectedControls = (rows, role, basis = null) => jsonArrayByteLength(rows.map((row) => {
    const category = categoryAt(row[0]);
    const firstCategoryFile = fileAt(categoryRows[row[0]][0][0]);
    const projected = { category, anchor_path: firstCategoryFile[0],
      candidate: anchor(fileAt(row[1]), null, null, role) };
    return valueBytes(basis === null ? projected : { ...projected, basis });
  }));
  const projectedSimpleOperations = (rows) => jsonArrayByteLength(rows.map((reference) =>
    projectedAnchorBytes(reference, null, null, 'scenario_before')));
  const projectedOperationEntries = [
    ['modify', projectedSimpleOperations(operationRows[0])],
    ['rename', jsonArrayByteLength(operationRows[1].map((row) =>
      projectedAnchorBytes(row[0], null, null, 'scenario_before',
        { proposed_path: row[1], destination_absence: destination })))],
    ['delete', projectedSimpleOperations(operationRows[2])],
    ['branch', jsonArrayByteLength(operationRows[3].map((row) =>
      projectedAnchorBytes(row[0], null, null, 'scenario_before',
        { proposed_branch: row[1], source_commit: reviewed.commit, executed: false })))],
    ['logical_worktree', jsonArrayByteLength(operationRows[4].map((row) =>
      projectedAnchorBytes(row[0], null, null, 'scenario_before',
        { logical_worktree_id: row[1], source_commit: reviewed.commit, executed: false })))],
  ];
  const projectedCandidateIndexBytes = jsonObjectByteLength([
    ['schema', scalarJsonByteLength('lamina.real-repository-oracle-discovery-index/v1')],
    ['rules_sha256', scalarJsonByteLength(digestObject(DISCOVERY_PATH_RULES))],
    ['categories', jsonObjectByteLength(categoryEntries)],
    ['near_neighbors', projectedControls(wire[10], 'near_neighbor')],
    ['negative_decoys', projectedControls(wire[11], 'negative',
      'same_stratum_without_discovered_category')],
    ['operation_candidates', jsonObjectByteLength(projectedOperationEntries)],
    ['index_sha256', scalarJsonByteLength('0'.repeat(64))],
  ]);
  const projectedResultBytes = jsonObjectByteLength([
    ['schema', scalarJsonByteLength(CASE_DISCOVERY_SCHEMA)],
    ['workload_id', scalarJsonByteLength('real-repository-oracle-v1:case-discovery')],
    ['status', scalarJsonByteLength('unreviewed_case_discovery_candidate')],
    ['admission', scalarJsonByteLength('reviewed_inventory_verified')],
    ['collection', valueBytes({ fixture_id: reviewed.fixture_id, fixture_class: reviewed.fixture_class,
      repository_url: reviewed.repository_url, commit: reviewed.commit, tree_oid: reviewed.tree_oid,
      baseline_manifest_sha256: reviewed.baseline_manifest_sha256,
      candidate_policy_sha256: reviewed.candidate_policy_sha256 })],
    ['inventory', valueBytes(reviewed.reviewed_inventory)],
    ['bounds', valueBytes(CASE_DISCOVERY_LIMITS)],
    ['scan', valueBytes({ candidate_files: scanTuple[0], candidate_bytes: scanTuple[1],
      tracked_path_count: scanTuple[2], admitted_index_files: scanTuple[3],
      excluded_generated_artifacts: scanTuple[4] })],
    ['candidate_index', projectedCandidateIndexBytes],
    ['authoring_handoff', valueBytes({ next_action: 'reviewer_selects_bounded_evidence_anchors',
      freeze_allowed: false, selection_schema: 'lamina.real-repository-oracle-evidence-selection/v1' })],
    ['expectations_loaded', scalarJsonByteLength(false)],
    ['grade_controller_evidence', scalarJsonByteLength(false)],
    ['quality_claims', valueBytes(NO_QUALITY_CLAIMS)],
    ['limitation', scalarJsonByteLength(STATIC_LIMITATION)],
  ]);
  if (projectedResultBytes > DISCOVERY_RECONSTRUCTED_MAX_BYTES) {
    throw new Error('case-discovery projected semantic payload exceeds its byte bound');
  }
  const categoryObject = {};
  for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex += 1) {
    const rows = categoryRows[categoryIndex];
    if (!Array.isArray(rows) || rows.length < 1
      || rows.length > CASE_DISCOVERY_LIMITS.anchors_per_category) {
      throw new Error('case-discovery wire category anchor count is invalid');
    }
    categoryObject[categories[categoryIndex]] = rows.map((row) => {
      arity(row, 2, 'category anchor');
      return anchor(fileAt(row[0]), categories[categoryIndex], signalObject(signalAt(row[1])),
        'positive');
    });
  }
  const controls = (rows, role, maximum) => {
    if (!Array.isArray(rows) || rows.length > maximum) throw new Error('invalid control row count');
    return rows.map((row) => {
      arity(row, 2, 'control');
      const category = categoryAt(row[0]);
      return { category, anchor_path: categoryObject[category][0].path,
        candidate: anchor(fileAt(row[1]), null, null, role) };
    });
  };
  const neighbors = controls(wire[10], 'near_neighbor', CASE_DISCOVERY_LIMITS.max_neighbor_records);
  const decoys = controls(wire[11], 'negative', CASE_DISCOVERY_LIMITS.max_negative_decoys)
    .map((row) => ({ ...row, basis: 'same_stratum_without_discovered_category' }));
  const simpleOperations = (rows) => rows.map((reference) =>
    anchor(fileAt(reference), null, null, 'scenario_before'));
  const modify = simpleOperations(operationRows[0]);
  const rename = operationRows[1].map((row) => {
    arity(row, 2, 'rename');
    return { ...anchor(fileAt(row[0]), null, null, 'scenario_before'),
      proposed_path: row[1], destination_absence: { ...destination } };
  });
  const remove = simpleOperations(operationRows[2]);
  const branch = operationRows[3].map((row) => {
    arity(row, 2, 'branch');
    return { ...anchor(fileAt(row[0]), null, null, 'scenario_before'),
      proposed_branch: row[1], source_commit: reviewed.commit, executed: false };
  });
  const logicalWorktree = operationRows[4].map((row) => {
    arity(row, 2, 'worktree');
    return { ...anchor(fileAt(row[0]), null, null, 'scenario_before'),
      logical_worktree_id: row[1], source_commit: reviewed.commit, executed: false };
  });
  if (usedFiles.size !== decodedFiles.length || usedSignals.size !== decodedSignals.length
    || usedSha1s.size !== sha1s.length || usedSha256s.size !== sha256s.length) {
    throw new Error('case-discovery wire tables contain unused facts');
  }
  const candidateIndexWithoutDigest = {
    schema: 'lamina.real-repository-oracle-discovery-index/v1',
    rules_sha256: digestObject(DISCOVERY_PATH_RULES), categories: categoryObject,
    near_neighbors: neighbors, negative_decoys: decoys,
    operation_candidates: { modify, rename, delete: remove, branch,
      logical_worktree: logicalWorktree },
  };
  const candidateIndex = { ...candidateIndexWithoutDigest,
    index_sha256: digestObject(candidateIndexWithoutDigest) };
  const result = {
    schema: CASE_DISCOVERY_SCHEMA,
    workload_id: 'real-repository-oracle-v1:case-discovery',
    status: 'unreviewed_case_discovery_candidate', admission: 'reviewed_inventory_verified',
    collection: { fixture_id: reviewed.fixture_id, fixture_class: reviewed.fixture_class,
      repository_url: reviewed.repository_url, commit: reviewed.commit, tree_oid: reviewed.tree_oid,
      baseline_manifest_sha256: reviewed.baseline_manifest_sha256,
      candidate_policy_sha256: reviewed.candidate_policy_sha256 },
    inventory: reviewed.reviewed_inventory,
    bounds: CASE_DISCOVERY_LIMITS,
    scan: { candidate_files: scanTuple[0], candidate_bytes: scanTuple[1],
      tracked_path_count: scanTuple[2], admitted_index_files: scanTuple[3],
      excluded_generated_artifacts: scanTuple[4] },
    candidate_index: candidateIndex,
    authoring_handoff: { next_action: 'reviewer_selects_bounded_evidence_anchors',
      freeze_allowed: false, selection_schema: 'lamina.real-repository-oracle-evidence-selection/v1' },
    expectations_loaded: false, grade_controller_evidence: false,
    quality_claims: { ...NO_QUALITY_CLAIMS }, limitation: STATIC_LIMITATION,
  };
  const reconstructedBytes = canonicalSemanticBytes(result).length;
  if (reconstructedBytes !== projectedResultBytes) {
    throw new Error('case-discovery projected semantic byte cardinality drifted');
  }
  if (reconstructedBytes > DISCOVERY_RECONSTRUCTED_MAX_BYTES) {
    throw new Error('case-discovery reconstructed semantic payload exceeds its byte bound');
  }
  validateDiscoveryResult(result);
  if (digestFromWire(wire[1], 32) !== semanticDigest(result)) {
    throw new Error('case-discovery semantic digest mismatch');
  }
  return result;
}

export function discoveryPathDisposition(relative) {
  const pieces = relative.split('/');
  const basename = pieces.at(-1).toLowerCase();
  const lowerPieces = pieces.map((piece) => piece.toLowerCase());
  const agentInstructionOrState = DISCOVERY_PATH_RULES.excluded_agent_basenames.includes(basename)
    || lowerPieces.some((piece) => DISCOVERY_PATH_RULES.excluded_agent_segments.includes(piece))
    || (lowerPieces[0] === '.github'
      && DISCOVERY_PATH_RULES.excluded_github_agent_directories.includes(lowerPieces[1]));
  if (agentInstructionOrState) {
    return Object.freeze({ admitted: false, stratum: null,
      reason: 'agent_instruction_or_state' });
  }
  const excluded = lowerPieces.some((piece) => DISCOVERY_PATH_RULES.excluded_segments.includes(piece))
    || DISCOVERY_PATH_RULES.excluded_basenames.includes(basename)
    || DISCOVERY_PATH_RULES.excluded_suffixes.some((suffix) => basename.endsWith(suffix))
    || /(?:^|[._-])generated(?:[._-]|$)/i.test(basename)
    || /^workbox-[a-z0-9_-]+\.js$/i.test(basename);
  if (excluded) return Object.freeze({ admitted: false, stratum: null, reason: 'generated_or_build_artifact' });
  if (/(?:^|[._-])(?:test|tests|spec|specs)(?:[._-]|$)/i.test(relative)
    || lowerPieces.some((piece) => ['test', 'tests', '__tests__', 'spec', 'specs'].includes(piece))) {
    return Object.freeze({ admitted: true, stratum: 'test', reason: null });
  }
  const extension = path.posix.extname(relative).toLowerCase();
  if (['.md', '.mdx', '.rst', '.txt'].includes(extension)
    || lowerPieces.some((piece) => ['doc', 'docs', 'documentation'].includes(piece))) {
    return Object.freeze({ admitted: true, stratum: 'docs', reason: null });
  }
  if (['.json', '.yaml', '.yml', '.toml', '.ini'].includes(extension)
    || /(?:^|[._-])config(?:[._-]|$)/i.test(basename) || basename.startsWith('.')) {
    return Object.freeze({ admitted: true, stratum: 'config', reason: null });
  }
  return Object.freeze({ admitted: true, stratum: 'source', reason: null });
}

function extractedDefinitions(bytes) {
  const text = bytes.toString('utf8');
  const definitions = [];
  const pattern = /\b(function|class|interface|type|enum|const|let|var|def)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const match of text.matchAll(pattern)) {
    const line = text.slice(0, match.index).split('\n').length;
    definitions.push({ kind: match[1], symbol: match[2], line });
    if (definitions.length === CASE_DISCOVERY_LIMITS.max_definition_anchors_per_file) break;
  }
  return definitions;
}

function compactSignalFact(bytes, value) {
  const text = bytes.toString('utf8');
  const raw = String(value);
  const derived = /^(?:npm|bin|dependencies|devDependencies|peerDependencies|state):/.test(raw);
  const needle = derived ? raw.slice(raw.indexOf(':') + 1).split(':')[0] : raw;
  const offset = needle ? text.indexOf(needle) : -1;
  if (offset < 0) {
    return { value: raw.slice(0, 240), value_sha256: sha256(raw), occurrence: 'derived_unresolved',
      line: null, line_sha256: null };
  }
  const line = text.slice(0, offset).split('\n').length;
  const lineText = text.split(/\r?\n/)[line - 1] || '';
  return { value: raw.slice(0, 240), value_sha256: sha256(raw),
    occurrence: derived ? 'derived_component_literal' : 'exact_literal',
    line, line_sha256: sha256(lineText) };
}

function compactAnchor(record, category = null, role = 'positive') {
  const definition = record.definitions[0] || null;
  return {
    path: record.path,
    blob_oid: record.blob_oid,
    stratum: record.stratum,
    category,
    category_signal: category ? record.signal_facts[category] || null : null,
    symbol: definition?.symbol || null,
    line: definition?.line || null,
    content_sha256: record.content_sha256,
    role,
    independent_method: 'sealed_git_blob_static_scan',
  };
}

function stratified(records, maximum) {
  const selected = [];
  for (const stratum of DISCOVERY_PATH_RULES.strata) {
    const candidate = records.find((record) => record.stratum === stratum && !selected.includes(record));
    if (candidate) selected.push(candidate);
    if (selected.length === maximum) return selected;
  }
  for (const record of records) {
    if (!selected.includes(record)) selected.push(record);
    if (selected.length === maximum) break;
  }
  return selected;
}

function pathSimilarity(left, right) {
  const leftPieces = left.toLowerCase().split(/[/_.-]+/).filter(Boolean);
  const rightSet = new Set(right.toLowerCase().split(/[/_.-]+/).filter(Boolean));
  return leftPieces.filter((piece) => rightSet.has(piece)).length;
}

function buildCandidateIndex(records, trackedPaths, collection) {
  const categories = [...new Set(records.flatMap((record) => record.categories))].sort();
  const byCategory = Object.fromEntries(categories.map((category) => {
    const candidates = records.filter((record) => record.categories.includes(category));
    return [category, stratified(candidates, CASE_DISCOVERY_LIMITS.anchors_per_category)
      .map((record) => compactAnchor(record, category))];
  }));
  const neighbors = [];
  const decoys = [];
  for (const category of categories) {
    const anchor = byCategory[category][0];
    if (!anchor) continue;
    const candidates = records.filter((record) => record.path !== anchor.path
      && record.stratum === anchor.stratum).sort((left, right) =>
      pathSimilarity(anchor.path, right.path) - pathSimilarity(anchor.path, left.path)
      || gitByteCompare(left.path, right.path));
    const neighbor = candidates[0];
    if (neighbor && neighbors.length < CASE_DISCOVERY_LIMITS.max_neighbor_records) {
      neighbors.push({ category, anchor_path: anchor.path,
        candidate: compactAnchor(neighbor, null, 'near_neighbor') });
    }
    const negative = candidates.find((record) => !record.categories.includes(category));
    if (negative && decoys.length < CASE_DISCOVERY_LIMITS.max_negative_decoys) {
      decoys.push({
        category, anchor_path: anchor.path, candidate: compactAnchor(negative, null, 'negative'),
        basis: 'same_stratum_without_discovered_category',
      });
    }
  }
  const operationPool = stratified(records.filter((record) => record.byte_length > 0), 12);
  const take = (offset) => operationPool.slice(offset, offset + CASE_DISCOVERY_LIMITS.operation_candidates_per_kind);
  const modify = take(0).map((record) => compactAnchor(record, null, 'scenario_before'));
  const orderedTrackedPaths = [...new Set(trackedPaths)].sort(gitByteCompare);
  const occupiedDestinations = new Set(['']);
  for (const trackedPath of orderedTrackedPaths) {
    occupiedDestinations.add(trackedPath);
    let parent = path.posix.dirname(trackedPath);
    while (parent !== '.') {
      occupiedDestinations.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const orderedOccupiedDestinations = [...occupiedDestinations].sort(gitByteCompare);
  const destinationAuthority = Object.freeze({
    basis: 'complete_stage0_git_paths_and_implied_directories',
    tracked_path_count: orderedTrackedPaths.length,
    tracked_paths_sha256: digestObject(orderedTrackedPaths),
    occupied_destination_count: orderedOccupiedDestinations.length,
    occupied_destinations_sha256: digestObject(orderedOccupiedDestinations),
    portable_root_included: true,
  });
  const rename = take(3).map((record) => {
    let proposedPath = null;
    for (let attempt = 0; attempt < CASE_DISCOVERY_LIMITS.max_rename_destination_attempts; attempt += 1) {
      const candidate = renameDestinationAt(record, attempt);
      if (!occupiedDestinations.has(candidate)) {
        proposedPath = candidate;
        occupiedDestinations.add(candidate);
        break;
      }
    }
    if (!proposedPath) throw new Error('no absent rename destination exists within the fixed attempt bound');
    return { ...compactAnchor(record, null, 'scenario_before'), proposed_path: proposedPath,
      destination_absence: Object.freeze({ ...destinationAuthority, absent: true }) };
  });
  const remove = take(6).map((record) => compactAnchor(record, null, 'scenario_before'));
  const branch = take(9).map((record) => {
    const candidateId = digestObject({ path: record.path, blob_oid: record.blob_oid }).slice(0, 12);
    const proposedBranch = `lamina-oracle/${candidateId}`;
    if (!validAuthoringBranchName(proposedBranch)) throw new Error('generated branch candidate is invalid');
    return { ...compactAnchor(record, null, 'scenario_before'), proposed_branch: proposedBranch,
      source_commit: collection.commit, executed: false };
  });
  const logicalWorktree = take(9).map((record) => {
    const candidateId = digestObject({ path: record.path, blob_oid: record.blob_oid }).slice(0, 12);
    const logicalWorktreeId = `oracle-worktree-${candidateId}`;
    if (!validLogicalWorktreeId(logicalWorktreeId)) throw new Error('generated worktree candidate is invalid');
    return { ...compactAnchor(record, null, 'scenario_before'),
      logical_worktree_id: logicalWorktreeId, source_commit: collection.commit, executed: false };
  });
  const index = {
    schema: 'lamina.real-repository-oracle-discovery-index/v1',
    rules_sha256: digestObject(DISCOVERY_PATH_RULES),
    categories: byCategory,
    near_neighbors: neighbors,
    negative_decoys: decoys,
    operation_candidates: { modify, rename, delete: remove, branch, logical_worktree: logicalWorktree },
  };
  return Object.freeze({ ...index, index_sha256: digestObject(index) });
}

export function discoverCandidateFacts(
  repository, collection, candidateVisitor = visitReviewedDiscoveryCandidates,
) {
  const records = [];
  let excludedGeneratedArtifacts = 0;
  if (typeof candidateVisitor !== 'function') throw new Error('case discovery requires a candidate visitor');
  const visited = candidateVisitor(repository, collection, (candidate) => {
    const disposition = discoveryPathDisposition(candidate.path);
    if (!disposition.admitted) { excludedGeneratedArtifacts += 1; return; }
    const observed = brownfieldSignals(candidate.path, candidate.bytes);
    const definitions = extractedDefinitions(candidate.bytes);
    const signalFacts = Object.fromEntries(observed.categories.map((category) => [
      category, compactSignalFact(candidate.bytes, observed.signals?.[category]?.[0] || candidate.path),
    ]));
    records.push({
      path: candidate.path, blob_oid: candidate.blob_oid, byte_length: candidate.bytes.length,
      content_sha256: sha256(candidate.bytes), stratum: disposition.stratum,
      categories: observed.categories, definitions, signal_facts: signalFacts,
    });
  });
  const visitedPathSet = new Set(visited?.tracked_paths || []);
  if (!visited || !Array.isArray(visited.tracked_paths)
    || visited.tracked_paths.some((trackedPath) => typeof trackedPath !== 'string'
      || trackedPath.length === 0 || Buffer.byteLength(trackedPath) > 4_096
      || /[\u0000-\u001f\u007f]/.test(trackedPath))
    || visitedPathSet.size !== visited.tracked_paths.length
    || records.some((record) => !visitedPathSet.has(record.path))) {
    throw new Error('case discovery requires complete stage-0 tracked path authority');
  }
  records.sort((left, right) => gitByteCompare(left.path, right.path));
  const candidateIndex = buildCandidateIndex(records, visited.tracked_paths, collection);
  return Object.freeze({
    schema: CASE_DISCOVERY_SCHEMA,
    workload_id: 'real-repository-oracle-v1:case-discovery',
    status: 'unreviewed_case_discovery_candidate',
    admission: 'reviewed_inventory_verified',
    collection: Object.freeze({
      fixture_id: collection.fixture_id, fixture_class: collection.fixture_class,
      repository_url: collection.repository_url, commit: collection.commit,
      tree_oid: collection.tree_oid,
      baseline_manifest_sha256: collection.baseline_manifest_sha256,
      candidate_policy_sha256: collection.candidate_policy_sha256,
    }),
    inventory: collection.reviewed_inventory,
    bounds: CASE_DISCOVERY_LIMITS,
    scan: Object.freeze({ candidate_files: visited.candidate_files,
      candidate_bytes: visited.candidate_bytes, tracked_path_count: visited.tracked_paths.length,
      admitted_index_files: records.length, excluded_generated_artifacts: excludedGeneratedArtifacts }),
    candidate_index: candidateIndex,
    authoring_handoff: Object.freeze({
      next_action: 'reviewer_selects_bounded_evidence_anchors', freeze_allowed: false,
      selection_schema: 'lamina.real-repository-oracle-evidence-selection/v1',
    }),
    expectations_loaded: false,
    grade_controller_evidence: false,
    quality_claims: NO_QUALITY_CLAIMS,
    limitation: 'This deterministic index contains non-semantic reviewer candidates only. Categories are static-scan signals, neighbors and decoys are lexical path controls, and operation paths are unexecuted authoring candidates. It defines no Workflow, domain meaning, golden expectation, quality grade, retrieval result, or runtime claim.',
  });
}

export function encodeDiscoveryPayload(result) {
  validateDiscoveryResult(result);
  if (canonicalSemanticBytes(result).length > DISCOVERY_RECONSTRUCTED_MAX_BYTES) {
    throw new Error('complete case-discovery semantic payload exceeds its reconstructed-byte bound');
  }
  const transport = Buffer.from(JSON.stringify(packDiscoveryResult(result)));
  if (transport.length > DISCOVERY_TRANSPORT_MAX_BYTES) {
    throw new Error('complete case-discovery transport exceeds its decoded-byte bound');
  }
  const compressed = zlib.brotliCompressSync(transport, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const line = `${CASE_DISCOVERY_PAYLOAD_PREFIX}${compressed.toString('base64url')}`;
  if (Buffer.byteLength(line) > CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES) {
    throw new Error('complete case-discovery candidate index exceeds the retained report-tail bound');
  }
  return Object.freeze({ result, line });
}

export function decodeDiscoveryPayload(line) {
  if (typeof line !== 'string' || !line.startsWith(CASE_DISCOVERY_PAYLOAD_PREFIX)
    || Buffer.byteLength(line) > CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES) {
    throw new Error('case-discovery payload line is outside the retained-output contract');
  }
  try {
    const encoded = line.slice(CASE_DISCOVERY_PAYLOAD_PREFIX.length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('invalid base64url');
    const compressed = Buffer.from(encoded, 'base64url');
    if (compressed.toString('base64url') !== encoded) throw new Error('non-canonical base64url');
    const bytes = zlib.brotliDecompressSync(compressed, {
      maxOutputLength: DISCOVERY_TRANSPORT_MAX_BYTES,
    });
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return unpackDiscoveryResult(JSON.parse(text), bytes);
  } catch { throw new Error('case-discovery payload line is malformed'); }
}

export function discoverSignedTier() {
  return withSignedReviewedRepository(
    'real-repository case discovery',
    ({ repository, collection }) => discoverCandidateFacts(repository, collection),
  );
}
