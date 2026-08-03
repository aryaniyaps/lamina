import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { admitSyntheticSupervisorCleanupProof } from
  '../../benchmarks/real-repository-oracle-v1/supervisor-cleanup-proof.mjs';
import {
  SYNTHETIC_SUPERVISOR_CLEANUP_AUTHORITY,
  SYNTHETIC_SUPERVISOR_CLEANUP_PRIVATE_KEY,
} from
  './synthetic-supervisor-cleanup-authority.mjs';

function identity(candidate) {
  const stat = fs.lstatSync(candidate, { bigint: true });
  return { path: candidate, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid) };
}

function mintSyntheticSupervisorCleanupProof(binding, authority) {
  if (authority !== SYNTHETIC_SUPERVISOR_CLEANUP_AUTHORITY) {
    throw new Error('synthetic cleanup proof requires explicit test authority');
  }
  const parent = fs.realpathSync.native(fs.mkdtempSync(
    path.join(os.tmpdir(), 'lamina-synthetic-supervisor-cleanup-'),
  ));
  fs.chmodSync(parent, 0o700);
  const root = path.join(parent, 'materializer-root');
  const quarantine = path.join(parent, 'materializer-quarantine');
  try {
    fs.mkdirSync(root, { mode: 0o700 });
    const finalRootIdentity = identity(root);
    fs.renameSync(root, quarantine);
    const quarantineIdentity = identity(quarantine);
    fs.rmdirSync(quarantine);
    const unsigned = {
      schema: 'lamina.real-repository-oracle-supervisor-cleanup-proof/v1',
      slot_id: binding.slot_id,
      phase: binding.phase,
      opaque_handle: binding.opaque_handle,
      end_digest: binding.end_digest,
      final_root_identity: finalRootIdentity,
      quarantine_identity: quarantineIdentity,
      physical_absence: {
        root_path: root, quarantine_path: quarantine,
        root_absent: true, quarantine_absent: true,
      },
    };
    const signature = crypto.sign(null, Buffer.from(JSON.stringify(unsigned)),
      SYNTHETIC_SUPERVISOR_CLEANUP_PRIVATE_KEY).toString('base64');
    const proof = Object.freeze({
      ...unsigned,
      final_root_identity: Object.freeze(unsigned.final_root_identity),
      quarantine_identity: Object.freeze(unsigned.quarantine_identity),
      physical_absence: Object.freeze(unsigned.physical_absence),
      synthetic_signature: signature,
    });
    return admitSyntheticSupervisorCleanupProof(proof, binding.plan);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

export function syntheticSupervisorCleanupProof(binding) {
  return mintSyntheticSupervisorCleanupProof(binding, SYNTHETIC_SUPERVISOR_CLEANUP_AUTHORITY);
}
