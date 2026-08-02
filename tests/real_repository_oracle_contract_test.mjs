#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  ADAPTER_SCHEMA, BASELINE_MANIFEST_SHA256, CANDIDATE_POLICY_SHA256,
  COLLECTION_PINS, COLLECTION_SCHEMA, DIRTY_OPERATION_PORCELAIN,
  FIXTURE_SCHEMA, FROZEN_GATES,
  OBSERVATION_CATEGORIES, OBLIGATION_CATEGORIES, QUALIFIED_CURRENT_BASELINE,
  QUERY_KINDS, RESULT_SCHEMA, canonical, collectionDigest, digest,
  executeRegisteredMutation, isSafeBranchName, isSafeRelativePath,
  fixtureDigest, materializationBaseDigest, materializationProvenanceDigest,
  resultCasesDigest, reviewedManifestDigest, validateFixture, validateResult,
} from '../benchmarks/real-repository-oracle-v1/contract.mjs';
import { evaluateAdapter, evaluateSideBySide } from '../benchmarks/real-repository-oracle-v1/evaluate.mjs';
import { gradeControllerVerification, gradeResult } from '../benchmarks/real-repository-oracle-v1/grade.mjs';
import {
  CANONICAL_WORKLOAD_ARGV, MAX_PAYLOAD_LINE_BYTES, PAYLOAD_PREFIX,
  MAX_RETAINED_DIAGNOSTICS,
  createCompactGradeEnvelope, encodeUnattestedPayload,
  runnerFailureClassification,
  verifyReturnedBlockedControllerReport, verifyReturnedControllerReport,
} from '../benchmarks/real-repository-oracle-v1/attestation.mjs';
import { runOracleThroughSafeRunner } from '../benchmarks/real-repository-oracle-v1/controller.mjs';
import { resolvePhysicalContained } from '../benchmarks/real-repository-oracle-v1/materialization-registry.mjs';
import { spawnTrustedGit } from '../scripts/safe-runner/git.mjs';
import { heldOutIdentity } from '../benchmarks/real-repository-oracle-v1/held-out-compatibility.mjs';
import { parsePorcelainV2Z } from '../benchmarks/real-repository-oracle-v1/repository-state.mjs';
import { retrievalFixture } from '../benchmarks/retrieval-v1/fixtures.mjs';
import { validateFixtureSchema, validateResultSchema } from '../benchmarks/real-repository-oracle-v1/schema-validation.mjs';

function collection(fixtureId, index) {
  const pin = COLLECTION_PINS[fixtureId];
  const value = {
    schema: COLLECTION_SCHEMA, id: `collection.${fixtureId}`,
    ...pin, baseline_manifest_sha256: BASELINE_MANIFEST_SHA256,
    candidate_policy_sha256: CANDIDATE_POLICY_SHA256,
    observation_paths_sha256: String(index + 1).repeat(64),
    observation_candidate_files: 100 + index, observation_candidate_bytes: 1000 + index,
    retrieval_paths_sha256: String(index + 4).repeat(64),
    retrieval_candidate_files: 80 + index, retrieval_candidate_bytes: 800 + index,
    collection_digest: '',
  };
  value.collection_digest = collectionDigest(value);
  return value;
}
const collections = ['small', 'medium', 'large'].map(collection);
const observations = OBSERVATION_CATEGORIES.map((category) => ({ category, path: `src/${category}.ts` }));
const obligations = OBLIGATION_CATEGORIES.map((category) => ({ category, path: `src/${category}.ts` }));

function scenarioFor(index) {
  if (index === 1) return { kind: 'dirty', name: 'modify', operations: [{ op: 'modify', path: 'src/a.ts', content: 'reviewed mutation' }] };
  if (index === 2) return { kind: 'dirty', name: 'rename', operations: [{ op: 'rename', path: 'src/a.ts', to: 'src/b.ts' }] };
  if (index === 3) return { kind: 'dirty', name: 'delete', operations: [{ op: 'delete', path: 'src/a.ts' }] };
  if (index === 4) return { kind: 'branch', name: 'branch', operations: [{ op: 'checkout_branch', branch: 'review/oracle' }] };
  if (index === 5) return { kind: 'worktree', name: 'worktree', operations: [{ op: 'add_worktree', branch: 'review/linked', worktree_id: 'linked-1' }] };
  return { kind: 'clean', name: `clean-${index}`, operations: [] };
}

function reviewedCase(collectionValue, query, index) {
  const scenario = scenarioFor(index);
  const intent = index === 6 ? 'multi_workflow' : index === 7 ? 'new_workflow'
    : index === 8 ? 'adversarial' : index % 2 ? 'source_localization' : 'workflow_selection';
  const outcome = intent === 'multi_workflow' ? 'multi_workflow'
    : intent === 'new_workflow' ? 'new_workflow_required' : 'selected';
  const selected = outcome === 'multi_workflow' ? ['workflow.primary', 'workflow.secondary']
    : outcome === 'new_workflow_required' ? [] : ['workflow.primary'];
  return {
    id: `${collectionValue.id}.${query}`,
    collection_id: collectionValue.id,
    request: `Reviewed ${query} request for ${collectionValue.id}`,
    kind: { query, intent, scope: index % 3 === 0 ? 'one_file' : index % 3 === 1 ? 'multi_file' : 'repository' },
    repository_scenario: scenario,
    expected: {
      workflow_outcome: outcome, selected_workflow_ids: selected,
      forbidden_workflow_ids: ['workflow.forbidden'],
      workflow_ranking: index === 0 ? [{ id: 'workflow.primary', max_rank: 1 }, { id: 'workflow.secondary', max_rank: 5 }] : [],
      source_ranking: index === 0 ? [{ path: 'src/entry_point.ts', symbol: 'entryPoint', max_rank: 1 }, { path: 'src/handler.ts', symbol: null, max_rank: 10 }] : [],
      observations: index === 0 ? observations : [], forbidden_observations: [],
      obligations: index === 0 ? obligations : [],
      forbidden_paths: [2, 3].includes(index) ? ['src/a.ts'] : [],
      repository_state: {
        head: collectionValue.commit,
        branch: ['branch', 'worktree'].includes(scenario.kind) ? scenario.operations[0].branch : '(detached)', upstream: null,
        ahead: 0, behind: 0, worktree_role: index === 5 ? 'linked-1' : 'primary',
        changes: scenario.operations.flatMap((operation) => {
          const semantics = DIRTY_OPERATION_PORCELAIN[operation.op];
          if (operation.op === 'modify') return [{ kind: semantics.kind, path: operation.path, original_path: null, xy: semantics.xy, submodule: semantics.submodule }];
          if (operation.op === 'rename') return [{ kind: semantics.kind, path: operation.to, original_path: operation.path, xy: semantics.xy, submodule: semantics.submodule }];
          if (operation.op === 'delete') return [{ kind: semantics.kind, path: operation.path, original_path: null, xy: semantics.xy, submodule: semantics.submodule }];
          return [];
        }),
      },
    },
    rationale: 'Compact reviewed expectation bound to one exact repository collection.',
  };
}
const cases = collections.flatMap((item) => QUERY_KINDS.map((query, index) => reviewedCase(item, query, index)));
const heldOut = heldOutIdentity(retrievalFixture());
const mutationKinds = [
  ['wrong_workflow', 'selected_workflow', 'selected Workflow ids'],
  ['missing_observation', 'observation', 'missing observation'],
  ['lost_obligation', 'obligation', 'missing obligation'],
  ['source_ranking_regression', 'source_ranking', 'source src/entry_point.ts'],
  ['extra_workflow', 'multi_workflow', 'selected Workflow ids'],
  ['nondeterministic_replay', 'replay', 'deterministic ordering'],
  ['repository_state_mismatch', 'repository_state', 'repository ahead'],
  ['stale_rename_path', 'rename', 'stale deleted or renamed path'],
  ['stale_delete_path', 'delete', 'stale deleted or renamed path'],
];
const fixture = {
  schema: FIXTURE_SCHEMA, id: 'synthetic-contract-fixture', version: 1,
  collections, cases,
  mutations: mutationKinds.map(([kind, applicability, diagnostic]) => ({
    id: `mutation.${kind}`,
    case_id: kind === 'extra_workflow' ? cases[6].id
      : kind === 'stale_rename_path' ? cases[2].id
      : kind === 'stale_delete_path' ? cases[3].id : cases[0].id,
    kind, applicability, diagnostic_includes: [diagnostic],
  })),
  held_out_compatibility: {
    benchmark: 'benchmarks/retrieval-v1/benchmark.mjs', split: 'held_out', ...heldOut,
    qualified_current: { ...QUALIFIED_CURRENT_BASELINE }, thresholds: { ...FROZEN_GATES },
  },
};
assert.deepEqual(validateFixture(fixture), { valid: true, errors: [] });
assert.equal(validateFixtureSchema(fixture), true, JSON.stringify(validateFixtureSchema.errors));
await assert.rejects(runOracleThroughSafeRunner({
  fixture, collection: collections[2], tier: 'small',
  cwd: '/controller-must-not-reach-filesystem', reportFile: '/controller-must-not-run/report.json',
}), /tier must exactly match/, 'collection tier mismatch is rejected before runSafely or filesystem access');
const relabelledCollection = structuredClone(collections[0]);
relabelledCollection.observation_candidate_files += 1;
relabelledCollection.collection_digest = collectionDigest(relabelledCollection);
await assert.rejects(runOracleThroughSafeRunner({
  fixture, collection: relabelledCollection, tier: 'small',
  cwd: '/controller-must-not-reach-filesystem', reportFile: '/controller-must-not-run/report.json',
}), /exact digest-bound fixture collection member/,
'a self-consistent but unreviewed collection cannot reach runSafely');
await assert.rejects(runOracleThroughSafeRunner({ env: { ORACLE_FIXTURE: '/candidate/path' } }),
  /rejects caller environment overrides/);
const previousOracleFixture = process.env.ORACLE_FIXTURE;
process.env.ORACLE_FIXTURE = '/ambient/candidate/path';
try {
  await assert.rejects(runOracleThroughSafeRunner({ fixture, collection: collections[0], tier: 'small' }),
    /unsealed ambient semantic environment/);
} finally {
  if (previousOracleFixture === undefined) delete process.env.ORACLE_FIXTURE;
  else process.env.ORACLE_FIXTURE = previousOracleFixture;
}
const manifestLf = Buffer.from(fs.readFileSync(
  new URL('../benchmarks/runtime-baseline-v1/manifest.json', import.meta.url), 'utf8',
).replaceAll('\r\n', '\n'));
const manifestCrlf = Buffer.from(manifestLf.toString('utf8').replaceAll('\n', '\r\n'));
assert.equal(manifestCrlf.includes(Buffer.from('\r\r\n')), false,
  'CRLF fixture construction must not double an existing checkout carriage return');
assert.equal(reviewedManifestDigest(manifestCrlf), BASELINE_MANIFEST_SHA256, 'CRLF checkout bytes preserve only the reviewed LF manifest identity');
assert.notEqual(reviewedManifestDigest(Buffer.from(manifestLf.toString('utf8').replace('Bulletproof React', 'Changed'))), BASELINE_MANIFEST_SHA256);

const selectedCollection = collections[0];
const selectedCases = cases.filter((item) => item.collection_id === selectedCollection.id);
const expectedByRequest = new Map(selectedCases.map((item) => [item.request, {
  workflow_outcome: item.expected.workflow_outcome,
  selected_workflow_ids: item.expected.selected_workflow_ids,
  workflow_ranking: item.expected.workflow_ranking.map(({ id }) => ({ id })),
  source_ranking: item.expected.source_ranking.map(({ path, symbol }) => ({ path, symbol })),
  observations: item.expected.observations, obligations: item.expected.obligations,
  repository_state: item.expected.repository_state,
}]));

let sequence = 0;
const active = new Map();
const prepareCalls = [];
const materializer = {
  prepare(scenario, collectionValue) {
    const treeOid = collectionValue.tree_oid;
    const scenarioDigest = digest(scenario);
    const provenance = materializationProvenanceDigest(collectionValue, scenarioDigest);
    const base = { schema: 'lamina.materialized-repository-base/v1', resolved_commit: collectionValue.commit, tree_oid: treeOid, scenario_digest: scenarioDigest, provenance_digest: provenance, content_digest: materializationBaseDigest(collectionValue, scenarioDigest) };
    prepareCalls.push({ scenario, collectionValue, base });
    return base;
  },
  lease(base) {
    sequence += 1;
    const lease = { schema: 'lamina.materialized-repository-lease/v1', opaque_handle: `lease-${String(sequence).padStart(16, '0')}`, provenance_digest: base.provenance_digest, start_digest: base.content_digest };
    active.set(lease.opaque_handle, lease);
    return lease;
  },
  resolve(lease) { assert.equal(active.has(lease.opaque_handle), true); return `/runner-private/${lease.opaque_handle}`; },
  verifyAndRelease(lease) { active.delete(lease.opaque_handle); return { end_digest: lease.start_digest, cleanup_verified: true }; },
};
const seenInputs = [];
const adapter = {
  id: 'current', version: 1, inputFormat: 'lamina.real-repository-oracle-input/v1', outputFormat: 'lamina.real-repository-oracle-result-case/v1',
  evaluate(input, authority) {
    seenInputs.push(input);
    assert.equal(Object.isFrozen(input), true);
    assert.equal('case_id' in input, false);
    assert.equal('expected' in input, false);
    assert.equal('repository_scenario' in input, false);
    assert.match(authority.resolveRepository(input.materialized_repository.opaque_handle), /^\/runner-private\/lease-/);
    return structuredClone(expectedByRequest.get(input.request));
  },
};
const result = await evaluateAdapter({ fixture, collection: selectedCollection, adapter, materializer });
assert.deepEqual(result.safety, { mode: 'not_applicable', outcome: 'not_applicable', reason: null, attestation: null });
assert.deepEqual(validateResult(result), { valid: true, errors: [] });
assert.equal(validateResultSchema(result), true, JSON.stringify(validateResultSchema.errors));
assert.equal(gradeResult(fixture, result).classification, 'pass');
assert.equal(new Set(seenInputs.map((item) => item.materialized_repository.opaque_handle)).size, selectedCases.length * 2, 'every first/replay call gets a fresh lease');
assert.equal(prepareCalls.length, selectedCases.length, 'each scenario has one immutable base');

const alternate = { ...adapter, id: 'candidate', evaluate(input) { return { answer: structuredClone(expectedByRequest.get(input.request)) }; }, normalize(raw) { return raw.answer; } };
const pair = await evaluateSideBySide({ fixture, collection: selectedCollection, current: adapter, candidate: alternate, materializer });
assert.deepEqual(pair.current.cases, pair.candidate.cases);
assert.deepEqual(pair.current.cases.map((item) => item.repository_state.worktree_role),
  pair.candidate.cases.map((item) => item.repository_state.worktree_role),
  'fresh physical leases preserve stable logical worktree semantics');

const mutableLeaseMaterializer = {
  ...materializer,
  verifyAndRelease(lease) { active.delete(lease.opaque_handle); return { end_digest: digest(`${lease.start_digest}:mutated`), cleanup_verified: true }; },
};
await assert.rejects(evaluateAdapter({ fixture, collection: selectedCollection, adapter, materializer: mutableLeaseMaterializer }), /changed or cleanup/);
let reused;
const reusedLeaseMaterializer = {
  ...materializer,
  lease(base) {
    reused ||= { schema: 'lamina.materialized-repository-lease/v1', opaque_handle: 'lease-reused-0000000000', provenance_digest: base.provenance_digest, start_digest: base.content_digest };
    active.set(reused.opaque_handle, reused); return reused;
  },
};
await assert.rejects(evaluateAdapter({ fixture: { ...fixture, cases: [cases[0]] }, collection: selectedCollection, adapter, materializer: reusedLeaseMaterializer }), /reused a writable lease/);
const unequalMaterialization = structuredClone(result);
unequalMaterialization.materializations[0].replay_end_digest = 'f'.repeat(64);
assert.equal(validateResult(unequalMaterialization).valid, false, 'all first/replay materialization digests must equal the immutable base');
const wrongScenarioIdentity = structuredClone(result);
wrongScenarioIdentity.materializations[0].scenario_digest = 'f'.repeat(64);
assert.equal(validateResult(wrongScenarioIdentity).valid, false);
assert.equal(gradeResult(fixture, wrongScenarioIdentity).classification, 'candidate_invalid');
const arbitraryProvenance = structuredClone(result);
arbitraryProvenance.materializations[0].provenance_digest = 'e'.repeat(64);
assert.equal(validateResult(arbitraryProvenance).valid, false, 'arbitrary provenance cannot satisfy the deterministic pinned identity');
const arbitraryAllEqualBase = structuredClone(result);
for (const field of ['base_digest', 'first_start_digest', 'first_end_digest', 'replay_start_digest', 'replay_end_digest']) {
  arbitraryAllEqualBase.materializations[0][field] = 'd'.repeat(64);
}
assert.equal(validateResult(arbitraryAllEqualBase).valid, false, 'arbitrary all-equal lease digests are not a grounded logical base');
assert.notEqual(gradeResult(fixture, arbitraryAllEqualBase).classification, 'pass');

// The #60 authority is not replaceable by recomputing a downstream digest.
const swapped = structuredClone(fixture);
swapped.collections[0].repository_url = 'https://github.com/example/replacement.git';
swapped.collections[0].commit = 'f'.repeat(40);
swapped.collections[0].collection_digest = collectionDigest(swapped.collections[0]);
assert.equal(validateFixture(swapped).valid, false);

for (const unsafe of ['/etc/passwd', '../escape', 'src/../escape', 'C:/escape', 'src\\escape', `src/a\0b`]) assert.equal(isSafeRelativePath(unsafe), false);
for (const unsafe of ['../branch', 'bad branch', 'bad..branch', 'bad@{upstream}', '/root']) assert.equal(isSafeBranchName(unsafe), false);
for (const unsafe of ['/etc/passwd', '../escape', `src/a\0b`]) {
  const defect = structuredClone(fixture);
  defect.cases[0].repository_scenario = { kind: 'dirty', name: 'unsafe', operations: [{ op: 'modify', path: unsafe, content: 'x' }] };
  assert.equal(validateFixture(defect).valid, false);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-oracle-security-'));
try {
  fs.mkdirSync(path.join(temp, 'repo')); fs.symlinkSync(temp, path.join(temp, 'repo', 'escape'));
  assert.throws(() => resolvePhysicalContained(path.join(temp, 'repo'), 'escape/outside'), /symlink/);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

// Windows has no production trusted-Git/materialization adapter. Parser,
// mutation, and CRLF contracts stay portable above, but Linux supplies the
// real trusted-executable materialization proof instead of falling back to PATH.
const productionGitMaterializationClaim = process.platform !== 'win32';
if (process.platform === 'win32') {
  assert.equal(productionGitMaterializationClaim, false,
    'Windows intentionally makes no production Git/materialization claim');
} else {
  // Probe the real Git state machine used by materialization: modify/delete are
  // deliberately unstaged, while rename is staged to obtain one type-2 R. row.
  const porcelainProbe = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-oracle-porcelain-')));
  function probeGit(args, encoding = 'utf8') {
    const completed = spawnTrustedGit(porcelainProbe, args, { encoding, timeout: 15_000 });
    assert.equal(completed.status, 0, `git ${args.join(' ')} failed: ${String(completed.stderr)}`);
    return completed.stdout;
  }
  function probedChanges() {
    return parsePorcelainV2Z(probeGit([
      'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--find-renames=50%',
    ], null), { worktreeRole: 'primary' }).changes;
  }
  try {
    probeGit(['init', '-q']);
    fs.mkdirSync(path.join(porcelainProbe, 'src'));
    fs.writeFileSync(path.join(porcelainProbe, 'src/a.ts'), 'original\n');
    probeGit(['add', 'src/a.ts']);
    probeGit(['-c', 'user.name=Lamina Oracle', '-c', 'user.email=oracle@lamina.invalid', 'commit', '-qm', 'base']);

    fs.writeFileSync(path.join(porcelainProbe, 'src/a.ts'), 'modified\n');
    assert.deepEqual(probedChanges(), [
      { kind: 'ordinary', path: 'src/a.ts', original_path: null, xy: '.M', submodule: 'N...' },
    ]);
    probeGit(['reset', '--hard', '-q', 'HEAD']);

    fs.renameSync(path.join(porcelainProbe, 'src/a.ts'), path.join(porcelainProbe, 'src/b.ts'));
    assert.deepEqual(probedChanges(), [
      { kind: 'deleted', path: 'src/a.ts', original_path: null, xy: '.D', submodule: 'N...' },
      { kind: 'untracked', path: 'src/b.ts', original_path: null, xy: null, submodule: null },
    ], 'a single unstaged filesystem rename cannot truthfully claim one rename row');
    probeGit(['add', '-A']);
    assert.deepEqual(probedChanges(), [
      { kind: 'renamed', path: 'src/b.ts', original_path: 'src/a.ts', xy: 'R.', submodule: 'N...' },
    ]);
    probeGit(['reset', '--hard', '-q', 'HEAD']);

    fs.unlinkSync(path.join(porcelainProbe, 'src/a.ts'));
    assert.deepEqual(probedChanges(), [
      { kind: 'deleted', path: 'src/a.ts', original_path: null, xy: '.D', submodule: 'N...' },
    ]);
  } finally { fs.rmSync(porcelainProbe, { recursive: true, force: true }); }
}

// Schema-first validation keeps manual/schema shape checks in parity.
for (const mutate of [
  (value) => { value.id = ''; },
  (value) => { value.cases[0].id = ''; },
  (value) => { value.cases[0].expected.selected_workflow_ids = ['']; },
  (value) => { value.cases[0].kind.query = 'free_form'; },
  (value) => { value.cases[0].coverage = ['exact_workflow_id']; },
]) {
  const value = structuredClone(fixture); mutate(value);
  assert.equal(validateFixtureSchema(value), false);
  assert.equal(validateFixture(value).valid, false);
}

// A query requiring two hits is one denominator and fails as a whole, not half credit.
const partialQuery = structuredClone(result);
partialQuery.cases[0].workflow_ranking.pop();
partialQuery.replay_digest = resultCasesDigest(partialQuery.cases);
assert.equal(gradeResult(fixture, partialQuery).metrics.workflow_recall_at_5, 0);
const partialSourceQuery = structuredClone(result);
partialSourceQuery.cases[0].source_ranking.pop();
partialSourceQuery.replay_digest = resultCasesDigest(partialSourceQuery.cases);
assert.equal(gradeResult(fixture, partialSourceQuery).metrics.source_recall_at_10, 0);

const incoherentScenario = structuredClone(fixture);
incoherentScenario.cases[0].repository_scenario.operations = [{ op: 'delete', path: 'src/a.ts' }];
assert.equal(validateFixture(incoherentScenario).valid, false, 'derived coverage cannot disagree with the typed scenario');
const incoherentIntent = structuredClone(fixture);
incoherentIntent.cases[0].kind.intent = 'new_workflow';
assert.equal(validateFixture(incoherentIntent).valid, false, 'typed intent must agree with workflow outcome');
const wrongScenarioOperation = structuredClone(fixture);
wrongScenarioOperation.cases[4].repository_scenario.operations = [{ op: 'delete', path: 'src/a.ts' }];
assert.equal(validateFixture(wrongScenarioOperation).valid, false, 'branch scenarios cannot carry an unrelated mutation recipe');
const wrongScenarioBranch = structuredClone(fixture);
wrongScenarioBranch.cases[4].expected.repository_state.branch = 'review/different';
assert.equal(validateFixture(wrongScenarioBranch).valid, false, 'branch state must equal the executable checkout branch');
const missingScenarioChange = structuredClone(fixture);
missingScenarioChange.cases[2].expected.repository_state.changes = [];
assert.equal(validateFixture(missingScenarioChange).valid, false, 'rename operations cannot claim a zero-change repository state');
const wrongPorcelainSemantics = structuredClone(fixture);
wrongPorcelainSemantics.cases[2].expected.repository_state.changes[0].xy = '.R';
assert.equal(validateFixture(wrongPorcelainSemantics).valid, false, 'scenario state must preserve exact porcelain XY semantics');
const zeroChangeRename = structuredClone(fixture);
zeroChangeRename.cases[2].repository_scenario.operations[0].to = 'src/a.ts';
assert.equal(validateFixture(zeroChangeRename).valid, false, 'rename operations must change the path');
const overlappingDirtyPaths = structuredClone(fixture);
overlappingDirtyPaths.cases[1].repository_scenario.operations.push({ op: 'delete', path: 'src/a.ts' });
assert.equal(validateFixture(overlappingDirtyPaths).valid, false, 'one porcelain path cannot be claimed by two dirty operations');
const conflictingRenameDestination = structuredClone(fixture);
conflictingRenameDestination.cases[2].repository_scenario.operations.push({ op: 'modify', path: 'src/b.ts', content: 'conflict' });
assert.equal(validateFixture(conflictingRenameDestination).valid, false, 'rename destinations cannot overlap another dirty operation');
const ancestorDirtyConflict = structuredClone(fixture);
ancestorDirtyConflict.cases[1].repository_scenario.operations.push({ op: 'rename', path: 'src', to: 'lib' });
const ancestorConflictValidation = validateFixture(ancestorDirtyConflict);
assert.ok(ancestorConflictValidation.errors.some((item) => item.includes('conflicts with another dirty operation')),
  'ancestor and descendant dirty paths cannot claim independent porcelain states');
const selectedForbiddenConflict = structuredClone(fixture);
selectedForbiddenConflict.cases[0].expected.forbidden_workflow_ids[0] = selectedForbiddenConflict.cases[0].expected.selected_workflow_ids[0];
assert.equal(validateFixture(selectedForbiddenConflict).valid, false, 'selected and forbidden Workflow contracts must be disjoint');

for (const field of ['head', 'upstream', 'ahead', 'behind', 'worktree_role']) {
  const mismatch = structuredClone(result);
  if (field === 'head') mismatch.cases[0].repository_state.head = 'f'.repeat(40);
  else if (field === 'upstream') mismatch.cases[0].repository_state.upstream = 'origin/main';
  else if (field === 'worktree_role') mismatch.cases[0].repository_state.worktree_role = 'unexpected';
  else mismatch.cases[0].repository_state[field] += 1;
  mismatch.replay_digest = resultCasesDigest(mismatch.cases);
  assert.ok(gradeResult(fixture, mismatch).diagnostics.some((item) => item.includes(`repository ${field}`)));
}
const extraChange = structuredClone(result);
extraChange.cases[0].repository_state.changes.push({ kind: 'untracked', path: 'unexpected.txt', original_path: null, xy: null, submodule: null });
extraChange.replay_digest = resultCasesDigest(extraChange.cases);
assert.ok(gradeResult(fixture, extraChange).diagnostics.some((item) => item.includes('repository changes expected exactly')));

for (const mutation of fixture.mutations) {
  const mutated = executeRegisteredMutation(fixture, result, mutation);
  const graded = gradeResult(fixture, mutated);
  assert.equal(validateResult(mutated).valid, true, `${mutation.kind} remains schema-valid`);
  assert.equal(graded.passed, false, `${mutation.kind} must fail the end-to-end grade`);
  assert.equal(graded.classification, 'product_regression', mutation.kind);
  for (const needle of mutation.diagnostic_includes) assert.ok(graded.diagnostics.some((item) => item.includes(needle)), `${mutation.kind}: ${needle}`);
}
const prependedUnrelated = structuredClone(result);
prependedUnrelated.cases[0].observations.unshift({ category: 'unrelated', path: 'src/unrelated-observation.ts' });
prependedUnrelated.cases[0].obligations.unshift({ category: 'unrelated', path: 'src/unrelated-obligation.ts' });
prependedUnrelated.replay_digest = resultCasesDigest(prependedUnrelated.cases);
assert.equal(gradeResult(fixture, prependedUnrelated).classification, 'pass');
for (const mutation of fixture.mutations) {
  const mutated = executeRegisteredMutation(fixture, prependedUnrelated, mutation);
  assert.equal(validateResult(mutated).valid, true);
  const graded = gradeResult(fixture, mutated);
  assert.equal(graded.classification, 'product_regression',
    `${mutation.kind} targets reviewed evidence even with unrelated prepended entries`);
  for (const needle of mutation.diagnostic_includes) {
    assert.ok(graded.diagnostics.some((item) => item.includes(needle)), `${mutation.kind}: ${needle}`);
  }
}
const wildcardSourceFixture = structuredClone(fixture);
wildcardSourceFixture.cases[0].expected.source_ranking = [
  { path: 'src/handler.ts', symbol: null, max_rank: 10 },
];
assert.equal(validateFixture(wildcardSourceFixture).valid, true);
const wildcardSourceResult = structuredClone(result);
wildcardSourceResult.fixture_digest = fixtureDigest(wildcardSourceFixture);
wildcardSourceResult.cases[0].source_ranking = [
  { path: 'src/handler.ts', symbol: 'actualHandlerSymbol' },
];
wildcardSourceResult.replay_digest = resultCasesDigest(wildcardSourceResult.cases);
assert.equal(gradeResult(wildcardSourceFixture, wildcardSourceResult).classification, 'pass',
  'a reviewed null symbol matches any actual symbol at the reviewed path');
const wildcardSourceMutation = wildcardSourceFixture.mutations
  .find((item) => item.kind === 'source_ranking_regression');
const wildcardSourceRegression = executeRegisteredMutation(
  wildcardSourceFixture, wildcardSourceResult, wildcardSourceMutation,
);
assert.equal(validateResult(wildcardSourceRegression).valid, true);
assert.equal(gradeResult(wildcardSourceFixture, wildcardSourceRegression).classification, 'product_regression',
  'source mutation removes the entire reviewed wildcard path, not only a literal null symbol');
const inertMutation = structuredClone(fixture);
inertMutation.mutations.find((item) => item.kind === 'stale_rename_path').case_id = cases[0].id;
assert.equal(validateFixture(inertMutation).valid, false, 'every registered mutation must be applicable to its reviewed target');
const stalePathWithoutContract = structuredClone(fixture);
stalePathWithoutContract.cases[2].expected.forbidden_paths = [];
assert.equal(validateFixture(stalePathWithoutContract).valid, false, 'stale rename mutations require the reviewed old path to be forbidden');
const missingMutationKind = structuredClone(fixture);
missingMutationKind.mutations = missingMutationKind.mutations.filter((item) => item.kind !== 'stale_delete_path');
assert.equal(validateFixture(missingMutationKind).valid, false, 'all executable mutation kinds are mandatory');

const measured = await evaluateAdapter({
  fixture, collection: selectedCollection, adapter, materializer,
  evidenceMode: 'semantic_core', claims: { end_to_end_runtime: false, observation: 'brownfield_signals', obligations: 'compiled', source_localization: 'not_measured' },
});
assert.equal(validateResult(measured).valid, false, 'unattested workload output is never gradeable');
const forgedAttestation = {
  schema: 'lamina.real-repository-oracle-attestation/v1', report_schema: 'lamina.safe-runner-report/v1',
  report_sha256: '1'.repeat(64), result_sha256: '2'.repeat(64), fixture_digest: fixtureDigest(fixture), tier: 'small',
  command_sha256: digest(CANONICAL_WORKLOAD_ARGV), source_identity_sha256: '3'.repeat(64),
  execution_identity_sha256: '4'.repeat(64), promotion_sha256: '5'.repeat(64),
  collection_digest: selectedCollection.collection_digest,
  materialization_digests: [...new Set(measured.materializations.map((item) => item.base_digest))],
  runner_outcome: 'success', cleanup_verified: true,
};
const forgedPublic = {
  ...structuredClone(measured), evidence_mode: 'public_cli',
  claims: { end_to_end_runtime: true, observation: 'public_cli', obligations: 'public_cli', source_localization: 'real_retrieval' },
  safety: { mode: 'attested', outcome: 'success', reason: null, attestation: forgedAttestation },
};
assert.equal(validateResult(forgedPublic).valid, false, 'caller-shaped proof cannot forge a public CLI pass');
assert.equal(gradeControllerVerification(fixture, { envelope: forgedPublic }).classification, 'candidate_invalid', 'an in-payload object cannot mint a parent-controller verification');

const measuredGrade = gradeResult(fixture, measured, { allowUnattestedEvaluation: true });
const compactEnvelope = createCompactGradeEnvelope({
  fixtureDigest: fixtureDigest(fixture), result: measured, grade: measuredGrade,
});
const relabelledFixture = structuredClone(fixture);
relabelledFixture.cases[0].rationale = 'A new valid rationale changes the reviewed fixture identity.';
assert.equal(validateFixture(relabelledFixture).valid, true);
assert.throws(() => createCompactGradeEnvelope({
  fixtureDigest: fixtureDigest(relabelledFixture), result: measured, grade: measuredGrade,
}), /cannot relabel/, 'an old result cannot be relabelled as evidence for a new valid fixture');
assert.equal('cases' in compactEnvelope, false, 'the retained payload is a compact grade envelope, not 20+ case bodies');
const payloadLine = encodeUnattestedPayload({ tier: 'small', collectionDigest: selectedCollection.collection_digest, envelope: compactEnvelope });
assert.ok(Buffer.byteLength(payloadLine) <= MAX_PAYLOAD_LINE_BYTES);
assert.ok(Buffer.byteLength(payloadLine) < 8 * 1024, 'compact payload must fit the real #59 diagnostic tail');
const oversizedGrade = {
  ...measuredGrade, passed: false, classification: 'product_regression',
  diagnostics: Array.from({ length: 500 }, (_, index) => `diagnostic-${index}-${'x'.repeat(2_000)}`),
};
const oversizedEnvelope = createCompactGradeEnvelope({
  fixtureDigest: fixtureDigest(fixture), result: measured, grade: oversizedGrade,
});
assert.equal(oversizedEnvelope.grade.diagnostics.length, MAX_RETAINED_DIAGNOSTICS);
assert.equal(oversizedEnvelope.grade.diagnostics_total, 500);
assert.match(oversizedEnvelope.grade.diagnostics_sha256, /^[a-f0-9]{64}$/);
assert.ok(Buffer.byteLength(encodeUnattestedPayload({ tier: 'small', collectionDigest: selectedCollection.collection_digest, envelope: oversizedEnvelope })) <= MAX_PAYLOAD_LINE_BYTES,
  'oversized failing diagnostics remain a bounded product-regression envelope');
function highEntropyDiagnostic(seed) {
  let state = (seed + 1) * 0x9e3779b1;
  let value = '';
  for (let index = 0; index < 2_000; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    value += String.fromCharCode(0x4e00 + (state % 20_000));
  }
  return value;
}
const entropyEnvelope = createCompactGradeEnvelope({
  fixtureDigest: fixtureDigest(fixture), result: measured,
  grade: { ...oversizedGrade, diagnostics: Array.from({ length: 500 }, (_, index) => highEntropyDiagnostic(index)) },
});
const naivePayload = canonical({
  schema: 'lamina.real-repository-oracle-payload/v1', tier: 'small',
  collection_digest: selectedCollection.collection_digest, envelope: entropyEnvelope,
});
const naiveCompressed = zlib.brotliCompressSync(Buffer.from(JSON.stringify(naivePayload)), {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
});
assert.ok(Buffer.byteLength(`${PAYLOAD_PREFIX}${naiveCompressed.toString('base64url')}`) > MAX_PAYLOAD_LINE_BYTES,
  'worst-case retained Unicode diagnostics exceed the physical tail before adaptive compaction');
const entropyLine = encodeUnattestedPayload({ tier: 'small', collectionDigest: selectedCollection.collection_digest, envelope: entropyEnvelope });
assert.ok(Buffer.byteLength(entropyLine) <= MAX_PAYLOAD_LINE_BYTES);
const entropyPayload = JSON.parse(zlib.brotliDecompressSync(Buffer.from(entropyLine.slice(PAYLOAD_PREFIX.length), 'base64url')));
assert.equal(entropyPayload.envelope.grade.diagnostics_total, 500);
assert.equal(entropyPayload.envelope.grade.diagnostics_sha256, entropyEnvelope.grade.diagnostics_sha256);
assert.ok(entropyPayload.envelope.grade.diagnostics.length < entropyEnvelope.grade.diagnostics.length
  || entropyPayload.envelope.grade.diagnostics.some((item, index) => item.length < entropyEnvelope.grade.diagnostics[index].length));
const attestationRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-oracle-attestation-')));
const payloadCwd = path.join(attestationRoot, 'payload-repository');
const controllerDirectory = path.join(attestationRoot, 'controller-reports');
const entrypoint = path.join(payloadCwd, 'benchmarks/real-repository-oracle-v1/workload.mjs');
fs.mkdirSync(path.dirname(entrypoint), { recursive: true }); fs.mkdirSync(controllerDirectory);
fs.writeFileSync(entrypoint, '#!/usr/bin/env node\n', { mode: 0o600 });
const entrypointPeer = path.join(payloadCwd, 'hardlinked-entrypoint-peer.mjs');
fs.linkSync(entrypoint, entrypointPeer);
const executableOrigin = path.join(payloadCwd, 'hardlinked-node-origin');
const executable = path.join(payloadCwd, 'hardlinked-node-command');
fs.writeFileSync(executableOrigin, '#!/bin/sh\n', { mode: 0o700 });
fs.linkSync(executableOrigin, executable);
assert.ok(fs.lstatSync(executable, { bigint: true }).nlink > 1n);
assert.ok(fs.lstatSync(entrypoint, { bigint: true }).nlink > 1n);
const command = [executable, entrypoint, 'validate'];
function testFileIdentity(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  return { path: file, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), mode: Number(stat.mode & 0o777n), size: String(stat.size), digest: digest(fs.readFileSync(file)) };
}
const executableIdentity = testFileIdentity(executable);
const entrypointIdentity = testFileIdentity(entrypoint);
const sourceValue = {
  repository: payloadCwd, command, executable: executableIdentity,
  workload_inputs: [{ path: entrypoint, size: entrypointIdentity.size, digest: entrypointIdentity.digest }],
  retrieval_authority: null, runtime_baseline_inputs: null,
  repository_source: '6'.repeat(64), runner_build: '7'.repeat(64),
};
const sourceIdentity = { ...sourceValue, digest: digest(JSON.stringify(sourceValue)) };
const snapshotDigest = '8'.repeat(64);
const executionIdentityDigest = digest(JSON.stringify({ source_identity_digest: sourceIdentity.digest, execution_snapshot_digest: snapshotDigest }));
const promotion = { ok: true, required: [], missing: [], completed: [], deferred_to_execution_snapshot: false };
const safeReportFile = path.join(controllerDirectory, 'issue60-compatible-report.json');
// Compatibility fixture mirrors the absolute command, source/execution identity,
// promotion, production scope, output, and cleanup shape emitted by the real #60 run.
const safeReport = {
  schema: 'lamina.safe-runner-report/v1', schema_version: 1, run_id: 'safe-test', report_file: safeReportFile,
  outcome: 'success', tier: 'small', command, cwd: payloadCwd,
  started_at: '2026-08-02T00:00:00.000Z', finished_at: '2026-08-02T00:00:01.000Z', duration_ms: 1000,
  adapter: { id: 'linux-systemd-cgroup-v2', production_enforcement: true },
  limits: { stdout_tail_max_bytes: 8 * 1024, stderr_tail_max_bytes: 8 * 1024 },
  preflight: {
    ok: true, workload_id: 'real-repository-oracle-v1:validate',
    ownership: { proven: true, audited_entrypoint: 'benchmarks/real-repository-oracle-v1/workload.mjs', executable },
    execution_command: command, source_identity: sourceIdentity,
    execution_snapshot: { schema: 'lamina.safe-runner-execution-snapshot/v1', digest: snapshotDigest, file_count: 1, total_bytes: Number(entrypointIdentity.size), snapshot_roots: [payloadCwd], writable_roots: [] },
    execution_identity: { ...sourceIdentity, source_identity_digest: sourceIdentity.digest, execution_snapshot_digest: snapshotDigest, digest: executionIdentityDigest },
    promotion, scope_proof: { production_enforcement: true },
  },
  samples: [{ elapsed_ms: 1, aggregate_rss_bytes: 1, cgroup_memory_bytes: 1, pids: 1, temporary_bytes: 1, temporary_inodes: 1 }],
  peaks: { aggregate_rss_bytes: 1, cgroup_memory_bytes: 1, pids: 1, temporary_bytes: 1, temporary_inodes: 1 },
  descendants: [],
  output: { stdout_bytes: Buffer.byteLength(payloadLine), stderr_bytes: 0, total_bytes: Buffer.byteLength(payloadLine), stdout_tail: payloadLine, stderr_tail: '', truncated: false },
  termination: { reason: 'completed', limit: null, requested_signals: [], child_exit_code: 0, child_signal: null, cgroup_events: {} },
  cleanup: { attempted: true, descendants_remaining: [], managed_paths_remaining: [], scope_removed: true, temporary_directory_removed: true, lock_released: true, errors: [] },
  error: null,
};
fs.writeFileSync(safeReportFile, JSON.stringify(safeReport), { mode: 0o600 });
Object.defineProperty(safeReport, 'writtenReport', { enumerable: false, value: { path: safeReportFile, fallback: false, write_error: null } });
const unbranded = verifyReturnedControllerReport(safeReport, {
  reportFile: safeReportFile, expectedTier: 'small',
  expectedCollectionDigest: selectedCollection.collection_digest,
  expectedFixtureDigest: fixtureDigest(fixture),
});
const reportHardlink = path.join(controllerDirectory, 'report-hardlink.json');
fs.linkSync(safeReportFile, reportHardlink);
assert.throws(() => verifyReturnedControllerReport(safeReport, {
  reportFile: safeReportFile, expectedTier: 'small',
  expectedCollectionDigest: selectedCollection.collection_digest,
  expectedFixtureDigest: fixtureDigest(fixture),
}), /canonical same-user physical file/,
'controller-written report authority must remain single-link even when audited inputs may be hardlinked');
fs.unlinkSync(reportHardlink);
assert.equal(gradeControllerVerification(fixture, unbranded).classification, 'candidate_invalid', 'a valid-shaped report outside the parent controller cannot mint a gradeable object');
const changedFixture = structuredClone(fixture);
changedFixture.cases[0].rationale = 'A different but still valid reviewed rationale.';
assert.throws(() => verifyReturnedControllerReport(safeReport, {
  reportFile: safeReportFile, expectedTier: 'small',
  expectedCollectionDigest: selectedCollection.collection_digest,
  expectedFixtureDigest: fixtureDigest(changedFixture),
}), /does not bind|payload/,
'old evidence fails after a valid fixture request, scenario, expectation, or rationale change');
const duplicatePayloadReport = structuredClone(safeReport);
duplicatePayloadReport.output.stdout_tail = `${payloadLine}\n${payloadLine}`;
duplicatePayloadReport.output.stdout_bytes = Buffer.byteLength(duplicatePayloadReport.output.stdout_tail);
duplicatePayloadReport.output.total_bytes = duplicatePayloadReport.output.stdout_bytes;
fs.writeFileSync(safeReportFile, JSON.stringify(duplicatePayloadReport), { mode: 0o600 });
Object.defineProperty(duplicatePayloadReport, 'writtenReport', { enumerable: false, value: { path: safeReportFile, fallback: false, write_error: null } });
assert.throws(() => verifyReturnedControllerReport(duplicatePayloadReport, {
  reportFile: safeReportFile, expectedTier: 'small',
  expectedCollectionDigest: selectedCollection.collection_digest,
  expectedFixtureDigest: fixtureDigest(fixture),
}), /exactly one compact oracle payload/,
'candidate or adapter stdout cannot masquerade as a second canonical workload envelope');
fs.writeFileSync(safeReportFile, JSON.stringify(safeReport), { mode: 0o600 });
const counterfeitFile = path.join(payloadCwd, 'payload-minted-report.json');
const counterfeit = { ...safeReport, report_file: counterfeitFile };
fs.writeFileSync(counterfeitFile, JSON.stringify(counterfeit), { mode: 0o600 });
Object.defineProperty(counterfeit, 'writtenReport', { enumerable: false, value: { path: counterfeitFile, fallback: false, write_error: null } });
assert.throws(() => verifyReturnedControllerReport(counterfeit, {
  reportFile: counterfeitFile, expectedTier: 'small',
  expectedCollectionDigest: selectedCollection.collection_digest,
  expectedFixtureDigest: fixtureDigest(fixture),
}), /overlaps the writable payload cwd/);
const reportWithoutCleanup = structuredClone(safeReport);
reportWithoutCleanup.cleanup.temporary_directory_removed = false;
fs.writeFileSync(safeReportFile, JSON.stringify(reportWithoutCleanup), { mode: 0o600 });
Object.defineProperty(reportWithoutCleanup, 'writtenReport', { enumerable: false, value: { path: safeReportFile, fallback: false, write_error: null } });
assert.throws(() => verifyReturnedControllerReport(reportWithoutCleanup, {
  reportFile: safeReportFile, expectedTier: 'small',
  expectedCollectionDigest: selectedCollection.collection_digest,
  expectedFixtureDigest: fixtureDigest(fixture),
}), /invalid|cleanup/);
const refusedReport = structuredClone(safeReport);
refusedReport.outcome = 'command_failed';
refusedReport.output = { stdout_bytes: 0, stderr_bytes: 0, total_bytes: 0, stdout_tail: '', stderr_tail: '', truncated: false };
refusedReport.termination = { reason: 'command_failed', limit: null, requested_signals: [], child_exit_code: 2, child_signal: null, cgroup_events: {} };
refusedReport.error = { code: 'LAMINA_WORKLOAD_BLOCKED', message: 'pinned worker is unavailable' };
fs.writeFileSync(safeReportFile, JSON.stringify(refusedReport), { mode: 0o600 });
Object.defineProperty(refusedReport, 'writtenReport', { enumerable: false, value: { path: safeReportFile, fallback: false, write_error: null } });
const blocked = verifyReturnedBlockedControllerReport(refusedReport, {
  reportFile: safeReportFile, expectedTier: 'small',
  expectedCollectionDigest: selectedCollection.collection_digest,
  expectedFixtureDigest: fixtureDigest(fixture),
});
assert.equal(blocked.failure_class, 'candidate_invalid', 'command failure is not a safety block');
assert.equal(runnerFailureClassification('preflight_refused'), 'safety_blocked');
assert.equal(runnerFailureClassification('safety_limit_exceeded'), 'safety_blocked');
assert.equal(runnerFailureClassification('interrupted'), 'safety_blocked');
assert.equal(runnerFailureClassification('command_failed'), 'candidate_invalid');
assert.equal(runnerFailureClassification('internal_error'), 'harness_failure');
assert.equal(gradeControllerVerification(fixture, blocked).classification, 'candidate_invalid', 'only the live parent controller can brand even a valid blocked report');
const controllerSource = fs.readFileSync(new URL('../benchmarks/real-repository-oracle-v1/controller.mjs', import.meta.url), 'utf8');
assert.match(controllerSource, /await runSafely\(/); assert.match(controllerSource, /issued\.add\(verification\)/);
assert.match(controllerSource, /realpathSync\.native\(path\.dirname\(requestedReport\)\)/,
  'controller canonicalizes macOS temp aliases before the report authority is created');
fs.rmSync(attestationRoot, { recursive: true, force: true });

const hash = '1'.repeat(40);
const porcelain = [
  `# branch.oid ${hash}`, '# branch.head feature/oracle', '# branch.upstream origin/feature/oracle', '# branch.ab +2 -1',
  `1 .M N... 100644 100644 100644 ${hash} ${hash} src/ordinary.ts`,
  `2 R. N... 100644 100644 100644 ${hash} ${hash} R100 src/new.ts`, 'src/old.ts',
  `2 C. N... 100644 100644 100644 ${hash} ${hash} C100 src/copy.ts`, 'src/original.ts',
  '? src/untracked.ts', '',
].join('\0');
const parsed = parsePorcelainV2Z(porcelain, { worktreeRole: 'linked-1' });
assert.deepEqual(parsed.changes.map((item) => [item.kind, item.path, item.original_path]), [
  ['copied', 'src/copy.ts', 'src/original.ts'], ['renamed', 'src/new.ts', 'src/old.ts'],
  ['ordinary', 'src/ordinary.ts', null], ['untracked', 'src/untracked.ts', null],
]);
assert.throws(() => parsePorcelainV2Z(`# branch.head main\0x nonsense\0`, { worktreeRole: 'primary' }), /unknown porcelain/);

const emptyResult = structuredClone(result); emptyResult.cases[0].selected_workflow_ids = [''];
assert.equal(validateResultSchema(emptyResult), false);
assert.equal(validateResult(emptyResult).valid, false);
assert.equal(result.schema, RESULT_SCHEMA); assert.equal(result.adapter.schema, ADAPTER_SCHEMA);
console.log('real repository oracle contract tests passed');
