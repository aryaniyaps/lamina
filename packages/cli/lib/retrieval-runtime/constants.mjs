export const RETRIEVAL_SCHEMA_VERSION = 1;
export const RETRIEVAL_DIMENSIONS = 768;
export const RETRIEVAL_RRF_K = 60;
export const RETRIEVAL_LIMIT = 12;
export const RETRIEVAL_WORKFLOW_THRESHOLD = 0.016;
export const RETRIEVAL_DENSE_RELEVANCE = 0.50;
export const RETRIEVAL_HYBRID_DENSE_RELEVANCE = 0.30;
export const RETRIEVAL_AMBIGUITY_MARGIN = 0.0015;
export const RETRIEVAL_MULTI_MARGIN = 0.003;

export const RETRIEVAL_SCHEMA = Object.freeze([
  `CREATE NODE TABLE IF NOT EXISTS RetrievalDocument(
    id STRING PRIMARY KEY,
    logical_key STRING,
    identity STRING,
    kind STRING,
    workflow_id STRING,
    aliases STRING[],
    text STRING,
    path STRING,
    symbol STRING,
    start_line INT64,
    end_line INT64,
    embedding FLOAT[${RETRIEVAL_DIMENSIONS}],
    content_hash STRING,
    metadata JSON
  )`,
  `CREATE NODE TABLE IF NOT EXISTS RetrievalManifest(
    identity STRING PRIMARY KEY,
    generation STRING,
    graph_version STRING,
    source_revision STRING,
    repository_revision STRING,
    branch STRING,
    worktree STRING,
    model_digest STRING,
    index_digest STRING,
    schema_version INT64,
    expected_count INT64,
    committed_count INT64,
    updated_at STRING
  )`,
  `CREATE NODE TABLE IF NOT EXISTS RetrievalPending(
    identity STRING PRIMARY KEY,
    generation STRING,
    graph_version STRING,
    source_revision STRING,
    repository_revision STRING,
    branch STRING,
    worktree STRING,
    model_digest STRING,
    index_digest STRING,
    schema_version INT64,
    expected_count INT64,
    started_at STRING
  )`,
  `CREATE NODE TABLE IF NOT EXISTS RetrievalMember(
    id STRING PRIMARY KEY,
    identity STRING,
    generation STRING,
    document_id STRING
  )`,
]);
