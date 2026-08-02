import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { brownfieldSignals } from '../../packages/cli/lib/observation-runtime/node.mjs';
import {
  CASE_DISCOVERY_SCAN_LIMITS, visitReviewedDiscoveryCandidates,
  withSignedReviewedRepository,
} from './materialize.mjs';

export const CASE_DISCOVERY_SCHEMA = 'lamina.real-repository-oracle-case-discovery/v1';
export const CASE_DISCOVERY_PAYLOAD_PREFIX = 'LAMINA_REAL_REPOSITORY_CASE_DISCOVERY_V1=';
export const CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES = 7_680;
export const CASE_DISCOVERY_LIMITS = Object.freeze({
  ...CASE_DISCOVERY_SCAN_LIMITS,
  max_retained_records: 96,
  max_values_per_signal: 12,
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

function extractedDefinitions(bytes) {
  const text = bytes.toString('utf8');
  const definitions = [];
  const pattern = /\b(function|class|interface|type|enum|const|let|var|def)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const match of text.matchAll(pattern)) {
    const line = text.slice(0, match.index).split('\n').length;
    const rawContext = text.slice(Math.max(0, text.lastIndexOf('\n', match.index) + 1),
      text.indexOf('\n', match.index) < 0 ? text.length : text.indexOf('\n', match.index));
    const context = rawContext.trim().replace(/\s+/g, ' ').slice(0, 180);
    definitions.push({
      kind: match[1], symbol: match[2], line, context,
      context_sha256: sha256(rawContext),
    });
    if (definitions.length === CASE_DISCOVERY_LIMITS.max_values_per_signal) break;
  }
  return definitions;
}

function boundedSignals(signals) {
  return Object.fromEntries(Object.entries(signals || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, values]) => [category, values
      .slice(0, CASE_DISCOVERY_LIMITS.max_values_per_signal)
      .map((value) => String(value).slice(0, 180))]));
}

export function discoverCandidateFacts(repository, collection) {
  const retained = [];
  const scan = visitReviewedDiscoveryCandidates(repository, collection, (candidate) => {
    const observed = brownfieldSignals(candidate.path, candidate.bytes);
    const definitions = extractedDefinitions(candidate.bytes);
    if (!observed.categories.length && !definitions.length) return;
    const signals = boundedSignals(observed.signals);
    retained.push({
      path: candidate.path,
      blob_oid: candidate.blob_oid,
      byte_length: candidate.bytes.length,
      content_sha256: sha256(candidate.bytes),
      categories: observed.categories,
      signals,
      definitions,
      unsupported: observed.unsupported,
      signal_value_count: Object.values(signals).reduce((total, values) => total + values.length, 0)
        + definitions.length,
    });
  });
  retained.sort((left, right) => right.categories.length - left.categories.length
    || right.signal_value_count - left.signal_value_count
    || left.path.localeCompare(right.path));
  const sampled = [];
  const categories = [...new Set(retained.flatMap((record) => record.categories))].sort();
  for (const category of categories) {
    const candidate = retained.find((record) => record.categories.includes(category)
      && !sampled.includes(record));
    if (candidate) sampled.push(candidate);
  }
  for (const candidate of retained) {
    if (sampled.length >= CASE_DISCOVERY_LIMITS.max_retained_records) break;
    if (!sampled.includes(candidate)) sampled.push(candidate);
  }
  const records = sampled.slice(0, CASE_DISCOVERY_LIMITS.max_retained_records)
    .map(({ signal_value_count: _score, ...record }) => record);
  const categoryCoverage = Object.fromEntries(categories.map((category) => [category,
    records.filter((record) => record.categories.includes(category)).length]));
  return Object.freeze({
    schema: CASE_DISCOVERY_SCHEMA,
    workload_id: 'real-repository-oracle-v1:case-discovery',
    status: 'unreviewed_case_discovery_candidate',
    admission: 'reviewed_inventory_verified',
    collection: Object.freeze({
      fixture_id: collection.fixture_id,
      fixture_class: collection.fixture_class,
      repository_url: collection.repository_url,
      commit: collection.commit,
      tree_oid: collection.tree_oid,
      baseline_manifest_sha256: collection.baseline_manifest_sha256,
      candidate_policy_sha256: collection.candidate_policy_sha256,
    }),
    inventory: collection.reviewed_inventory,
    bounds: CASE_DISCOVERY_LIMITS,
    scan,
    retained_records: records,
    retained_record_count: records.length,
    omitted_signal_records: Math.max(0, retained.length - records.length),
    category_coverage: categoryCoverage,
    retained_records_sha256: sha256(JSON.stringify(records)),
    authoring_handoff: Object.freeze({
      next_action: 'independent_human_review',
      freeze_allowed: false,
      required_receipt: 'lamina.real-repository-oracle-case-expectation-review/v1',
      required_checks: Object.freeze([
        'git_blob_and_symbol_identity',
        'expectation_private_from_adapter',
        'all_query_intent_scope_and_repository_state_coverage_per_pin',
        'production_seam_result_provenance',
      ]),
    }),
    expectations_loaded: false,
    grade_controller_evidence: false,
    quality_claims: NO_QUALITY_CLAIMS,
    limitation: 'This bounded production-signal scan is an unreviewed case-authoring candidate only. It does not define golden expectations, select Workflows, grade quality, exercise the public CLI, or make observation, obligation, retrieval, or runtime claims.',
  });
}

function compactDiscoveryResult(result) {
  const compact = structuredClone(result);
  const requiredCategories = Object.entries(result.category_coverage)
    .filter(([, count]) => count > 0).map(([category]) => category);
  while (true) {
    compact.retained_record_count = compact.retained_records.length;
    compact.omitted_signal_records = result.omitted_signal_records
      + result.retained_records.length - compact.retained_records.length;
    compact.category_coverage = Object.fromEntries(Object.keys(result.category_coverage)
      .map((category) => [category,
        compact.retained_records.filter((record) => record.categories.includes(category)).length]));
    compact.retained_records_sha256 = sha256(JSON.stringify(compact.retained_records));
    const compressed = zlib.brotliCompressSync(Buffer.from(JSON.stringify(compact)), {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    });
    const line = `${CASE_DISCOVERY_PAYLOAD_PREFIX}${compressed.toString('base64url')}`;
    if (Buffer.byteLength(line) <= CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES) {
      if (requiredCategories.some((category) => compact.category_coverage[category] < 1)) {
        throw new Error('case-discovery compaction lost mandatory category coverage');
      }
      return Object.freeze({ result: Object.freeze(compact), line });
    }
    const removableIndex = compact.retained_records.findLastIndex((record) =>
      record.categories.every((category) => compact.category_coverage[category] > 1));
    if (removableIndex < 0) {
      throw new Error(
        'mandatory case-discovery category evidence exceeds the safe-runner diagnostic-tail bound',
      );
    }
    compact.retained_records.splice(removableIndex, 1);
  }
}

export function encodeDiscoveryPayload(result) { return compactDiscoveryResult(result); }

export function decodeDiscoveryPayload(line) {
  if (typeof line !== 'string' || !line.startsWith(CASE_DISCOVERY_PAYLOAD_PREFIX)
    || Buffer.byteLength(line) > CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES) {
    throw new Error('case-discovery payload line is outside the retained-output contract');
  }
  try {
    const bytes = Buffer.from(line.slice(CASE_DISCOVERY_PAYLOAD_PREFIX.length), 'base64url');
    return JSON.parse(zlib.brotliDecompressSync(bytes, { maxOutputLength: 512 * 1024 }).toString('utf8'));
  } catch {
    throw new Error('case-discovery payload line is malformed');
  }
}

export function discoverSignedTier() {
  return withSignedReviewedRepository(
    'real-repository case discovery',
    ({ repository, collection }) => discoverCandidateFacts(repository, collection),
  );
}
