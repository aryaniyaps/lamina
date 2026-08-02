#!/usr/bin/env node
import assert from 'node:assert/strict';
import { retrievalFixture } from '../benchmarks/retrieval-v1/fixtures.mjs';
import { heldOutIdentity } from '../benchmarks/real-repository-oracle-v1/held-out-compatibility.mjs';
import {
  FROZEN_GATES, OBSERVATION_CATEGORIES, QUALIFIED_CURRENT_BASELINE,
} from '../benchmarks/real-repository-oracle-v1/contract.mjs';

assert.deepEqual(heldOutIdentity(retrievalFixture()), {
  workflow_rows: 160,
  workflow_rows_bytes: 16928,
  workflow_rows_sha256: '536c7459bb3457ca01b1a5444964bb5cc1d3cea8d7fc3ff5c1c84190f26c9027',
  source_rows: 80,
  source_rows_bytes: 11806,
  source_rows_sha256: '080df00ccec46bf06a7b9336c1defd270a312005e872b1e64f29437e08709f99',
});
assert.deepEqual(FROZEN_GATES, {
  exact_id_alias_accuracy: 1,
  complete_multi_workflow_selection: 0.95,
  incorrect_new_workflow_attachment: 0.02,
  workflow_recall_at_5: 0.99,
  source_recall_at_10: 0.9275,
});
assert.deepEqual(QUALIFIED_CURRENT_BASELINE, {
  workflow_recall_at_5: 1,
  source_recall_at_10: 0.9375,
});
assert.deepEqual(OBSERVATION_CATEGORIES, [
  'entry_points', 'commands', 'routes', 'handlers', 'schemas', 'entities',
  'state_transitions', 'permissions', 'events', 'tests', 'documentation',
  'personas', 'feature_flags', 'dependencies',
]);

console.log('real repository oracle held-out compatibility contracts passed');
