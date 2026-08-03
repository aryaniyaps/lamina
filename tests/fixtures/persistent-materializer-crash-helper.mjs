#!/usr/bin/env node
import fs from 'node:fs';
import {
  createSyntheticPersistentScenarioMaterializer,
  SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY,
} from '../../benchmarks/real-repository-oracle-v1/persistent-materializer.mjs';
import { createMaterializationRegistry } from '../../benchmarks/real-repository-oracle-v1/materialization-registry.mjs';

const [configFile, boundary] = process.argv.slice(2);
if (!configFile || ![
  'cache_creating', 'cache_ready', 'lease_allocated', 'logical_worktree_active',
  'lease_quarantined', 'root_quarantined',
  'before_root_creation', 'after_root_creation', 'after_owner_marker',
].includes(boundary)) {
  throw new Error('persistent materializer crash helper arguments are invalid');
}
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const recoveryOwnerIdentity = await new Promise((resolve) => {
  process.once('message', (message) => resolve(message?.recovery_owner_identity));
});
let publishedAuthority = null;
let stopped = false;
const stopAtBoundary = (extra = {}) => {
  if (stopped) return;
  stopped = true;
  fs.writeSync(process.stdout.fd, `${JSON.stringify({
    boundary, authority: publishedAuthority, resolved: null, ...extra,
  })}\n`);
  process.kill(process.pid, 'SIGSTOP');
};
const materializer = createSyntheticPersistentScenarioMaterializer({
  runnerTemporaryRoot: config.runnerTemporaryRoot,
  collection: config.collection,
  recoveryOwnerIdentity,
  publishRecoveryAuthority(authority) {
    publishedAuthority = authority;
    fs.writeSync(4, `${JSON.stringify(authority)}\n`);
    const bytes = Buffer.alloc(4096);
    const count = fs.readSync(5, bytes, 0, bytes.length, null);
    if (count < 1 || count === bytes.length) throw new Error('external recovery ACK is missing or oversized');
    const acknowledgement = JSON.parse(bytes.subarray(0, count).toString('utf8').trim());
    return acknowledgement;
  },
  seedBareRepository: config.seedBareRepository,
  maximumPackBytes: 16 * 1024 * 1024,
  maximumSnapshotBytes: 32 * 1024 * 1024,
  syntheticCopyInterposition() {
    if (boundary === 'cache_creating') stopAtBoundary();
  },
  syntheticLifecycleInterposition(event) {
    if (boundary === event.boundary
      || (boundary === 'lease_quarantined' && event.label === 'physical repository lease')
      || (boundary === 'root_quarantined' && event.label === 'persistent materializer root')) {
      stopAtBoundary({ quarantine: event.quarantine });
    }
  },
}, SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY);
const registry = createMaterializationRegistry(materializer);
let resolved = null;
if (!['cache_ready', 'root_quarantined'].includes(boundary)) {
  const selected = ['lease_allocated', 'lease_quarantined'].includes(boundary)
    ? config.clean : config.worktree;
  const base = await registry.prepare(selected.scenario, config.collection);
  const lease = await registry.lease(base, {
    expected_repository_state: selected.expected,
  });
  resolved = registry.resolve(lease.opaque_handle);
  if (boundary === 'lease_quarantined') {
    await registry.verifyAndRelease(lease);
    resolved = null;
  }
}
if (boundary === 'root_quarantined') await registry.close();
const payload = {
  boundary,
  authority: publishedAuthority,
  inspection: materializer.inspectForTest(),
  resolved,
};
process.stdout.write(`${JSON.stringify(payload)}\n`, () => {
  setInterval(() => {}, 60_000);
});
