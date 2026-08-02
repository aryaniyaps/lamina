#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { inspectSignedTier } from './materialize.mjs';

export const WORKLOAD_ID = 'real-repository-oracle-v1:inventory-admission';
export const EXACT_COMMAND = Object.freeze(['admit-inventory']);
export const INVENTORY_ADMISSION_SCHEMA = 'lamina.real-repository-oracle-inventory-admission/v1';

export function inventoryAdmissionResult(collection, inventory) {
  return Object.freeze({
    schema: INVENTORY_ADMISSION_SCHEMA,
    workload_id: WORKLOAD_ID,
    admission: 'pass',
    collection: Object.freeze({
      fixture_id: collection.fixture_id,
      fixture_class: collection.fixture_class,
      repository_url: collection.repository_url,
      commit: collection.commit,
      tree_oid: collection.tree_oid,
      baseline_manifest_sha256: collection.baseline_manifest_sha256,
      candidate_policy_sha256: collection.candidate_policy_sha256,
    }),
    inventory,
    evidence_mode: 'reviewed_collection_inventory_admission_only',
    quality_claims: Object.freeze({
      workflow_selection: false,
      observation: false,
      obligations: false,
      source_localization: false,
      retrieval_ranking: false,
      end_to_end_runtime: false,
    }),
    limitation: 'This admission proves only exact pinned materialization and equality with an independently reviewed inventory. It is not routed through the oracle grade controller and makes no retrieval or product-quality claim. Medium and large remain temporarily refused until #61 reconstructs and independently reviews their inventories.',
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (JSON.stringify(argv) !== JSON.stringify(EXACT_COMMAND)) {
    throw new Error('usage: workload.mjs admit-inventory');
  }
  const { collection, inventory } = inspectSignedTier();
  process.stdout.write(`${JSON.stringify(inventoryAdmissionResult(collection, inventory))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
