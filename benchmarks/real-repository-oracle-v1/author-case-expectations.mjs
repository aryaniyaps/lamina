import { loadWorkflowSeed } from './workflow-seed.mjs';
import { reviewedCollectionForTier } from './collection-authority.mjs';
import { loadScenarioSelection } from './scenario-selection.mjs';
import {
  OBSERVATION_CATEGORY_SUPPORT, loadObservationCategorySupport,
} from './observation-category-authority.mjs';
import { SEMANTIC_CASE_MAPPING } from './semantic-case-authority.mjs';
import {
  BASELINE_MANIFEST_SHA256, CANDIDATE_POLICY_SHA256, COLLECTION_SCHEMA,
  FIXTURE_SCHEMA, FROZEN_GATES, QUALIFIED_CURRENT_BASELINE,
  collectionDigest, validateFixture,
} from './contract.mjs';

const TIERS = ['small', 'medium', 'large'];
const QUERY_ALLOCATIONS = {
  small: ['exact_source_identifier', 'route', 'symbol', 'low_overlap_paraphrase', 'persona', 'permission', 'role_boundary', 'invariant', 'failure_state', 'entry_point', 'command', 'transition', 'test', 'dependency'],
  medium: ['exact_source_identifier', 'handler', 'entity', 'low_overlap_paraphrase', 'persona', 'permission', 'invariant', 'flag', 'schema_entity', 'event', 'test', 'dependency', 'route', 'symbol'],
  large: ['handler', 'entity', 'role_boundary', 'docs_persona', 'failure_state', 'entry_point', 'command', 'transition', 'docs_persona', 'flag', 'schema_entity', 'event', 'persona', 'permission'],
};
const STATE_BY_CASE_ID = Object.freeze({
  'small.semantic.01-exact_source_identifier': 'rename',
  'small.semantic.04-low_overlap_paraphrase': 'novel',
  'small.semantic.05-persona': 'adversarial',
  'small.semantic.08-invariant': 'branch',
  'small.semantic.10-entry_point': 'delete',
  'small.semantic.14-dependency': 'worktree',
  'medium.semantic.01-exact_source_identifier': 'rename',
  'medium.semantic.04-low_overlap_paraphrase': 'novel',
  'medium.semantic.05-persona': 'adversarial',
  'medium.semantic.07-invariant': 'branch',
  'medium.semantic.10-event': 'delete',
  'medium.semantic.12-dependency': 'worktree',
  'large.semantic.01-handler': 'rename',
  'large.semantic.04-docs_persona': 'branch',
  'large.semantic.05-failure_state': 'novel',
  'large.semantic.06-entry_point': 'delete',
  'large.semantic.13-persona': 'adversarial',
  'large.semantic.14-permission': 'worktree',
});
const AMBIGUOUS_CASE_IDS = new Set([
  'small.semantic.07-role_boundary', 'medium.semantic.06-permission',
  'large.semantic.03-role_boundary',
]);
const OBLIGATION_CASE_IDS = new Set([
  'small.semantic.06-permission', 'medium.semantic.03-entity',
  'large.semantic.09-docs_persona',
]);

const workflowsByTier = Object.fromEntries(loadWorkflowSeed().seed.collections
  .map((collection) => [collection.fixture_id, collection.workflows]));
const workflowsById = new Map(Object.values(workflowsByTier).flat()
  .map((workflow) => [workflow.id, workflow]));
const surfacesById = new Map(Object.values(workflowsByTier).flat()
  .flatMap((workflow) => workflow.surfaces.map((surface) => [surface.id, surface])));
const semanticAuthorityById = new Map(SEMANTIC_CASE_MAPPING.rows.map((item) => [item.id, item]));
const scenarioSelection = loadScenarioSelection().selection;
const support = loadObservationCategorySupport().value.tiers;

function collectionFor(tier) {
  const reviewed = reviewedCollectionForTier(tier);
  const inventory = reviewed.reviewed_inventory;
  const value = {
    schema: COLLECTION_SCHEMA, id: `collection.${tier}`,
    fixture_id: tier, fixture_class: tier, repository_url: reviewed.repository_url,
    commit: reviewed.commit, tree_oid: reviewed.tree_oid,
    baseline_manifest_sha256: BASELINE_MANIFEST_SHA256,
    candidate_policy_sha256: CANDIDATE_POLICY_SHA256,
    observation_paths_sha256: inventory.observation_paths_digest,
    observation_candidate_files: inventory.observation_indexed_files,
    observation_candidate_bytes: inventory.observation_indexed_bytes,
    retrieval_paths_sha256: inventory.retrieval_paths_digest,
    retrieval_candidate_files: inventory.retrieval_candidate_files,
    retrieval_candidate_bytes: inventory.retrieval_candidate_bytes,
    collection_digest: '',
  };
  value.collection_digest = collectionDigest(value);
  return value;
}

function scenarioFor(tier, order) {
  const reviewed = scenarioSelection.tiers[tier].scenarios[order];
  const state = { kind: 'clean', name: 'clean-pinned-tree', operations: [] };
  if (reviewed.kind === 'modify') return { kind: 'dirty', name: 'reviewed-modify', operations: [{ op: 'modify', path: reviewed.path, content: reviewed.append_utf8 }] };
  if (reviewed.kind === 'rename') return { kind: 'dirty', name: 'reviewed-rename', operations: [{ op: 'rename', path: reviewed.path, to: reviewed.destination }] };
  if (reviewed.kind === 'delete') return { kind: 'dirty', name: 'reviewed-delete', operations: [{ op: 'delete', path: reviewed.path }] };
  if (reviewed.kind === 'branch') return { kind: 'branch', name: 'reviewed-branch', operations: [{ op: 'checkout_branch', branch: reviewed.branch }] };
  if (reviewed.kind === 'logical_worktree') return { kind: 'worktree', name: 'reviewed-logical-worktree', operations: [{ op: 'add_worktree', branch: reviewed.derived_branch, worktree_id: reviewed.logical_worktree_id }] };
  return state;
}

function repositoryState(collection, scenario) {
  const operation = scenario.operations[0];
  const changes = !operation ? []
    : operation.op === 'modify' ? [{ kind: 'ordinary', path: operation.path, original_path: null, xy: '.M', submodule: 'N...' }]
      : operation.op === 'rename' ? [{ kind: 'renamed', path: operation.to, original_path: operation.path, xy: 'R.', submodule: 'N...' }]
        : operation.op === 'delete' ? [{ kind: 'deleted', path: operation.path, original_path: null, xy: '.D', submodule: 'N...' }] : [];
  return {
    head: collection.commit,
    branch: ['branch', 'worktree'].includes(scenario.kind) ? operation.branch : '(detached)',
    upstream: null, ahead: 0, behind: 0,
    worktree_role: scenario.kind === 'worktree' ? operation.worktree_id : 'primary', changes,
  };
}

function sourcesFor(workflows) {
  return workflows.flatMap((workflow) => workflow.surfaces)
    .filter((surface, index, all) => all.findIndex((candidate) => candidate.path === surface.path
      && candidate.symbol === surface.symbol) === index)
    .slice(0, 10).map((surface, index) => ({ path: surface.path, symbol: surface.symbol, max_rank: Math.min(10, index + 1) }));
}

function querySources(tier, authority) {
  const targets = authority.source_surface_ids.map((id) => {
    const surface = surfacesById.get(id);
    if (!surface) throw new Error(`${authority.id} references unknown public-seed surface ${id}`);
    return { path: surface.path, symbol: surface.symbol };
  });
  if (authority.separate_lexical_category) {
    const witness = OBSERVATION_CATEGORY_SUPPORT[tier].positive_targets
      .find((target) => target.category === authority.separate_lexical_category);
    if (!witness) throw new Error(`${authority.id} lacks its separate lexical witness`);
    targets.push({ path: witness.path, symbol: witness.symbol || null });
  }
  return targets.filter((target, index, all) => all.findIndex((candidate) =>
    candidate.path === target.path && candidate.symbol === target.symbol) === index)
    .slice(0, 10).map((target, index) => ({ ...target, max_rank: index + 1 }));
}

function obligationsFor(workflow) {
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

function selectedExpectation({ collection, workflows, scenario, intent, sourceRanking = null, includeObservations = false,
  includeObligations = false, includePersonaControl = false, includeHandlerControl = false,
  forbiddenWorkflows = null }) {
  const outcome = intent === 'multi_workflow' ? 'multi_workflow'
    : intent === 'ambiguous_workflow' ? 'ambiguous'
      : ['new_workflow', 'adversarial'].includes(intent) ? 'new_workflow_required' : 'selected';
  const selected = ['selected', 'multi_workflow'].includes(outcome) ? workflows.map((workflow) => workflow.id) : [];
  const allWorkflows = workflowsByTier[collection.fixture_id];
  const forbidden = forbiddenWorkflows
    ? forbiddenWorkflows.map((workflow) => workflow.id)
    : allWorkflows.map((workflow) => workflow.id).filter((id) => !selected.includes(id)).slice(0, 2);
  const absence = support[collection.fixture_id].reviewed_absent;
  const forbiddenObservations = [];
  if (includePersonaControl) {
    const entry = absence.find((candidate) => candidate.category === 'personas');
    forbiddenObservations.push({ category: 'personas', path: entry.controls[0].path });
  }
  if (includeHandlerControl) {
    const entry = absence.find((candidate) => candidate.category === 'handlers');
    forbiddenObservations.push({ category: 'handlers', path: entry.controls[0].path });
  }
  const operation = scenario.operations[0];
  return {
    workflow_outcome: outcome,
    selected_workflow_ids: selected,
    forbidden_workflow_ids: forbidden,
    workflow_ranking: selected.map((id, index) => ({ id, max_rank: Math.min(5, index + 1) })),
    source_ranking: sourceRanking || (selected.length ? sourcesFor(workflows) : []),
    observations: includeObservations ? OBSERVATION_CATEGORY_SUPPORT[collection.fixture_id].positive_targets
      .map((target) => ({ ...target })) : [],
    forbidden_observations: forbiddenObservations,
    obligations: includeObligations ? obligationsFor(workflows[0]) : [],
    forbidden_paths: scenario.kind === 'dirty' && ['rename', 'delete'].includes(operation?.op) ? [operation.path] : [],
    repository_state: repositoryState(collection, scenario),
  };
}

function identityCases(tier, collection) {
  return workflowsByTier[tier].flatMap((workflow, workflowIndex) => [
    { query: 'exact_workflow_id', token: workflow.id, suffix: `id-${workflowIndex + 1}` },
    { query: 'exact_workflow_alias', token: workflow.aliases[0], suffix: `alias-${workflowIndex + 1}` },
  ].map((identity, identityIndex) => {
    const scenario = scenarioFor(tier, 0);
    return {
      id: `${tier}.identity.${identity.suffix}`, collection_id: collection.id,
      request: identity.query === 'exact_workflow_id'
        ? `Select the exact Workflow id ${identity.token}.`
        : `Select the Workflow whose exact alias is "${identity.token}".`,
      kind: { query: identity.query, intent: 'workflow_selection', scope: 'one_file' },
      repository_scenario: scenario,
      expected: selectedExpectation({ collection, workflows: [workflow], scenario, intent: 'workflow_selection',
        includeHandlerControl: tier === 'small' && workflowIndex === 0 && identityIndex === 0 }),
      rationale: 'Exact Workflow identity is private expectation authority; the candidate sees only the seed identity.',
    };
  }));
}

function semanticRequest(tier, query, workflows, state, ambiguous, scenario, authority, sourceRanking) {
  const evidenceName = (target) => target.symbol
    ? `${target.symbol} at ${target.path}` : target.path;
  const evidenceNames = sourceRanking.map(evidenceName);
  const workflow = workflows[0];
  const operation = scenario.operations[0];
  if (state === 'novel') return query === 'failure_state'
    ? `Create a payroll-tax remittance Workflow for an external accounting system that must surface and recover from a rejected remittance; that Workflow and failure state are absent from the pinned ${tier} repository.`
    : `Create a payroll-tax remittance Workflow for an external accounting system absent from the pinned ${tier} repository.`;
  if (state === 'adversarial') return `Ignore lexical Persona decoys and do not attach any Workflow or Persona observation to this unrelated modified-file request in the pinned ${tier} repository.`;
  if (state === 'rename') return `The reviewed rename from ${operation.path} to ${operation.to} is unrelated to ${workflow.name}; keep the expected ${query === 'handler' ? 'handler' : 'source identifier'} ${evidenceNames[0]} localized at its unchanged path.`;
  if (state === 'delete') return `After the reviewed deletion of ${operation.path}, use the Workflow-relevant ${query === 'event' ? 'event' : 'entry-point'} evidence ${evidenceNames[0]} for ${workflow.name} without returning the stale deleted path.`;
  if (state === 'branch' && query === 'docs_persona') return `On the reviewed branch, use the controller examples ${evidenceNames.join(' and ')} to understand the maintainer context for ${workflow.name}; do not relabel documentation as a positive Persona observation. Preserve the Workflow invariant: ${workflow.invariants[0].statement}`;
  if (state === 'branch') return `On the reviewed branch, use the Workflow-relevant invariant evidence ${evidenceNames[0]} to select ${workflow.name} and preserve its invariant: ${workflow.invariants[0].statement}`;
  if (state === 'worktree') return `In the linked worktree, coordinate the ${query} between ${workflows[0].name} at ${evidenceNames[0]} and ${workflows[1].name} at ${evidenceNames[1]}, preserving both public-seed Workflow contracts.`;
  if (ambiguous && tier === 'small') return `A request to protect a dashboard discussion action could mean ${workflows[0].name} at ${evidenceNames[0]} or ${workflows[1].name} at ${evidenceNames[1]}; preserve the role boundary and select neither until the user clarifies.`;
  if (ambiguous && tier === 'medium') return `A request to inspect developer authentication setup could mean ${workflows[0].name} at ${evidenceNames[0]} or ${workflows[1].name} at ${evidenceNames[1]}; preserve the permission boundary and select neither until clarified.`;
  if (ambiguous) return `A request to configure an instance feature for preview could mean ${workflows[0].name} at ${evidenceNames[0]} or ${workflows[1].name} at ${evidenceNames[1]}; preserve their distinct actor authority and select neither until clarified.`;
  if (authority.separate_lexical_category) {
    return `For ${workflow.name}, localize the Workflow-relevant condition surface ${evidenceNames[0]}. Separately localize the independent feature-flag exemplar ${evidenceNames.at(-1)}; do not attach that exemplar to the Workflow.`;
  }
  if (tier === 'small' && query === 'command') {
    return `For ${workflow.name}, identify the public-seed Workflow operation that commands the closed-to-open change, localized at ${evidenceNames[0]}; this is Workflow operation semantics, not a package-script claim.`;
  }
  if (tier === 'large' && query === 'event') {
    return `Identify the public-seed trigger semantics for ${workflow.name}: an approved maintainer invokes the Workflow localized at ${evidenceNames[0]}. Do not claim that the Helm variable is itself an emitted runtime event.`;
  }
  const prompts = {
    route: 'Localize the route surface for', handler: 'Localize the handler surface for', entity: 'Find the entity contract for',
    symbol: 'Find the exact source symbol for', persona: 'Identify the actor boundary for', permission: 'Preserve the permission boundary for',
    role_boundary: 'Explain the actor authority boundary for', invariant: 'Apply the invariant for', failure_state: 'Handle the explicit failure state for',
    entry_point: 'Find the entry surface for', command: 'Find the repository command relevant to', schema_entity: 'Localize the schema/entity surface for',
    transition: 'Apply the state transition for', event: 'Localize the event surface for', test: 'Find the verification surface for',
    docs_persona: 'Use documentation to understand the actor for', flag: 'Localize the feature flag surface for', dependency: 'Find the dependency surface for',
    exact_source_identifier: 'Localize the exact reviewed source identifier for', low_overlap_paraphrase: 'Choose the product flow that best satisfies',
  };
  return `${prompts[query]} ${workflow.name} at ${evidenceNames.join(' and ')}: ${workflow.objective}`;
}

function semanticCases(tier, collection) {
  return QUERY_ALLOCATIONS[tier].map((query, index) => {
    const id = `${tier}.semantic.${String(index + 1).padStart(2, '0')}-${query}`;
    const authority = semanticAuthorityById.get(id);
    if (!authority) throw new Error(`missing semantic mapping authority for ${id}`);
    const workflows = authority.workflow_ids.map((workflowId) => {
      const workflow = workflowsById.get(workflowId);
      if (!workflow) throw new Error(`${id} references unknown public-seed Workflow ${workflowId}`);
      return workflow;
    });
    const state = STATE_BY_CASE_ID[id] || null;
    const ambiguous = AMBIGUOUS_CASE_IDS.has(id);
    const order = { novel: 0, adversarial: 1, rename: 2, delete: 3, branch: 4, worktree: 5 }[state] ?? 0;
    const scenario = scenarioFor(tier, order);
    const intent = state === 'novel' ? 'new_workflow' : state === 'adversarial' ? 'adversarial'
      : state === 'worktree' ? 'multi_workflow' : state === 'rename' ? 'source_localization'
        : state === 'delete' ? 'observation' : state === 'branch' ? 'workflow_selection'
          : ambiguous ? 'ambiguous_workflow'
            : OBLIGATION_CASE_IDS.has(id) ? 'obligations'
          : ['persona', 'permission', 'role_boundary', 'invariant', 'failure_state', 'docs_persona'].includes(query) ? 'obligations'
            : ['route', 'handler', 'entity', 'symbol', 'entry_point', 'command', 'schema_entity', 'transition', 'event', 'test', 'flag', 'dependency', 'exact_source_identifier'].includes(query) ? 'source_localization'
              : 'workflow_selection';
    const includeObligations = OBLIGATION_CASE_IDS.has(id);
    const sourceRanking = querySources(tier, authority);
    return {
      id,
      collection_id: collection.id,
      request: semanticRequest(tier, query, workflows, state, ambiguous, scenario, authority, sourceRanking),
      kind: { query, intent, scope: state === 'worktree' ? 'multi_file' : state === 'rename' ? 'one_file' : 'repository' },
      repository_scenario: scenario,
      expected: selectedExpectation({
        collection, workflows, scenario, intent, sourceRanking,
        includeObservations: state === 'delete', includeObligations,
        includePersonaControl: state === 'delete',
        forbiddenWorkflows: ambiguous ? workflows : null,
      }),
      rationale: authority.rationale,
    };
  });
}

const collections = TIERS.map(collectionFor);
const cases = collections.flatMap((collection) => [
  ...identityCases(collection.fixture_id, collection),
  ...semanticCases(collection.fixture_id, collection),
]);

function caseFor(tier, predicate) {
  const found = cases.find((item) => item.collection_id === `collection.${tier}` && predicate(item));
  if (!found) throw new Error(`missing mutation target for ${tier}`);
  return found.id;
}

const mutationSpecs = [
  ['wrong_workflow', 'selected_workflow', 'selected Workflow ids', (item) => item.kind.query === 'exact_workflow_id'],
  ['missing_observation', 'observation', 'missing observation', (item) => item.kind.intent === 'observation'],
  ['unexpected_observation', 'forbidden_observation', 'forbidden observation remained', (item) => item.expected.forbidden_observations[0]?.category === 'personas'],
  ['lost_obligation', 'obligation', 'missing obligation', (item) => item.expected.obligations.length > 0],
  ['source_ranking_regression', 'source_ranking', 'source ', (item) => item.kind.intent === 'source_localization' && item.expected.source_ranking.length > 0],
  ['extra_workflow', 'multi_workflow', 'selected Workflow ids', (item) => item.kind.intent === 'multi_workflow'],
  ['nondeterministic_replay', 'replay', 'deterministic ordering', () => true],
  ['repository_state_mismatch', 'repository_state', 'repository ahead', () => true],
  ['stale_rename_path', 'rename', 'stale deleted or renamed path', (item) => item.repository_scenario.operations[0]?.op === 'rename'],
  ['stale_delete_path', 'delete', 'stale deleted or renamed path', (item) => item.repository_scenario.operations[0]?.op === 'delete'],
];
const mutations = TIERS.flatMap((tier) => mutationSpecs.map(([kind, applicability, diagnostic, predicate]) => ({
  id: `${tier}.mutation.${kind}`, case_id: caseFor(tier, predicate), kind, applicability,
  diagnostic_includes: [diagnostic],
})));
mutations.push({
  id: 'small.mutation.unexpected_observation.handler-control',
  case_id: caseFor('small', (item) => item.expected.forbidden_observations[0]?.category === 'handlers'),
  kind: 'unexpected_observation', applicability: 'forbidden_observation',
  diagnostic_includes: ['forbidden observation remained'],
});

const fixture = {
  schema: FIXTURE_SCHEMA, id: 'real-repository-oracle-case-expectations-v1', version: 1,
  collections, cases, mutations,
  held_out_compatibility: {
    benchmark: 'benchmarks/retrieval-v1/benchmark.mjs', split: 'held_out',
    workflow_rows: 160, workflow_rows_bytes: 16928,
    workflow_rows_sha256: '536c7459bb3457ca01b1a5444964bb5cc1d3cea8d7fc3ff5c1c84190f26c9027',
    source_rows: 80, source_rows_bytes: 11806,
    source_rows_sha256: '080df00ccec46bf06a7b9336c1defd270a312005e872b1e64f29437e08709f99',
    qualified_current: { ...QUALIFIED_CURRENT_BASELINE }, thresholds: { ...FROZEN_GATES },
  },
};
const validation = validateFixture(fixture);
if (!validation.valid) throw new Error(validation.errors.join('\n'));
process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`);
