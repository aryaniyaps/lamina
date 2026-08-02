const verified = new WeakSet();
export function registerVerifierAttestation(attestation) {
  verified.add(attestation);
  return attestation;
}
export function isVerifierAttestation(attestation) { return verified.has(attestation); }
