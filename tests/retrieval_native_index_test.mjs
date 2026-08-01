#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { assertSafeRunnerContext } from '../scripts/safe-runner/context.mjs';

assertSafeRunnerContext('native retrieval index qualification');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { RetrievalStore } = await import('../packages/cli/lib/retrieval-runtime/store.mjs');

if (!process.env.LAMINA_RETRIEVAL_FTS_EXTENSION_PATH ||
    !process.env.LAMINA_RETRIEVAL_VECTOR_EXTENSION_PATH ||
    !process.env.LAMINA_RETRIEVAL_TOKENIZER_PATH) {
  console.log('retrieval_native_index_test: set packaged asset paths to exercise native indexes');
  process.exit(0);
}

const vector = (index) =>
  Array.from({ length: 768 }, (_, item) => item === index ? 1 : 0);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const workflow = {
  id: 'workflow-billing',
  logical_key: 'workflow:workflow.billing',
  identity: 'native-identity',
  kind: 'workflow',
  workflow_id: 'workflow.billing',
  aliases: ['billing'],
  text: 'billing invoice payment reconciliation',
  embedding: vector(0),
  content_hash: hash('billing invoice payment reconciliation'),
  metadata: { facets: { operations: ['reconcile payment'] } },
};
const source = {
  id: 'source-billing',
  logical_key: 'source:src/billing.ts:reconcilePayment:1:2',
  identity: 'native-identity',
  kind: 'source',
  workflow_id: '',
  aliases: [],
  text: 'file: src/billing.ts\nsymbol: reconcilePayment\nreconcile billing payment',
  path: 'src/billing.ts',
  symbol: 'reconcilePayment',
  start_line: 1,
  end_line: 2,
  embedding: vector(0),
  content_hash: hash('source billing'),
  metadata: { facets: { path: ['src/billing.ts'], symbol: ['reconcilePayment'] } },
};
const documents = [workflow, source];
const indexDigest = hash(JSON.stringify(documents.map((item) => ({
  content_hash: item.content_hash,
  id: item.id,
  logical_key: item.logical_key,
})).sort((left, right) => left.logical_key.localeCompare(right.logical_key))));
const manifest = {
  identity: 'native-identity',
  generation: 'native-generation',
  graph_version: 'native-graph',
  source_revision: 'native-source',
  repository_revision: 'native-commit',
  branch: 'main',
  worktree: '/native',
  model_digest: 'native-model',
  index_digest: indexDigest,
  schema_version: 1,
  expected_count: documents.length,
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-native-index-'));
try {
  const store = new RetrievalStore({
    retrieval: path.join(root, 'retrieval.lbdb'),
    retrieval_failure: path.join(root, 'failure.json'),
  });
  store.apply({
    identity: manifest.identity,
    generation: manifest.generation,
    manifest,
    reset: true,
    upserts: documents,
    members: documents.map((item) => item.id),
  });
  store.apply({
    identity: manifest.identity,
    generation: manifest.generation,
    manifest,
    complete: true,
  });
  const query = () => store.retrievalQuery({
    ...manifest,
    query: 'reconcile billing payment',
    embedding: vector(0),
  });
  const first = query();
  assert.deepEqual(first.selected_workflow_ids, ['workflow.billing']);
  assert.equal(first.source_chunks[0].file, 'src/billing.ts');
  assert.equal(store.lastFailure(), null, 'healthy native indexes must answer without a rebuild');

  store.connection.querySync(
    "CALL DROP_VECTOR_INDEX('RetrievalDocument', 'retrieval_vector')",
  );
  const recovered = query();
  assert.deepEqual(recovered.selected_workflow_ids, ['workflow.billing']);
  const indexes = store.connection.querySync('CALL SHOW_INDEXES() RETURN *').getAllSync();
  assert.ok(indexes.some((item) => item.index_name === 'retrieval_vector'),
    'a missing/corrupt native index must be rebuilt before retry');
  store.close();
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('retrieval_native_index_test: ok');
