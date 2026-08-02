import { pinnedCollectionForTier } from './collection-pins.mjs';

export {
  BASELINE_MANIFEST_SHA256, CANDIDATE_POLICY_SHA256, COLLECTION_PINS,
  pinnedCollectionForTier, reviewedManifestDigest,
} from './collection-pins.mjs';

// #60 durably reviewed only the small collection. The names here deliberately
// match the raw runtime-baseline report rather than inventing oracle semantics.
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
  medium: null,
  large: null,
});

export function reviewedCollectionForTier(tier) {
  const collection = pinnedCollectionForTier(tier);
  const reviewedInventory = REVIEWED_INVENTORIES[tier];
  if (!reviewedInventory) {
    throw new Error(
      `real-repository ${tier} inventory is temporarily unreviewed; #61 must reconstruct and independently review it before network materialization`,
    );
  }
  return Object.freeze({ ...collection, reviewed_inventory: reviewedInventory });
}
