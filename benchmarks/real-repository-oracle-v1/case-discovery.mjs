import crypto from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { brownfieldSignals } from '../../packages/cli/lib/observation-runtime/node.mjs';
import {
  CASE_DISCOVERY_SCAN_LIMITS, visitReviewedDiscoveryCandidates,
  withSignedReviewedRepository,
} from './materialize.mjs';

export const CASE_DISCOVERY_SCHEMA = 'lamina.real-repository-oracle-case-discovery/v2';
export const CASE_DISCOVERY_PAYLOAD_PREFIX = 'LAMINA_REAL_REPOSITORY_CASE_DISCOVERY_V2=';
export const CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES = 7_680;
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
    'bun.lock', 'cargo.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  ]),
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

export function discoveryPathDisposition(relative) {
  const pieces = relative.split('/');
  const basename = pieces.at(-1).toLowerCase();
  const lowerPieces = pieces.map((piece) => piece.toLowerCase());
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
  const existingPaths = new Set(orderedTrackedPaths);
  const trackedPathAuthority = Object.freeze({
    basis: 'complete_stage0_git_tracked_paths',
    tracked_path_count: orderedTrackedPaths.length,
    tracked_paths_sha256: digestObject(orderedTrackedPaths),
  });
  const rename = take(3).map((record) => {
    const parent = path.posix.dirname(record.path) === '.' ? '' : `${path.posix.dirname(record.path)}/`;
    const extension = path.posix.extname(record.path);
    let proposedPath = null;
    for (let attempt = 0; attempt < CASE_DISCOVERY_LIMITS.max_rename_destination_attempts; attempt += 1) {
      const suffix = attempt === 0 ? '' : `-${attempt}`;
      const candidate = `${parent}lamina-oracle-rename-${record.blob_oid.slice(0, 8)}${suffix}${extension}`;
      if (!existingPaths.has(candidate)) { proposedPath = candidate; break; }
    }
    if (!proposedPath) throw new Error('no absent rename destination exists within the fixed attempt bound');
    return { ...compactAnchor(record, null, 'scenario_before'), proposed_path: proposedPath,
      destination_absence: Object.freeze({ ...trackedPathAuthority, absent: true }) };
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
  const compressed = zlib.brotliCompressSync(Buffer.from(JSON.stringify(result)), {
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
    const bytes = Buffer.from(line.slice(CASE_DISCOVERY_PAYLOAD_PREFIX.length), 'base64url');
    return JSON.parse(zlib.brotliDecompressSync(bytes, { maxOutputLength: 512 * 1024 }).toString('utf8'));
  } catch { throw new Error('case-discovery payload line is malformed'); }
}

export function discoverSignedTier() {
  return withSignedReviewedRepository(
    'real-repository case discovery',
    ({ repository, collection }) => discoverCandidateFacts(repository, collection),
  );
}
