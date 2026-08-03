import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = 'lamina.real-repository-oracle-supervisor-cleanup-proof/v1';
const PHASES = new Set(['first', 'replay']);
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[A-Za-z0-9+/]{80,96}={0,2}$/;
const SYNTHETIC_TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAvOfnUvRPgzkAWzxUj9YKyUiXP4In6Ge43K3MNiyRtlo=
-----END PUBLIC KEY-----
`;
const ISSUED = new WeakSet();
const RECEIPTS = new WeakMap();

const exactKeys = (value, keys) => value !== null && typeof value === 'object'
  && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

function validIdentity(value) {
  return exactKeys(value, ['path', 'dev', 'ino', 'uid'])
    && path.isAbsolute(value.path || '')
    && /^\d+$/.test(String(value.dev)) && /^\d+$/.test(String(value.ino))
    && Number.isSafeInteger(value.uid) && value.uid >= 0;
}

function sameIdentity(left, right) {
  return left?.path === right?.path && String(left?.dev) === String(right?.dev)
    && String(left?.ino) === String(right?.ino) && Number(left?.uid) === Number(right?.uid);
}

function sameNode(left, right) {
  return String(left?.dev) === String(right?.dev)
    && String(left?.ino) === String(right?.ino) && Number(left?.uid) === Number(right?.uid);
}

function assertAbsent(candidate) {
  try { fs.lstatSync(candidate); }
  catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  throw new Error('supervisor cleanup proof requires current physical path absence');
}

function signingBytes(proof) {
  return Buffer.from(JSON.stringify({
    schema: proof.schema,
    slot_id: proof.slot_id,
    phase: proof.phase,
    opaque_handle: proof.opaque_handle,
    end_digest: proof.end_digest,
    final_root_identity: proof.final_root_identity,
    quarantine_identity: proof.quarantine_identity,
    physical_absence: proof.physical_absence,
  }));
}

function validProof(proof) {
  return exactKeys(proof, [
    'schema', 'slot_id', 'phase', 'opaque_handle', 'end_digest',
    'final_root_identity', 'quarantine_identity', 'physical_absence',
    'synthetic_signature',
  ])
    && proof.schema === SCHEMA
    && /^slot-[1-9]\d*$/.test(proof.slot_id || '')
    && PHASES.has(proof.phase) && HANDLE.test(proof.opaque_handle || '')
    && SHA256.test(proof.end_digest || '') && SIGNATURE.test(proof.synthetic_signature || '')
    && validIdentity(proof.final_root_identity) && validIdentity(proof.quarantine_identity)
    && sameNode(proof.final_root_identity, proof.quarantine_identity)
    && exactKeys(proof.physical_absence, [
      'root_path', 'quarantine_path', 'root_absent', 'quarantine_absent',
    ])
    && proof.physical_absence.root_path === proof.final_root_identity.path
    && proof.physical_absence.quarantine_path === proof.quarantine_identity.path
    && proof.physical_absence.root_absent === true
    && proof.physical_absence.quarantine_absent === true
    && Object.isFrozen(proof) && Object.isFrozen(proof.final_root_identity)
    && Object.isFrozen(proof.quarantine_identity) && Object.isFrozen(proof.physical_absence);
}

// This admits only receipts signed by the synthetic private key held outside
// the production source closure. It cannot mint or alter a receipt.
export function admitSyntheticSupervisorCleanupProof(proof, plan) {
  if (!plan || typeof plan !== 'object' || !validProof(proof)
    || !crypto.verify(null, signingBytes(proof), SYNTHETIC_TEST_PUBLIC_KEY,
      Buffer.from(proof.synthetic_signature, 'base64'))) {
    throw new Error('synthetic supervisor cleanup proof lacks test-only signing authority');
  }
  assertAbsent(proof.physical_absence.root_path);
  assertAbsent(proof.physical_absence.quarantine_path);
  ISSUED.add(proof);
  RECEIPTS.set(proof, Object.freeze({
    plan,
    slot_id: proof.slot_id,
    phase: proof.phase,
    opaque_handle: proof.opaque_handle,
    end_digest: proof.end_digest,
    final_root_identity: proof.final_root_identity,
    quarantine_identity: proof.quarantine_identity,
    physical_absence: proof.physical_absence,
  }));
  return proof;
}

export function verifyIssuedSupervisorCleanupProof(proof, expected) {
  const receipt = proof && ISSUED.has(proof) ? RECEIPTS.get(proof) : null;
  if (!receipt) throw new Error('supervisor cleanup proof was not issued by the host authority');
  if (!exactKeys(expected, ['plan', 'slot_id', 'phase', 'opaque_handle', 'end_digest'])
    || receipt.plan !== expected.plan || receipt.slot_id !== expected.slot_id
    || receipt.phase !== expected.phase || receipt.opaque_handle !== expected.opaque_handle
    || receipt.end_digest !== expected.end_digest
    || proof.slot_id !== receipt.slot_id || proof.phase !== receipt.phase
    || proof.opaque_handle !== receipt.opaque_handle || proof.end_digest !== receipt.end_digest
    || !sameIdentity(proof.final_root_identity, receipt.final_root_identity)
    || !sameIdentity(proof.quarantine_identity, receipt.quarantine_identity)
    || proof.physical_absence !== receipt.physical_absence) {
    throw new Error('supervisor cleanup proof belongs to different plan, slot, phase, lease, or digest');
  }
  assertAbsent(receipt.physical_absence.root_path);
  assertAbsent(receipt.physical_absence.quarantine_path);
  return true;
}
