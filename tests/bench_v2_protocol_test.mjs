#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CodexAdapter, ClaudeCodeAdapter } from '../benchmarks/v2/runtime/agent-adapters.mjs';
import { isolatedCliVersion, isReviewSafetyInterruption, isTransientProviderFailure, reviewSafetyContinuationPrompt, transientContinuationPrompt } from '../benchmarks/v2/runtime/agent-invocation.mjs';
import { answerQuestions } from '../benchmarks/v2/runtime/oracle.mjs';
import { evaluateClaims } from '../benchmarks/v2/scoring/claim-gates.mjs';
import { compileMatrix } from '../benchmarks/v2/runtime/compile-matrix.mjs';
import { aggregateResults } from '../benchmarks/v2/scoring/aggregate-results.mjs';
import { summarizeRatings, weightedRating } from '../benchmarks/v2/scoring/score-ratings.mjs';
import { isReviewSourcePath, snapshotWorkspace } from '../benchmarks/v2/runtime/workspace-snapshot.mjs';
import { reconcileAbandonedAttempts } from '../benchmarks/v2/runtime/attempt-ledger.mjs';
import { auditIsolation } from '../benchmarks/v2/runtime/isolation.mjs';
import { indexTree, validateProductProofManifest, validateProductWorkspace, validateQuestions, validateTelemetry, writeProductValidationReceipt } from '../benchmarks/v2/runtime/trial-validation.mjs';
import { fixtureFingerprint } from '../benchmarks/scripts/stage-bench-fixture.mjs';
import { authoredArtifactHash, verifyBlindedKey, verifyPublicBlindedPackage } from '../benchmarks/v2/runtime/blinded-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v2 = path.join(root, 'benchmarks', 'v2');

for (const file of ['release.json', 'protocol/prompts.json', 'protocol/reviewer-prompts.json', 'corpus/manifest.json', 'scoring/product-contract-rubric.json']) JSON.parse(fs.readFileSync(path.join(v2, file), 'utf8'));
const release = JSON.parse(fs.readFileSync(path.join(v2, 'release.json'), 'utf8'));
assert.deepEqual(release.arms, ['raw', 'structured', 'lamina']);
assert.equal(release.publication_tasks, 12);
const prompts = JSON.parse(fs.readFileSync(path.join(v2, 'protocol', 'prompts.json'), 'utf8'));
for (const arm of release.arms) for (const phase of release.phases) assert.equal(typeof prompts[arm][phase], 'string', `${arm} missing ${phase} prompt`);
assert.match(prompts.structured.contract, /transition from\/to value against the states declared/);
assert.match(prompts.structured.contract, /trace each critical promise to at least one critical actor, entity, operation, workflow, rule, surface, and scenario/);
assert.match(prompts.structured.contract, /reachable enrollment, provisioning, activation, or operational entry_path/);
assert.match(prompts.structured.contract, /implementable key attributes with field contracts/);
assert.match(prompts.structured.contract, /concrete current-slice fulfillment mechanism and owner/);
assert.match(prompts.structured.contract_finalize, /critical-node scenario coverage/);
for (const arm of ['raw', 'structured']) {
  assert.match(prompts[arm].review, /Write product-review\.md and product-fix-list\.md without editing application source/);
  assert.match(prompts[arm].fix, /Implement product-fix-list\.md completely/);
}
for (const arm of release.arms) {
  assert.match(prompts[arm].implement, /untouched local components plus the subject\/place IANA zone/);
  assert.match(prompts[arm].implement, /browser zone different from subject zone/);
  assert.match(prompts[arm].implement, /show who acted and when/);
  assert.match(prompts[arm].implement, /concrete provider seam and fail-closed production configuration/);
  assert.match(prompts[arm].review, /session-mutation protection/);
  assert.match(prompts[arm].review, /DST\/recurrence behavior/);
}
assert.match(prompts.lamina.contract, /Declare the proof budget/);
assert.match(prompts.lamina.implement, /product-proof-manifest\.json/);
assert.match(prompts.lamina.implement, /finite per-test timeout/);
assert.match(prompts.lamina.review, /open-handle-leaking/);
assert.match(prompts.lamina.review, /Execute and inspect every proof/);
const modelRatingPrompt = fs.readFileSync(path.join(v2, 'protocol', 'model-rating-prompt.md'), 'utf8');
assert.match(modelRatingPrompt, /smallest coherent current product slice/);
assert.match(modelRatingPrompt, /runnable local adapter can satisfy the current slice/);
assert.match(modelRatingPrompt, /Still penalize self-asserted public identifiers/);

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-v2-attempt-ledger-'));
  const results = path.join(root, 'results');
  const cellId = 'dev-green-01__raw__oracle__test__r1';
  fs.mkdirSync(path.join(results, 'cells', cellId), { recursive: true });
  const started = { id: cellId, attempt: 3, attempt_path: 'cells/example/attempts/attempt-003', protocol_hash: 'a'.repeat(64), cell_input_hash: 'b'.repeat(64), started_at: '2026-07-18T00:00:00.000Z', event: 'started' };
  fs.writeFileSync(path.join(results, 'attempt-ledger.jsonl'), `${JSON.stringify(started)}\n`);
  const recovered = reconcileAbandonedAttempts(results, [cellId], () => '2026-07-18T01:00:00.000Z');
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, 'failed');
  assert.equal(recovered[0].recovery_reason, 'abandoned_started_event');
  assert.equal(JSON.parse(fs.readFileSync(path.join(results, 'cells', cellId, 'result.json'), 'utf8')).attempt, 3);
  assert.equal(reconcileAbandonedAttempts(results, [cellId]).length, 0);
  const events = fs.readFileSync(path.join(results, 'attempt-ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map((event) => event.event), ['started', 'failed']);
  fs.rmSync(root, { recursive: true, force: true });
}
for (const arm of release.arms) {
  assert.match(prompts[arm].review, /ordinary role-based product scenarios/);
  assert.match(prompts[arm].review, /do not frame the work as adversarial cybersecurity/);
}
const neutralSchema = JSON.parse(fs.readFileSync(path.join(v2, 'schemas', 'benchmark-contract.schema.json'), 'utf8'));
const transitionDescription = neutralSchema.$defs.operation.allOf[1].properties.transitions.description;
assert.match(transitionDescription, /must exactly equal a state declared/);
assert.match(neutralSchema.properties.status.description, /complete semantic readiness contract/);
assert.match(neutralSchema.properties.traceability.description, /critical actor, entity, operation, workflow, rule, surface, and scenario/);
assert.ok(neutralSchema.required.includes('surfaces'));
assert.match(neutralSchema.$defs.actor.allOf[1].properties.authority.description, /Trusted identity/);
assert.match(neutralSchema.$defs.actor.allOf[1].properties.entry_path.description, /Reachable enrollment/);
assert.match(neutralSchema.$defs.entity.allOf[1].properties.attributes.description, /key fields/);
assert.match(neutralSchema.$defs.dependency.allOf[1].properties.fulfillment.description, /current-slice mechanism/);
assert.deepEqual(neutralSchema.$defs.actor.allOf[2].then.required, ['entry_path']);
assert.deepEqual(neutralSchema.$defs.entity.allOf[2].then.required, ['attributes']);
assert.deepEqual(neutralSchema.$defs.dependency.allOf[2].then.required, ['condition', 'fulfillment', 'verification']);
assert.match(neutralSchema.$defs.surface.allOf[1].properties.contract.description, /Reachability/);
assert.match(neutralSchema.$defs.scenario.allOf[1].properties.covers.description, /every declared critical operation, workflow, rule, and dependency/);
assert.match(neutralSchema.$defs.operation.allOf[1].properties.effects.description, /at least one transition or at least one effect/);
assert.equal(release.primary_cohort_trial_cells, release.publication_tasks * release.arms.length * release.tracks.length * release.runs_per_cell);
assert.equal(release.all_cohort_trial_cells, release.primary_cohort_trial_cells * release.cohorts.length);
const corpus = JSON.parse(fs.readFileSync(path.join(v2, 'corpus', 'manifest.json'), 'utf8'));
assert.equal(compileMatrix(release, corpus, { mode: 'development', cohort: release.primary_cohort }).length, release.development_tasks * release.arms.length * release.tracks.length * release.runs_per_cell);
assert.equal(release.cohorts[1].model, 'gpt-5.5');
assert.equal(release.validation_test_replays, 3);
assert.equal(release.agent_transient_retries, 2);
assert.equal(release.model_judge.id, 'openai-gpt-5.5-secondary-judge');
assert.equal(release.model_judge.model, 'gpt-5.5');
assert.throws(() => compileMatrix(release, corpus, { mode: 'publication', cohort: 'openai-gpt-5.5' }), /sealed package hash/);
const sealedCorpus = structuredClone(corpus);
for (const task of sealedCorpus.publication) task.sealed_sha256 = 'a'.repeat(64);
assert.throws(() => compileMatrix(release, sealedCorpus, { mode: 'publication', cohort: 'openai-gpt-5.5' }), /not pinned/);
assert.throws(() => compileMatrix(release, corpus, { mode: 'development', repeat: '0' }), /Repeat must/);
const rubric = JSON.parse(fs.readFileSync(path.join(v2, 'scoring', 'product-contract-rubric.json'), 'utf8'));
assert.ok(!('persona_provenance' in rubric.dimensions));
assert.equal(Math.round(Object.values(rubric.dimensions).reduce((sum, weight) => sum + weight, 0) * 100), 100);

{
  const result = answerQuestions({ questions: [{ id: 'q1', topics: ['ownership', 'privacy'], question: 'Who owns it?', impact_refs: [], reason: 'Authority' }, { id: 'q2', topics: ['money'], question: 'Who pays?', impact_refs: [], reason: 'Policy' }] }, { task_id: 'task', facts: [{ id: 'f1', topic: 'ownership', answer: 'The member owns it.' }] });
  assert.equal(result.answers[0].answer, 'The member owns it.');
  assert.deepEqual(result.answers[0].facts.map((fact) => fact.id), ['f1']);
  assert.match(result.answers[1].answer, /No founder preference/);
  assert.throws(() => answerQuestions({ questions: new Array(4).fill({ id: 'q', topics: ['scope'], question: '?' }) }, { facts: [] }), /at most three/);
  assert.equal(validateQuestions({ questions: [{ id: 'q1', topics: ['scope'], question: 'What?', impact_refs: [], reason: 'Scope' }] }).ok, true);
  assert.equal(validateQuestions({ questions: [{ id: 'q1', topics: ['scope'], question: 'What?' }] }).ok, false);
}

{
  const dimensions = Object.fromEntries(Object.keys(rubric.dimensions).map((key) => [key, 5]));
  assert.equal(Math.round(weightedRating({ artifact_id: 'x', rater_id: 'a', dimensions }, rubric)), 100);
  const summary = summarizeRatings([{ artifact_id: 'x', rater_id: 'a', dimensions, critical_omissions: [], critical_failures: [] }, { artifact_id: 'x', rater_id: 'b', dimensions, critical_omissions: [], critical_failures: [] }], rubric);
  assert.equal(summary[0].score, 100);
  assert.equal(summary[0].adjudication_required, false);
  assert.throws(() => summarizeRatings([{ artifact_id: 'single', rater_id: 'model', dimensions, critical_omissions: [], critical_failures: [] }], rubric), /at least 2/);
  assert.equal(summarizeRatings([{ artifact_id: 'single', rater_id: 'model', dimensions, critical_omissions: [], critical_failures: [] }], rubric, { minimumPrimaryRaters: 1 })[0].score, 100);
  const split = structuredClone(dimensions);
  split.critical_product_shape = 1;
  const disputed = summarizeRatings([{ artifact_id: 'gap', rater_id: 'a', dimensions, critical_omissions: [], critical_failures: [] }, { artifact_id: 'gap', rater_id: 'b', dimensions: split, critical_omissions: [], critical_failures: [] }], rubric);
  assert.equal(disputed[0].adjudication_complete, false);
  assert.equal(disputed[0].score, null);
}

{
  const records = [];
  for (const task of ['a', 'b']) {
    for (const arm of ['structured', 'lamina']) records.push({ task_id: task, arm, track: 'oracle', cohort_id: 'primary', repeat: 1, contract_score: arm === 'lamina' ? 88 : 80, contract_model_score: arm === 'lamina' ? 86 : 79, transfer_score: arm === 'lamina' ? 84 : 78, critical_omissions: arm === 'lamina' ? 1 : 2, critical_failures: 0, incomplete: false, time_to_threshold: arm === 'lamina' ? 8 : 10, rework_tokens: arm === 'lamina' ? 3000 : 4000 });
  }
  const report = aggregateResults(records, { comparator: 'structured', track: 'oracle', cohortId: 'primary' });
  assert.equal(report.task_count, 2);
  assert.equal(report.results.graph.effect_points, 8);
  assert.equal(report.results.transfer.critical_omission_reduction, 0.5);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-v2-snapshot-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(path.join(workspace, '.lamina'), { recursive: true });
  fs.mkdirSync(path.join(workspace, '.benchmark-review'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.lamina', 'run.json'), '{}');
  fs.writeFileSync(path.join(workspace, '.benchmark-review', 'review-final.txt'), 'review evidence');
  fs.writeFileSync(path.join(workspace, 'product-contract.md'), 'secret method artifact');
  fs.writeFileSync(path.join(workspace, 'product-spec.json'), '{}');
  fs.writeFileSync(path.join(workspace, 'src', 'app.js'), 'product');
  const snapshot = path.join(root, 'snapshot');
  snapshotWorkspace(workspace, snapshot);
  assert.equal(fs.existsSync(path.join(snapshot, 'src', 'app.js')), true);
  assert.equal(fs.existsSync(path.join(snapshot, '.lamina')), false);
  assert.equal(fs.existsSync(path.join(snapshot, '.benchmark-review')), false);
  assert.equal(fs.existsSync(path.join(snapshot, 'product-contract.md')), false);
  assert.equal(fs.existsSync(path.join(snapshot, 'product-spec.json')), false);
  assert.equal(isReviewSourcePath('src/app.js'), true);
  assert.equal(isReviewSourcePath('package-lock.json'), true);
  assert.equal(isReviewSourcePath('artifacts/desktop.png'), false);
  assert.equal(isReviewSourcePath('harbor-home.png'), false);
  assert.equal(isReviewSourcePath('tsconfig.app.tsbuildinfo'), false);
  assert.equal(isReviewSourcePath('data/e2e.sqlite'), false);
  assert.equal(isReviewSourcePath('data/e2e.sqlite-shm'), false);
  assert.equal(isReviewSourcePath('data/e2e.sqlite-wal'), false);
  assert.equal(isReviewSourcePath('.test-data/care-state.json'), false);
  assert.equal(isReviewSourcePath('runtime-data/session.json'), false);
  assert.equal(isReviewSourcePath('proof-execution-summary.json'), false);
  assert.equal(isReviewSourcePath('dist/server.js'), false);
  assert.equal(isReviewSourcePath('build/static/app.js'), false);
  assert.equal(isReviewSourcePath('coverage/lcov-report/index.html'), false);
  assert.equal(isReviewSourcePath('.next/server/app.js'), false);
  assert.equal(isReviewSourcePath('tmp/browser-profile/state.json'), false);
  assert.equal(isReviewSourcePath('__pycache__/app.cpython-314.pyc'), false);
  assert.equal(isReviewSourcePath('tests/__pycache__/test_app.cpython-314.pyc'), false);
  assert.equal(isReviewSourcePath('.pytest_cache/v/cache/nodeids'), false);
  assert.equal(isReviewSourcePath('build/generated.pyo'), false);
  assert.equal(isReviewSourcePath('fixtures/seed.json'), true);
  assert.equal(isReviewSourcePath('src/data/defaults.json'), true);
  const authored = authoredArtifactHash(workspace);
  fs.mkdirSync(path.join(workspace, 'data'), { recursive: true });
  fs.mkdirSync(path.join(workspace, '.test-data'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'data', 'care.sqlite-wal'), 'generated runtime state');
  fs.writeFileSync(path.join(workspace, '.test-data', 'care-state.json'), 'generated test state');
  assert.equal(authoredArtifactHash(workspace), authored);
  fs.writeFileSync(path.join(workspace, 'src', 'app.js'), 'changed product source');
  assert.notEqual(authoredArtifactHash(workspace), authored);
  fs.mkdirSync(path.join(root, 'runtime-home'), { recursive: true });
  const isolation = auditIsolation(workspace, path.join(root, 'runtime-home'));
  assert.equal(isolation.passed, true);
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const trialRuntime = fs.readFileSync(path.join(v2, 'runtime', 'run-trial.mjs'), 'utf8');
  const transferRuntime = fs.readFileSync(path.join(v2, 'runtime', 'run-transfer.mjs'), 'utf8');
  for (const runtime of [trialRuntime, transferRuntime]) {
    assert.match(runtime, /review-copy/);
    assert.match(runtime, /review_isolation/);
    assert.match(runtime, /\.benchmark-review/);
  }
  assert.match(trialRuntime, /sessionId: null, runtimeHome: reviewHome, adoptSession: false/);
  assert.match(transferRuntime, /reviewResult = run\(adapter, null,/);
  assert.match(transferRuntime, /product-spec/);
  assert.match(transferRuntime, /Never replace an explicit trusted, durable, atomic, or server-enforced boundary/);
  assert.match(trialRuntime, /Product artifact hygiene/);
  assert.match(trialRuntime, /must not be copied or named in judge-visible product artifacts/);
  assert.match(trialRuntime, /review did not produce \$\{name\}/);
  assert.match(transferRuntime, /do not mention the benchmark, oracle, reviewers/);
  assert.match(transferRuntime, /PROOF_PACKET_INSTRUCTION/);
  assert.match(transferRuntime, /validateProductProofManifest/);
  assert.match(trialRuntime, /isReviewSourcePath/);
  assert.match(transferRuntime, /isReviewSourcePath/);
}

{
  const blindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-v2-blind-'));
  const resultsRoot = path.join(blindRoot, 'results');
  const output = path.join(blindRoot, 'judge-package');
  const keyOutput = path.join(blindRoot, 'custody', 'key.json');
  const protocolHash = 'a'.repeat(64);
  for (const arm of release.arms) {
    const cellId = `dev-green-01__${arm}__oracle__test-cohort__r1`;
    const cellRoot = path.join(resultsRoot, 'cells', cellId);
    const attemptRelative = path.join('cells', cellId, 'attempts', 'attempt-001');
    const attempt = path.join(resultsRoot, attemptRelative);
    const contractName = arm === 'raw' ? 'product-contract.md' : arm === 'structured' ? 'benchmark-contract.json' : 'run.json';
    fs.mkdirSync(path.join(attempt, 'main-output', 'product-stages', 'after-implement'), { recursive: true });
    fs.mkdirSync(path.join(attempt, 'main-output', 'product-stages', 'after-fix'), { recursive: true });
    fs.mkdirSync(path.join(attempt, 'transfer-output', 'product-stages', 'after-implement'), { recursive: true });
    fs.mkdirSync(path.join(attempt, 'transfer-output', 'product-stages', 'after-fix'), { recursive: true });
    fs.writeFileSync(path.join(attempt, 'main-output', contractName), arm === 'raw'
      ? '# Product contract\n'
      : arm === 'lamina'
        ? `${JSON.stringify({ evidence: [{ kind: 'lamina_init', path: '.lamina/business-context.md' }, { kind: 'oracle_answer', path: 'oracle-answers.json' }, { kind: 'oracle_fact', path: 'task-input.json' }, { kind: 'persona_perspective', path: '.benchmark-reviewers/older-relative.json' }], relevance_reason: 'The reviewer closed a benchmark gap.', source: 'review_hypothesis' }, null, 2)}\n`
        : `${JSON.stringify({ relevance_reason: 'critic-1 and the reviewers closed an oracle gap.', source: 'review_hypothesis' }, null, 2)}\n`);
    for (const relative of ['main-output/product-stages/after-implement', 'main-output/product-stages/after-fix', 'transfer-output/product-stages/after-implement', 'transfer-output/product-stages/after-fix']) fs.writeFileSync(path.join(attempt, relative, 'app.js'), `export const armNeutral = true;\n`);
    fs.mkdirSync(cellRoot, { recursive: true });
    fs.writeFileSync(path.join(cellRoot, 'result.json'), `${JSON.stringify({ status: 'complete', id: cellId, task_id: 'dev-green-01', task_package: 'dev-green-01', arm, track: 'oracle', cohort_id: 'test-cohort', repeat: 1, protocol_hash: protocolHash, cell_input_hash: `${arm[0]}`.repeat(64), attempt_path: attemptRelative }, null, 2)}\n`);
  }
  const blind = spawnSync(process.execPath, [path.join(v2, 'runtime', 'blind-artifacts.mjs'), '--results', resultsRoot, '--output', output, '--key-output', keyOutput, '--protocol-hash', protocolHash, '--track', 'oracle', '--cohort', 'test-cohort', '--task', 'dev-green-01', '--arm', 'raw,structured,lamina', '--repeat', '1'], { cwd: root, encoding: 'utf8' });
  assert.equal(blind.status, 0, blind.stderr || blind.stdout);
  const verified = verifyBlindedKey({ manifestPath: path.join(output, 'manifest.json'), keyPath: keyOutput, resultsRoot });
  assert.equal(verified.manifest.artifact_count, 15);
  assert.equal(verified.key.selection.protocol_hash, protocolHash);
  assert.equal(JSON.stringify(verified.manifest).includes('test-cohort'), false);
  assert.equal(JSON.stringify(verified.manifest).includes('"arm"'), false);
  const judgeVisibleText = verified.manifest.artifacts.map((artifact) => {
    const source = path.join(output, artifact.path);
    return fs.statSync(source).isFile() ? fs.readFileSync(source, 'utf8') : indexTree(source).map((item) => fs.readFileSync(path.join(source, item.path), 'utf8')).join('\n');
  }).join('\n');
  assert.doesNotMatch(judgeVisibleText, /lamina|\.lamina|benchmark|oracle|reviewer|review_hypothesis|critic-\d+/i);
  assert.match(judgeVisibleText, /product_method/);
  assert.match(judgeVisibleText, /task_input/);
  assert.match(judgeVisibleText, /validation_hypothesis/);
  const artifactPath = path.join(output, verified.manifest.artifacts[0].path);
  if (fs.statSync(artifactPath).isDirectory()) fs.writeFileSync(path.join(artifactPath, 'tampered.txt'), 'tampered');
  else fs.appendFileSync(artifactPath, 'tampered');
  assert.throws(() => verifyPublicBlindedPackage(path.join(output, 'manifest.json')), /hash mismatch|file count mismatch/);
  fs.rmSync(blindRoot, { recursive: true, force: true });
}

{
  assert.equal(isTransientProviderFailure('Selected model is at capacity. Please try a different model.'), true);
  assert.equal(isTransientProviderFailure('Too many requests'), true);
  assert.equal(isTransientProviderFailure('tests failed with exit 1'), false);
  assert.equal(isTransientProviderFailure('Selected model is at capacity.', { timedOut: true }), false);
  assert.match(transientContinuationPrompt(), /Do not restart completed work/);
  const safetyMessage = 'This content was flagged for possible cybersecurity risk. Join the Trusted Access for Cyber program.';
  assert.equal(isReviewSafetyInterruption(safetyMessage, { phase: 'review' }), true);
  assert.equal(isReviewSafetyInterruption(safetyMessage, { phase: 'transfer_review' }), true);
  assert.equal(isReviewSafetyInterruption(safetyMessage, { phase: 'implement' }), false);
  assert.equal(isReviewSafetyInterruption(safetyMessage, { phase: 'review', timedOut: true }), false);
  assert.match(reviewSafetyContinuationPrompt(), /ordinary named product roles/);
  assert.match(reviewSafetyContinuationPrompt(), /Still verify every declared authorization/);

  const codex = new CodexAdapter({ model: 'gpt-5.6-sol' });
  assert.deepEqual(codex.start('hello').args.slice(0, 2), ['exec', '--dangerously-bypass-approvals-and-sandbox']);
  assert.deepEqual(codex.version(), { command: 'codex', args: ['--version'] });
  const versionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-v2-cli-version-'));
  const versionWorkspace = path.join(versionRoot, 'workspace');
  const versionHome = path.join(versionRoot, 'runtime-home');
  fs.mkdirSync(versionWorkspace, { recursive: true });
  assert.match(isolatedCliVersion(codex, versionWorkspace, versionHome), /^codex-cli \d+/);
  fs.rmSync(versionRoot, { recursive: true, force: true });
  const normalized = codex.normalize('{"type":"thread.started","thread_id":"abc"}\n{"type":"item.completed"}');
  assert.equal(normalized.session_id, 'abc');
  const withText = codex.normalize('{"type":"item.completed","item":{"type":"agent_message","text":"review"}}');
  assert.equal(withText.final_text, 'review');
  const emptyWait = codex.normalize('{"type":"item.completed","item":{"type":"collab_tool_call","tool":"wait","receiver_thread_ids":[]}}');
  assert.equal(emptyWait.subagent_calls, 0);
  const spawned = codex.normalize('{"type":"item.completed","item":{"type":"collab_tool_call","tool":"spawn_agent","receiver_thread_ids":["child"]}}');
  assert.equal(spawned.subagent_calls, 1);
  const firstUsage = codex.normalize('{"type":"thread.started","thread_id":"usage-thread"}\n{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":80,"output_tokens":20,"reasoning_output_tokens":5}}');
  assert.deepEqual([firstUsage.input_tokens, firstUsage.cached_input_tokens, firstUsage.output_tokens, firstUsage.reasoning_output_tokens], [100, 80, 20, 5]);
  assert.equal(firstUsage.usage_accounting, 'session_delta');
  const resumedUsage = codex.normalize('{"type":"thread.started","thread_id":"usage-thread"}\n{"type":"turn.completed","usage":{"input_tokens":160,"cached_input_tokens":128,"output_tokens":31,"reasoning_output_tokens":9}}');
  assert.deepEqual([resumedUsage.input_tokens, resumedUsage.cached_input_tokens, resumedUsage.output_tokens, resumedUsage.reasoning_output_tokens], [60, 48, 11, 4]);
  assert.equal(resumedUsage.cumulative_input_tokens, 160);
  assert.throws(() => codex.normalize('{"type":"thread.started","thread_id":"usage-thread"}\n{"type":"turn.completed","usage":{"input_tokens":159,"cached_input_tokens":128,"output_tokens":31,"reasoning_output_tokens":9}}'), /Non-monotonic cumulative Codex usage/);
  assert.ok(codex.start('hello').args.includes('multi_agent'));
  const claude = new ClaudeCodeAdapter({ model: 'opus' });
  assert.deepEqual(claude.version(), { command: 'claude', args: ['--version'] });
  const start = claude.start('hello');
  assert.ok(start.sessionId);
  assert.ok(start.args.includes('--session-id'));
  const claudeResult = claude.normalize('{"type":"system","subtype":"init","session_id":"def","model":"claude-opus-x"}\n{"type":"result","session_id":"def"}');
  assert.equal(claudeResult.resolved_model, 'claude-opus-x');
}

{
  const thresholds = { graph_quality_points: 6, transfer_quality_points: 5, critical_omission_relative_reduction: 0.2, efficiency_time_reduction: 0.2, efficiency_rework_reduction: 0.25, noninferiority_margin_points: 2, favorable_tasks_required: 8 };
  const passed = evaluateClaims({ analysis: { complete: true }, graph: { effect_points: 8, effect_ci95: [2, 11], favorable_tasks: 9, human_model_direction_agree: true, model_rating_pairs_complete: true, critical_failure_increase: false }, transfer: { effect_points: 6, effect_ci95: [1, 9], critical_omission_reduction: 0.3, favorable_tasks: 8, incomplete_trial_increase: false, critical_failure_increase: false }, efficiency: { selected_outcome: 'time_to_threshold', selected_reduction: 0.22, selected_reduction_ci95: [0.04, 0.35], quality_delta: 0, favorable_tasks: 9 } }, thresholds);
  assert.equal(passed.downstream_implementation, 'passed');
  assert.equal(passed.agent_iteration_efficiency, 'passed');
  assert.equal(passed.human_iteration_speed, 'not_tested');
  const uncertain = evaluateClaims({ analysis: { complete: true }, graph: { effect_points: 8, effect_ci95: [-1, 11], favorable_tasks: 9, human_model_direction_agree: true, model_rating_pairs_complete: true, critical_failure_increase: false }, transfer: { effect_points: 6, effect_ci95: [1, 9], critical_omission_reduction: 0.3, favorable_tasks: 8, incomplete_trial_increase: false, critical_failure_increase: false }, efficiency: { selected_outcome: 'time_to_threshold', selected_reduction: 0.22, selected_reduction_ci95: [0.04, 0.35], quality_delta: 0, favorable_tasks: 9 } }, thresholds);
  assert.equal(uncertain.product_contract, 'failed');
}

{
  assert.match(fixtureFingerprint('plane-with-init'), /^[a-f0-9]{64}$/);
  const telemetry = [{ phase: 'x', provider: 'codex', model: 'm', resolved_model: 'm', cli_version: 'v', session_id: 's', started_at: '2026-01-01T00:00:00.000Z', ended_at: '2026-01-01T00:00:01.000Z', duration_ms: 1000, exit_code: 0, timed_out: false, usage_accounting: 'session_delta', input_tokens: 10, cached_input_tokens: 8, output_tokens: 2, reasoning_output_tokens: 1, cumulative_input_tokens: 20, cumulative_cached_input_tokens: 16, cumulative_output_tokens: 5, cumulative_reasoning_output_tokens: 2, tool_calls: 0, subagent_calls: 0, retries: 0, evidence_path: 'x' }];
  assert.equal(validateTelemetry(telemetry, ['x']).ok, true);
  assert.equal(validateTelemetry([{ ...telemetry[0], cumulative_input_tokens: null }], ['x']).ok, false);
}

{
  const validationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-v2-validation-'));
  const workspace = path.join(validationRoot, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'package.json'), `${JSON.stringify({ scripts: { check: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"' } }, null, 2)}\n`);
  fs.mkdirSync(path.join(workspace, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'tests', 'journey.test.mjs'), '// [proof:complete-journey]\n');
  fs.writeFileSync(path.join(workspace, 'product-proof-manifest.json'), `${JSON.stringify({ version: '1.0', proofs: [{ proof_id: 'complete-journey', test_files: ['tests/journey.test.mjs'], evidence_levels: ['boundary', 'journey'], test_requirements: ['restart_or_reload', 'responsive', 'accessibility'] }] }, null, 2)}\n`);
  const validation = validateProductWorkspace(workspace, path.join(validationRoot, 'home'), path.join(validationRoot, 'evidence'), { testReplays: 3 });
  assert.equal(validation.passed, true);
  assert.equal(validation.check, 'passed');
  assert.equal(validation.commands.filter((item) => item.kind === 'check').length, 1);
  assert.equal(validation.tests, 'passed_stable');

  fs.writeFileSync(path.join(workspace, 'product-proof-manifest.json'), `${JSON.stringify({ version: '1.0', proofs: { 'complete-journey': { test_files: ['tests/journey.test.mjs'], evidence_levels: ['boundary', 'journey'], test_requirements: ['restart_or_reload', 'responsive', 'accessibility'] } } }, null, 2)}\n`);
  assert.equal(validateProductProofManifest(workspace, { proofs: [{ id: 'complete-journey', evidence_levels: ['boundary', 'journey'], test_requirements: ['restart_or_reload', 'responsive', 'accessibility'] }] }).ok, true);
  assert.equal(validation.commands.filter((item) => item.kind === 'test').length, 3);
  assert.equal(fs.existsSync(path.join(validationRoot, 'evidence', 'test-replay-3.log')), true);
  const proofValidation = validateProductProofManifest(workspace, { proofs: [{ id: 'complete-journey', evidence_levels: ['boundary', 'journey'], test_requirements: ['restart_or_reload', 'responsive', 'accessibility'] }] });
  assert.equal(proofValidation.ok, true);
  fs.writeFileSync(path.join(workspace, 'proof-execution-summary.json'), `${JSON.stringify({
    result: 'passed',
    duration_ms: 1500,
    runtime_state: { node: process.version, browser_executable: '/private/browser', isolated_temporary_databases: true, test_concurrency: 1, nested_timeout_ms: 120000, nested_timed_out: false, skipped_tests_observed: false },
    requirements: [
      { proof_id: 'complete-journey', requirement: 'restart_or_reload', scenario: 'state survives reload', result: 'passed', duration_ms: 500 },
      { proof_id: 'complete-journey', requirement: 'responsive', scenario: 'journey works at narrow width', result: 'passed', duration_ms: 500 },
      { proof_id: 'complete-journey', requirement: 'accessibility', scenario: 'journey has no serious violations', result: 'passed', duration_ms: 500 },
    ],
  }, null, 2)}\n`);
  const receiptRoot = path.join(validationRoot, 'snapshot');
  const receipt = writeProductValidationReceipt(receiptRoot, validation, proofValidation, workspace);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.validation.completed_test_replays, 3);
  assert.equal(receipt.proof_coverage.execution.requirements_passed, 3);
  assert.equal(receipt.proof_coverage.execution.runtime.browser_available, true);
  const receiptText = fs.readFileSync(path.join(receiptRoot, 'product-validation-receipt.json'), 'utf8');
  assert.doesNotMatch(receiptText, /private\/browser|benchmark|oracle|reviewer|lamina/i);
  fs.rmSync(path.join(workspace, 'proof-execution-summary.json'));
  assert.equal(writeProductValidationReceipt(receiptRoot, validation, proofValidation, workspace).status, 'failed');
  fs.writeFileSync(path.join(workspace, 'tests', 'journey.test.mjs'), '// marker removed\n');
  assert.equal(validateProductProofManifest(workspace, { proofs: [{ id: 'complete-journey', evidence_levels: ['boundary', 'journey'], test_requirements: ['restart_or_reload', 'responsive', 'accessibility'] }] }).ok, false);
  fs.rmSync(validationRoot, { recursive: true, force: true });
}

console.log('bench_v2_protocol_test: ok');
