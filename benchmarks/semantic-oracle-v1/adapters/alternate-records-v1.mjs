import {
  ADAPTER_SCHEMA,
  RESULT_SCHEMA,
  semanticDigest,
  sortSemantic,
} from '../contract.mjs';

export const ALTERNATE_RECORDS_ADAPTER = Object.freeze({
  schema: ADAPTER_SCHEMA,
  id: 'alternate-records-example',
  version: '1',
  input_format: 'example.alternate-semantic-records/v1',
});

export function adaptAlternateRecords(raw) {
  if (raw?.format !== ALTERNATE_RECORDS_ADAPTER.input_format) {
    throw new Error(`alternate records adapter requires ${ALTERNATE_RECORDS_ADAPTER.input_format}`);
  }
  const semantic = sortSemantic({
    resources: raw.nodes,
    relations: raw.edges,
    graph_versions: raw.commits,
    branches: raw.refs,
    contradictions: raw.conflicts,
    obligations: raw.duties,
    publication_attempts: raw.transactions,
    derived_state: raw.projections,
  });
  return {
    schema: RESULT_SCHEMA,
    fixture_id: raw.case,
    adapter: ALTERNATE_RECORDS_ADAPTER,
    semantic,
    semantic_digest: semanticDigest(semantic),
  };
}
