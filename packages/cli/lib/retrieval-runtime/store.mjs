import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Connection, Database, json } from '@ladybugdb/core';
import { graphdLadybugThreads } from '../runtime-budget.mjs';
import {
  RETRIEVAL_AMBIGUITY_MARGIN,
  RETRIEVAL_DENSE_RELEVANCE,
  RETRIEVAL_DIMENSIONS,
  RETRIEVAL_HYBRID_DENSE_RELEVANCE,
  RETRIEVAL_LIMIT,
  RETRIEVAL_MULTI_MARGIN,
  RETRIEVAL_RRF_K,
  RETRIEVAL_SCHEMA,
  RETRIEVAL_SCHEMA_VERSION,
  RETRIEVAL_WORKFLOW_THRESHOLD,
} from './constants.mjs';
import { verifyRetrievalRuntimeAssets } from './assets.mjs';

const dbJson = (value) => json(JSON.stringify(value));
const MANIFEST_RETURN = `m.identity AS identity, m.generation AS generation,
  m.graph_version AS graph_version, m.source_revision AS source_revision,
  m.repository_revision AS repository_revision, m.branch AS branch,
  m.worktree AS worktree, m.model_digest AS model_digest,
  m.index_digest AS index_digest, m.schema_version AS schema_version,
  m.expected_count AS expected_count`;
const ACTIVE_MANIFEST_RETURN = `${MANIFEST_RETURN},
  m.committed_count AS committed_count, m.updated_at AS updated_at`;
const PENDING_MANIFEST_RETURN = `${MANIFEST_RETURN}, m.started_at AS started_at`;

function rows(result) {
  if (Array.isArray(result)) return result.flatMap((item) => item.getAllSync());
  return result.getAllSync();
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalIndexDigest(items) {
  return hash(JSON.stringify(items
    .map((item) => ({
      content_hash: item.content_hash,
      id: item.id,
      logical_key: item.logical_key,
    }))
    .sort((left, right) => left.logical_key.localeCompare(right.logical_key))));
}

function terms(value) {
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
  const queryTerms = [...new Set(terms(query))];
  if (!queryTerms.length || !documents.length) return [];
  const tokenized = documents.map((document) => terms(document.text));
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
    .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id));
}

export function denseRanking(documents, embedding) {
  return documents.map((document) => ({
    document,
    score: cosine(document.embedding, embedding),
  })).sort((left, right) =>
    right.score - left.score || left.document.id.localeCompare(right.document.id));
}

function fuseRankings(documents, query, lexical, dense) {
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
  const queryTerms = new Set(terms(query));
  for (const row of scores.values()) {
    const facets = row.document.metadata?.facets || {};
    const direct = [...new Set(Object.values(facets).flat().flatMap(terms))]
      .filter((term) => queryTerms.has(term));
    row.direct_matches = direct;
    row.score += Math.min(direct.length, 4) * 0.0005;
  }
  return [...scores.values()].sort((left, right) =>
    right.score - left.score || left.document.id.localeCompare(right.document.id));
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

function retrievalFailure(message, details = {}) {
  const error = new Error(message);
  error.code = 'LAMINA_RETRIEVAL_CORRUPT';
  error.details = details;
  return error;
}

export function extensionLoadStatement(file) {
  // Ladybug accepts forward slashes on Windows. Backslashes inside its quoted
  // extension path are parsed as escapes, so normalize before SQL quoting.
  const escaped = String(file).replaceAll('\\', '/').replaceAll("'", "''");
  return `LOAD EXTENSION '${escaped}'`;
}

export class RetrievalStore {
  constructor(paths) {
    this.paths = paths;
    this.database = null;
    this.connection = null;
    this.extensionsLoaded = false;
  }

  ensureOpen() {
    if (this.connection) return;
    fs.mkdirSync(path.dirname(this.paths.retrieval), { recursive: true, mode: 0o700 });
    try {
      this.database = new Database(this.paths.retrieval);
      const ladybugThreads = graphdLadybugThreads();
      this.connection = ladybugThreads
        ? new Connection(this.database, ladybugThreads)
        : new Connection(this.database);
      this.connection.initSync();
      for (const statement of RETRIEVAL_SCHEMA) this.connection.querySync(statement);
    } catch (error) {
      this.close();
      this.recordFailure('retrieval_database_corrupt', error);
      for (const file of [this.paths.retrieval, `${this.paths.retrieval}.wal`]) {
        try { fs.rmSync(file, { recursive: true, force: true }); } catch {}
      }
      this.database = new Database(this.paths.retrieval);
      const ladybugThreads = graphdLadybugThreads();
      this.connection = ladybugThreads
        ? new Connection(this.database, ladybugThreads)
        : new Connection(this.database);
      this.connection.initSync();
      for (const statement of RETRIEVAL_SCHEMA) this.connection.querySync(statement);
    }
  }

  close() {
    try { this.connection?.querySync('CHECKPOINT'); } catch {}
    try { this.connection?.closeSync(); } catch {}
    try { this.database?.closeSync(); } catch {}
    this.connection = null;
    this.database = null;
    this.extensionsLoaded = false;
  }

  query(statement, params = {}) {
    this.ensureOpen();
    const prepared = this.connection.prepareSync(statement);
    if (!prepared.isSuccess()) throw retrievalFailure(prepared.getErrorMessage(), { statement });
    return rows(this.connection.executeSync(prepared, params));
  }

  transaction(work) {
    this.ensureOpen();
    this.connection.querySync('BEGIN TRANSACTION');
    try {
      const result = work();
      this.connection.querySync('COMMIT');
      return result;
    } catch (error) {
      try { this.connection.querySync('ROLLBACK'); } catch {}
      throw error;
    }
  }

  recordFailure(code, error) {
    const value = {
      code,
      message: error?.message || String(error),
      at: new Date().toISOString(),
    };
    try {
      fs.mkdirSync(path.dirname(this.paths.retrieval_failure), { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.paths.retrieval_failure, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    } catch {}
  }

  clearFailure() {
    try { fs.rmSync(this.paths.retrieval_failure, { force: true }); } catch {}
  }

  lastFailure() {
    try { return JSON.parse(fs.readFileSync(this.paths.retrieval_failure, 'utf8')); } catch { return null; }
  }

  ensureExtensions() {
    if (this.extensionsLoaded || process.env.LAMINA_TEST_RETRIEVAL_NO_EXTENSIONS === '1') return;
    const assets = verifyRetrievalRuntimeAssets();
    for (const file of [assets.fts, assets.vector]) {
      this.connection.querySync(extensionLoadStatement(file));
    }
    this.extensionsLoaded = true;
  }

  rebuildNativeIndexes() {
    if (process.env.LAMINA_TEST_RETRIEVAL_NO_EXTENSIONS === '1') return;
    this.ensureExtensions();
    const indexes = this.connection.querySync('CALL SHOW_INDEXES() RETURN *').getAllSync();
    for (const index of indexes) {
      const name = index.index_name;
      if (name === 'retrieval_fts') {
        this.connection.querySync("CALL DROP_FTS_INDEX('RetrievalDocument', 'retrieval_fts')");
      }
      if (name === 'retrieval_vector') {
        this.connection.querySync("CALL DROP_VECTOR_INDEX('RetrievalDocument', 'retrieval_vector')");
      }
    }
    this.connection.querySync(
      "CALL CREATE_FTS_INDEX('RetrievalDocument', 'retrieval_fts', ['text'], stemmer := 'porter')",
    );
    this.connection.querySync(
      "CALL CREATE_VECTOR_INDEX('RetrievalDocument', 'retrieval_vector', 'embedding', metric := 'cosine')",
    );
  }

  nativeHybridRanking(documents, query, embedding, { lexicalOnly = false, retry = true } = {}) {
    if (process.env.LAMINA_TEST_RETRIEVAL_NO_EXTENSIONS === '1') {
      return lexicalOnly
        ? fuseRankings(documents, query, bm25Ranking(documents, query), [])
        : hybridRanking(documents, query, embedding);
    }
    this.ensureExtensions();
    const byId = new Map(documents.map((document) => [document.id, document]));
    const normalizedQuery = [...new Set(terms(query))].join(' ');
    try {
      const lexical = normalizedQuery ? this.query(
        `CALL QUERY_FTS_INDEX(
           'RetrievalDocument', 'retrieval_fts', $query
         )
         RETURN node.id AS id, score
         ORDER BY score DESC, id`,
        { query: normalizedQuery },
      ).filter((item) => byId.has(item.id)).map((item) => {
        const document = byId.get(item.id);
        const documentTerms = new Set(terms(document.text));
        return {
          document,
          score: Number(item.score),
          matched: terms(normalizedQuery).filter((term) => documentTerms.has(term)),
        };
      }) : [];
      let dense = [];
      if (!lexicalOnly && documents.length) {
        const totalDocuments = this.query(
          'MATCH (d:RetrievalDocument) RETURN count(d) AS count',
        )[0]?.count || documents.length;
        dense = this.query(
          `CALL QUERY_VECTOR_INDEX(
             'RetrievalDocument', 'retrieval_vector', $embedding, $limit, efs := 500
           )
           RETURN node.id AS id, distance
           ORDER BY distance, id`,
          { embedding, limit: Number(totalDocuments) },
        ).filter((item) => byId.has(item.id)).map((item) => ({
          document: byId.get(item.id),
          score: 1 - Number(item.distance),
        }));
      }
      return fuseRankings(documents, query, lexical, dense);
    } catch (error) {
      this.recordFailure('retrieval_native_index_corrupt', error);
      if (!retry) throw error;
      this.rebuildNativeIndexes();
      return this.nativeHybridRanking(
        documents,
        query,
        embedding,
        { lexicalOnly, retry: false },
      );
    }
  }

  status(params = {}) {
    this.ensureOpen();
    const identity = params.identity || null;
    const manifest = identity
      ? this.query(
        `MATCH (m:RetrievalManifest {identity: $identity}) RETURN ${ACTIVE_MANIFEST_RETURN}`,
        { identity },
      )[0] || null
      : null;
    const pending = identity
      ? this.query(
        `MATCH (m:RetrievalPending {identity: $identity}) RETURN ${PENDING_MANIFEST_RETURN}`,
        { identity },
      )[0] || null
      : null;
    const fresh = Boolean(manifest) &&
      manifest.graph_version === params.graph_version &&
      manifest.source_revision === params.source_revision &&
      manifest.repository_revision === (params.repository_revision || '') &&
      manifest.branch === params.branch &&
      manifest.worktree === params.worktree &&
      manifest.model_digest === params.model_digest &&
      Number(manifest.schema_version) === RETRIEVAL_SCHEMA_VERSION;
    let documents;
    const documentGeneration = manifest || pending;
    if (params.include_documents && documentGeneration) {
      const members = this.query(
        'MATCH (m:RetrievalMember) WHERE m.identity = $identity AND m.generation = $generation RETURN m.document_id AS id',
        { identity, generation: documentGeneration.generation },
      );
      const wanted = new Set(members.map((item) => item.id));
      documents = Object.fromEntries(this.query(
        'MATCH (d:RetrievalDocument) RETURN d.id AS id, d.logical_key AS logical_key, d.content_hash AS content_hash',
      ).filter((item) => wanted.has(item.id)).map((item) => [
        item.logical_key,
        { id: item.id, content_hash: item.content_hash },
      ]));
    }
    return {
      schema: 'lamina.retrieval-status/v1',
      database: this.paths.retrieval,
      schema_version: RETRIEVAL_SCHEMA_VERSION,
      identity,
      generation: manifest?.generation || null,
      fresh,
      manifest,
      pending,
      counts: manifest ? {
        expected: Number(manifest.expected_count),
        committed: Number(manifest.committed_count),
        workflows: this.activeDocuments(manifest, 'workflow').length,
        source_chunks: this.activeDocuments(manifest, 'source').length,
      } : { expected: 0, committed: 0, workflows: 0, source_chunks: 0 },
      last_failure: this.lastFailure(),
      ...(documents ? { documents } : {}),
    };
  }

  activeDocuments(manifest, kind = null) {
    if (!manifest) return [];
    const members = this.query(
      'MATCH (m:RetrievalMember) WHERE m.identity = $identity AND m.generation = $generation RETURN m.document_id AS id',
      { identity: manifest.identity, generation: manifest.generation },
    );
    const wanted = new Set(members.map((item) => item.id));
    return this.query(
      `MATCH (d:RetrievalDocument) RETURN
       d.id AS id, d.logical_key AS logical_key, d.identity AS identity,
       d.kind AS kind, d.workflow_id AS workflow_id, d.aliases AS aliases,
       d.text AS text, d.path AS path, d.symbol AS symbol,
       d.start_line AS start_line, d.end_line AS end_line,
       d.embedding AS embedding, d.content_hash AS content_hash, d.metadata AS metadata`,
    ).filter((item) => wanted.has(item.id) && (!kind || item.kind === kind));
  }

  apply(params = {}) {
    const {
      identity,
      generation,
      manifest,
      reset = false,
      upserts = [],
      members = [],
      deletes = [],
      complete = false,
    } = params;
    if (!identity || !generation || manifest?.identity !== identity || manifest?.generation !== generation) {
      throw retrievalFailure('Retrieval apply requires one bound identity and generation.');
    }
    if (Number(manifest.schema_version) !== RETRIEVAL_SCHEMA_VERSION) {
      throw retrievalFailure('Retrieval schema version mismatch.', {
        expected: RETRIEVAL_SCHEMA_VERSION,
        actual: manifest.schema_version,
      });
    }
    if (!Array.isArray(deletes) || deletes.some((item) => typeof item !== 'string' || !item)) {
      throw retrievalFailure('Retrieval deletion keys are malformed.');
    }
    this.ensureOpen();
    this.transaction(() => {
      if (reset) {
        const previous = this.query(
          'MATCH (p:RetrievalPending {identity: $identity}) RETURN p.generation AS generation',
          { identity },
        )[0];
        if (previous) {
          this.query(
            'MATCH (m:RetrievalMember) WHERE m.identity = $identity AND m.generation = $generation DELETE m',
            { identity, generation: previous.generation },
          );
        }
        this.query('MATCH (p:RetrievalPending {identity: $identity}) DELETE p', { identity });
        this.query(
          `CREATE (p:RetrievalPending {
            identity: $identity, generation: $generation, graph_version: $graph_version,
            source_revision: $source_revision, repository_revision: $repository_revision,
            branch: $branch, worktree: $worktree, model_digest: $model_digest,
            index_digest: $index_digest, schema_version: $schema_version,
            expected_count: $expected_count, started_at: $started_at
          })`,
          {
            ...manifest,
            repository_revision: manifest.repository_revision || '',
            started_at: new Date().toISOString(),
          },
        );
      }
      const pending = this.query(
        `MATCH (m:RetrievalPending {identity: $identity}) RETURN ${PENDING_MANIFEST_RETURN}`,
        { identity },
      )[0];
      if (!pending || pending.generation !== generation ||
          pending.graph_version !== manifest.graph_version ||
          pending.source_revision !== manifest.source_revision ||
          pending.model_digest !== manifest.model_digest) {
        throw retrievalFailure('Retrieval batch does not match the pending generation.');
      }
      for (const item of upserts) {
        if (!item.id || !item.logical_key || !item.content_hash ||
            !Array.isArray(item.embedding) || item.embedding.length !== RETRIEVAL_DIMENSIONS ||
            item.embedding.some((value) => !Number.isFinite(value))) {
          throw retrievalFailure('Retrieval document is malformed.', { id: item.id || null });
        }
        const existing = this.query(
          'MATCH (d:RetrievalDocument {id: $id}) RETURN d.content_hash AS content_hash',
          { id: item.id },
        )[0];
        if (existing) {
          if (existing.content_hash !== item.content_hash) {
            throw retrievalFailure('Retrieval document id collided with different content.', { id: item.id });
          }
          continue;
        }
        this.query(
          `CREATE (d:RetrievalDocument {
            id: $id, logical_key: $logical_key, identity: $identity, kind: $kind,
            workflow_id: $workflow_id, aliases: $aliases, text: $text, path: $path,
            symbol: $symbol, start_line: $start_line, end_line: $end_line,
            embedding: $embedding, content_hash: $content_hash, metadata: $metadata
          })`,
          {
            ...item,
            workflow_id: item.workflow_id || '',
            aliases: item.aliases || [],
            path: item.path || '',
            symbol: item.symbol || '',
            start_line: Number(item.start_line || 0),
            end_line: Number(item.end_line || 0),
            metadata: dbJson(item.metadata || {}),
          },
        );
      }
      for (const documentId of members) {
        const document = this.query(
          'MATCH (d:RetrievalDocument {id: $id}) RETURN d.id AS id',
          { id: documentId },
        )[0];
        if (!document) throw retrievalFailure('Retrieval membership references a missing document.', {
          document_id: documentId,
        });
        const memberId = hash(`${identity}\0${generation}\0${documentId}`);
        if (!this.query('MATCH (m:RetrievalMember {id: $id}) RETURN m.id AS id', { id: memberId })[0]) {
          this.query(
            'CREATE (m:RetrievalMember {id: $id, identity: $identity, generation: $generation, document_id: $document_id})',
            { id: memberId, identity, generation, document_id: documentId },
          );
        }
      }
    });
    if (!complete) return { identity, generation, committed: false };

    const pending = this.query(
      `MATCH (m:RetrievalPending {identity: $identity}) RETURN ${PENDING_MANIFEST_RETURN}`,
      { identity },
    )[0];
    const memberRows = this.query(
      'MATCH (m:RetrievalMember) WHERE m.identity = $identity AND m.generation = $generation RETURN m.document_id AS id',
      { identity, generation },
    );
    const wanted = new Set(memberRows.map((item) => item.id));
    const documents = this.query(
      'MATCH (d:RetrievalDocument) RETURN d.id AS id, d.logical_key AS logical_key, d.content_hash AS content_hash',
    ).filter((item) => wanted.has(item.id));
    if (memberRows.length !== Number(pending.expected_count) || documents.length !== memberRows.length) {
      throw retrievalFailure('Retrieval generation item count is incomplete; it was not activated.', {
        expected_count: Number(pending.expected_count),
        committed_count: documents.length,
      });
    }
    const actualDigest = canonicalIndexDigest(documents);
    if (actualDigest !== pending.index_digest) {
      throw retrievalFailure('Retrieval generation digest is invalid; it was not activated.', {
        expected_digest: pending.index_digest,
        actual_digest: actualDigest,
      });
    }
    try {
      this.rebuildNativeIndexes();
      this.transaction(() => {
        this.query('MATCH (m:RetrievalManifest {identity: $identity}) DELETE m', { identity });
        this.query(
          `CREATE (m:RetrievalManifest {
            identity: $identity, generation: $generation, graph_version: $graph_version,
            source_revision: $source_revision, repository_revision: $repository_revision,
            branch: $branch, worktree: $worktree, model_digest: $model_digest,
            index_digest: $index_digest, schema_version: $schema_version,
            expected_count: $expected_count, committed_count: $committed_count,
            updated_at: $updated_at
          })`,
          {
            ...pending,
            committed_count: documents.length,
            updated_at: new Date().toISOString(),
          },
        );
        this.query('MATCH (p:RetrievalPending {identity: $identity}) DELETE p', { identity });
        const obsoleteMembers = this.query(
          `MATCH (m:RetrievalMember)
           WHERE m.identity = $identity AND m.generation <> $generation
           RETURN m.id AS id`,
          { identity, generation },
        );
        for (const member of obsoleteMembers) {
          this.query('MATCH (m:RetrievalMember {id: $id}) DELETE m', { id: member.id });
        }
        const referenced = new Set(this.query(
          'MATCH (m:RetrievalMember) RETURN m.document_id AS id',
        ).map((item) => item.id));
        const orphaned = this.query(
          'MATCH (d:RetrievalDocument) RETURN d.id AS id',
        ).filter((item) => !referenced.has(item.id));
        for (const document of orphaned) {
          this.query('MATCH (d:RetrievalDocument {id: $id}) DELETE d', { id: document.id });
        }
      });
      this.connection.querySync('CHECKPOINT');
      this.clearFailure();
    } catch (error) {
      this.recordFailure('retrieval_activation_failed', error);
      throw error;
    }
    return {
      identity,
      generation,
      committed: true,
      expected_count: Number(pending.expected_count),
      committed_count: documents.length,
      index_digest: actualDigest,
    };
  }

  retrievalQuery(params = {}) {
    const status = this.status(params);
    if (!status.fresh) {
      const error = new Error('The retrieval index is stale. Run lamina work prepare or lamina context rebuild.');
      error.code = 'LAMINA_RETRIEVAL_STALE';
      error.details = status;
      throw error;
    }
    if (!Array.isArray(params.embedding) || params.embedding.length !== RETRIEVAL_DIMENSIONS) {
      throw retrievalFailure('Retrieval query embedding is missing or malformed.');
    }
    this.ensureExtensions();
    const workflowDocuments = this.activeDocuments(status.manifest, 'workflow');
    const sourceDocuments = this.activeDocuments(status.manifest, 'source');
    const lexicalOnly = params.degradation === 'lexical_degraded';
    const workflowRanking = this.nativeHybridRanking(
      workflowDocuments,
      params.query,
      params.embedding,
      { lexicalOnly },
    );
    const selection = classifyWorkflowOutcome(params.query, workflowRanking);
    const sourceRanking = this.nativeHybridRanking(
      sourceDocuments,
      params.query,
      params.embedding,
      { lexicalOnly },
    );
    const workflowCandidates = workflowRanking.slice(0, RETRIEVAL_LIMIT).map((row) => ({
      workflow_id: row.document.workflow_id,
      score: Number(row.score.toFixed(8)),
      bm25_score: Number(row.bm25_score.toFixed(8)),
      dense_score: Number(row.dense_score.toFixed(8)),
      reasons: [
        ...(row.matched_terms.length ? [`BM25 terms: ${row.matched_terms.join(', ')}`] : []),
        `dense similarity: ${row.dense_score.toFixed(4)}`,
        ...(row.direct_matches.length ? [`direct graph facets: ${row.direct_matches.join(', ')}`] : []),
      ],
    }));
    const seenSymbols = new Set();
    const sourceChunks = [];
    for (const row of sourceRanking) {
      const key = `${row.document.path}:${row.document.symbol}`;
      if (seenSymbols.has(key)) continue;
      seenSymbols.add(key);
      sourceChunks.push({
        file: row.document.path,
        symbol: row.document.symbol || null,
        start_line: Number(row.document.start_line),
        end_line: Number(row.document.end_line),
        score: Number(row.score.toFixed(8)),
        reasons: [
          ...(row.matched_terms.length ? [`BM25 terms: ${row.matched_terms.join(', ')}`] : []),
          `dense similarity: ${row.dense_score.toFixed(4)}`,
        ],
        content_hash: row.document.content_hash,
      });
      if (sourceChunks.length >= RETRIEVAL_LIMIT) break;
    }
    return {
      schema: 'lamina.retrieval-query/v1',
      generation: status.generation,
      freshness: 'fresh',
      model_digest: status.manifest.model_digest,
      index_digest: status.manifest.index_digest,
      candidates: workflowCandidates,
      outcome: selection.outcome,
      selected_workflow_ids: selection.selected,
      exact_match: selection.exact,
      source_chunks: sourceChunks,
      degradation: params.degradation || null,
    };
  }

  invalidate(params = {}) {
    this.ensureOpen();
    const identity = params.identity;
    if (identity) {
      const generations = [
        ...this.query('MATCH (m:RetrievalManifest {identity: $identity}) RETURN m.generation AS generation', { identity }),
        ...this.query('MATCH (m:RetrievalPending {identity: $identity}) RETURN m.generation AS generation', { identity }),
      ].map((item) => item.generation);
      this.transaction(() => {
        for (const generation of generations) {
          this.query(
            'MATCH (m:RetrievalMember) WHERE m.identity = $identity AND m.generation = $generation DELETE m',
            { identity, generation },
          );
        }
        this.query('MATCH (m:RetrievalManifest {identity: $identity}) DELETE m', { identity });
        this.query('MATCH (m:RetrievalPending {identity: $identity}) DELETE m', { identity });
      });
      this.connection.querySync('CHECKPOINT');
      return { invalidated: true, identity };
    }
    this.close();
    for (const file of [this.paths.retrieval, `${this.paths.retrieval}.wal`]) {
      fs.rmSync(file, { recursive: true, force: true });
    }
    this.clearFailure();
    return { invalidated: true, identity: null };
  }
}
