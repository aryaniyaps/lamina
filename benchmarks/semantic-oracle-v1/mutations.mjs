import { semanticDigest } from './contract.mjs';

function finish(result) {
  result.semantic_digest = semanticDigest(result.semantic);
  return result;
}

function removeFrom(array, id) {
  return array.filter((item) => item !== id);
}

function replaceIn(array, before, after) {
  return array.map((item) => item === before ? after : item);
}

function removeRelation(result, relation) {
  const id = relation.id;
  result.semantic.relations = result.semantic.relations.filter((item) => item.id !== id);
  for (const version of result.semantic.graph_versions) {
    for (const field of [
      'added_relation_ids', 'retired_relation_ids', 'active_relation_ids',
    ]) version[field] = removeFrom(version[field], id);
  }
  for (const branch of result.semantic.branches) {
    branch.active_relation_ids = removeFrom(branch.active_relation_ids, id);
  }
  for (const attempt of result.semantic.publication_attempts) {
    attempt.visible_relation_ids = removeFrom(attempt.visible_relation_ids, id);
  }
  result.semantic.obligations = result.semantic.obligations
    .filter((item) => !item.required_relation_ids.includes(id));
  for (const contradiction of result.semantic.contradictions) {
    contradiction.member_ids = removeFrom(contradiction.member_ids, id);
  }
}

function removeResource(result, id) {
  for (const relation of [...result.semantic.relations]) {
    if (relation.subject_id === id || relation.object_id === id || relation.scope_id === id
      || relation.evidence_ids.includes(id) || relation.generated_by_ids.includes(id)) {
      removeRelation(result, relation);
    }
  }
  result.semantic.resources = result.semantic.resources.filter((item) => item.id !== id);
  result.semantic.contradictions = result.semantic.contradictions.filter((item) => item.id !== id);
  result.semantic.obligations = result.semantic.obligations
    .filter((item) => item.subject_id !== id)
    .map((item) => ({ ...item, evidence_ids: removeFrom(item.evidence_ids, id) }));
  for (const version of result.semantic.graph_versions) {
    for (const field of [
      'added_resource_ids', 'retired_resource_ids', 'active_resource_ids',
    ]) version[field] = removeFrom(version[field], id);
    version.validation.contradiction_ids = removeFrom(version.validation.contradiction_ids, id);
  }
  for (const branch of result.semantic.branches) {
    branch.active_resource_ids = removeFrom(branch.active_resource_ids, id);
  }
  for (const attempt of result.semantic.publication_attempts) {
    attempt.visible_resource_ids = removeFrom(attempt.visible_resource_ids, id);
  }
}

function relationByPredicate(result, predicate) {
  const relation = result.semantic.relations.find((item) => item.predicate === predicate);
  if (!relation) throw new Error(`mutation fixture lacks relation ${predicate}`);
  return relation;
}

const MUTATION_FUNCTIONS = Object.freeze({
  'remove-product-resource': (result) => removeResource(result, 'product.checkout'),
  'remove-governed-relation': (result) => removeRelation(result, relationByPredicate(result, 'lamina:governedBy')),
  'break-version-parent': (result) => {
    const feature = result.semantic.graph_versions.find((item) =>
      item.active_resource_ids.includes('surface.feature-only'));
    feature.parent_ids = [];
  },
  'change-provenance': (result) => {
    result.semantic.resources.find((item) => item.id === 'product.checkout').epistemic_class = 'inferred';
  },
  'remove-contradiction': (result) => removeResource(
    result,
    result.semantic.contradictions[0].id,
  ),
  'expose-partial-publication': (result) => {
    const failed = result.semantic.publication_attempts.find((item) => item.outcome === 'validation_failed');
    const main = result.semantic.branches.find((item) => item.id === 'branch:main');
    failed.head_version_id_after = main.head_version_id;
    failed.visible_resource_ids = [...main.active_resource_ids];
    failed.visible_relation_ids = [...main.active_relation_ids];
  },
  'collapse-epistemic-class': (result) => {
    result.semantic.resources.find((item) => item.id === 'observation.route').epistemic_class = 'intended';
  },
  'remove-actor': (result) => removeResource(result, 'actor.reviewer'),
  'remove-persona': (result) => removeResource(result, 'persona.operator'),
  'remove-workflow-step': (result) => removeRelation(result, relationByPredicate(result, 'lamina:hasStep')),
  'remove-transition': (result) => removeRelation(result, relationByPredicate(result, 'lamina:transitionsTo')),
  'remove-state': (result) => removeResource(result, 'state.pending'),
  'remove-permission': (result) => removeRelation(result, relationByPredicate(result, 'lamina:authorizedFor')),
  'remove-invariant': (result) => removeRelation(result, relationByPredicate(result, 'lamina:constrainedBy')),
  'remove-failure': (result) => removeRelation(result, relationByPredicate(result, 'lamina:hasScenario')),
  'remove-decision': (result) => removeResource(result, 'decision.manual-review'),
  'remove-verification-evidence': (result) => {
    const relation = relationByPredicate(result, 'lamina:requiresProof');
    relation.evidence_ids = [];
    for (const obligation of result.semantic.obligations.filter((item) =>
      item.required_relation_ids.includes(relation.id))) obligation.evidence_ids = [];
  },
  'leak-feature-branch': (result) => {
    const main = result.semantic.branches.find((item) => item.id === 'branch:main');
    const head = result.semantic.graph_versions.find((item) => item.id === main.head_version_id);
    main.active_resource_ids.push('surface.feature-only');
    main.active_resource_ids.sort();
    head.active_resource_ids.push('surface.feature-only');
    head.active_resource_ids.sort();
    head.added_resource_ids.push('surface.feature-only');
    head.added_resource_ids.sort();
    for (const attempt of result.semantic.publication_attempts.filter((item) =>
      item.head_version_id_after === head.id)) {
      attempt.visible_resource_ids.push('surface.feature-only');
      attempt.visible_resource_ids.sort();
    }
  },
  'drop-concurrent-update': (result) => removeResource(result, 'entity.concurrent-b'),
  'swap-workflow-step-order': (result) => {
    const approve = result.semantic.relations.find((item) =>
      item.predicate === 'lamina:hasStep' && item.object_id === 'operation.approve');
    const archive = result.semantic.relations.find((item) =>
      item.predicate === 'lamina:hasStep' && item.object_id === 'operation.archive');
    [approve.attributes.position, archive.attributes.position] = [
      archive.attributes.position,
      approve.attributes.position,
    ];
  },
  'reverse-order': (result) => result.semantic.relations.reverse(),
  'break-graph-closure': (result) => {
    const main = result.semantic.branches.find((item) => item.id === 'branch:main');
    main.active_relation_ids = main.active_relation_ids.slice(1);
  },
  'make-derived-authoritative': (result) => {
    result.semantic.derived_state[0].authoritative = true;
  },
  'remove-obligation': (result) => result.semantic.obligations.shift(),
  'mark-unresolved-complete': (result) => {
    result.semantic.obligations[0].complete = true;
  },
  'corrupt-relation-id': (result) => {
    const relation = result.semantic.relations[0];
    const before = relation.id;
    const after = `${before}.corrupt`;
    relation.id = after;
    for (const version of result.semantic.graph_versions) {
      for (const field of [
        'added_relation_ids', 'retired_relation_ids', 'active_relation_ids',
      ]) version[field] = replaceIn(version[field], before, after).sort();
    }
    for (const branch of result.semantic.branches) {
      branch.active_relation_ids = replaceIn(branch.active_relation_ids, before, after).sort();
    }
    for (const attempt of result.semantic.publication_attempts) {
      attempt.visible_relation_ids = replaceIn(attempt.visible_relation_ids, before, after).sort();
    }
    for (const obligation of result.semantic.obligations) {
      obligation.required_relation_ids = replaceIn(obligation.required_relation_ids, before, after).sort();
    }
    for (const contradiction of result.semantic.contradictions) {
      contradiction.member_ids = replaceIn(contradiction.member_ids, before, after).sort();
    }
  },
});

export const MUTATION_IDS = Object.freeze(Object.keys(MUTATION_FUNCTIONS).sort());

export function applySemanticMutation(id, input) {
  const mutate = MUTATION_FUNCTIONS[id];
  if (!mutate) throw new Error(`unknown semantic mutation: ${id}`);
  const result = structuredClone(input);
  mutate(result);
  return finish(result);
}
