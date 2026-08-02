import {
  FROZEN_GATES, collectionDigest, resultCasesDigest, validateFixture, validateResult,
} from './contract.mjs';

const stableTarget = (target) => JSON.stringify({
  category: target.category, id: target.id || null, path: target.path || null,
  symbol: target.symbol || null, relation: target.relation || null,
});
const ratio = (numerator, denominator) => denominator ? numerator / denominator : 1;
const sameSet = (left, right) => left.length === right.length
  && [...left].sort().every((value, index) => value === [...right].sort()[index]);
const changeKey = (value) => JSON.stringify({
  kind: value.kind, path: value.path, original_path: value.original_path,
  xy: value.xy, submodule: value.submodule,
});

function completeRanking(expected, actual, matcher, diagnostic) {
  let complete = true;
  for (const target of expected) {
    const rank = actual.findIndex((item) => matcher(item, target)) + 1;
    if (!(rank > 0 && rank <= target.max_rank)) {
      complete = false;
      diagnostic(target, rank);
    }
  }
  return complete;
}

function compareRepositoryState(expected, actual, prefix, diagnostics) {
  for (const field of ['head', 'branch', 'upstream', 'ahead', 'behind', 'worktree']) {
    if (actual[field] !== expected[field]) diagnostics.push(`${prefix}: repository ${field} expected ${JSON.stringify(expected[field])}, got ${JSON.stringify(actual[field])}`);
  }
  const expectedChanges = expected.changes.map(changeKey).sort();
  const actualChanges = actual.changes.map(changeKey).sort();
  if (JSON.stringify(actualChanges) !== JSON.stringify(expectedChanges)) {
    diagnostics.push(`${prefix}: repository changes expected exactly ${JSON.stringify(expectedChanges)}, got ${JSON.stringify(actualChanges)}`);
  }
}

function compareCase(expectedCase, actual, diagnostics, counters, coverage) {
  const expected = expectedCase.expected;
  const prefix = `case ${expectedCase.id}`;
  if (actual.workflow_outcome !== expected.workflow_outcome) diagnostics.push(`${prefix}: workflow outcome expected ${expected.workflow_outcome}, got ${actual.workflow_outcome}`);
  if (!sameSet(actual.selected_workflow_ids, expected.selected_workflow_ids)) diagnostics.push(`${prefix}: selected Workflow ids expected ${JSON.stringify(expected.selected_workflow_ids)}, got ${JSON.stringify(actual.selected_workflow_ids)}`);
  for (const forbidden of expected.forbidden_workflow_ids) if (actual.selected_workflow_ids.includes(forbidden)) diagnostics.push(`${prefix}: forbidden Workflow id ${forbidden} was selected`);
  if (['exact_workflow_id', 'exact_workflow_alias'].includes(expectedCase.kind.query)) {
    counters.exact.total += 1;
    if (sameSet(actual.selected_workflow_ids, expected.selected_workflow_ids)) counters.exact.matched += 1;
  }
  if (expectedCase.kind.intent === 'multi_workflow') {
    counters.multi.total += 1;
    if (sameSet(actual.selected_workflow_ids, expected.selected_workflow_ids)) counters.multi.matched += 1;
  }
  if (expectedCase.kind.intent === 'new_workflow') {
    counters.novel.total += 1;
    if (actual.selected_workflow_ids.length) counters.novel.incorrect += 1;
  }
  if (expected.workflow_ranking.length) {
    counters.workflow.total += 1;
    if (completeRanking(expected.workflow_ranking, actual.workflow_ranking,
      (item, target) => item.id === target.id,
      (target, rank) => diagnostics.push(`${prefix}: Workflow ${target.id} missing from rank <= ${target.max_rank}; got ${rank || 'absent'}`))) counters.workflow.matched += 1;
  }
  if (expected.source_ranking.length) {
    counters.source.total += 1;
    if (completeRanking(expected.source_ranking, actual.source_ranking,
      (item, target) => item.path === target.path && (target.symbol === null || item.symbol === target.symbol),
      (target, rank) => diagnostics.push(`${prefix}: source ${target.path}${target.symbol ? `#${target.symbol}` : ''} missing from rank <= ${target.max_rank}; got ${rank || 'absent'}`))) counters.source.matched += 1;
  }
  const actualObservations = new Set(actual.observations.map(stableTarget));
  for (const target of expected.observations) {
    const category = coverage.observations[target.category] ||= { expected: 0, matched: 0 };
    category.expected += 1;
    if (actualObservations.has(stableTarget(target))) category.matched += 1;
    else diagnostics.push(`${prefix}: missing observation ${stableTarget(target)}`);
  }
  for (const target of expected.forbidden_observations) if (actualObservations.has(stableTarget(target))) diagnostics.push(`${prefix}: forbidden observation remained ${stableTarget(target)}`);
  const actualObligations = new Set(actual.obligations.map(stableTarget));
  for (const target of expected.obligations) {
    const category = coverage.obligations[target.category] ||= { expected: 0, matched: 0 };
    category.expected += 1;
    if (actualObligations.has(stableTarget(target))) category.matched += 1;
    else diagnostics.push(`${prefix}: missing obligation ${stableTarget(target)}`);
  }
  for (const forbidden of expected.forbidden_paths) {
    if (actual.source_ranking.some((item) => item.path === forbidden)
      || actual.observations.some((item) => item.path === forbidden)) diagnostics.push(`${prefix}: stale deleted or renamed path ${forbidden} remained`);
  }
  compareRepositoryState(expected.repository_state, actual.repository_state, prefix, diagnostics);
}

export function gradeResult(fixture, result, { safetyAttestation = null } = {}) {
  const fixtureValidation = validateFixture(fixture);
  if (!fixtureValidation.valid) return { passed: false, classification: 'fixture_defect', metrics: null, coverage: null, diagnostics: fixtureValidation.errors };
  const resultValidation = validateResult(result, { safetyAttestation });
  if (!resultValidation.valid) return { passed: false, classification: 'candidate_invalid', metrics: null, coverage: null, diagnostics: resultValidation.errors };
  const collection = fixture.collections.find((item) => item.id === result.collection_id);
  if (!collection || result.collection_digest !== collection.collection_digest
    || collection.collection_digest !== collectionDigest(collection)) {
    return { passed: false, classification: 'fixture_defect', metrics: null, coverage: null, diagnostics: [`collection mismatch: ${result.collection_id} does not match its reviewed #60 collection digest`] };
  }
  if (result.safety.outcome === 'blocked') return { passed: false, classification: 'safety_blocked', metrics: null, coverage: null, diagnostics: [result.safety.reason] };
  if (safetyAttestation) {
    const materializationDigests = [...new Set(result.materializations.map((item) => item.base_digest))].sort();
    if (safetyAttestation.collection_digest !== result.collection_digest
      || JSON.stringify([...safetyAttestation.materialization_digests].sort()) !== JSON.stringify(materializationDigests)) {
      return { passed: false, classification: 'candidate_invalid', metrics: null, coverage: null, diagnostics: ['safe-runner attestation does not bind the exact collection materializations'] };
    }
  }
  const expectedCases = fixture.cases.filter((item) => item.collection_id === collection.id);
  if (!sameSet(result.cases.map((item) => item.id), expectedCases.map((item) => item.id))) return { passed: false, classification: 'candidate_invalid', metrics: null, coverage: null, diagnostics: ['candidate case ids do not exactly match the reviewed collection case ids'] };
  const diagnostics = [];
  const counters = { exact: { matched: 0, total: 0 }, multi: { matched: 0, total: 0 }, novel: { incorrect: 0, total: 0 }, workflow: { matched: 0, total: 0 }, source: { matched: 0, total: 0 } };
  const coverage = { observations: {}, obligations: {} };
  const byId = new Map(result.cases.map((item) => [item.id, item]));
  for (const expectedCase of expectedCases) compareCase(expectedCase, byId.get(expectedCase.id), diagnostics, counters, coverage);
  const metrics = {
    exact_id_alias_accuracy: ratio(counters.exact.matched, counters.exact.total),
    complete_multi_workflow_selection: ratio(counters.multi.matched, counters.multi.total),
    incorrect_new_workflow_attachment: ratio(counters.novel.incorrect, counters.novel.total),
    workflow_recall_at_5: ratio(counters.workflow.matched, counters.workflow.total),
    source_recall_at_10: ratio(counters.source.matched, counters.source.total),
    deterministic_ordering: result.replay_digest === resultCasesDigest(result.cases),
  };
  for (const [metric, threshold] of Object.entries(FROZEN_GATES)) {
    const failed = metric === 'incorrect_new_workflow_attachment' ? metrics[metric] > threshold : metrics[metric] < threshold;
    if (failed) diagnostics.push(`quality gate ${metric}: expected ${metric.includes('incorrect') ? '<=' : '>='} ${threshold}, got ${metrics[metric]}`);
  }
  if (!metrics.deterministic_ordering) diagnostics.push('deterministic ordering: replay digest differs from the graded case ordering');
  return { passed: diagnostics.length === 0, classification: diagnostics.length ? 'product_regression' : 'pass', metrics, coverage, diagnostics };
}
