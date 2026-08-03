const ISSUED_SUPERVISOR_CLEANUP_PROOFS = new WeakSet();
const SUPERVISOR_CLEANUP_RECEIPTS = new WeakMap();

// Issue #59 will add the supervisor-owned physical deletion integration that
// can populate these private stores. Until then there is deliberately no
// issuance, admission, registration, signing, or synthetic test path.
export function verifyIssuedSupervisorCleanupProof(proof) {
  const receipt = proof && ISSUED_SUPERVISOR_CLEANUP_PROOFS.has(proof)
    ? SUPERVISOR_CLEANUP_RECEIPTS.get(proof) : null;
  if (!receipt) {
    throw new Error('supervisor cleanup proof is unavailable pending issue #59 integration');
  }
  return true;
}
