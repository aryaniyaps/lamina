import crypto from 'node:crypto';
import {
  WORKFLOW_TIER_SEED_CANONICAL_SHA256,
  loadWorkflowTierProjection,
} from './workflow-seed.mjs';

export const CANDIDATE_PUBLIC_BATCH_SCHEMA = 'lamina.real-repository-oracle-candidate-batch/v1';
export const CANDIDATE_RAW_SCHEMA = 'lamina.real-repository-oracle-candidate-raw/v1';
export const CANDIDATE_ADAPTER_SCHEMA = 'lamina.real-repository-oracle-candidate-adapter/v1';
export const PERSONA_PROBE_EVIDENCE_SCHEMA = 'lamina.real-repository-oracle-persona-probe-evidence/v1';
export const CANDIDATE_RAW_MAX_CANONICAL_BYTES = 16 * 1024 * 1024;
export const CANDIDATE_MAX_REQUESTS = 256;

const PUBLIC_BATCH_MAX_BYTES = 4 * 1024 * 1024;
const MAX_STRUCTURE_DEPTH = 64;
const MAX_STRUCTURE_NODES = CANDIDATE_RAW_MAX_CANONICAL_BYTES;
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_STRING_BYTES = 2 * 1024;
const MAX_RESULT_ROWS = CANDIDATE_MAX_REQUESTS;
const MAX_WORKFLOWS = 15;
const MAX_SOURCE_RANKING = 6_000;
const MAX_OBSERVATIONS = 84_000;
const MAX_OBLIGATIONS = 256;
const MAX_CHANGES = 64;
const MAX_PROBE_OBSERVATIONS = 16;
const SHA256 = /^[a-f0-9]{64}$/;
const NONCE = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const TIERS = Object.freeze(['small', 'medium', 'large']);
const OUTCOMES = Object.freeze(['selected', 'multi_workflow', 'ambiguous', 'new_workflow_required']);
const CHANGE_KINDS = Object.freeze(['ordinary', 'renamed', 'copied', 'deleted', 'unmerged', 'untracked']);
const OBSERVATION_CATEGORIES = Object.freeze([
  'entry_points', 'commands', 'routes', 'handlers', 'schemas', 'entities',
  'state_transitions', 'permissions', 'events', 'tests', 'documentation',
  'personas', 'feature_flags', 'dependencies',
]);
const OBLIGATION_CATEGORIES = Object.freeze([
  'implementation', 'state', 'permission', 'failure', 'persona', 'completeness', 'verification',
]);
const PRIVATE_KEY_PARTS = Object.freeze([
  'caseid', 'scenario', 'recipe', 'fixture', 'expected', 'expectation', 'mutation', 'grade', 'grading',
  'claim', 'attestation',
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => JSON.stringify(canonicalCandidateValue(left))
  === JSON.stringify(canonicalCandidateValue(right));
const exactKeys = (value, keys) => isObject(value)
  && same(Object.keys(value).sort(), [...keys].sort());
const byteLength = (value) => Buffer.byteLength(value, 'utf8');
const boundedString = (value, maximum = MAX_STRING_BYTES) => typeof value === 'string'
  && value.length > 0 && byteLength(value) <= maximum;
const unique = (values) => new Set(values).size === values.length;

function boundedStructure(value) {
  const pending = [{ value, depth: 0 }];
  const active = new WeakSet();
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop();
    if (current.exit) {
      active.delete(current.value);
      continue;
    }
    nodes += 1;
    if (nodes > MAX_STRUCTURE_NODES) {
      return { valid: false, error: 'structure node count exceeds the bounded contract' };
    }
    if (current.depth > MAX_STRUCTURE_DEPTH) {
      return { valid: false, error: 'structure depth exceeds the bounded contract' };
    }
    const item = current.value;
    if (item === null || typeof item === 'string' || typeof item === 'boolean'
      || (typeof item === 'number' && Number.isFinite(item))) continue;
    if (!Array.isArray(item) && !isObject(item)) {
      return { valid: false, error: 'structure contains a non-JSON value' };
    }
    if (Array.isArray(item) && item.length > MAX_OBSERVATIONS) {
      return { valid: false, error: 'structure array length exceeds every declared array contract' };
    }
    if (active.has(item)) return { valid: false, error: 'structure contains a cycle' };
    active.add(item);
    pending.push({ value: item, depth: current.depth, exit: true });
    for (const child of Object.values(item)) pending.push({ value: child, depth: current.depth + 1 });
  }
  return { valid: true, error: null };
}

export function canonicalCandidateValue(value) {
  const structure = boundedStructure(value);
  if (!structure.valid) throw new Error(`Candidate value ${structure.error}`);
  if (!Array.isArray(value) && !isObject(value)) return value;
  const result = Array.isArray(value) ? new Array(value.length) : {};
  const pending = [{ source: value, target: result }];
  while (pending.length) {
    const { source, target } = pending.pop();
    const keys = Array.isArray(source) ? Object.keys(source) : Object.keys(source).sort();
    for (const key of keys) {
      const child = source[key];
      if (Array.isArray(child) || isObject(child)) {
        target[key] = Array.isArray(child) ? new Array(child.length) : {};
        pending.push({ source: child, target: target[key] });
      } else {
        target[key] = child;
      }
    }
  }
  return result;
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonicalCandidateValue(value)), 'utf8');
}

function deepFreeze(value) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || Object.isFrozen(current)) continue;
    for (const child of Object.values(current)) pending.push(child);
    Object.freeze(current);
  }
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function privateKey(value, { skipTierSeed = false } = {}) {
  const pending = [{ value, at: '$', root: true }];
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current.value[index], at: `${current.at}[${index}]`, root: false });
      }
      continue;
    }
    if (!isObject(current.value)) continue;
    const entries = Object.entries(current.value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      if (skipTierSeed && current.root && key === 'tier_seed') continue;
      const normalized = key.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '');
      if (PRIVATE_KEY_PARTS.some((part) => normalized.includes(part))) return `${current.at}.${key}`;
      pending.push({ value: child, at: `${current.at}.${key}`, root: false });
    }
  }
  return null;
}

function safeRelativePath(value) {
  if (!boundedString(value, 4096) || /[\u0000-\u001f\u007f]/u.test(value) || value.includes('\\')
    || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('//')
    || value.endsWith('/')) return false;
  return value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function validAdapter(value) {
  return exactKeys(value, ['schema', 'id', 'version', 'input_format', 'output_format'])
    && value.schema === CANDIDATE_ADAPTER_SCHEMA
    && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value.id || '')
    && Number.isSafeInteger(value.version) && value.version >= 1 && value.version <= 1_000_000
    && value.input_format === CANDIDATE_PUBLIC_BATCH_SCHEMA
    && value.output_format === CANDIDATE_RAW_SCHEMA;
}

function publicBatchIdentity(batch) {
  const { public_input_sha256: _claimed, ...identity } = batch;
  return identity;
}

export function candidatePublicInputDigest(batch) {
  return sha256(canonicalBytes(publicBatchIdentity(batch)));
}

export function validateCandidatePublicBatch(batch) {
  const errors = [];
  const structure = boundedStructure(batch);
  if (!structure.valid) return { valid: false, errors: [`Candidate public batch ${structure.error}`] };
  const leaked = privateKey(batch, { skipTierSeed: true });
  if (leaked) errors.push(`Candidate public batch contains a private controller key at ${leaked}`);
  if (!exactKeys(batch, ['schema', 'tier', 'implementation', 'public_input_sha256', 'requests', 'tier_seed'])) {
    return { valid: false, errors: [...errors, 'Candidate public batch has unexpected or missing fields'] };
  }
  if (batch.schema !== CANDIDATE_PUBLIC_BATCH_SCHEMA) errors.push('Candidate public batch schema is invalid');
  if (!TIERS.includes(batch.tier)) errors.push('Candidate public batch tier is invalid');
  if (!validAdapter(batch.implementation)) errors.push('Candidate public batch implementation is invalid');
  if (!Array.isArray(batch.requests) || batch.requests.length < 1
    || batch.requests.length > CANDIDATE_MAX_REQUESTS) {
    errors.push('Candidate public batch request count is outside the bounded contract');
  } else {
    const nonces = [];
    for (const [index, row] of batch.requests.entries()) {
      if (!exactKeys(row, ['nonce', 'order', 'request']) || !NONCE.test(row.nonce || '')
        || row.order !== index + 1 || !boundedString(row.request, MAX_REQUEST_BYTES)) {
        errors.push(`Candidate public batch request ${index} is malformed or out of order`);
      }
      nonces.push(row.nonce);
    }
    if (!unique(nonces)) errors.push('Candidate public batch nonces must be unique');
  }
  if (TIERS.includes(batch.tier)) {
    const reviewed = loadWorkflowTierProjection(batch.tier);
    if (!same(canonicalCandidateValue(batch.tier_seed), canonicalCandidateValue(reviewed.tier_seed))
      || sha256(canonicalBytes(batch.tier_seed)) !== WORKFLOW_TIER_SEED_CANONICAL_SHA256[batch.tier]) {
      errors.push('Candidate public batch tier seed differs from the frozen Workflow projection');
    }
  }
  if (!SHA256.test(batch.public_input_sha256 || '')
    || batch.public_input_sha256 !== candidatePublicInputDigest(batch)) {
    errors.push('Candidate public batch digest does not bind its exact public input');
  }
  if (canonicalBytes(batch).length > PUBLIC_BATCH_MAX_BYTES) {
    errors.push('Candidate public batch exceeds its canonical byte bound');
  }
  return { valid: errors.length === 0, errors };
}

function assertValid(validation, label) {
  if (!validation.valid) throw new Error(`${label} is invalid: ${validation.errors.join('; ')}`);
}

export function createCandidatePublicBatch({ tier, implementation, requests }) {
  const batch = {
    schema: CANDIDATE_PUBLIC_BATCH_SCHEMA,
    tier,
    implementation: structuredClone(implementation),
    public_input_sha256: '0'.repeat(64),
    requests: structuredClone(requests),
    tier_seed: structuredClone(loadWorkflowTierProjection(tier).tier_seed),
  };
  batch.public_input_sha256 = candidatePublicInputDigest(batch);
  assertValid(validateCandidatePublicBatch(batch), 'Candidate public batch');
  return deepFreeze(batch);
}

function decodeJsonBytes(bytes, maximum, label) {
  if (!Buffer.isBuffer(bytes) || bytes.length > maximum) throw new Error(`${label} exceeds its byte bound`);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error(`${label} is not exact UTF-8 JSON`); }
  return value;
}

export function serializeCandidatePublicBatch(batch) {
  assertValid(validateCandidatePublicBatch(batch), 'Candidate public batch');
  return canonicalBytes(batch);
}

export function parseCandidatePublicBatchBytes(bytes) {
  const batch = decodeJsonBytes(bytes, PUBLIC_BATCH_MAX_BYTES, 'Candidate public batch');
  assertValid(validateCandidatePublicBatch(batch), 'Candidate public batch');
  const serialized = serializeCandidatePublicBatch(batch);
  if (!bytes.equals(serialized)) throw new Error('Candidate public batch bytes are not canonical JSON');
  return Object.freeze({
    batch: deepFreeze(batch),
    canonical_json: serialized.toString('utf8'),
    canonical_byte_length: serialized.length,
    canonical_sha256: sha256(serialized),
  });
}

function validateTarget(target, categories, at, errors) {
  const allowed = ['category', 'id', 'path', 'symbol', 'relation'];
  if (!isObject(target) || Object.keys(target).some((key) => !allowed.includes(key))
    || !Object.hasOwn(target, 'category') || Object.keys(target).length < 2
    || !categories.includes(target.category)) {
    errors.push(`${at} is not a normalized target`);
    return;
  }
  for (const key of ['id', 'symbol', 'relation']) {
    if (Object.hasOwn(target, key) && !boundedString(target[key])) errors.push(`${at}.${key} is invalid`);
  }
  if (Object.hasOwn(target, 'path') && !safeRelativePath(target.path)) errors.push(`${at}.path is unsafe`);
}

function validateResultBody(result, at, errors) {
  if (!exactKeys(result, [
    'workflow_outcome', 'selected_workflow_ids', 'workflow_ranking', 'source_ranking',
    'observations', 'obligations', 'repository_state',
  ])) {
    errors.push(`${at} is not the exact normalized result case body`);
    return;
  }
  if (!OUTCOMES.includes(result.workflow_outcome)) errors.push(`${at}.workflow_outcome is invalid`);
  if (!Array.isArray(result.selected_workflow_ids) || result.selected_workflow_ids.length > MAX_WORKFLOWS
    || !result.selected_workflow_ids.every((item) => boundedString(item))
    || !unique(result.selected_workflow_ids)) errors.push(`${at}.selected_workflow_ids is invalid`);
  const selectedCount = result.selected_workflow_ids?.length;
  if ((result.workflow_outcome === 'selected' && selectedCount !== 1)
    || (result.workflow_outcome === 'multi_workflow' && selectedCount < 2)
    || (['ambiguous', 'new_workflow_required'].includes(result.workflow_outcome) && selectedCount !== 0)) {
    errors.push(`${at} has invalid selected Workflow cardinality`);
  }
  if (!Array.isArray(result.workflow_ranking) || result.workflow_ranking.length > MAX_WORKFLOWS
    || result.workflow_ranking.some((item) => !exactKeys(item, ['id']) || !boundedString(item.id))
    || !unique(result.workflow_ranking.map((item) => item.id))) errors.push(`${at}.workflow_ranking is invalid`);
  if (!Array.isArray(result.source_ranking) || result.source_ranking.length > MAX_SOURCE_RANKING
    || result.source_ranking.some((item) => !exactKeys(item, ['path', 'symbol'])
      || !safeRelativePath(item.path) || !(item.symbol === null || boundedString(item.symbol)))
    || !unique(result.source_ranking.map((item) => `${item.path}\0${item.symbol ?? ''}`))) {
    errors.push(`${at}.source_ranking is invalid`);
  }
  for (const [field, categories, maximum] of [
    ['observations', OBSERVATION_CATEGORIES, MAX_OBSERVATIONS],
    ['obligations', OBLIGATION_CATEGORIES, MAX_OBLIGATIONS],
  ]) {
    if (!Array.isArray(result[field]) || result[field].length > maximum) {
      errors.push(`${at}.${field} exceeds its array bound`);
    } else {
      result[field].forEach((target, index) => validateTarget(target, categories, `${at}.${field}[${index}]`, errors));
    }
  }
  const state = result.repository_state;
  if (!exactKeys(state, ['head', 'branch', 'upstream', 'ahead', 'behind', 'worktree_role', 'changes'])
    || !(state.head === null || COMMIT.test(state.head || '')) || !boundedString(state.branch)
    || !(state.upstream === null || boundedString(state.upstream))
    || !Number.isSafeInteger(state.ahead) || state.ahead < 0 || state.ahead > 1_000_000
    || !Number.isSafeInteger(state.behind) || state.behind < 0 || state.behind > 1_000_000
    || !boundedString(state.worktree_role) || !Array.isArray(state.changes)
    || state.changes.length > MAX_CHANGES) {
    errors.push(`${at}.repository_state is invalid`);
  } else {
    state.changes.forEach((change, index) => {
      if (!exactKeys(change, ['kind', 'path', 'original_path', 'xy', 'submodule'])
        || !CHANGE_KINDS.includes(change.kind) || !safeRelativePath(change.path)
        || !(change.original_path === null || safeRelativePath(change.original_path))
        || !(change.xy === null || (typeof change.xy === 'string' && byteLength(change.xy) === 2))
        || !(change.submodule === null || boundedString(change.submodule))) {
        errors.push(`${at}.repository_state.changes[${index}] is invalid`);
      }
    });
  }
}

function validatePersonaProbe(probe, errors) {
  if (!exactKeys(probe, ['schema', 'input_sha256', 'observations', 'observations_sha256'])
    || probe.schema !== PERSONA_PROBE_EVIDENCE_SCHEMA || !SHA256.test(probe.input_sha256 || '')
    || !Array.isArray(probe.observations) || probe.observations.length < 1
    || probe.observations.length > MAX_PROBE_OBSERVATIONS) {
    errors.push('Candidate Persona probe evidence shape is invalid');
    return;
  }
  probe.observations.forEach((target, index) =>
    validateTarget(target, OBSERVATION_CATEGORIES, `persona_probe.observations[${index}]`, errors));
  if (!probe.observations.some((target) => target.category === 'personas')
    || !SHA256.test(probe.observations_sha256 || '')
    || probe.observations_sha256 !== sha256(canonicalBytes(probe.observations))) {
    errors.push('Candidate Persona probe lacks positive digest-bound personas evidence');
  }
}

export function validateCandidateRawArtifact(artifact, publicBatch) {
  const errors = [];
  const batchValidation = validateCandidatePublicBatch(publicBatch);
  if (!batchValidation.valid) return { valid: false, errors: ['Expected public batch is invalid'] };
  const structure = boundedStructure(artifact);
  if (!structure.valid) return { valid: false, errors: [`Candidate raw artifact ${structure.error}`] };
  const leaked = privateKey(artifact);
  if (leaked) errors.push(`Candidate raw artifact contains a private controller key at ${leaked}`);
  if (!exactKeys(artifact, ['schema', 'public_input_sha256', 'adapter', 'persona_probe', 'first', 'replay'])) {
    return { valid: false, errors: [...errors, 'Candidate raw artifact has unexpected or missing fields'] };
  }
  if (artifact.schema !== CANDIDATE_RAW_SCHEMA) errors.push('Candidate raw artifact schema is invalid');
  if (artifact.public_input_sha256 !== publicBatch.public_input_sha256) {
    errors.push('Candidate raw artifact is not bound to the exact public input');
  }
  if (!validAdapter(artifact.adapter) || !same(artifact.adapter, publicBatch.implementation)) {
    errors.push('Candidate raw artifact adapter differs from the requested implementation');
  }
  validatePersonaProbe(artifact.persona_probe, errors);
  for (const field of ['first', 'replay']) {
    const rows = artifact[field];
    if (!Array.isArray(rows) || rows.length > MAX_RESULT_ROWS
      || rows.length !== publicBatch.requests.length) {
      errors.push(`Candidate ${field} rows do not have exact public-input cardinality`);
      continue;
    }
    for (const [index, row] of rows.entries()) {
      const request = publicBatch.requests[index];
      if (!exactKeys(row, ['nonce', 'order', 'result'])
        || row.nonce !== request.nonce || row.order !== request.order) {
        errors.push(`Candidate ${field} row ${index} is not exactly correlated and ordered`);
        continue;
      }
      validateResultBody(row.result, `${field}[${index}].result`, errors);
    }
  }
  if (canonicalBytes(artifact).length > CANDIDATE_RAW_MAX_CANONICAL_BYTES) {
    errors.push('Candidate raw artifact exceeds the 16 MiB canonical byte bound');
  }
  return { valid: errors.length === 0, errors };
}

export function serializeCandidateRawArtifact(artifact, publicBatch) {
  assertValid(validateCandidateRawArtifact(artifact, publicBatch), 'Candidate raw artifact');
  return canonicalBytes(artifact);
}

export function candidateRawArtifactDigest(artifact, publicBatch) {
  return sha256(serializeCandidateRawArtifact(artifact, publicBatch));
}

export function parseCandidateRawArtifactBytes(bytes, publicBatch) {
  const artifact = decodeJsonBytes(bytes, CANDIDATE_RAW_MAX_CANONICAL_BYTES, 'Candidate raw artifact');
  assertValid(validateCandidateRawArtifact(artifact, publicBatch), 'Candidate raw artifact');
  const serialized = serializeCandidateRawArtifact(artifact, publicBatch);
  if (!bytes.equals(serialized)) throw new Error('Candidate raw artifact bytes are not canonical JSON');
  return Object.freeze({
    artifact: deepFreeze(artifact),
    canonical_json: serialized.toString('utf8'),
    canonical_byte_length: serialized.length,
    canonical_sha256: sha256(serialized),
  });
}
