import fs from 'node:fs';
import path from 'node:path';
import {
  digest, materializationBaseDigest, materializationProvenanceDigest,
} from './contract.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const frozenClone = (value) => {
  const clone = structuredClone(value);
  const freeze = (item) => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      Object.freeze(item);
      Object.values(item).forEach(freeze);
    }
    return item;
  };
  return freeze(clone);
};
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export function resolvePhysicalContained(root, relative, { allowMissingLeaf = false } = {}) {
  const physicalRoot = fs.realpathSync.native(root);
  const pieces = relative.split('/');
  let current = physicalRoot;
  for (const [index, piece] of pieces.entries()) {
    const candidate = path.join(current, piece);
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error(`materialization path crosses a symlink: ${relative}`);
      current = fs.realpathSync.native(candidate);
    } catch (error) {
      if (error.code !== 'ENOENT' || !allowMissingLeaf || index !== pieces.length - 1) throw error;
      current = candidate;
    }
    if (current !== physicalRoot && !current.startsWith(`${physicalRoot}${path.sep}`)) {
      throw new Error(`materialization path escapes the repository: ${relative}`);
    }
  }
  return current;
}

function assertBase(value, scenario, collection) {
  const expectedScenario = digest(scenario);
  const expectedProvenance = materializationProvenanceDigest(collection, expectedScenario);
  const expectedBase = materializationBaseDigest(collection, expectedScenario);
  if (!exactKeys(value, [
    'schema', 'resolved_commit', 'tree_oid', 'scenario_digest',
    'provenance_digest', 'content_digest',
  ])
    || value.schema !== 'lamina.materialized-repository-base/v1'
    || value.resolved_commit !== collection.commit || value.tree_oid !== collection.tree_oid
    || value.scenario_digest !== expectedScenario || value.provenance_digest !== expectedProvenance
    || value.content_digest !== expectedBase
    || !SHA256.test(value.provenance_digest) || !SHA256.test(value.content_digest)) {
    throw new Error('trusted materializer did not bind the actual pinned tree and reviewed scenario');
  }
  return frozenClone(value);
}
function assertLease(value, base) {
  if (!exactKeys(value, ['schema', 'opaque_handle', 'provenance_digest', 'start_digest'])
    || value.schema !== 'lamina.materialized-repository-lease/v1'
    || !/^[A-Za-z0-9._:-]{16,256}$/.test(value.opaque_handle)
    || value.provenance_digest !== base.provenance_digest
    || value.start_digest !== base.content_digest) {
    throw new Error('trusted materializer returned an invalid isolated lease');
  }
  return frozenClone(value);
}
function assertRelease(value, lease) {
  if (!exactKeys(value, ['end_digest', 'cleanup_verified'])
    || value.cleanup_verified !== true || value.end_digest !== lease.start_digest) {
    throw new Error('materialized lease changed or cleanup was not verified');
  }
  return frozenClone(value);
}
function assertIssuedLease(value, issued) {
  if (!exactKeys(value, ['schema', 'opaque_handle', 'provenance_digest', 'start_digest'])
    || value.schema !== issued.schema || value.opaque_handle !== issued.opaque_handle
    || value.provenance_digest !== issued.provenance_digest
    || value.start_digest !== issued.start_digest) {
    throw new Error('repository lease authority differs from the exact issued lease');
  }
}

export function createMaterializationRegistry(materializer) {
  for (const method of ['prepare', 'lease', 'resolve', 'verifyAndRelease']) {
    if (typeof materializer?.[method] !== 'function') throw new Error(`trusted materializer lacks ${method}`);
  }
  const active = new Map();
  const issued = new Set();
  let closed = false;
  const registry = {
    async prepare(scenario, collection) {
      if (closed) throw new Error('materialization registry is closed');
      const frozenScenario = frozenClone(scenario);
      const frozenCollection = frozenClone(collection);
      return assertBase(await materializer.prepare(frozenScenario, frozenCollection), frozenScenario, frozenCollection);
    },
    async lease(base, context) {
      if (closed) throw new Error('materialization registry is closed');
      if (active.size) throw new Error('only one physical repository lease may be active');
      const raw = await materializer.lease(frozenClone(base), frozenClone(context));
      const publicLease = assertLease(raw, base);
      if (issued.has(publicLease.opaque_handle)) throw new Error('materializer reused a writable lease handle');
      issued.add(publicLease.opaque_handle);
      active.set(publicLease.opaque_handle, { raw, publicLease, state: 'active' });
      return publicLease;
    },
    resolve(opaqueHandle) {
      if (closed) throw new Error('materialization registry is closed');
      const authority = active.get(opaqueHandle);
      if (!authority) throw new Error('repository lease handle is unknown or no longer active');
      if (authority.state !== 'active') {
        throw new Error('repository lease release failed and is recovery-only');
      }
      return materializer.resolve(authority.raw);
    },
    async verifyAndRelease(lease) {
      if (closed) throw new Error('materialization registry is closed');
      const authority = active.get(lease.opaque_handle);
      if (!authority) throw new Error('repository lease handle is unknown or already released');
      assertIssuedLease(lease, authority.publicLease);
      if (authority.state !== 'active') {
        throw new Error('repository lease release failed and is recovery-only');
      }
      authority.state = 'releasing';
      let released;
      try {
        released = assertRelease(
          await materializer.verifyAndRelease(authority.raw), authority.publicLease,
        );
      } catch (error) {
        authority.state = 'release_failed';
        throw error;
      }
      active.delete(lease.opaque_handle);
      return released;
    },
    assertEmpty() {
      if (active.size) throw new Error(`${active.size} repository leases remain active`);
    },
  };
  if (typeof materializer.close === 'function') {
    registry.close = async () => {
      if (closed) throw new Error('materialization registry is already closed');
      if (active.size) throw new Error(`${active.size} repository leases remain active`);
      await materializer.close();
      closed = true;
    };
  }
  if (typeof materializer.recoveryAuthority === 'function') {
    registry.recoveryAuthority = () => frozenClone(materializer.recoveryAuthority());
  }
  return Object.freeze(registry);
}
