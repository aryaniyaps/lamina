import { loadCaseExpectationReview } from './case-expectation-review-receipt.mjs';

export const FIXTURE_AUTHORITY_BOUNDARY = Object.freeze({
  visibility: 'private_controller_only',
  candidate_closure: 'pending_not_implemented_or_reachable',
  candidate_supplied_fixture_or_grade_trusted: false,
  persona_positive_capability_gate: 'excepted_pending_unimplemented_candidate_facing_sealed_probe',
  quality_pass: 'structurally_unreachable_pending_candidate_isolation_and_host_grading',
});

export function loadReviewedFixture() {
  const receipt = loadCaseExpectationReview();
  return Object.freeze({
    fixture: structuredClone(receipt.fixture),
    fixture_digest: receipt.fixture_digest,
    authority: receipt.authority,
  });
}
