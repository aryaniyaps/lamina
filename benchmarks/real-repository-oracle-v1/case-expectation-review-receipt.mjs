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
  SEMANTIC_CASE_MAPPING, SEMANTIC_CASE_MAPPING_CANONICAL_SHA256,
  semanticCaseMappingDigest, validateSemanticCaseMapping,
} from './semantic-case-authority.mjs';
import {
  WORKFLOW_SEED_CANONICAL_SHA256, WORKFLOW_SEED_RAW_SHA256, loadWorkflowSeed,
} from './workflow-seed.mjs';

const REVIEW_FILE = new URL('./reviews/case-expectations-v1.json', import.meta.url);
const TIERS = Object.freeze(['small', 'medium', 'large']);
const QUERY_ALLOCATIONS = Object.freeze({
  small: Object.freeze(['exact_source_identifier', 'route', 'symbol', 'low_overlap_paraphrase', 'persona', 'permission', 'role_boundary', 'invariant', 'failure_state', 'entry_point', 'command', 'transition', 'test', 'dependency']),
  medium: Object.freeze(['exact_source_identifier', 'handler', 'entity', 'low_overlap_paraphrase', 'persona', 'permission', 'invariant', 'flag', 'schema_entity', 'event', 'test', 'dependency', 'route', 'symbol']),
  large: Object.freeze(['handler', 'entity', 'role_boundary', 'docs_persona', 'failure_state', 'entry_point', 'command', 'transition', 'docs_persona', 'flag', 'schema_entity', 'event', 'persona', 'permission']),
});
const STATE_NAMES = Object.freeze([
  'clean-pinned-tree', 'reviewed-modify', 'reviewed-rename', 'reviewed-delete',
  'reviewed-branch', 'reviewed-logical-worktree',
]);
const OBLIGATION_CASE_IDS = Object.freeze(new Set([
  'small.semantic.06-permission', 'medium.semantic.03-entity',
  'large.semantic.09-docs_persona',
]));

function isAcceptedStateRow(item) {
  const operation = item.repository_scenario.operations[0]?.op;
  return item.kind.intent === 'new_workflow' || item.kind.intent === 'adversarial'
    || ['rename', 'delete', 'checkout_branch', 'add_worktree'].includes(operation);
}

export const CASE_EXPECTATIONS_RAW_SHA256 = 'dfbfb99528e8e898449f169eff4932ca29666b17f2123c535161f9c1654e8b4d';
export const CASE_EXPECTATIONS_CANONICAL_SHA256 = '59766f5b63c14e1da424e4749e730b13f4512d963b6f32c3407b4700f59bc86d';
export const RECEIPT_SEMANTIC_CASE_MAPPING_CANONICAL_SHA256 = '092cfbb1313ccdec0afd2064a37dd9c9e70fff2aafa7e9ae2cdb73f09d1a58d6';
export function semanticMappingReceiptMatches(actualDigest = semanticCaseMappingDigest()) {
  return actualDigest === RECEIPT_SEMANTIC_CASE_MAPPING_CANONICAL_SHA256
    && SEMANTIC_CASE_MAPPING_CANONICAL_SHA256 === RECEIPT_SEMANTIC_CASE_MAPPING_CANONICAL_SHA256;
}
export const CASE_EXPECTATION_REVIEW_AUTHORITY = Object.freeze({
  review_status: 'accepted_independent_review_adjudication',
  review_decision: 'accepted',
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
  semantic_case_mapping_canonical_sha256: RECEIPT_SEMANTIC_CASE_MAPPING_CANONICAL_SHA256,
  request_scenario_set_sha256: '2de7a1ae276985a60ecc882f77afe9bfb0e18c528d4490c67266f35d16a5a6f0',
  expectation_set_sha256: 'ae22b9ca8a3847ebfc68e18618a92947341bbef3ab2cdc1faffcecf0c13ce7ac',
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

function expectedObligations(workflow) {
  const surfaceFor = (surfaceId) => workflow.surfaces.find((surface) => surface.id === surfaceId)
    || workflow.surfaces[0];
  const target = (category, id, surface, relation) => ({
    category, id, path: surface.path, ...(surface.symbol ? { symbol: surface.symbol } : {}), relation,
  });
  const operation = workflow.operations[0];
  const actor = workflow.actors.find((item) => item.id === operation.actor_id) || workflow.actors[0];
  const transition = workflow.transitions[0];
  const failure = workflow.failure_contracts[0];
  const scenario = workflow.scenarios[0];
  const operationSurface = surfaceFor(operation.surface_id);
  return [
    target('implementation', operation.id, operationSurface,
      `operation:${operation.actor_id}->${operation.surface_id}`),
    target('state', transition.id, operationSurface,
      `transition:${transition.from}->${transition.to}`),
    target('permission', actor.id, operationSurface, `authority:${actor.authority}`),
    target('failure', failure.id, operationSurface,
      `failure:${failure.condition}=>${failure.response}`),
    target('persona', actor.id, operationSurface, `persona:${actor.persona}`),
    target('completeness', workflow.id, operationSurface,
      `closure:targets=${workflow.implementation_ready_input.target_ids.join(',')};unresolved=0`),
    target('verification', scenario.id, operationSurface,
      `proof:${workflow.implementation_ready_input.proof_ids.join(',')}`),
  ];
}

export function validateCaseExpectationReview(fixture) {
  const errors = [];
  const base = validateFixture(fixture);
  if (!base.valid) return base;
  const semanticMappingValidation = validateSemanticCaseMapping(SEMANTIC_CASE_MAPPING);
  if (!semanticMappingValidation.valid || !semanticMappingReceiptMatches()) {
    errors.push('semantic case mapping authority is invalid or unsealed');
  }
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
  const semanticAuthorityById = new Map(SEMANTIC_CASE_MAPPING.rows.map((item) => [item.id, item]));
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
      if (item.id.includes('.identity.') && item.expected.source_ranking.some((target) =>
        !selectedWorkflows.some((workflow) => workflow.surfaces.some((surface) => sameTarget(target, surface))))) {
        errors.push(`${item.id} identity source ranking contains a non-Workflow witness`);
      }
      const semanticAuthority = semanticAuthorityById.get(item.id);
      if (item.id.includes('.semantic.')) {
        if (!semanticAuthority) {
          errors.push(`${item.id} lacks exact semantic mapping authority`);
        } else {
          const mappedWorkflows = semanticAuthority.workflow_ids.map((id) =>
            tierWorkflows.find((workflow) => workflow.id === id));
          if (mappedWorkflows.some((workflow) => !workflow)) {
            errors.push(`${item.id} semantic mapping crosses its tier Workflow authority`);
          }
          const expectedSources = [];
          for (const surfaceId of semanticAuthority.source_surface_ids) {
            const owners = tierWorkflows.filter((workflow) =>
              workflow.surfaces.some((surface) => surface.id === surfaceId));
            const surface = owners[0]?.surfaces.find((candidate) => candidate.id === surfaceId);
            if (owners.length !== 1 || !semanticAuthority.workflow_ids.includes(owners[0]?.id)) {
              errors.push(`${item.id} semantic surface is not owned by its mapped same-tier Workflow`);
            } else {
              expectedSources.push({ path: surface.path, symbol: surface.symbol, max_rank: expectedSources.length + 1 });
            }
          }
          if (semanticAuthority.separate_lexical_category) {
            const witness = OBSERVATION_CATEGORY_SUPPORT[tier].positive_targets.find((target) =>
              target.category === semanticAuthority.separate_lexical_category);
            if (!witness) errors.push(`${item.id} lacks its explicitly separate lexical witness`);
            else expectedSources.push({
              path: witness.path, symbol: witness.symbol || null, max_rank: expectedSources.length + 1,
            });
          }
          if (!same(item.expected.source_ranking, expectedSources)) {
            errors.push(`${item.id} source ranking differs from its exact ordered semantic surface authority`);
          }
          if (expectedSources.length && !semanticAuthority.source_surface_ids.length) {
            errors.push(`${item.id} cannot rank an independent lexical witness before a Workflow surface`);
          }
          const expectedSelected = ['selected', 'multi_workflow'].includes(item.expected.workflow_outcome)
            ? semanticAuthority.workflow_ids : [];
          if (!same(item.expected.selected_workflow_ids, expectedSelected)
            || !same(item.expected.workflow_ranking, expectedSelected.map((id, index) =>
              ({ id, max_rank: index + 1 })))) {
            errors.push(`${item.id} Workflow selection differs from its exact semantic mapping`);
          }
          if (item.expected.workflow_outcome === 'ambiguous'
            && (semanticAuthority.workflow_ids.length !== 2
              || !same(item.expected.forbidden_workflow_ids, semanticAuthority.workflow_ids))) {
            errors.push(`${item.id} ambiguity must retain exactly two mapped Workflow alternatives`);
          }
          if (item.rationale !== semanticAuthority.rationale) {
            errors.push(`${item.id} rationale differs from its exact semantic mapping authority`);
          }
          if (expectedSources.some((target) => !item.request.includes(target.path)
            || (target.symbol && !item.request.includes(target.symbol)))) {
            errors.push(`${item.id} request does not explicitly name every ranked semantic source`);
          }
          if (semanticAuthority.separate_lexical_category
            && (!item.request.includes(`Separately localize the exact reviewed ${semanticAuthority.separate_lexical_category} witness`)
              || !item.request.includes('it is independent lexical evidence')
              || !item.request.includes('must not be attached'))) {
            errors.push(`${item.id} request does not preserve the two-part cross-authority boundary`);
          }
          if (!semanticAuthority.separate_lexical_category
            && item.request.includes('independent lexical evidence')) {
            errors.push(`${item.id} invents an unreviewed independent lexical task`);
          }
          const expectedObligationSet = OBLIGATION_CASE_IDS.has(item.id)
            ? expectedObligations(mappedWorkflows[0]) : [];
          if (!same(item.expected.obligations, expectedObligationSet)) {
            errors.push(`${item.id} obligations differ from exact public-seed contract derivation`);
          }
        }
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
        || !item.request.includes(item.kind.query === 'event' ? 'event surface' : 'entry surface'))) {
        errors.push(`${item.id} delete request must name its assigned query witness and stale path`);
      }
      if (operation?.op === 'checkout_branch') {
        const selectedWorkflow = selectedWorkflows[0];
        if (!includesFirstSource || !selectedWorkflow?.invariants.some((invariant) =>
          item.request.includes(invariant.statement))) {
          errors.push(`${item.id} branch request must bind its query witness and Workflow invariant`);
        }
        if (item.kind.query === 'docs_persona'
          && !item.request.includes('do not relabel documentation as a positive Persona observation')) {
          errors.push(`${item.id} documentation query must preserve negative Persona authority`);
        }
      }
      if (operation?.op === 'add_worktree' && (!includesFirstSource
        || !item.request.includes(item.kind.query)
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
  const fixtureSemanticIds = fixture.cases.filter((item) => item.id.includes('.semantic.')).map((item) => item.id);
  if (!same(fixtureSemanticIds, SEMANTIC_CASE_MAPPING.rows.map((item) => item.id))) {
    errors.push('fixture semantic rows must exactly equal the ordered 42-row semantic mapping authority');
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
