import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  BASELINE_MANIFEST_SHA256, CANDIDATE_POLICY_SHA256, fixtureDigest, validateFixture,
} from './contract.mjs';
import {
  OBSERVATION_CATEGORY_SUPPORT,
  OBSERVATION_CATEGORY_SUPPORT_CANONICAL_SHA256,
  OBSERVATION_CATEGORY_SUPPORT_RAW_SHA256,
} from './observation-category-authority.mjs';
import {
  SCENARIO_SELECTION_CANONICAL_SHA256, SCENARIO_SELECTION_RAW_SHA256,
  loadScenarioSelection,
} from './scenario-selection.mjs';
import {
  WORKFLOW_SEED_CANONICAL_SHA256, WORKFLOW_SEED_RAW_SHA256, loadWorkflowSeed,
} from './workflow-seed.mjs';

const REVIEW_FILE = new URL('./reviews/case-expectations-v1.json', import.meta.url);
const TIERS = Object.freeze(['small', 'medium', 'large']);
const QUERY_ALLOCATIONS = Object.freeze({
  small: Object.freeze(['exact_source_identifier', 'route', 'symbol', 'low_overlap_paraphrase', 'persona', 'permission', 'role_boundary', 'invariant', 'failure_state', 'entry_point', 'command', 'transition', 'test', 'dependency']),
  medium: Object.freeze(['exact_source_identifier', 'handler', 'entity', 'low_overlap_paraphrase', 'persona', 'permission', 'docs_persona', 'flag', 'schema_entity', 'event', 'test', 'dependency', 'route', 'symbol']),
  large: Object.freeze(['handler', 'entity', 'role_boundary', 'invariant', 'failure_state', 'entry_point', 'command', 'transition', 'docs_persona', 'flag', 'schema_entity', 'event', 'persona', 'permission']),
});
const STATE_NAMES = Object.freeze([
  'clean-pinned-tree', 'reviewed-modify', 'reviewed-rename', 'reviewed-delete',
  'reviewed-branch', 'reviewed-logical-worktree',
]);
const QUERY_OBSERVATION_CATEGORY = Object.freeze({
  route: 'routes', handler: 'handlers', entity: 'entities', permission: 'permissions',
  role_boundary: 'permissions', entry_point: 'entry_points', command: 'commands',
  schema_entity: 'schemas', transition: 'state_transitions', event: 'events', test: 'tests',
  docs_persona: 'documentation', flag: 'feature_flags', dependency: 'dependencies',
});
const WORKFLOW_SURFACE_FIRST_QUERIES = Object.freeze(new Set([
  'exact_source_identifier', 'symbol', 'invariant', 'failure_state',
]));

function isAcceptedStateRow(item) {
  const operation = item.repository_scenario.operations[0]?.op;
  return item.kind.intent === 'new_workflow' || item.kind.intent === 'adversarial'
    || ['rename', 'delete', 'checkout_branch', 'add_worktree'].includes(operation);
}

export const CASE_EXPECTATIONS_RAW_SHA256 = 'ba8736cf60db9bd9554fd8966404206558db085625ee0010ceb198e466e1e9b9';
export const CASE_EXPECTATIONS_CANONICAL_SHA256 = '68282446582a9b5ee1d0d122a385ab205468ce0255d12554298b1a48da287874';
export const CASE_EXPECTATION_REVIEW_AUTHORITY = Object.freeze({
  review_status: 'pending_independent_review_adjudication',
  review_decision: 'not_yet_accepted',
  fixture_raw_sha256: CASE_EXPECTATIONS_RAW_SHA256,
  fixture_canonical_sha256: CASE_EXPECTATIONS_CANONICAL_SHA256,
  baseline_manifest_sha256: BASELINE_MANIFEST_SHA256,
  candidate_policy_sha256: CANDIDATE_POLICY_SHA256,
  collections_sha256: 'f867f9a122e6025bb7cd08752aae6598a797e77a4b9b752f2f289bf1d3a46244',
  workflow_seed_raw_sha256: WORKFLOW_SEED_RAW_SHA256,
  workflow_seed_canonical_sha256: WORKFLOW_SEED_CANONICAL_SHA256,
  observation_support_raw_sha256: OBSERVATION_CATEGORY_SUPPORT_RAW_SHA256,
  observation_support_canonical_sha256: OBSERVATION_CATEGORY_SUPPORT_CANONICAL_SHA256,
  scenario_selection_raw_sha256: SCENARIO_SELECTION_RAW_SHA256,
  scenario_selection_canonical_sha256: SCENARIO_SELECTION_CANONICAL_SHA256,
  request_scenario_set_sha256: '2ee00f4cf2aef7c7837d9593bfd07522f3fb2c17c8f424b2527f4fdce44c692c',
  expectation_set_sha256: '3beaeeb6bb3b90b1f6fba2514603a1f32b113d1649c1c534f3e2cc529870a62b',
  mutation_set_sha256: 'c1bf8394ceeca151d74ee875e3fa3a3cf656d7cd1b985b8d488840273ba718cb',
  gates_sha256: 'ecea71c2b2179c520264e60109fd2f6a6e58845daa16187de392b9919520b950',
  held_out_identity_sha256: 'afc38bd388d6b27e397671806f3d83adb4b9dcbea5aa0d702d251878618e9e6c',
  counts: Object.freeze({ tiers: 3, cases: 72, identity: 30, semantic_source: 24, state: 18, mutations: 31 }),
  candidate_closure: 'pending_not_implemented_or_reachable',
  persona_positive_capability_gate: 'excepted_pending_unimplemented_candidate_facing_sealed_probe',
  quality_pass: 'structurally_unreachable_pending_candidate_isolation_and_host_grading',
});

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sectionDigest = (value) => sha256(JSON.stringify(canonical(value)));
const targetIdentity = (target) => `${target.path}\0${target.symbol ?? ''}`;
const sameTarget = (left, right) => targetIdentity(left) === targetIdentity(right);
const containsPerCaseDigestKey = (value) => value && typeof value === 'object'
  && (Object.keys(value).some((key) => key.endsWith('_sha256'))
    || Object.values(value).some(containsPerCaseDigestKey));

function sectionDigests(fixture) {
  return {
    collections_sha256: sectionDigest(fixture.collections),
    request_scenario_set_sha256: sectionDigest(fixture.cases.map(
      ({ id, collection_id, request, kind, repository_scenario }) =>
        ({ id, collection_id, request, kind, repository_scenario }),
    )),
    expectation_set_sha256: sectionDigest(fixture.cases.map(
      ({ id, expected, rationale }) => ({ id, expected, rationale }),
    )),
    mutation_set_sha256: sectionDigest(fixture.mutations),
    gates_sha256: sectionDigest({
      qualified_current: fixture.held_out_compatibility.qualified_current,
      thresholds: fixture.held_out_compatibility.thresholds,
    }),
    held_out_identity_sha256: sectionDigest(fixture.held_out_compatibility),
  };
}

function expectedScenario(selection, order) {
  const source = selection.scenarios[order];
  if (order === 0) return { kind: 'clean', name: 'clean-pinned-tree', operations: [] };
  if (order === 1) return { kind: 'dirty', name: 'reviewed-modify', operations: [{ op: 'modify', path: source.path, content: source.append_utf8 }] };
  if (order === 2) return { kind: 'dirty', name: 'reviewed-rename', operations: [{ op: 'rename', path: source.path, to: source.destination }] };
  if (order === 3) return { kind: 'dirty', name: 'reviewed-delete', operations: [{ op: 'delete', path: source.path }] };
  if (order === 4) return { kind: 'branch', name: 'reviewed-branch', operations: [{ op: 'checkout_branch', branch: source.branch }] };
  return { kind: 'worktree', name: 'reviewed-logical-worktree', operations: [{ op: 'add_worktree', branch: source.derived_branch, worktree_id: source.logical_worktree_id }] };
}

export function validateCaseExpectationReview(fixture) {
  const errors = [];
  const base = validateFixture(fixture);
  if (!base.valid) return base;
  if (fixture.id !== 'real-repository-oracle-case-expectations-v1' || fixture.version !== 1) {
    errors.push('case expectation review root identity differs');
  }
  if (fixture.cases.length !== 72 || fixture.mutations.length !== 31) {
    errors.push('case expectation review must contain exactly 72 cases and 31 executable mutations');
  }
  for (const [field, actual] of Object.entries(sectionDigests(fixture))) {
    if (CASE_EXPECTATION_REVIEW_AUTHORITY[field] !== actual) {
      errors.push(`case expectation ${field} differs from its separately reviewed section identity`);
    }
  }
  if (new Set(fixture.cases.map((item) => item.request)).size !== fixture.cases.length) {
    errors.push('reviewed requests must be unique without per-row hash labels');
  }
  const workflows = loadWorkflowSeed().seed.collections;
  const workflowsByTier = Object.fromEntries(workflows.map((collection) => [collection.fixture_id, collection.workflows]));
  const workflowIds = new Set(workflows.flatMap((collection) => collection.workflows.map((workflow) => workflow.id)));
  const scenarioSelection = loadScenarioSelection().selection;
  for (const tier of TIERS) {
    const tierCases = fixture.cases.filter((item) => item.collection_id === `collection.${tier}`);
    const identity = tierCases.filter((item) => item.id.startsWith(`${tier}.identity.`));
    const semantic = tierCases.filter((item) => item.id.startsWith(`${tier}.semantic.`));
    const state = semantic.filter(isAcceptedStateRow);
    const semanticSource = semantic.filter((item) => !isAcceptedStateRow(item));
    if (tierCases.length !== 24 || identity.length !== 10 || semanticSource.length !== 8 || state.length !== 6) {
      errors.push(`${tier} must contain exactly 10 identity, 8 semantic/source, and 6 accepted-state rows`);
    }
    const distinctStateNames = new Set(state.map((item) => item.repository_scenario.name));
    if (distinctStateNames.size !== 6 || STATE_NAMES.some((name) => !distinctStateNames.has(name))) {
      errors.push(`${tier} does not bind all six accepted scenario identities`);
    }
    for (let order = 1; order < 6; order += 1) {
      const matches = semantic.filter((item) => item.repository_scenario.name === STATE_NAMES[order]);
      if (matches.length !== 1 || !same(matches[0].repository_scenario,
        expectedScenario(scenarioSelection.tiers[tier], order))) {
        errors.push(`${tier} state row ${STATE_NAMES[order]} differs from the reviewed scenario selection`);
      }
    }
    const novel = semantic.filter((item) => item.kind.intent === 'new_workflow');
    if (novel.length !== 1 || !same(novel[0].repository_scenario,
      expectedScenario(scenarioSelection.tiers[tier], 0))) errors.push(`${tier} clean novel state row is not exact`);
    if (!same(semantic.map((item) => item.kind.query), QUERY_ALLOCATIONS[tier])) {
      errors.push(`${tier} semantic/source query allocation differs`);
    }
    const tierWorkflows = workflowsByTier[tier];
    for (const [index, workflow] of tierWorkflows.entries()) {
      const idCase = identity.find((item) => item.id === `${tier}.identity.id-${index + 1}`);
      const aliasCase = identity.find((item) => item.id === `${tier}.identity.alias-${index + 1}`);
      if (!idCase || !aliasCase || !same(idCase.expected.selected_workflow_ids, [workflow.id])
        || !same(aliasCase.expected.selected_workflow_ids, [workflow.id])
        || !idCase.request.includes(workflow.id) || !aliasCase.request.includes(workflow.aliases[0])) {
        errors.push(`${tier}.${workflow.id} lacks exact id and first-alias private expectations`);
      }
    }
    for (const item of tierCases) {
      if ([...item.expected.selected_workflow_ids, ...item.expected.forbidden_workflow_ids,
        ...item.expected.workflow_ranking.map((ranked) => ranked.id)].some((id) => !workflowIds.has(id))) {
        errors.push(`${item.id} references a Workflow outside the public seed`);
      }
      const selectedWorkflows = tierWorkflows.filter((workflow) =>
        item.expected.selected_workflow_ids.includes(workflow.id));
      const category = QUERY_OBSERVATION_CATEGORY[item.kind.query];
      const categoryWitness = category && OBSERVATION_CATEGORY_SUPPORT[tier].positive_targets
        .find((target) => target.category === category);
      const preferWorkflowSurface = item.kind.query === 'handler'
        || (tier === 'medium' && item.kind.query === 'event');
      if (categoryWitness && item.expected.source_ranking.length
        && !item.expected.source_ranking.some((target) => sameTarget(target, categoryWitness))) {
        errors.push(`${item.id} omits the exact reviewed ${category} source witness`);
      }
      const expectedFirst = preferWorkflowSurface ? selectedWorkflows[0]?.surfaces[0]
        : categoryWitness || (WORKFLOW_SURFACE_FIRST_QUERIES.has(item.kind.query)
          ? selectedWorkflows[0]?.surfaces[0] : null);
      if (expectedFirst && (!item.expected.source_ranking.length
        || !sameTarget(item.expected.source_ranking[0], expectedFirst))) {
        errors.push(`${item.id} rank one source differs from the reviewed query witness`);
      }
      if (item.id.includes('.identity.') && item.expected.source_ranking.some((target) =>
        !selectedWorkflows.some((workflow) => workflow.surfaces.some((surface) => sameTarget(target, surface))))) {
        errors.push(`${item.id} identity source ranking contains a non-Workflow witness`);
      }
      if (item.kind.intent === 'multi_workflow' && selectedWorkflows.some((workflow) =>
        !workflow.surfaces.some((surface) => item.expected.source_ranking.some((target) => sameTarget(target, surface))))) {
        errors.push(`${item.id} multi-Workflow source ranking omits a selected Workflow surface`);
      }
      if (item.kind.scope === 'multi_file'
        && (item.expected.selected_workflow_ids.length < 2
          || new Set(item.expected.source_ranking.map((target) => target.path)).size < 2)) {
        errors.push(`${item.id} claims multi-file scope without multiple selected Workflows and paths`);
      }
      if (item.kind.intent === 'adversarial'
        && (item.expected.workflow_outcome !== 'new_workflow_required'
          || item.expected.selected_workflow_ids.length !== 0)) {
        errors.push(`${item.id} domain-irrelevant adversary must abstain with no selected Workflow`);
      }
      if (item.kind.intent === 'ambiguous_workflow') {
        const forbiddenNames = item.expected.forbidden_workflow_ids.map((id) =>
          tierWorkflows.find((workflow) => workflow.id === id)?.name);
        if (forbiddenNames.length !== 2 || forbiddenNames.some((name) => !name || !item.request.includes(name))) {
          errors.push(`${item.id} ambiguous forbidden ids must exactly name both request alternatives`);
        }
      }
      const operation = item.repository_scenario.operations[0];
      const firstSource = item.expected.source_ranking[0];
      const includesFirstSource = !firstSource || (item.request.includes(firstSource.path)
        && (!firstSource.symbol || item.request.includes(firstSource.symbol)));
      if (operation?.op === 'rename' && (!includesFirstSource || !item.request.includes(operation.path)
        || !item.request.includes(operation.to) || !item.request.includes('unrelated'))) {
        errors.push(`${item.id} rename request must distinguish unrelated state mutation from unchanged source evidence`);
      }
      if (operation?.op === 'delete' && (!includesFirstSource || !item.request.includes(operation.path)
        || !item.request.includes(item.kind.query === 'event' ? 'event evidence' : 'entry-point evidence'))) {
        errors.push(`${item.id} delete request must name its assigned query witness and stale path`);
      }
      if (operation?.op === 'checkout_branch') {
        const selectedWorkflow = selectedWorkflows[0];
        if (!includesFirstSource || !selectedWorkflow?.invariants.some((invariant) =>
          item.request.includes(invariant.statement))) {
          errors.push(`${item.id} branch request must bind its query witness and Workflow invariant`);
        }
        if (item.kind.query === 'docs_persona'
          && (!item.request.includes('not positive Persona evidence')
            || !item.request.includes('complete candidate set'))) {
          errors.push(`${item.id} documentation query must preserve negative Persona authority`);
        }
      }
      if (operation?.op === 'add_worktree' && (!includesFirstSource
        || !item.request.includes(item.kind.query === 'dependency' ? 'dependency evidence' : 'permission evidence')
        || selectedWorkflows.some((workflow) => !item.request.includes(workflow.name)))) {
        errors.push(`${item.id} worktree request must name its query witness and both selected Workflows`);
      }
      if (item.kind.intent === 'new_workflow' && item.kind.query === 'failure_state'
        && (!item.request.includes('failure state') || !item.request.includes('rejected'))) {
        errors.push(`${item.id} novel failure-state request does not express the absent failure need`);
      }
      if (containsPerCaseDigestKey(item)) errors.push(`${item.id} leaks a per-case digest key`);
    }
  }
  const identityCount = fixture.cases.filter((item) => item.id.includes('.identity.')).length;
  const stateCount = fixture.cases.filter((item) => item.id.includes('.semantic.') && isAcceptedStateRow(item)).length;
  if (identityCount !== 30 || stateCount !== 18 || fixture.cases.length - identityCount - stateCount !== 24) {
    errors.push('global allocation must be 30 identity, 24 semantic/source, and 18 accepted-state rows');
  }
  const queryCounts = fixture.cases.reduce((counts, item) => {
    counts[item.kind.query] = (counts[item.kind.query] || 0) + 1;
    return counts;
  }, {});
  const nonIdentityQueries = new Set(Object.values(QUERY_ALLOCATIONS).flat());
  if (queryCounts.exact_workflow_id !== 15 || queryCounts.exact_workflow_alias !== 15
    || [...nonIdentityQueries].some((query) => queryCounts[query] < 2)
    || queryCounts.persona !== 3 || queryCounts.permission !== 3) {
    errors.push('query allocation must contain 15 exact ids, 15 aliases, every semantic/source query at least twice, and three Persona/permission rows');
  }
  const ambiguous = fixture.cases.filter((item) => item.kind.intent === 'ambiguous_workflow');
  if (ambiguous.length !== 3 || TIERS.some((tier) => ambiguous.filter((item) =>
    item.collection_id === `collection.${tier}`).length !== 1)) {
    errors.push('ambiguous Workflow coverage must contain exactly one reviewed abstention per tier');
  }
  const unexpected = fixture.mutations.filter((item) => item.kind === 'unexpected_observation');
  const unexpectedTargets = unexpected.map((mutation) => fixture.cases.find((item) => item.id === mutation.case_id)
    ?.expected.forbidden_observations[0]?.category).sort();
  if (unexpected.length !== 4 || !same(unexpectedTargets, ['handlers', 'personas', 'personas', 'personas'])) {
    errors.push('unexpected-observation mutations must cover Persona category-wide absence per tier and the small bounded handler control');
  }
  return { valid: errors.length === 0, errors };
}

export function parseCaseExpectationReviewBytes(bytes, { requireReviewedBytes = true } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 256 * 1024
    || (requireReviewedBytes && sha256(bytes) !== CASE_EXPECTATIONS_RAW_SHA256)) {
    throw new Error('case expectation review bytes do not match the private reviewed identity');
  }
  let fixture;
  try { fixture = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('case expectation review is not UTF-8 JSON'); }
  const validation = validateCaseExpectationReview(fixture);
  if (!validation.valid) throw new Error(`case expectation review is invalid: ${validation.errors.join('; ')}`);
  const canonicalSha256 = sha256(JSON.stringify(canonical(fixture)));
  if (requireReviewedBytes && canonicalSha256 !== CASE_EXPECTATIONS_CANONICAL_SHA256) {
    throw new Error('case expectation semantic content differs from the private reviewed identity');
  }
  return Object.freeze({ fixture, raw_sha256: sha256(bytes), canonical_sha256: canonicalSha256,
    fixture_digest: fixtureDigest(fixture), authority: CASE_EXPECTATION_REVIEW_AUTHORITY });
}

export function loadCaseExpectationReview() {
  return parseCaseExpectationReviewBytes(fs.readFileSync(REVIEW_FILE));
}
