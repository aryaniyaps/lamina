#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  boundedHybridCandidateIds,
  boundedHybridRanking,
  hybridRanking,
} from '../packages/cli/lib/retrieval-runtime/scoring.mjs';
import {
  RETRIEVAL_DENSE_CANDIDATE_LIMIT,
  RETRIEVAL_LEXICAL_CANDIDATE_LIMIT,
} from '../packages/cli/lib/retrieval-runtime/constants.mjs';

function vector(index) {
  return Array.from({ length: 768 }, (_, item) => item === index ? 1 : 0);
}

function document(id, text, embedding, aliases = [id]) {
  return {
    id: `doc-${id}`,
    workflow_id: id,
    aliases,
    text,
    embedding,
    metadata: { facets: { operations: text.split(/\s+/) } },
  };
}

const documents = [
  document('workflow.billing', 'billing invoice payment reconciliation', vector(0), ['billing']),
  document('workflow.notifications', 'notifications delivery reminder preferences', vector(1), ['notify']),
  document('workflow.profile', 'member profile settings preferences', vector(2), ['profile']),
];

const query = 'billing invoice';
const embedding = vector(0);
const bounded = boundedHybridRanking(documents, query, embedding);
const full = hybridRanking(documents, query, embedding);
assert.deepEqual(
  bounded.map((row) => row.document.workflow_id),
  full.map((row) => row.document.workflow_id),
  'bounded hybrid must match full hybrid when corpus is below candidate cap',
);

const lexical = [{ document: documents[0], score: 1, matched: ['billing'] }];
const denseOrdered = documents.map((item, index) => ({ document: item, score: 1 - index * 0.1 }));
const ids = boundedHybridCandidateIds(documents, lexical, denseOrdered);
assert.equal(ids.size, documents.length, 'small corpora must retain every document in the pool');

const large = Array.from({ length: RETRIEVAL_DENSE_CANDIDATE_LIMIT + 8 }, (_, index) =>
  document(`workflow.item${index}`, `item ${index} shared vocabulary`, vector(index % 16)));
const lexicalLarge = large.slice(0, RETRIEVAL_LEXICAL_CANDIDATE_LIMIT).map((item, index) => ({
  document: item,
  score: 10 - index,
  matched: ['item'],
}));
const denseLarge = large.map((item, index) => ({ document: item, score: 1 - index * 0.001 }));
const capped = boundedHybridCandidateIds(large, lexicalLarge, denseLarge);
assert.ok(capped.size <= RETRIEVAL_DENSE_CANDIDATE_LIMIT + RETRIEVAL_LEXICAL_CANDIDATE_LIMIT,
  'bounded pool must not exceed lexical and dense union caps');
assert.ok(capped.size < large.length, 'bounded pool must be smaller than an oversized corpus');

console.log('retrieval_bounded_dense_test: ok');
