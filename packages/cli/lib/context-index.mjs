import path from 'node:path';
import { repositoryContext } from './graph-runtime/util.mjs';
import { retrievalModelManifest } from './retrieval-runtime/assets.mjs';
import { RETRIEVAL_SCHEMA_VERSION } from './retrieval-runtime/constants.mjs';

export function contextCatalog(cwd = process.cwd()) {
  const repo = repositoryContext(cwd);
  return {
    schema: 'lamina.context-catalog/v2',
    source_revision: repo.source_revision,
    authority: {
      graph: 'exact_graph_closure',
      provenance: 'direct_supportedBy_edges',
      source_localization: 'derived_non_authoritative_index',
    },
    retrieval: {
      order: ['exact_identifier_or_alias', 'bm25', 'dense_vector', 'reciprocal_rank_fusion', 'exact_graph_closure'],
      lexical: { engine: 'ladybug_fts_bm25', availability: 'checksum_managed' },
      dense: {
        engine: 'ladybug_vector_cosine',
        model: retrievalModelManifest().model_id,
        model_revision: retrievalModelManifest().revision,
        model_digest: retrievalModelManifest().sha256,
        availability: 'checksum_managed',
        fallback: 'fail_closed_for_automatic_workflow_selection',
        authoritative: false,
      },
      fusion: { algorithm: 'reciprocal_rank_fusion', k: 60 },
      schema_version: RETRIEVAL_SCHEMA_VERSION,
    },
    storage: path.join(repo.runtime_dir, 'context', 'retrieval.lbdb'),
    privacy: 'repository_local_git_common_dir',
  };
}
