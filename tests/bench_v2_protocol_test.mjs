#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CodexAdapter, ClaudeCodeAdapter } from '../benchmarks/v2/runtime/agent-adapters.mjs';
import { answerQuestions } from '../benchmarks/v2/runtime/oracle.mjs';
import { evaluateClaims } from '../benchmarks/v2/scoring/claim-gates.mjs';
import { compileMatrix } from '../benchmarks/v2/runtime/compile-matrix.mjs';
import { aggregateResults } from '../benchmarks/v2/scoring/aggregate-results.mjs';
import { summarizeRatings, weightedRating } from '../benchmarks/v2/scoring/score-ratings.mjs';
import { snapshotWorkspace } from '../benchmarks/v2/runtime/workspace-snapshot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v2 = path.join(root, 'benchmarks', 'v2');

for (const file of ['release.json', 'protocol/prompts.json', 'protocol/reviewer-prompts.json', 'corpus/manifest.json', 'scoring/product-contract-rubric.json']) JSON.parse(fs.readFileSync(path.join(v2, file), 'utf8'));
const release = JSON.parse(fs.readFileSync(path.join(v2, 'release.json'), 'utf8'));
assert.deepEqual(release.arms, ['raw', 'structured', 'lamina']);
assert.equal(release.publication_tasks, 12);
const prompts = JSON.parse(fs.readFileSync(path.join(v2, 'protocol', 'prompts.json'), 'utf8'));
for (const arm of release.arms) for (const phase of release.phases) assert.equal(typeof prompts[arm][phase], 'string', `${arm} missing ${phase} prompt`);
assert.equal(release.primary_cohort_trial_cells, release.publication_tasks * release.arms.length * release.tracks.length * release.runs_per_cell);
assert.equal(release.all_cohort_trial_cells, release.primary_cohort_trial_cells * release.cohorts.length);
const corpus = JSON.parse(fs.readFileSync(path.join(v2, 'corpus', 'manifest.json'), 'utf8'));
assert.equal(compileMatrix(release, corpus, { mode: 'development', cohort: release.primary_cohort }).length, release.development_tasks * release.arms.length * release.tracks.length * release.runs_per_cell);
assert.throws(() => compileMatrix(release, corpus, { mode: 'publication', cohort: 'anthropic-opus' }), /not pinned/);
const rubric = JSON.parse(fs.readFileSync(path.join(v2, 'scoring', 'product-contract-rubric.json'), 'utf8'));
assert.ok(!('persona_provenance' in rubric.dimensions));
assert.equal(Math.round(Object.values(rubric.dimensions).reduce((sum, weight) => sum + weight, 0) * 100), 100);

{
  const result = answerQuestions({ questions: [{ id: 'q1', topic: 'ownership', question: 'Who owns it?', impact_refs: [], reason: 'Authority' }, { id: 'q2', topic: 'money', question: 'Who pays?', impact_refs: [], reason: 'Policy' }] }, { task_id: 'task', facts: [{ id: 'f1', topic: 'ownership', answer: 'The member owns it.' }] });
  assert.equal(result.answers[0].answer, 'The member owns it.');
  assert.match(result.answers[1].answer, /No founder preference/);
  assert.throws(() => answerQuestions({ questions: new Array(4).fill({ id: 'q', topic: 'scope', question: '?' }) }, { facts: [] }), /at most three/);
}

{
  const dimensions = Object.fromEntries(Object.keys(rubric.dimensions).map((key) => [key, 5]));
  assert.equal(Math.round(weightedRating({ artifact_id: 'x', rater_id: 'a', dimensions }, rubric)), 100);
  const summary = summarizeRatings([{ artifact_id: 'x', rater_id: 'a', dimensions, critical_omissions: [], critical_failures: [] }, { artifact_id: 'x', rater_id: 'b', dimensions, critical_omissions: [], critical_failures: [] }], rubric);
  assert.equal(summary[0].score, 100);
  assert.equal(summary[0].adjudication_required, false);
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
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.lamina', 'run.json'), '{}');
  fs.writeFileSync(path.join(workspace, 'product-contract.md'), 'secret method artifact');
  fs.writeFileSync(path.join(workspace, 'src', 'app.js'), 'product');
  const snapshot = path.join(root, 'snapshot');
  snapshotWorkspace(workspace, snapshot);
  assert.equal(fs.existsSync(path.join(snapshot, 'src', 'app.js')), true);
  assert.equal(fs.existsSync(path.join(snapshot, '.lamina')), false);
  assert.equal(fs.existsSync(path.join(snapshot, 'product-contract.md')), false);
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const codex = new CodexAdapter({ model: 'gpt-5.6-sol' });
  assert.deepEqual(codex.start('hello').args.slice(0, 2), ['exec', '--dangerously-bypass-approvals-and-sandbox']);
  const normalized = codex.normalize('{"type":"thread.started","thread_id":"abc"}\n{"type":"item.completed"}');
  assert.equal(normalized.session_id, 'abc');
  const withText = codex.normalize('{"type":"item.completed","item":{"type":"agent_message","text":"review"}}');
  assert.equal(withText.final_text, 'review');
  const claude = new ClaudeCodeAdapter({ model: 'opus' });
  const start = claude.start('hello');
  assert.ok(start.sessionId);
  assert.ok(start.args.includes('--session-id'));
  const claudeResult = claude.normalize('{"type":"system","subtype":"init","session_id":"def","model":"claude-opus-x"}\n{"type":"result","session_id":"def"}');
  assert.equal(claudeResult.resolved_model, 'claude-opus-x');
}

{
  const thresholds = { graph_quality_points: 6, transfer_quality_points: 5, critical_omission_relative_reduction: 0.2, efficiency_time_reduction: 0.2, efficiency_rework_reduction: 0.25, noninferiority_margin_points: 2, favorable_tasks_required: 8 };
  const passed = evaluateClaims({ graph: { effect_points: 8, effect_ci95: [2, 11], favorable_tasks: 9, human_model_direction_agree: true, critical_failure_increase: false }, transfer: { effect_points: 6, effect_ci95: [1, 9], critical_omission_reduction: 0.3, favorable_tasks: 8, incomplete_trial_increase: false }, efficiency: { time_to_threshold_reduction: 0.22, time_reduction_ci95: [0.04, 0.35], rework_reduction: 0.1, rework_reduction_ci95: [-0.1, 0.2], quality_delta: 0, favorable_tasks: 9 } }, thresholds);
  assert.equal(passed.downstream_implementation, 'passed');
  assert.equal(passed.agent_iteration_efficiency, 'passed');
  assert.equal(passed.human_iteration_speed, 'not_tested');
  const uncertain = evaluateClaims({ graph: { effect_points: 8, effect_ci95: [-1, 11], favorable_tasks: 9, human_model_direction_agree: true, critical_failure_increase: false }, transfer: { effect_points: 6, effect_ci95: [1, 9], critical_omission_reduction: 0.3, favorable_tasks: 8, incomplete_trial_increase: false }, efficiency: { time_to_threshold_reduction: 0.22, time_reduction_ci95: [0.04, 0.35], rework_reduction: 0.1, rework_reduction_ci95: [-0.1, 0.2], quality_delta: 0, favorable_tasks: 9 } }, thresholds);
  assert.equal(uncertain.product_contract, 'failed');
}

console.log('bench_v2_protocol_test: ok');
