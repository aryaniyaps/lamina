/** Retrieval generation, membership digests, and interrupted recovery (#73).
 *
 * Derived retrieval state only — graphd remains the sole Ladybug writer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha256 as contractSha256 } from '../../../benchmarks/runtime-baseline-v1/contract.mjs';
import { digest, repositoryContext } from './graph-runtime/util.mjs';
import { enumerateRetrievalCandidatePaths, gitByteCompare } from './source-inventory.mjs';

export const RETRIEVAL_GENERATION_SCHEMA = 'lamina.retrieval-generation/v1';
export const GENERATION_STATE_FILE = 'retrieval-generation-state.json';

export function retrievalFreshnessContext(cwd = process.cwd(), {
  graph_version = '',
  model_digest = '',
  schema_version = 1,
  observation_generation = '',
  observation_membership_digest = contractSha256(''),
} = {}) {
  const repository = repositoryContext(cwd);
  return Object.freeze({
    source_revision: repository.source_revision,
    repository_revision: repository.revision || '',
    branch: repository.branch,
    worktree: repository.root,
    graph_version,
    model_digest,
    schema_version,
    observation_generation,
    observation_membership_digest,
    non_canonical: true,
    writes_product_truth: false,
  });
}

export function retrievalMembershipDigest(documents) {
  const entries = (documents || [])
    .map((item) => ({
      content_hash: item.content_hash,
      id: item.id,
      logical_key: item.logical_key,
    }))
    .sort((left, right) => gitByteCompare(left.logical_key, right.logical_key))
    .map((item) => `${item.logical_key}\0${item.content_hash}\0${item.id}`);
  return contractSha256(entries.join('\n'));
}

export function retrievalGenerationId({ identity, ...freshness }) {
  return digest('retrieval_generation', {
    identity,
    graph_version: freshness.graph_version,
    source_revision: freshness.source_revision,
    repository_revision: freshness.repository_revision,
    branch: freshness.branch,
    worktree: freshness.worktree,
    model_digest: freshness.model_digest,
    schema_version: freshness.schema_version,
    observation_generation: freshness.observation_generation || '',
    observation_membership_digest: freshness.observation_membership_digest || contractSha256(''),
  });
}

export function generationStatePath(contextDir) {
  return path.join(contextDir, GENERATION_STATE_FILE);
}

export function emptyGenerationState() {
  return {
    schema: RETRIEVAL_GENERATION_SCHEMA,
    version: 1,
    generation: null,
    source_revision: null,
    repository_revision: '',
    branch: null,
    worktree: null,
    graph_version: null,
    model_digest: null,
    schema_version: 1,
    observation_generation: '',
    observation_membership_digest: contractSha256(''),
    index_digest: contractSha256(''),
    membership_digest: contractSha256(''),
    commit_phase: 'committed',
    non_canonical: true,
    writes_product_truth: false,
  };
}

export function readGenerationState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (parsed?.schema !== RETRIEVAL_GENERATION_SCHEMA) return emptyGenerationState();
    return {
      ...emptyGenerationState(),
      ...parsed,
    };
  } catch {
    return emptyGenerationState();
  }
}

export function writeGenerationState(statePath, state) {
  const normalized = Object.freeze({
    ...state,
    schema: RETRIEVAL_GENERATION_SCHEMA,
    version: 1,
    non_canonical: true,
    writes_product_truth: false,
  });
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  return normalized;
}

export function freshnessChanged(previous, current) {
  return !previous
    || previous.source_revision !== current.source_revision
    || previous.repository_revision !== current.repository_revision
    || previous.branch !== current.branch
    || previous.worktree !== current.worktree
    || previous.graph_version !== current.graph_version
    || previous.model_digest !== current.model_digest
    || Number(previous.schema_version) !== Number(current.schema_version)
    || previous.observation_generation !== current.observation_generation
    || previous.observation_membership_digest !== current.observation_membership_digest;
}

export function interruptedRecoveryNeeded(previous, { generation, freshness }) {
  if (!previous || previous.generation !== generation) return false;
  if (previous.commit_phase !== 'pending') return false;
  return !freshnessChanged(previous, freshness);
}

export function planRetrievalSync({
  repositoryRoot,
  identity,
  freshness,
  previous,
  includeUntracked = false,
}) {
  const generation = retrievalGenerationId({ identity, ...freshness });
  const sourcePaths = enumerateRetrievalCandidatePaths(repositoryRoot, { includeUntracked });
  const fullReconcile = previous.generation !== generation || freshnessChanged(previous, freshness);
  const interrupted = interruptedRecoveryNeeded(previous, { generation, freshness });
  return Object.freeze({
    generation,
    identity,
    freshness,
    source_paths: Object.freeze(sourcePaths),
    full_reconcile: fullReconcile,
    interrupted_recovery: interrupted,
    non_canonical: true,
    writes_product_truth: false,
  });
}

export function activateGenerationPlan(plan, status = null) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('retrieval generation activation requires a plan');
  }
  if (status?.index_digest && plan.index_digest && status.index_digest !== plan.index_digest) {
    const error = new Error('Retrieval generation index digest is invalid; it was not activated.');
    error.code = 'LAMINA_RETRIEVAL_INCOMPLETE';
    error.details = {
      expected_digest: plan.index_digest,
      actual_digest: status.index_digest,
      non_canonical: true,
    };
    throw error;
  }
  if (status?.committed_count !== undefined && status?.expected_count !== undefined) {
    if (Number(status.committed_count) !== Number(status.expected_count)) {
      const error = new Error('Retrieval generation item count is incomplete; it was not activated.');
      error.code = 'LAMINA_RETRIEVAL_INCOMPLETE';
      error.details = {
        expected_count: status.expected_count,
        committed_count: status.committed_count,
        non_canonical: true,
      };
      throw error;
    }
  }
  return Object.freeze({
    generation: plan.generation,
    index_digest: plan.index_digest || status?.index_digest || plan.membership_digest,
    membership_digest: plan.membership_digest || plan.index_digest,
    committed: true,
    interrupted_recovery: plan.interrupted_recovery,
    non_canonical: true,
    writes_product_truth: false,
  });
}

export function commitGenerationState(statePath, plan, status, { phase = 'committed' } = {}) {
  return writeGenerationState(statePath, {
    schema: RETRIEVAL_GENERATION_SCHEMA,
    version: 1,
    generation: plan.generation,
    source_revision: plan.freshness.source_revision,
    repository_revision: plan.freshness.repository_revision,
    branch: plan.freshness.branch,
    worktree: plan.freshness.worktree,
    graph_version: plan.freshness.graph_version,
    model_digest: plan.freshness.model_digest,
    schema_version: plan.freshness.schema_version,
    observation_generation: plan.freshness.observation_generation,
    observation_membership_digest: plan.freshness.observation_membership_digest,
    index_digest: status?.index_digest || plan.index_digest || contractSha256(''),
    membership_digest: status?.index_digest || plan.membership_digest || contractSha256(''),
    commit_phase: phase,
    non_canonical: true,
    writes_product_truth: false,
  });
}
