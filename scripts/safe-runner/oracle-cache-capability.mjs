import crypto from 'node:crypto';
import path from 'node:path';

export const ORACLE_CACHE_CAPABILITY_FD = 4;
export const ORACLE_CACHE_CAPABILITY_MOUNT = '/oracle-cache-capability';
export const ORACLE_CACHE_CAPABILITY_SOURCE_NAME = '.oracle-cache-capability';
export const ORACLE_CACHE_CAPABILITY_TRANSFER =
  'fixed-fd-post-setup-anonymized-read-only';
const OID = /^[a-f0-9]{40}$/;
const PACK_DIGEST = /^[a-f0-9]{64}$/;

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function oracleCacheCapabilityAuthority(sealed) {
  if (!sealed?.manifest || !PACK_DIGEST.test(sealed.digest || '')
    || !Number.isSafeInteger(sealed.size) || sealed.size < 1
    || sealed.manifest.schema !== 'lamina.sealed-packed-bare-cache-capability/v1'
    || !['small', 'medium', 'large'].includes(sealed.manifest.tier)
    || !OID.test(sealed.manifest.commit || '') || !OID.test(sealed.manifest.tree_oid || '')
    || sealed.pack_closure_digest !== sealed.manifest.pack_closure_digest
    || !PACK_DIGEST.test(sealed.pack_closure_digest || '')) {
    throw new Error('sealed packed bare cache capability authority is invalid');
  }
  return Object.freeze({
    schema: 'lamina.safe-runner-oracle-cache-capability-authority/v1',
    transfer: ORACLE_CACHE_CAPABILITY_TRANSFER,
    descriptor: ORACLE_CACHE_CAPABILITY_FD,
    mount_path: ORACLE_CACHE_CAPABILITY_MOUNT,
    source_name: ORACLE_CACHE_CAPABILITY_SOURCE_NAME,
    tier: sealed.manifest.tier,
    commit: sealed.manifest.commit,
    tree_oid: sealed.manifest.tree_oid,
    pack_closure_digest: sealed.pack_closure_digest,
    size: sealed.size,
    digest: sealed.digest,
  });
}

export function isOracleCacheCapabilityAuthority(value) {
  return exactAuthority(value);
}

export function exactOracleCacheCapabilityAuthority(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactAuthority(value) {
  return exactKeys(value, [
    'schema', 'transfer', 'descriptor', 'mount_path', 'source_name',
    'tier', 'commit', 'tree_oid', 'pack_closure_digest', 'size', 'digest',
  ])
    && value.schema === 'lamina.safe-runner-oracle-cache-capability-authority/v1'
    && value.transfer === ORACLE_CACHE_CAPABILITY_TRANSFER
    && value.descriptor === ORACLE_CACHE_CAPABILITY_FD
    && value.mount_path === ORACLE_CACHE_CAPABILITY_MOUNT
    && value.source_name === ORACLE_CACHE_CAPABILITY_SOURCE_NAME
    && ['small', 'medium', 'large'].includes(value.tier)
    && OID.test(value.commit) && OID.test(value.tree_oid)
    && PACK_DIGEST.test(value.pack_closure_digest)
    && Number.isSafeInteger(value.size) && value.size > 0
    && PACK_DIGEST.test(value.digest);
}

function exactIdentity(value, authority) {
  return exactKeys(value, ['dev', 'ino', 'uid', 'mode', 'size', 'digest'])
    && /^\d+$/.test(value.dev) && /^\d+$/.test(value.ino)
    && Number.isSafeInteger(value.uid) && value.uid >= 0
    && value.mode === 0o400
    && value.size === authority.size
    && value.digest === authority.digest;
}

function fail() {
  throw new Error('oracle cache capability evidence is not exact post-setup-anonymized read-only authority');
}

export function validateOracleCacheCapabilityEvidence(claim, observation, {
  privateTmpRoot, expectedUid = null, authority = null,
} = {}) {
  if (!exactAuthority(authority)
    || !path.isAbsolute(privateTmpRoot || '')
    || !exactKeys(claim, [
      'schema', 'transfer', 'descriptor', 'source_path', 'pathname_absent',
      'source_fd_closed', 'identity',
    ])
    || claim.schema !== 'lamina.safe-runner-oracle-cache-capability-claim/v1'
    || claim.transfer !== authority.transfer
    || claim.descriptor !== authority.descriptor
    || claim.source_path !== path.join(privateTmpRoot, authority.source_name)
    || claim.pathname_absent !== true || claim.source_fd_closed !== true
    || !exactIdentity(claim.identity, authority)
    || (expectedUid !== null
      && (!Number.isSafeInteger(expectedUid) || claim.identity.uid !== expectedUid))
    || !exactKeys(observation, [
      'identity', 'mount_id', 'mount_access', 'pathname_exists',
      'requester_fd_retained', 'outer_fd_retained', 'keeper_fd_retained',
      'read_descriptor_write_refused', 'open_for_write_refused',
    ])
    || !exactIdentity(observation.identity, authority)
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
    transfer: authority.transfer,
    descriptor: authority.descriptor,
    tier: authority.tier,
    commit: authority.commit,
    tree_oid: authority.tree_oid,
    pack_closure_digest: authority.pack_closure_digest,
    source: Object.freeze({
      ...claim.identity, pathname_absent: true, fd_closed: true,
    }),
    mount: Object.freeze({
      path: authority.mount_path, mount_id: observation.mount_id,
      access: observation.mount_access, ...observation.identity,
    }),
    retained_fds: Object.freeze({ requester: false, outer: false, keeper: false }),
    write_refused: true,
    open_for_write_refused: true,
  });
}
