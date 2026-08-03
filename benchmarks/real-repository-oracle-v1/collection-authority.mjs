import { pinnedCollectionForTier } from './collection-pins.mjs';
import { loadInventoryReviewReceipt } from './inventory-review-receipt.mjs';

export {
  BASELINE_MANIFEST_SHA256, CANDIDATE_POLICY_SHA256, COLLECTION_PINS,
  pinnedCollectionForTier, reviewedManifestDigest,
} from './collection-pins.mjs';

// These names deliberately match the raw runtime-baseline report rather than
// inventing new oracle semantics. Small was reviewed in #60; medium and large
// are literal values manually frozen from the independent #61 A/B review.
export const REVIEWED_INVENTORIES = Object.freeze({
  small: Object.freeze({
    tracked_files: 535,
    tracked_bytes: 2_640_087,
    tracked_source_files: 438,
    tracked_source_bytes: 628_504,
    tracked_source_loc: 20_450,
    observation_indexed_files: 535,
    observation_indexed_bytes: 2_640_087,
    observation_paths_digest: 'a751c5ae498aad42ec231daf714f8bede3e76f1d6f083ccbe3b6097f666b07cc',
    retrieval_candidate_files: 467,
    retrieval_candidate_bytes: 693_785,
    retrieval_paths_digest: '8915cb111c9232dd2645d5b470e95fcfddc8a2293f4cc6881a9727c52864d52b',
  }),
  medium: Object.freeze({
    tracked_files: 2_539,
    tracked_bytes: 15_972_213,
    tracked_source_files: 2_324,
    tracked_source_bytes: 8_584_027,
    tracked_source_loc: 268_625,
    observation_indexed_files: 2_539,
    observation_indexed_bytes: 15_972_213,
    observation_paths_digest: 'a54821d081c82acea3bce42c769f6c39f3d388c330e432436bda7e80977e3b5c',
    retrieval_candidate_files: 2_420,
    retrieval_candidate_bytes: 12_914_792,
    retrieval_paths_digest: '3ba81ce78f10ff50ec4d652ebed8ef18a9e2624b3434f7a125e3a3f133ec1d7e',
  }),
  large: Object.freeze({
    tracked_files: 5_405,
    tracked_bytes: 55_779_821,
    tracked_source_files: 4_184,
    tracked_source_bytes: 14_824_422,
    tracked_source_loc: 373_748,
    observation_indexed_files: 5_399,
    observation_indexed_bytes: 55_696_352,
    observation_paths_digest: '90fef3b430dee05642af40a636590a97fc0bbf405f37040def570ba7832a1652',
    retrieval_candidate_files: 4_805,
    retrieval_candidate_bytes: 21_278_398,
    retrieval_paths_digest: 'de46b1ebd6495065f95d8afd365be2195f4518ed5f2e57f4d38881c9f29f3ebc',
  }),
});

export const INVENTORY_REVIEW_RECEIPT = loadInventoryReviewReceipt(REVIEWED_INVENTORIES);

export function reviewedCollectionForTier(tier) {
  const collection = pinnedCollectionForTier(tier);
  const reviewedInventory = REVIEWED_INVENTORIES[tier];
  if (!reviewedInventory) {
    throw new Error(
      `real-repository ${tier} inventory lacks completed manual review authority`,
    );
  }
  return Object.freeze({ ...collection, reviewed_inventory: reviewedInventory });
}
