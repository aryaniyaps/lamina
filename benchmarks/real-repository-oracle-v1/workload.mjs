#!/usr/bin/env node
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

export const WORKLOAD_ID = 'real-repository-oracle-v1:inventory-admission';
export const EXACT_COMMAND = Object.freeze(['admit-inventory']);
export const INVENTORY_ADMISSION_SCHEMA = 'lamina.real-repository-oracle-inventory-admission/v1';
export const RECONSTRUCTION_WORKLOAD_ID = 'real-repository-oracle-v1:inventory-reconstruction';
export const RECONSTRUCTION_EXACT_COMMAND = Object.freeze(['reconstruct-inventory']);
export const INVENTORY_RECONSTRUCTION_SCHEMA = 'lamina.real-repository-oracle-inventory-reconstruction/v1';
export const REVIEW_WORKLOAD_ID = 'real-repository-oracle-v1:inventory-review';
export const REVIEW_EXACT_COMMAND = Object.freeze(['review-inventory']);
export const INVENTORY_REVIEW_SCHEMA = 'lamina.real-repository-oracle-inventory-review/v1';
export const DISCOVERY_WORKLOAD_ID = 'real-repository-oracle-v1:case-discovery';
export const DISCOVERY_EXACT_COMMAND = Object.freeze(['discover-cases']);
export const EVIDENCE_EXPANSION_WORKLOAD_ID = 'real-repository-oracle-v1:evidence-expansion';
export const EVIDENCE_EXPANSION_EXACT_COMMAND = Object.freeze(['expand-evidence']);
export const SCENARIO_VERIFICATION_WORKLOAD_ID = 'real-repository-oracle-v1:scenario-verification';
export const SCENARIO_VERIFICATION_EXACT_COMMAND = Object.freeze(['verify-scenarios']);
export const ORACLE_HOST_PROBE_WORKLOAD_ID = 'real-repository-oracle-v1:oracle-host-probe';
export const ORACLE_HOST_PROBE_EXACT_COMMAND = Object.freeze(['probe-oracle-host']);

const NO_QUALITY_CLAIMS = Object.freeze({
  workflow_selection: false,
  observation: false,
  obligations: false,
  source_localization: false,
  retrieval_ranking: false,
  end_to_end_runtime: false,
});

export async function writeStdoutLine(value, stdout = process.stdout) {
  if (!stdout.write(`${value}\n`)) await once(stdout, 'drain');
}

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
    limitation: 'This admission proves only exact pinned materialization and equality with an independently reviewed inventory. It is not routed through the oracle grade controller and makes no retrieval or product-quality claim.',
  });
}

export function inventoryReconstructionResult({
  collection, inventory, candidate_inventory_sha256: candidateInventorySha256,
  portable_link_resolution: portableLinkResolution, bounds,
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
    portable_link_resolution: portableLinkResolution,
    evidence_mode: 'unreviewed_inventory_reconstruction_only',
    quality_claims: NO_QUALITY_CLAIMS,
    grade_controller_evidence: false,
    limitation: 'This bounded output is an unreviewed inventory reconstruction candidate only. It does not admit a collection, is not grade-controller evidence, and makes no retrieval or product-quality claim.',
  });
}

export function inventoryReviewResult({
  collection, inventory, review_inventory_sha256: reviewInventorySha256,
  object_link_resolution: objectLinkResolution, git_object_identity: gitObjectIdentity, bounds,
}) {
  return Object.freeze({
    schema: INVENTORY_REVIEW_SCHEMA,
    workload_id: REVIEW_WORKLOAD_ID,
    status: 'independent_unreviewed_inventory_review',
    admission: 'not_performed',
    collection: collectionIdentity(collection),
    bounds,
    inventory,
    review_inventory_sha256: reviewInventorySha256,
    git_object_identity: gitObjectIdentity,
    object_link_resolution: objectLinkResolution,
    evidence_mode: 'independent_git_object_inventory_review_only',
    quality_claims: NO_QUALITY_CLAIMS,
    grade_controller_evidence: false,
    limitation: 'This independent bounded Git-object review does not freeze reviewed inventory, admit a collection, or make retrieval or product-quality claims. Reviewer sign-off and a later authority change are separate actions.',
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (JSON.stringify(argv) === JSON.stringify(EXACT_COMMAND)) {
    const { inspectSignedTier } = await import('./materialize.mjs');
    const { collection, inventory } = inspectSignedTier();
    process.stdout.write(`${JSON.stringify(inventoryAdmissionResult(collection, inventory))}\n`);
    return;
  }
  if (JSON.stringify(argv) === JSON.stringify(RECONSTRUCTION_EXACT_COMMAND)) {
    const { reconstructSignedTier } = await import('./materialize.mjs');
    process.stdout.write(`${JSON.stringify(inventoryReconstructionResult(reconstructSignedTier()))}\n`);
    return;
  }
  if (JSON.stringify(argv) === JSON.stringify(REVIEW_EXACT_COMMAND)) {
    const { reviewSignedTier } = await import('./inventory-review.mjs');
    process.stdout.write(`${JSON.stringify(inventoryReviewResult(reviewSignedTier()))}\n`);
    return;
  }
  if (JSON.stringify(argv) === JSON.stringify(DISCOVERY_EXACT_COMMAND)) {
    const { discoverSignedTier, encodeDiscoveryPayload } = await import('./case-discovery.mjs');
    await writeStdoutLine(encodeDiscoveryPayload(discoverSignedTier()).line);
    return;
  }
  if (JSON.stringify(argv) === JSON.stringify(EVIDENCE_EXPANSION_EXACT_COMMAND)) {
    const { expandSignedTier, encodeEvidenceExpansionPayload } = await import('./case-evidence.mjs');
    process.stdout.write(`${encodeEvidenceExpansionPayload(expandSignedTier())}\n`);
    return;
  }
  if (JSON.stringify(argv) === JSON.stringify(SCENARIO_VERIFICATION_EXACT_COMMAND)) {
    const {
      encodeScenarioVerificationPayload, verifySelectedScenarios,
    } = await import('./scenario-verification.mjs');
    await writeStdoutLine(encodeScenarioVerificationPayload(verifySelectedScenarios()));
    return;
  }
  if (JSON.stringify(argv) === JSON.stringify(ORACLE_HOST_PROBE_EXACT_COMMAND)) {
    throw new Error('oracle-host probe is a safe-runner launch profile and cannot execute directly');
  }
  throw new Error('usage: workload.mjs <admit-inventory|reconstruct-inventory|review-inventory|discover-cases|expand-evidence|verify-scenarios|probe-oracle-host>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
