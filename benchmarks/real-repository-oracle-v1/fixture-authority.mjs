import { loadCaseExpectationReview } from './case-expectation-review-receipt.mjs';

export const FIXTURE_AUTHORITY_BOUNDARY = Object.freeze({
  visibility: 'private_controller_only',
  candidate_closure: 'public_batch_and_single_run_raw_exclude_private_fixture_expectation_scenario_and_grade_authority',
  candidate_supplied_fixture_or_grade_trusted: false,
  persona_positive_capability_gate: 'host_recomputed_fixed_probe_contract_pending_isolated_candidate_execution',
  quality_pass: 'oracle_validation_host_reconstruction_reachable_without_measured_runtime_or_safety_claims',
});

export function loadReviewedFixture() {
  const receipt = loadCaseExpectationReview();
  return Object.freeze({
    fixture: structuredClone(receipt.fixture),
    fixture_digest: receipt.fixture_digest,
    authority: receipt.authority,
  });
}
