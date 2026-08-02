#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { inspectSignedTier, reconstructSignedTier } from './materialize.mjs';

export const WORKLOAD_ID = 'real-repository-oracle-v1:inventory-admission';
export const EXACT_COMMAND = Object.freeze(['admit-inventory']);
export const INVENTORY_ADMISSION_SCHEMA = 'lamina.real-repository-oracle-inventory-admission/v1';
export const RECONSTRUCTION_WORKLOAD_ID = 'real-repository-oracle-v1:inventory-reconstruction';
export const RECONSTRUCTION_EXACT_COMMAND = Object.freeze(['reconstruct-inventory']);
export const INVENTORY_RECONSTRUCTION_SCHEMA = 'lamina.real-repository-oracle-inventory-reconstruction/v1';

const NO_QUALITY_CLAIMS = Object.freeze({
  workflow_selection: false,
  observation: false,
  obligations: false,
  source_localization: false,
  retrieval_ranking: false,
  end_to_end_runtime: false,
});

function collectionIdentity(collection) {
  return Object.freeze({
    fixture_id: collection.fixture_id,
    fixture_class: collection.fixture_class,
    repository_url: collection.repository_url,
    commit: collection.commit,
    tree_oid: collection.tree_oid,
    baseline_manifest_sha256: collection.baseline_manifest_sha256,
    candidate_policy_sha256: collection.candidate_policy_sha256,
  });
}

export function inventoryAdmissionResult(collection, inventory) {
  return Object.freeze({
    schema: INVENTORY_ADMISSION_SCHEMA,
    workload_id: WORKLOAD_ID,
    admission: 'pass',
    collection: collectionIdentity(collection),
    inventory,
    evidence_mode: 'reviewed_collection_inventory_admission_only',
    quality_claims: NO_QUALITY_CLAIMS,
    limitation: 'This admission proves only exact pinned materialization and equality with an independently reviewed inventory. It is not routed through the oracle grade controller and makes no retrieval or product-quality claim. Medium and large remain temporarily refused until #61 reconstructs and independently reviews their inventories.',
  });
}

export function inventoryReconstructionResult({
  collection, inventory, candidate_inventory_sha256: candidateInventorySha256, bounds,
}) {
  return Object.freeze({
    schema: INVENTORY_RECONSTRUCTION_SCHEMA,
    workload_id: RECONSTRUCTION_WORKLOAD_ID,
    status: 'unreviewed_reconstruction_candidate',
    admission: 'not_performed',
    collection: collectionIdentity(collection),
    bounds,
    inventory,
    candidate_inventory_sha256: candidateInventorySha256,
    evidence_mode: 'unreviewed_inventory_reconstruction_only',
    quality_claims: NO_QUALITY_CLAIMS,
    grade_controller_evidence: false,
    limitation: 'This bounded output is an unreviewed inventory reconstruction candidate only. It does not admit a collection, is not grade-controller evidence, and makes no retrieval or product-quality claim.',
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (JSON.stringify(argv) === JSON.stringify(EXACT_COMMAND)) {
    const { collection, inventory } = inspectSignedTier();
    process.stdout.write(`${JSON.stringify(inventoryAdmissionResult(collection, inventory))}\n`);
    return;
  }
  if (JSON.stringify(argv) === JSON.stringify(RECONSTRUCTION_EXACT_COMMAND)) {
    process.stdout.write(`${JSON.stringify(inventoryReconstructionResult(reconstructSignedTier()))}\n`);
    return;
  }
  throw new Error('usage: workload.mjs <admit-inventory|reconstruct-inventory>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
