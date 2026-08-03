/** Hybrid retrieval scoring and Workflow outcome classification (#74 / ADR-012).
 *
 * Pure ranking over indexed candidates — graph closure and packet assembly live in
 * work-context; index membership lives in retrieval-generation (#73).
 */
import { gitByteCompare } from '../source-inventory.mjs';
import {
  RETRIEVAL_AMBIGUITY_MARGIN,
  RETRIEVAL_DENSE_RELEVANCE,
  RETRIEVAL_HYBRID_DENSE_RELEVANCE,
  RETRIEVAL_MULTI_MARGIN,
  RETRIEVAL_RRF_K,
  RETRIEVAL_WORKFLOW_THRESHOLD,
} from './constants.mjs';

function documentIdCompare(left, right) {
  return gitByteCompare(left.document.id, right.document.id);
}

export function retrievalQueryTerms(value) {
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'for', 'from',
    'how', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this',
    'to', 'what', 'when', 'where', 'which', 'who', 'with',
  ]);
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .match(/[a-z][a-z0-9]{1,}/g)?.filter((term) => !stopWords.has(term)) || [];
}

function normalizedExact(value) {
  return String(value || '').trim().toLowerCase();
}

function cosine(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export function bm25Ranking(documents, query) {
  const queryTerms = [...new Set(retrievalQueryTerms(query))];
  if (!queryTerms.length || !documents.length) return [];
  const tokenized = documents.map((document) => retrievalQueryTerms(document.text));
  const averageLength = tokenized.reduce((total, item) => total + item.length, 0) / tokenized.length || 1;
  const documentFrequency = new Map(queryTerms.map((term) => [
    term,
    tokenized.filter((item) => item.includes(term)).length,
  ]));
  return documents.map((document, index) => {
    const documentTerms = tokenized[index];
    const frequency = new Map();
    for (const term of documentTerms) frequency.set(term, (frequency.get(term) || 0) + 1);
    let score = 0;
    const matched = [];
    for (const term of queryTerms) {
      const tf = frequency.get(term) || 0;
      if (!tf) continue;
      matched.push(term);
      const df = documentFrequency.get(term) || 0;
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      const denominator = tf + 1.2 * (1 - 0.75 + 0.75 * documentTerms.length / averageLength);
      score += idf * (tf * 2.2) / denominator;
    }
    return { document, score, matched };
  }).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || documentIdCompare(left, right));
}

export function denseRanking(documents, embedding) {
  return documents.map((document) => ({
    document,
    score: cosine(document.embedding, embedding),
  })).sort((left, right) =>
    right.score - left.score || documentIdCompare(left, right));
}

export function fuseRankings(documents, query, lexical, dense) {
  const scores = new Map(documents.map((document) => [document.id, {
    document,
    score: 0,
    bm25_score: 0,
    dense_score: 0,
    matched_terms: [],
    ranks: {},
  }]));
  lexical.forEach((item, index) => {
    const row = scores.get(item.document.id);
    row.score += 1 / (RETRIEVAL_RRF_K + index + 1);
    row.bm25_score = item.score;
    row.matched_terms = item.matched;
    row.ranks.bm25 = index + 1;
  });
  dense.forEach((item, index) => {
    const row = scores.get(item.document.id);
    row.score += 1 / (RETRIEVAL_RRF_K + index + 1);
    row.dense_score = item.score;
    row.ranks.dense = index + 1;
  });
  const queryTerms = new Set(retrievalQueryTerms(query));
  for (const row of scores.values()) {
    const facets = row.document.metadata?.facets || {};
    const direct = [...new Set(Object.values(facets).flat().flatMap(retrievalQueryTerms))]
      .filter((term) => queryTerms.has(term));
    row.direct_matches = direct;
    row.score += Math.min(direct.length, 4) * 0.0005;
  }
  return [...scores.values()].sort((left, right) =>
    right.score - left.score || documentIdCompare(left, right));
}

export function hybridRanking(documents, query, embedding) {
  return fuseRankings(
    documents,
    query,
    bm25Ranking(documents, query),
    denseRanking(documents, embedding),
  );
}

export function classifyWorkflowOutcome(query, ranking) {
  const exact = ranking.filter((row) => {
    const values = [row.document.workflow_id, ...(row.document.aliases || [])]
      .map(normalizedExact);
    return values.includes(normalizedExact(query));
  });
  if (exact.length === 1) {
    return { outcome: 'selected', selected: [exact[0].document.workflow_id], exact: true };
  }
  if (exact.length > 1) {
    return { outcome: 'ambiguous', selected: [], exact: true };
  }
  const relevant = ranking.filter((row) =>
    row.score >= RETRIEVAL_WORKFLOW_THRESHOLD &&
    (row.dense_score >= RETRIEVAL_DENSE_RELEVANCE ||
      (row.bm25_score > 0 && (
        row.dense_score >= RETRIEVAL_HYBRID_DENSE_RELEVANCE ||
        row.direct_matches.length >= 2
      ))));
  if (!relevant.length) return { outcome: 'new_workflow_required', selected: [], exact: false };
  if (relevant.length === 1) {
    return { outcome: 'selected', selected: [relevant[0].document.workflow_id], exact: false };
  }
  const margin = relevant[0].score - relevant[1].score;
  const conjunction = /\b(and|plus|along with|as well as)\b|[,;&]/i.test(query);
  const independentDirectMatches = relevant.slice(0, 4).filter((row) =>
    row.direct_matches.length || row.bm25_score > 0);
  if (conjunction && independentDirectMatches.length > 1 &&
      margin <= RETRIEVAL_MULTI_MARGIN) {
    return {
      outcome: 'multi_workflow',
      selected: independentDirectMatches.map((row) => row.document.workflow_id),
      exact: false,
    };
  }
  if (margin < RETRIEVAL_AMBIGUITY_MARGIN) {
    return { outcome: 'ambiguous', selected: [], exact: false };
  }
  return { outcome: 'selected', selected: [relevant[0].document.workflow_id], exact: false };
}
