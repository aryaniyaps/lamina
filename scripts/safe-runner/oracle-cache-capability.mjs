import crypto from 'node:crypto';
import path from 'node:path';

export const ORACLE_CACHE_CAPABILITY_CONTENT =
  'lamina real-repository oracle cache capability v1\n';
export const ORACLE_CACHE_CAPABILITY_FD = 4;
export const ORACLE_CACHE_CAPABILITY_MOUNT = '/oracle-cache-capability';
export const ORACLE_CACHE_CAPABILITY_SOURCE_NAME = '.oracle-cache-capability';
export const ORACLE_CACHE_CAPABILITY_DIGEST = crypto.createHash('sha256')
  .update(ORACLE_CACHE_CAPABILITY_CONTENT).digest('hex');
export const ORACLE_CACHE_CAPABILITY_AUTHORITY = Object.freeze({
  schema: 'lamina.safe-runner-oracle-cache-capability-authority/v1',
  transfer: 'fixed-fd-post-setup-anonymized-read-only',
  descriptor: ORACLE_CACHE_CAPABILITY_FD,
  mount_path: ORACLE_CACHE_CAPABILITY_MOUNT,
  source_name: ORACLE_CACHE_CAPABILITY_SOURCE_NAME,
  size: Buffer.byteLength(ORACLE_CACHE_CAPABILITY_CONTENT),
  digest: ORACLE_CACHE_CAPABILITY_DIGEST,
});

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function exactIdentity(value) {
  return exactKeys(value, ['dev', 'ino', 'uid', 'mode', 'size', 'digest'])
    && /^\d+$/.test(value.dev) && /^\d+$/.test(value.ino)
    && Number.isSafeInteger(value.uid) && value.uid >= 0
    && value.mode === 0o400
    && value.size === ORACLE_CACHE_CAPABILITY_AUTHORITY.size
    && value.digest === ORACLE_CACHE_CAPABILITY_DIGEST;
}

function fail() {
  throw new Error('oracle cache capability evidence is not exact post-setup-anonymized read-only authority');
}

export function validateOracleCacheCapabilityEvidence(claim, observation, {
  privateTmpRoot, expectedUid = null,
} = {}) {
  if (!path.isAbsolute(privateTmpRoot || '')
    || !exactKeys(claim, [
      'schema', 'transfer', 'descriptor', 'source_path', 'pathname_absent',
      'source_fd_closed', 'identity',
    ])
    || claim.schema !== 'lamina.safe-runner-oracle-cache-capability-claim/v1'
    || claim.transfer !== ORACLE_CACHE_CAPABILITY_AUTHORITY.transfer
    || claim.descriptor !== ORACLE_CACHE_CAPABILITY_FD
    || claim.source_path !== path.join(privateTmpRoot, ORACLE_CACHE_CAPABILITY_SOURCE_NAME)
    || claim.pathname_absent !== true || claim.source_fd_closed !== true
    || !exactIdentity(claim.identity)
    || (expectedUid !== null
      && (!Number.isSafeInteger(expectedUid) || claim.identity.uid !== expectedUid))
    || !exactKeys(observation, [
      'identity', 'mount_id', 'mount_access', 'pathname_exists',
      'requester_fd_retained', 'outer_fd_retained', 'keeper_fd_retained',
      'read_descriptor_write_refused', 'open_for_write_refused',
    ])
    || !exactIdentity(observation.identity)
    || JSON.stringify(observation.identity) !== JSON.stringify(claim.identity)
    || !Number.isSafeInteger(observation.mount_id) || observation.mount_id <= 0
    || observation.mount_access !== 'ro' || observation.pathname_exists !== false
    || observation.requester_fd_retained !== false
    || observation.outer_fd_retained !== false
    || observation.keeper_fd_retained !== false
    || observation.read_descriptor_write_refused !== true
    || observation.open_for_write_refused !== true) fail();
  return Object.freeze({
    schema: 'lamina.safe-runner-oracle-cache-capability-proof/v1',
    non_gradeable: true,
    transfer: ORACLE_CACHE_CAPABILITY_AUTHORITY.transfer,
    descriptor: ORACLE_CACHE_CAPABILITY_FD,
    source: Object.freeze({
      ...claim.identity, pathname_absent: true, fd_closed: true,
    }),
    mount: Object.freeze({
      path: ORACLE_CACHE_CAPABILITY_MOUNT, mount_id: observation.mount_id,
      access: observation.mount_access, ...observation.identity,
    }),
    retained_fds: Object.freeze({ requester: false, outer: false, keeper: false }),
    write_refused: true,
    open_for_write_refused: true,
  });
}
