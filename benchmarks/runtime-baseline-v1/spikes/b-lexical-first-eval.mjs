#!/usr/bin/env node
/** #52 Slice 3 Spike 2 (B): lexical/BM25-only held-out quality vs ADR-012 hybrid gates. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrievalFixture } from '../../retrieval-v1/fixtures.mjs';
import {
  bm25Ranking,
  classifyWorkflowOutcome,
} from '../../../packages/cli/lib/retrieval-runtime/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = retrievalFixture();

const workflowDocuments = new Map();
const sourceDocuments = new Map();
for (const graph of fixture.graphs) {
  workflowDocuments.set(graph.id, graph.workflows.map((workflow) => ({
    id: workflow.id,
    workflow_id: workflow.id,
    aliases: [workflow.alias],
    text: workflow.text,
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
  sourceDocuments.set(graph.id, graph.workflows.flatMap((workflow) =>
    workflow.source_documents.map((source, index) => ({
      id: `${workflow.id}:source:${index}`,
      path: source.file,
      symbol: source.symbol,
      text: source.text,
      metadata: { facets: { path: [source.file], symbol: [source.symbol] } },
    }))));
}

const heldOutWorkflow = fixture.workflowQueries.filter((item) => item.split === 'held_out');
const singles = heldOutWorkflow.filter((item) =>
  !['multi_workflow', 'new_workflow'].includes(item.kind));
const exact = singles.filter((item) => ['exact_id', 'exact_alias'].includes(item.kind));
const multi = heldOutWorkflow.filter((item) => item.kind === 'multi_workflow');
const novel = heldOutWorkflow.filter((item) => item.kind === 'new_workflow');
const heldOutSource = fixture.sourceQueries.filter((item) => item.split === 'held_out');

const ranks = (query) => bm25Ranking(workflowDocuments.get(query.graph), query.query);

const recallAtFive = () => singles.filter((query) => {
  const found = new Set(ranks(query).slice(0, 5).map((item) => item.document.workflow_id));
  return query.expected.every((id) => found.has(id));
}).length / singles.length;

const exactAccuracy = () => exact.filter((query) =>
  classifyWorkflowOutcome(query.query, ranks(query)).selected[0] === query.expected[0])
  .length / exact.length;

const multiComplete = () => multi.filter((query) => {
  const outcome = classifyWorkflowOutcome(query.query, ranks(query));
  return outcome.outcome === 'multi_workflow'
    && query.expected.every((id) => outcome.selected.includes(id));
}).length / multi.length;

const incorrectNovelAttachment = () => novel.filter((query) =>
  classifyWorkflowOutcome(query.query, ranks(query)).outcome !== 'new_workflow_required')
  .length / novel.length;

const sourceRecallAtTen = () => heldOutSource.filter((query) => {
  const ranking = bm25Ranking(sourceDocuments.get(query.graph), query.query);
  return ranking.slice(0, 10).some((item) => item.document.path === query.expected_file);
}).length / heldOutSource.length;

const lexicalOnly = {
  workflow_recall_at_5: recallAtFive(),
  exact_id_alias_accuracy: exactAccuracy(),
  complete_multi_workflow_selection: multiComplete(),
  incorrect_new_workflow_attachment: incorrectNovelAttachment(),
  source_recall_at_10: sourceRecallAtTen(),
};

// ADR-012 / retrieval-v1 qualification gates for hybrid held-out rows.
const gates = {
  exact_id_alias_min: 1.0,
  multi_workflow_min: 0.95,
  incorrect_new_workflow_max: 0.02,
  workflow_recall_at_5_hybrid_min: 0.98,
  source_recall_at_10_hybrid_min: 0.9,
};

const report = {
  schema: 'lamina.runtime-baseline-spike/v1',
  spike: 'b-lexical-first',
  generated_at: new Date().toISOString(),
  fixture: {
    graphs: fixture.graphs.length,
    held_out_workflow_queries: heldOutWorkflow.length,
    held_out_source_queries: heldOutSource.length,
  },
  lexical_only_bm25: lexicalOnly,
  adr012_hybrid_gates: gates,
  passes_gates: {
    exact_id_alias: lexicalOnly.exact_id_alias_accuracy >= gates.exact_id_alias_min,
    multi_workflow: lexicalOnly.complete_multi_workflow_selection >= gates.multi_workflow_min,
    incorrect_new_workflow: lexicalOnly.incorrect_new_workflow_attachment <= gates.incorrect_new_workflow_max,
    workflow_recall_at_5: lexicalOnly.workflow_recall_at_5 >= gates.workflow_recall_at_5_hybrid_min,
    source_recall_at_10: lexicalOnly.source_recall_at_10 >= gates.source_recall_at_10_hybrid_min,
  },
  footprint_headroom: {
    model_bytes_avoided: 161_895_621,
    worker_bytes_note: 'Observation CocoIndex worker (88.7 MiB) remains until #56 removal decision.',
  },
  verdict: null,
};

report.verdict = Object.values(report.passes_gates).every(Boolean)
  ? 'lexical_only_meets_held_out_gates'
  : 'lexical_only_fails_held_out_gates_keep_hybrid_dense';

const destination = path.join(HERE, 'b-lexical-first.json');
fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
