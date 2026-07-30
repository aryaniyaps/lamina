#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import {
  bm25Ranking,
  classifyWorkflowOutcome,
  denseRanking,
  hybridRanking,
} from '../../packages/cli/lib/retrieval-runtime/store.mjs';
import { retrievalFixture } from './fixtures.mjs';

const fixture = retrievalFixture();
const evaluate = process.argv.includes('--evaluate');
const calibrate = process.argv.includes('--calibrate');
if (!evaluate && !calibrate) {
  const heldOutWorkflow = fixture.workflowQueries.filter((item) => item.split === 'held_out');
  const heldOutSource = fixture.sourceQueries.filter((item) => item.split === 'held_out');
  assert.ok(heldOutWorkflow.some((item) => item.kind === 'exact_id'));
  assert.ok(heldOutWorkflow.some((item) => item.kind === 'multi_workflow'));
  assert.ok(heldOutWorkflow.some((item) => item.kind === 'new_workflow'));
  assert.ok(heldOutSource.some((item) => item.kind === 'failure_state'));
  process.stdout.write(`${JSON.stringify({
    valid: true,
    graphs: fixture.graphs.length,
    workflow_queries: fixture.workflowQueries.length,
    source_queries: fixture.sourceQueries.length,
    development: {
      workflows: fixture.workflowQueries.filter((item) => item.split === 'development').length,
      sources: fixture.sourceQueries.filter((item) => item.split === 'development').length,
    },
    held_out: {
      workflows: heldOutWorkflow.length,
      sources: heldOutSource.length,
    },
  }, null, 2)}\n`);
  process.exit(0);
}

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const worker = argument('--worker');
const model = argument('--model') || process.env.LAMINA_RETRIEVAL_MODEL_PATH;
const tokenizer = argument('--tokenizer') || process.env.LAMINA_RETRIEVAL_TOKENIZER_PATH;
const modelDigest = argument('--model-digest') || process.env.LAMINA_RETRIEVAL_MODEL_DIGEST;
if (!model || !tokenizer || !modelDigest) {
  throw new Error('--evaluate requires model, tokenizer, and model digest inputs.');
}

function invocation() {
  if (worker) return { command: path.resolve(worker), args: ['retrieval', 'serve'] };
  return {
    command: process.env.LAMINA_UV_BINARY || 'uv',
    args: [
      'run', '--locked', '--project', path.resolve('packages/cli'), 'python',
      path.resolve('packages/cli/retrieval_worker.py'), 'serve',
    ],
  };
}

function embeddingClient() {
  const command = invocation();
  const child = spawn(command.command, command.args, {
    env: {
      ...process.env,
      LAMINA_RETRIEVAL_MODEL_PATH: path.resolve(model),
      LAMINA_RETRIEVAL_MODEL_DIGEST: modelDigest,
      LAMINA_RETRIEVAL_TOKENIZER_PATH: path.resolve(tokenizer),
      LAMINA_RETRIEVAL_LEXICAL_ONLY: '0',
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = [];
  lines.on('line', (line) => {
    const request = pending.shift();
    if (!request) return;
    try {
      const value = JSON.parse(line);
      if (value.error) request.reject(new Error(value.error));
      else request.resolve(value.embeddings);
    } catch (error) {
      request.reject(error);
    }
  });
  child.on('exit', (code) => {
    for (const request of pending.splice(0)) {
      request.reject(new Error(`embedding worker exited with ${code}`));
    }
  });
  return {
    request(texts) {
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        child.stdin.write(`${JSON.stringify({ texts })}\n`);
      });
    },
    close() {
      child.stdin.end();
      child.kill('SIGTERM');
    },
  };
}

const texts = [];
for (const graph of fixture.graphs) {
  for (const workflow of graph.workflows) {
    texts.push(workflow.text);
    for (const source of workflow.source_documents) texts.push(source.text);
  }
}
for (const query of [...fixture.workflowQueries, ...fixture.sourceQueries]) texts.push(query.query);
const uniqueTexts = [...new Set(texts)];
const client = embeddingClient();
const coldStart = performance.now();
await client.request(['warm retrieval benchmark']);
const coldInitializationMs = performance.now() - coldStart;
const embeddings = await client.request(uniqueTexts);
const byText = new Map(uniqueTexts.map((text, index) => [text, embeddings[index]]));
const warmSamples = [];
for (let index = 0; index < 7; index += 1) {
  const started = performance.now();
  await client.request([`warm query ${index}`]);
  warmSamples.push(performance.now() - started);
}
client.close();
warmSamples.sort((left, right) => left - right);

const workflowDocuments = new Map();
const sourceDocuments = new Map();
const allWorkflowDocuments = fixture.graphs.flatMap((graph) => graph.workflows.map((workflow) => ({
  id: workflow.id,
  workflow_id: workflow.id,
  aliases: [workflow.alias],
  text: workflow.text,
  embedding: byText.get(workflow.text),
  metadata: {
    facets: {
      persona: [workflow.persona],
      invariant: [workflow.invariant],
      failure: [workflow.failure],
      surface: [workflow.surface],
      operation: [workflow.operation],
    },
  },
})));
const allSourceDocuments = fixture.graphs.flatMap((graph) => graph.workflows.flatMap((workflow) =>
  workflow.source_documents.map((source, index) => ({
    id: `${workflow.id}:source:${index}`,
    path: source.file,
    symbol: source.symbol,
    text: source.text,
    embedding: byText.get(source.text),
    metadata: { facets: { path: [source.file], symbol: [source.symbol] } },
  }))));
for (const graph of fixture.graphs) {
  workflowDocuments.set(graph.id, allWorkflowDocuments);
  sourceDocuments.set(graph.id, allSourceDocuments);
}

function baselineRanking(documents, query) {
  const queryTerms = new Set(String(query).toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []);
  return documents.map((document) => ({
    document,
    score: [...queryTerms].filter((term) => document.text.toLowerCase().includes(term)).length,
  })).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id));
}

const heldOutWorkflow = fixture.workflowQueries.filter((item) => item.split === 'held_out');
const singles = heldOutWorkflow.filter((item) =>
  !['multi_workflow', 'new_workflow'].includes(item.kind));
const exact = singles.filter((item) => ['exact_id', 'exact_alias'].includes(item.kind));
const multi = heldOutWorkflow.filter((item) => item.kind === 'multi_workflow');
const novel = heldOutWorkflow.filter((item) => item.kind === 'new_workflow');

const ranks = (query, mode) => {
  const documents = workflowDocuments.get(query.graph);
  const embedding = byText.get(query.query);
  if (mode === 'baseline') return baselineRanking(documents, query.query);
  if (mode === 'bm25') return bm25Ranking(documents, query.query);
  if (mode === 'dense') return denseRanking(documents, embedding);
  return hybridRanking(documents, query.query, embedding);
};
const recallAtFive = (mode) => singles.filter((query) => {
  const found = new Set(ranks(query, mode).slice(0, 5).map((item) => item.document.workflow_id));
  return query.expected.every((id) => found.has(id));
}).length / singles.length;
const exactAccuracy = exact.filter((query) =>
  classifyWorkflowOutcome(query.query, ranks(query, 'hybrid')).selected[0] === query.expected[0])
  .length / exact.length;
const multiComplete = multi.filter((query) => {
  const outcome = classifyWorkflowOutcome(query.query, ranks(query, 'hybrid'));
  return outcome.outcome === 'multi_workflow' &&
    query.expected.every((id) => outcome.selected.includes(id));
}).length / multi.length;
const incorrectNovelAttachment = novel.filter((query) =>
  classifyWorkflowOutcome(query.query, ranks(query, 'hybrid')).outcome !== 'new_workflow_required')
  .length / novel.length;
const developmentWorkflow = fixture.workflowQueries.filter((item) => item.split === 'development');
const developmentExact = developmentWorkflow.filter((item) =>
  ['exact_id', 'exact_alias'].includes(item.kind));
const developmentMulti = developmentWorkflow.filter((item) => item.kind === 'multi_workflow');
const developmentNovel = developmentWorkflow.filter((item) => item.kind === 'new_workflow');
const developmentMetrics = {
  exact_id_alias_accuracy: developmentExact.filter((query) =>
    classifyWorkflowOutcome(query.query, ranks(query, 'hybrid')).selected[0] === query.expected[0])
    .length / developmentExact.length,
  complete_multi_workflow_selection: developmentMulti.filter((query) => {
    const outcome = classifyWorkflowOutcome(query.query, ranks(query, 'hybrid'));
    return outcome.outcome === 'multi_workflow' &&
      query.expected.every((id) => outcome.selected.includes(id));
  }).length / developmentMulti.length,
  incorrect_new_workflow_attachment: developmentNovel.filter((query) =>
    classifyWorkflowOutcome(query.query, ranks(query, 'hybrid')).outcome !== 'new_workflow_required')
    .length / developmentNovel.length,
};
const novelDiagnostics = novel.map((query) => {
  const ranking = ranks(query, 'hybrid');
  const outcome = classifyWorkflowOutcome(query.query, ranking);
  const top = ranking[0];
  return {
    graph: query.graph,
    query: query.query,
    outcome: outcome.outcome,
    selected: outcome.selected,
    top: top ? {
      workflow: top.document.workflow_id,
      score: top.score,
      bm25_score: top.bm25_score,
      dense_score: top.dense_score,
      matched_terms: top.matched_terms,
      direct_matches: top.direct_matches,
    } : null,
  };
});
const developmentNovelDiagnostics = developmentNovel.map((query) => {
  const ranking = ranks(query, 'hybrid');
  const outcome = classifyWorkflowOutcome(query.query, ranking);
  const top = ranking[0];
  return {
    graph: query.graph,
    query: query.query,
    outcome: outcome.outcome,
    top: top ? {
      workflow: top.document.workflow_id,
      score: top.score,
      bm25_score: top.bm25_score,
      dense_score: top.dense_score,
      matched_terms: top.matched_terms,
      direct_matches: top.direct_matches,
    } : null,
  };
});

const heldOutSource = fixture.sourceQueries.filter((item) => item.split === 'held_out');
const sourceRecall = (mode) => heldOutSource.filter((query) => {
  const documents = sourceDocuments.get(query.graph);
  const embedding = byText.get(query.query);
  const ranking = mode === 'baseline'
    ? baselineRanking(documents, query.query)
    : hybridRanking(documents, query.query, embedding);
  return ranking.slice(0, 10).some((item) => item.document.path === query.expected_file);
}).length / heldOutSource.length;

const deterministic = heldOutWorkflow.every((query) => {
  const first = ranks(query, 'hybrid').map((item) => item.document.id);
  const second = ranks(query, 'hybrid').map((item) => item.document.id);
  return JSON.stringify(first) === JSON.stringify(second);
});
const workflowTimingStart = performance.now();
for (let index = 0; index < 100; index += 1) ranks(singles[index % singles.length], 'hybrid');
const warmWorkflowMs = (performance.now() - workflowTimingStart) / 100 + warmSamples[3];
const sourceTimingStart = performance.now();
for (let index = 0; index < 100; index += 1) {
  const query = heldOutSource[index % heldOutSource.length];
  hybridRanking(sourceDocuments.get(query.graph), query.query, byText.get(query.query));
}
const warmSourceMs = (performance.now() - sourceTimingStart) / 100 + warmSamples[3];

const report = {
  schema: 'lamina.retrieval-benchmark/v1',
  fixture: {
    graphs: fixture.graphs.length,
    workflow_queries: fixture.workflowQueries.length,
    source_queries: fixture.sourceQueries.length,
  },
  held_out: {
    exact_id_alias_accuracy: exactAccuracy,
    workflow_recall_at_5: {
      baseline: recallAtFive('baseline'),
      bm25: recallAtFive('bm25'),
      dense: recallAtFive('dense'),
      hybrid: recallAtFive('hybrid'),
    },
    complete_multi_workflow_selection: multiComplete,
    incorrect_new_workflow_attachment: incorrectNovelAttachment,
    source_file_recall_at_10: {
      baseline: sourceRecall('baseline'),
      hybrid: sourceRecall('hybrid'),
    },
  },
  deterministic,
  latency_ms: {
    cold_initialization: coldInitializationMs,
    warm_workflow: warmWorkflowMs,
    warm_source: warmSourceMs,
  },
};
if (calibrate) {
  const calibrationFailures = [];
  if (developmentMetrics.exact_id_alias_accuracy < 1) {
    calibrationFailures.push('exact_id_alias_accuracy');
  }
  if (developmentMetrics.complete_multi_workflow_selection < 0.95) {
    calibrationFailures.push('complete_multi_workflow_selection');
  }
  if (developmentMetrics.incorrect_new_workflow_attachment > 0.02) {
    calibrationFailures.push('incorrect_new_workflow_attachment');
  }
  const calibrationReport = {
    schema: 'lamina.retrieval-calibration/v1',
    split: 'development',
    thresholds_source: 'packages/cli/lib/retrieval-runtime/constants.mjs',
    metrics: developmentMetrics,
    incorrect_new_workflow_attachments: developmentNovelDiagnostics.filter((item) =>
      item.outcome !== 'new_workflow_required'),
    passed: calibrationFailures.length === 0,
    failures: calibrationFailures,
  };
  process.stdout.write(`${JSON.stringify(calibrationReport, null, 2)}\n`);
  if (calibrationFailures.length) process.exitCode = 1;
  process.exit();
}
const failures = [];
if (exactAccuracy < 1) failures.push('exact_id_alias_accuracy');
if (report.held_out.workflow_recall_at_5.hybrid < 0.98) failures.push('workflow_recall_at_5');
if (multiComplete < 0.95) failures.push('complete_multi_workflow_selection');
if (incorrectNovelAttachment > 0.02) failures.push('incorrect_new_workflow_attachment');
if (report.held_out.source_file_recall_at_10.hybrid < 0.9) failures.push('source_file_recall_at_10');
if (report.held_out.source_file_recall_at_10.hybrid -
    report.held_out.source_file_recall_at_10.baseline < 0.1) failures.push('source_baseline_lift');
if (!deterministic) failures.push('determinism');
if (warmWorkflowMs >= 250) failures.push('warm_workflow_latency');
if (warmSourceMs >= 500) failures.push('warm_source_latency');
if (coldInitializationMs >= 5000) failures.push('cold_initialization_latency');
report.passed = failures.length === 0;
report.failures = failures;
if (failures.includes('incorrect_new_workflow_attachment')) {
  report.diagnostics = {
    incorrect_new_workflow_attachments: novelDiagnostics.filter((item) =>
      item.outcome !== 'new_workflow_required'),
  };
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
