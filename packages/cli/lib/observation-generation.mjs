/** Observation generation, invalidation, tombstones, and interrupted recovery (#72).
 *
 * Derived observation state only — never writes canonical product truth.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sha256 as contractSha256 } from '../../../benchmarks/runtime-baseline-v1/contract.mjs';
import { canonical, digest, repositoryContext } from './graph-runtime/util.mjs';
import { enumerateObservationPaths, gitByteCompare } from './source-inventory.mjs';

export const OBSERVATION_GENERATION_SCHEMA = 'lamina.observation-generation/v1';
export const GENERATION_STATE_FILE = 'observation-generation-state.json';

export function observationFreshnessContext(cwd = process.cwd()) {
  const repository = repositoryContext(cwd);
  return Object.freeze({
    source_revision: repository.source_revision,
    repository_revision: repository.revision || '',
    branch: repository.branch,
    worktree: repository.root,
    non_canonical: true,
    writes_product_truth: false,
  });
}

export function observationMembershipDigest(records) {
  const entries = Object.entries(records || {})
    .sort(([left], [right]) => gitByteCompare(left, right))
    .map(([sourceKey, record]) => `${sourceKey}\0${record?.fingerprint || ''}\0${record?.id || ''}`);
  return contractSha256(entries.join('\n'));
}

export function generationStatePath(cocoindexDir) {
  return path.join(cocoindexDir, GENERATION_STATE_FILE);
}

export function emptyGenerationState() {
  return {
    schema: OBSERVATION_GENERATION_SCHEMA,
    version: 1,
    generation: null,
    source_revision: null,
    repository_revision: '',
    branch: null,
    worktree: null,
    records: {},
    tombstones: {},
    membership_digest: contractSha256(''),
    commit_phase: 'committed',
    non_canonical: true,
    writes_product_truth: false,
  };
}

export function readGenerationState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (parsed?.schema !== OBSERVATION_GENERATION_SCHEMA) return emptyGenerationState();
    return {
      ...emptyGenerationState(),
      ...parsed,
      records: parsed.records || {},
      tombstones: parsed.tombstones || {},
    };
  } catch {
    return emptyGenerationState();
  }
}

export function writeGenerationState(statePath, state) {
  const normalized = Object.freeze({
    ...state,
    schema: OBSERVATION_GENERATION_SCHEMA,
    version: 1,
    membership_digest: observationMembershipDigest(state.records),
    non_canonical: true,
    writes_product_truth: false,
  });
  fs.writeFileSync(statePath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  return normalized;
}

export function freshnessChanged(previous, current) {
  return !previous
    || previous.source_revision !== current.source_revision
    || previous.repository_revision !== current.repository_revision
    || previous.branch !== current.branch
    || previous.worktree !== current.worktree;
}

export function interruptedRecoveryNeeded(previous, { generation, freshness }) {
  if (!previous || previous.generation !== generation) return false;
  if (previous.commit_phase !== 'pending') return false;
  return !freshnessChanged(previous, freshness);
}

export function buildObservationEnvelope({
  relative,
  content,
  snapshot,
  extractSignals,
  extractor = { id: 'lamina.source-file', version: '2' },
}) {
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  const payload = {
    media_type: content.subarray(0, 4096).includes(0) ? 'binary' : 'text',
    byte_length: content.length,
    brownfield: extractSignals(relative, content),
  };
  const envelope = {
    source_snapshot: snapshot,
    source_key: relative,
    content_hash: contentHash,
    path: relative,
    extractor,
    payload,
  };
  envelope.id = digest('observation', {
    snapshot: envelope.source_snapshot,
    source_key: envelope.source_key,
    content_hash: envelope.content_hash,
    extractor: envelope.extractor,
    payload: envelope.payload,
  });
  const fingerprint = digest('fingerprint', canonical(envelope));
  return { envelope, fingerprint };
}

export function planObservationSync({
  repositoryRoot,
  generation,
  snapshot,
  freshness,
  previous,
  extractSignals,
  readFile = fs.readFileSync,
}) {
  const nextRecords = {};
  const envelopes = [];
  const fullReconcile = previous.generation !== generation || freshnessChanged(previous, freshness);
  const interrupted = interruptedRecoveryNeeded(previous, { generation, freshness });

  for (const { path: relative } of enumerateObservationPaths(repositoryRoot)) {
    let content;
    try { content = readFile(path.join(repositoryRoot, relative)); } catch { continue; }
    const { envelope, fingerprint } = buildObservationEnvelope({
      relative,
      content,
      snapshot,
      extractSignals,
    });
    nextRecords[relative] = { id: envelope.id, fingerprint };
    if (fullReconcile || interrupted || previous.records[relative]?.fingerprint !== fingerprint) {
      envelopes.push(envelope);
    }
  }

  const tombstones = { ...previous.tombstones };
  const deletes = [];
  for (const [relative, record] of Object.entries(previous.records)) {
    if (nextRecords[relative]) continue;
    deletes.push(record.id);
    tombstones[relative] = Object.freeze({
      id: record.id,
      generation,
      tombstoned_at: new Date().toISOString(),
      reason: 'path_removed',
    });
  }

  const membershipDigest = observationMembershipDigest(nextRecords);
  return Object.freeze({
    generation,
    snapshot,
    freshness,
    envelopes,
    deletes,
    tombstones,
    records: nextRecords,
    membership_digest: membershipDigest,
    expected_count: Object.keys(nextRecords).length,
    full_reconcile: fullReconcile,
    interrupted_recovery: interrupted,
    non_canonical: true,
    writes_product_truth: false,
  });
}

export function activateGenerationPlan(plan, observedStatus = null) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('observation generation activation requires a plan');
  }
  const actualDigest = observationMembershipDigest(plan.records);
  if (actualDigest !== plan.membership_digest) {
    const error = new Error('Observation generation membership digest is invalid; it was not activated.');
    error.code = 'LAMINA_OBSERVATION_INCOMPLETE';
    error.details = {
      expected_digest: plan.membership_digest,
      actual_digest: actualDigest,
      non_canonical: true,
    };
    throw error;
  }
  if (observedStatus?.exists) {
    const observedCount = Number(observedStatus.source_key_count ?? observedStatus.count ?? 0);
    if (observedCount !== plan.expected_count) {
      const error = new Error('Observation generation item count is incomplete; it was not activated.');
      error.code = 'LAMINA_OBSERVATION_INCOMPLETE';
      error.details = {
        expected_count: plan.expected_count,
        observed_count: observedCount,
        membership_digest: plan.membership_digest,
        non_canonical: true,
      };
      throw error;
    }
  }
  return Object.freeze({
    generation: plan.generation,
    membership_digest: plan.membership_digest,
    expected_count: plan.expected_count,
    committed: true,
    interrupted_recovery: plan.interrupted_recovery,
    non_canonical: true,
    writes_product_truth: false,
  });
}

export function commitGenerationState(statePath, plan, { phase = 'committed' } = {}) {
  return writeGenerationState(statePath, {
    schema: OBSERVATION_GENERATION_SCHEMA,
    version: 1,
    generation: plan.generation,
    source_revision: plan.freshness.source_revision,
    repository_revision: plan.freshness.repository_revision,
    branch: plan.freshness.branch,
    worktree: plan.freshness.worktree,
    records: plan.records,
    tombstones: plan.tombstones,
    membership_digest: plan.membership_digest,
    commit_phase: phase,
    non_canonical: true,
    writes_product_truth: false,
  });
}
