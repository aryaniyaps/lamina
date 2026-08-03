#!/usr/bin/env node
/** #56 / #75: side-by-side held-out matrix — BM25-only vs bounded vs full hybrid. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrievalFixture } from '../../retrieval-v1/fixtures.mjs';
import {
  boundedHybridRanking,
  hybridRanking,
} from '../../../packages/cli/lib/retrieval-runtime/store.mjs';
import { RETRIEVAL_DENSE_CANDIDATE_LIMIT } from '../../../packages/cli/lib/retrieval-runtime/constants.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const spike2 = JSON.parse(fs.readFileSync(path.join(HERE, 'b-lexical-first.json'), 'utf8'));
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

function embedText(text) {
  const vector = Array(768).fill(0);
  const expanded = String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  for (const token of expanded.match(/[a-z][a-z0-9]{1,}/g) || []) {
    const digest = crypto.createHash('sha256').update(token).digest();
    for (let offset = 0; offset < 16; offset += 2) {
      const index = digest.readUInt16BE(offset) % 768;
      vector[index] += digest[offset] & 1 ? 1 : -1;
    }
  }
  const norm = Math.sqrt(vector.reduce((total, item) => total + item * item, 0));
  return norm ? vector.map((item) => item / norm) : vector;
}

for (const graph of fixture.graphs) {
  workflowDocuments.set(graph.id, workflowDocuments.get(graph.id).map((document) => ({
    ...document,
    embedding: embedText(document.text),
  })));
  sourceDocuments.set(graph.id, sourceDocuments.get(graph.id).map((document) => ({
    ...document,
    embedding: embedText(document.text),
  })));
}

const heldOutWorkflow = fixture.workflowQueries.filter((item) => item.split === 'held_out');
let boundedMatchesFull = 0;
let boundedTotal = 0;
for (const query of heldOutWorkflow) {
  const documents = workflowDocuments.get(query.graph);
  const embedding = embedText(query.query);
  const bounded = boundedHybridRanking(documents, query.query, embedding);
  const full = hybridRanking(documents, query.query, embedding);
  boundedTotal += 1;
  if (JSON.stringify(bounded.map((row) => row.document.id)) ===
      JSON.stringify(full.map((row) => row.document.id))) {
    boundedMatchesFull += 1;
  }
}

const gates = spike2.adr012_hybrid_gates;
const report = {
  schema: 'lamina.runtime-baseline-spike/v1',
  spike: 'c56-dense-comparison-matrix',
  generated_at: new Date().toISOString(),
  fixture: {
    graphs: fixture.graphs.length,
    held_out_workflow_queries: heldOutWorkflow.length,
    held_out_source_queries: fixture.sourceQueries.filter((item) => item.split === 'held_out').length,
    dense_candidate_limit: RETRIEVAL_DENSE_CANDIDATE_LIMIT,
    max_workflow_documents_per_graph: Math.max(...fixture.graphs.map((graph) => graph.workflows.length)),
  },
  modes: {
    bm25_only: {
      metrics: spike2.lexical_only_bm25,
      passes_gates: spike2.passes_gates,
      dense_leg: 'removed',
      evidence: 'benchmarks/runtime-baseline-v1/spikes/b-lexical-first.json',
    },
    bounded_hybrid: {
      ranking_equivalence: {
        held_out_workflow_queries_matching_full_hybrid: boundedMatchesFull,
        held_out_workflow_queries_total: boundedTotal,
        note: 'Fixture corpora are below dense candidate cap; bounded pool equals full pool.',
      },
      dense_leg: 'retained_bounded',
      qualification: 'npm run test:cli (retrieval-v1 benchmark --evaluate)',
    },
    full_hybrid_pre_76: {
      dense_leg: 'retained_full',
      qualification: 'ADR-012 retrieval-v1 held-out gates (pre-#76 baseline)',
    },
  },
  adr012_hybrid_gates: gates,
  decision: {
    issue: 75,
    outcome: 'keep_mandatory_dense',
    rationale: 'bm25_only fails multi_workflow and recall gates; bounded hybrid preserves full hybrid ranking on fixture',
  },
};

const destination = path.join(HERE, 'c56-dense-comparison-matrix.json');
fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
