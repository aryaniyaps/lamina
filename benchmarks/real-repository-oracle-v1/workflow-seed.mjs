import crypto from 'node:crypto';
import fs from 'node:fs';

const WORKFLOW_FILE = new URL('./workflows-v1.json', import.meta.url);
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const TIERS = Object.freeze(['small', 'medium', 'large']);
const FORBIDDEN_KEYS = new Set([
  'answer', 'answers', 'applicability', 'case', 'caseid', 'cases', 'classification',
  'diagnostic', 'diagnostics', 'expected', 'expectation', 'gate', 'gates', 'gold',
  'golden', 'grade', 'heldout', 'maxrank', 'metric', 'metrics', 'mutation',
  'mutations', 'pass', 'passed', 'rank', 'ranking', 'rationale', 'request',
  'requests', 'threshold', 'thresholds',
]);
const PUBLIC_AUTHORITY = Object.freeze({
  baseline_manifest_sha256: '9e8319288d69b77f77f2b3e386c868f83e62a1b7032ca4f3deb443acf60bb3ba',
  candidate_policy_sha256: '08425c000f94788345e1b7d713f89f6b82c0586e36bafa20c74155142baff064',
  evidence_selection_raw_sha256: '338540672264c5bd2bd98164fa120e6cceea6ac5408fcb7c77986d786d70f7d2',
});
const PUBLIC_PINS = Object.freeze({
  small: Object.freeze({ repository_url: 'https://github.com/alan2207/bulletproof-react.git', commit: '9506629ed003a561c6627735480cce4994244bb4', tree_oid: 'b03782f905ffcd394bdaf597c06322afbc8ed991' }),
  medium: Object.freeze({ repository_url: 'https://github.com/outline/outline.git', commit: '30730179b852d42da5078a9294f7d05a44f516b7', tree_oid: '1ada87cb0c8c8066fd8f8df2401c187c05632e9d' }),
  large: Object.freeze({ repository_url: 'https://github.com/makeplane/plane.git', commit: 'dc9d80b2d2a499b967f0b541e083b283f463719f', tree_oid: '382c6539083af65e86cdddbffd4e09884773e64e' }),
});

export const WORKFLOW_SEED_RAW_SHA256 = '68aed6465b9bab0c459c1b144eeeadd50ce2f65494f31be8db90f61b88619b4b';
export const WORKFLOW_SEED_CANONICAL_SHA256 = 'f9700a4499207c65d9c37942f97a7dae0d97d8c5e114ef0eb6f31bb358ae64e4';
export const WORKFLOW_SEED_SCHEMA = 'lamina.real-repository-oracle-workflows/v1';

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const nonempty = (value) => typeof value === 'string' && value.length > 0;
const unique = (values) => new Set(values).size === values.length;

function containsForbiddenKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '');
    return FORBIDDEN_KEYS.has(normalized) || containsForbiddenKey(child);
  });
}

function addUniqueId(value, at, ids, errors) {
  if (!ID.test(value || '') || ids.has(value)) errors.push(`${at} is malformed or duplicated`);
  ids.add(value);
}

function identityKey(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('en-US') : '';
}

function registerWorkflowIdentity(value, at, identities, errors) {
  const key = identityKey(value);
  if (!key || identities.has(key)) errors.push(`${at} collides with another Workflow id, name, or alias`);
  identities.add(key);
}

function validateWorkflow(workflow, tier, allIds, allReferences, identities, errors) {
  const at = `workflows.${workflow?.id || 'unknown'}`;
  if (!exactKeys(workflow, [
    'id', 'name', 'aliases', 'objective', 'non_goals', 'actors', 'operations',
    'states', 'transitions', 'failure_contracts', 'invariants', 'scenarios',
    'surfaces', 'proofs', 'dependencies', 'implementation_ready_input',
  ])) {
    errors.push(`${at} has unexpected or missing fields`);
    return;
  }
  if (!ID.test(workflow.id || '') || !workflow.id.startsWith(`${tier}.`) || allIds.has(workflow.id)) {
    errors.push(`${at}.id is unstable, cross-tier, or duplicated`);
  }
  allIds.add(workflow.id);
  registerWorkflowIdentity(workflow.id, `${at}.id`, identities, errors);
  if (![workflow.name, workflow.objective].every(nonempty)
    || !Array.isArray(workflow.aliases) || workflow.aliases.length < 1
    || !unique(workflow.aliases) || !workflow.aliases.every(nonempty)
    || !Array.isArray(workflow.non_goals) || workflow.non_goals.length < 1
    || !workflow.non_goals.every(nonempty)) {
    errors.push(`${at} lacks compact identity, objective, aliases, or non-goals`);
  }
  registerWorkflowIdentity(workflow.name, `${at}.name`, identities, errors);
  for (const alias of workflow.aliases || []) registerWorkflowIdentity(alias, `${at}.alias`, identities, errors);
  if (!Array.isArray(workflow.actors) || workflow.actors.length < 1
    || workflow.actors.some((item) => !exactKeys(item, ['id', 'persona', 'authority'])
      || !ID.test(item.id || '') || !nonempty(item.persona) || !nonempty(item.authority))) {
    errors.push(`${at}.actors are malformed`);
  }
  for (const actor of workflow.actors || []) addUniqueId(actor.id, `${at}.actor id`, allReferences, errors);
  const actorIds = new Set(workflow.actors?.map((item) => item.id));
  if (!Array.isArray(workflow.operations) || workflow.operations.length < 1
    || workflow.operations.length > 3 || workflow.operations.some((item, index) =>
      !exactKeys(item, ['order', 'id', 'actor_id', 'action', 'surface_id'])
      || item.order !== index + 1 || !ID.test(item.id || '') || !actorIds.has(item.actor_id)
      || !nonempty(item.action) || !ID.test(item.surface_id || ''))) {
    errors.push(`${at}.operations do not contain one to three ordered actor-bound operations`);
  }
  for (const operation of workflow.operations || []) addUniqueId(operation.id, `${at}.operation id`, allReferences, errors);
  if (!Array.isArray(workflow.states) || workflow.states.length < 2
    || workflow.states.some((item) => !exactKeys(item, ['id', 'meaning'])
      || !ID.test(item.id || '') || !nonempty(item.meaning))) errors.push(`${at}.states are malformed`);
  const stateIds = new Set(workflow.states?.map((item) => item.id));
  for (const state of workflow.states || []) addUniqueId(state.id, `${at}.state id`, allReferences, errors);
  if (!Array.isArray(workflow.transitions) || workflow.transitions.length < 1
    || workflow.transitions.some((item) => !exactKeys(item, ['id', 'from', 'to', 'trigger'])
      || !ID.test(item.id || '') || !stateIds.has(item.from) || !stateIds.has(item.to)
      || !nonempty(item.trigger))) errors.push(`${at}.transitions are malformed`);
  for (const transition of workflow.transitions || []) addUniqueId(transition.id, `${at}.transition id`, allReferences, errors);
  if (!Array.isArray(workflow.failure_contracts) || workflow.failure_contracts.length < 1
    || workflow.failure_contracts.some((item) => !exactKeys(item, ['id', 'condition', 'response'])
      || !ID.test(item.id || '') || !nonempty(item.condition) || !nonempty(item.response))) {
    errors.push(`${at}.failure_contracts are malformed`);
  }
  for (const failure of workflow.failure_contracts || []) addUniqueId(failure.id, `${at}.failure id`, allReferences, errors);
  if (!Array.isArray(workflow.invariants) || workflow.invariants.length < 1
    || workflow.invariants.some((item) => !exactKeys(item, ['id', 'statement'])
      || !ID.test(item.id || '') || !nonempty(item.statement))) errors.push(`${at}.invariants are malformed`);
  for (const invariant of workflow.invariants || []) addUniqueId(invariant.id, `${at}.invariant id`, allReferences, errors);
  if (!Array.isArray(workflow.scenarios) || workflow.scenarios.length < 1
    || workflow.scenarios.some((item) => !exactKeys(item, ['id', 'persona_id', 'given', 'when', 'then'])
      || !ID.test(item.id || '') || !actorIds.has(item.persona_id)
      || ![item.given, item.when, item.then].every(nonempty))) errors.push(`${at}.scenarios are malformed`);
  for (const scenario of workflow.scenarios || []) addUniqueId(scenario.id, `${at}.scenario id`, allReferences, errors);

  if (!Array.isArray(workflow.surfaces) || workflow.surfaces.length < 1) {
    errors.push(`${at}.surfaces are absent`);
    return;
  }
  const surfaceIds = new Set();
  const surfaceEvidenceRefs = new Set();
  for (const [index, surface] of workflow.surfaces.entries()) {
    if (!exactKeys(surface, ['id', 'path', 'blob_oid', 'symbol', 'line', 'line_sha256', 'evidence_ref'])
      || !ID.test(surface.id || '') || surfaceIds.has(surface.id)
      || !new RegExp(`^${tier}\\.evidence\\.[1-9][0-9]*$`).test(surface.evidence_ref || '')
      || surfaceEvidenceRefs.has(surface.evidence_ref) || !SHA1.test(surface.blob_oid || '')
      || !SHA256.test(surface.line_sha256 || '') || !nonempty(surface.path)
      || !(surface.symbol === null || nonempty(surface.symbol))
      || !(surface.line === null || (Number.isSafeInteger(surface.line) && surface.line > 0))) {
      errors.push(`${at}.surfaces[${index}] is not a bounded tier-local evidence target`);
    }
    surfaceIds.add(surface.id);
    surfaceEvidenceRefs.add(surface.evidence_ref);
    addUniqueId(surface.id, `${at}.surface id`, allReferences, errors);
  }
  if (workflow.operations.some((item) => !surfaceIds.has(item.surface_id))) {
    errors.push(`${at}.operations reference unknown surfaces`);
  }
  const proofIds = new Set();
  if (!Array.isArray(workflow.proofs) || workflow.proofs.length < 1
    || workflow.proofs.some((item) => {
      const invalid = !exactKeys(item, ['id', 'claim', 'evidence_ref']) || !ID.test(item.id || '')
        || proofIds.has(item.id) || !nonempty(item.claim)
        || !new RegExp(`^${tier}\\.evidence\\.[1-9][0-9]*$`).test(item.evidence_ref || '');
      proofIds.add(item.id);
      addUniqueId(item.id, `${at}.proof id`, allReferences, errors);
      return invalid;
    })) errors.push(`${at}.proofs are malformed or unreviewed`);
  if (!Array.isArray(workflow.dependencies) || workflow.dependencies.some((item) =>
    !exactKeys(item, ['id', 'relation', 'target_id', 'evidence_ref'])
      || !ID.test(item.id || '') || !ID.test(item.target_id || '') || !nonempty(item.relation)
      || !surfaceIds.has(item.target_id)
      || !new RegExp(`^${tier}\\.evidence\\.[1-9][0-9]*$`).test(item.evidence_ref || ''))) {
    errors.push(`${at}.dependencies are malformed or unreviewed`);
  }
  for (const dependency of workflow.dependencies || []) addUniqueId(dependency.id, `${at}.dependency id`, allReferences, errors);
  const ready = workflow.implementation_ready_input;
  if (!exactKeys(ready, ['target_ids', 'proof_ids', 'unresolved'])
    || !Array.isArray(ready.target_ids) || !unique(ready.target_ids)
    || JSON.stringify([...ready.target_ids].sort()) !== JSON.stringify([...surfaceIds].sort())
    || !Array.isArray(ready.proof_ids) || !unique(ready.proof_ids)
    || JSON.stringify([...ready.proof_ids].sort()) !== JSON.stringify([...proofIds].sort())
    || !Array.isArray(ready.unresolved) || ready.unresolved.length !== 0) {
    errors.push(`${at}.implementation_ready_input is incomplete or references unknown reviewed targets`);
  }
}

export function validateWorkflowSeed(seed) {
  const errors = [];
  if (!exactKeys(seed, ['schema', 'purpose', 'authority', 'collections'])
    || seed.schema !== WORKFLOW_SEED_SCHEMA
    || seed.purpose !== 'candidate_visible_human_reviewed_synthetic_persona_walks_with_lexical_surface_grounding_only') {
    return { valid: false, errors: ['Workflow seed root is not the exact candidate-visible review schema'] };
  }
  if (containsForbiddenKey(seed)) errors.push('Workflow seed contains request-to-answer or golden-ranking fields');
  const expectedReports = {
    small: ['30c9b02d50a2d0c7af7d3f15df8c2a9122f044118a078cbcfbb8651d454bf51a', '94b5b5c49c095970e68d5a5592ca8f2584decd8a0977745341132890cd48fe58'],
    medium: ['e133903549b9e759592f31be95c84b2655d600ae8d34ac206459cc4a9ded77ba', '657b93b3c9a07f51d1e1c235b800196be38027d377a0bc6a8d83b7dab2a0265d'],
    large: ['27c71d733850d64a82d484197f7cde28110ec47a96f8e892241eed7c8a4d118e', '6069a1a809bfb6af9ef1a9f08244742bc686b78a36409d8e7f89bd7b39b93241'],
  };
  if (!exactKeys(seed.authority, ['baseline_manifest_sha256', 'candidate_policy_sha256',
    'evidence_selection_raw_sha256', 'semantic_reviews', 'implementation_ready_meaning',
    'evidence_expansion_reports'])
    || seed.authority.baseline_manifest_sha256 !== PUBLIC_AUTHORITY.baseline_manifest_sha256
    || seed.authority.candidate_policy_sha256 !== PUBLIC_AUTHORITY.candidate_policy_sha256
    || seed.authority.evidence_selection_raw_sha256 !== PUBLIC_AUTHORITY.evidence_selection_raw_sha256
    || seed.authority.implementation_ready_meaning !== 'all_reviewed_target_and_proof_references_resolve_only'
    || JSON.stringify(seed.authority.semantic_reviews) !== JSON.stringify([
      { id: 'workflow-semantic-review-a', decision: 'accepted', scope: 'synthetic_product_contracts_and_persona_walks' },
      { id: 'workflow-semantic-review-b', decision: 'accepted', scope: 'lexical_surface_grounding_and_non_derivation_boundary' },
    ])
    || !exactKeys(seed.authority.evidence_expansion_reports, TIERS)
    || TIERS.some((tier) => !exactKeys(seed.authority.evidence_expansion_reports[tier], ['report_sha256', 'records_sha256'])
      || seed.authority.evidence_expansion_reports[tier].report_sha256 !== expectedReports[tier][0]
      || seed.authority.evidence_expansion_reports[tier].records_sha256 !== expectedReports[tier][1])) {
    errors.push('Workflow seed authority differs from the reviewed pins and decoded evidence reports');
  }
  if (!Array.isArray(seed.collections) || seed.collections.length !== 3
    || seed.collections.map((item) => item.fixture_id).join(',') !== TIERS.join(',')) {
    return { valid: false, errors: [...errors, 'Workflow seed must contain ordered small, medium, and large collections'] };
  }
  const allIds = new Set();
  const allReferences = new Set();
  const identities = new Set();
  for (const collection of seed.collections) {
    const pin = PUBLIC_PINS[collection.fixture_id];
    if (!exactKeys(collection, ['collection_id', 'fixture_id', 'pin', 'workflows'])
      || collection.collection_id !== `collection.${collection.fixture_id}`
      || JSON.stringify(collection.pin) !== JSON.stringify({
        repository_url: pin.repository_url, commit: pin.commit, tree_oid: pin.tree_oid,
      }) || !Array.isArray(collection.workflows) || collection.workflows.length !== 5) {
      errors.push(`${collection.fixture_id} Workflow collection is not exact`);
      continue;
    }
    collection.workflows.forEach((workflow) =>
      validateWorkflow(workflow, collection.fixture_id, allIds, allReferences, identities, errors));
  }
  if (allIds.size !== 15) errors.push('Workflow seed must contain exactly 15 unique Workflow ids');
  return { valid: errors.length === 0, errors };
}

export function parseWorkflowSeedBytes(bytes, { requireReviewedBytes = true } = {}) {
  if (!Buffer.isBuffer(bytes) || (requireReviewedBytes && sha256(bytes) !== WORKFLOW_SEED_RAW_SHA256)) {
    throw new Error('Workflow seed bytes do not match the reviewed source identity');
  }
  let seed;
  try { seed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Workflow seed is not UTF-8 JSON'); }
  const validation = validateWorkflowSeed(seed);
  if (!validation.valid) throw new Error(`Workflow seed is invalid: ${validation.errors.join('; ')}`);
  if (requireReviewedBytes && sha256(JSON.stringify(canonical(seed))) !== WORKFLOW_SEED_CANONICAL_SHA256) {
    throw new Error('Workflow seed semantic content differs from the reviewed identity');
  }
  return Object.freeze({ seed, raw_sha256: sha256(bytes), canonical_sha256: sha256(JSON.stringify(canonical(seed))) });
}

export function loadWorkflowSeed() {
  return parseWorkflowSeedBytes(fs.readFileSync(WORKFLOW_FILE));
}
