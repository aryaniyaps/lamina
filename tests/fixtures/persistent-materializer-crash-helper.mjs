#!/usr/bin/env node
import fs from 'node:fs';
import {
  createSyntheticPersistentScenarioMaterializer,
  SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY,
} from '../../benchmarks/real-repository-oracle-v1/persistent-materializer.mjs';
import { createMaterializationRegistry } from '../../benchmarks/real-repository-oracle-v1/materialization-registry.mjs';

const [configFile, boundary] = process.argv.slice(2);
if (!configFile || !['cache_ready', 'lease_allocated', 'logical_worktree_active',
  'released_before_close'].includes(boundary)) {
  throw new Error('persistent materializer crash helper arguments are invalid');
}
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const recoveryOwnerIdentity = await new Promise((resolve) => {
  process.once('message', (message) => resolve(message?.recovery_owner_identity));
});
const materializer = createSyntheticPersistentScenarioMaterializer({
  runnerTemporaryRoot: config.runnerTemporaryRoot,
  collection: config.collection,
  recoveryOwnerIdentity,
  seedBareRepository: config.seedBareRepository,
  maximumPackBytes: 16 * 1024 * 1024,
  maximumSnapshotBytes: 32 * 1024 * 1024,
}, SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY);
const registry = createMaterializationRegistry(materializer);
let resolved = null;
if (boundary !== 'cache_ready') {
  const selected = boundary === 'lease_allocated' ? config.clean : config.worktree;
  const base = await registry.prepare(selected.scenario, config.collection);
  const lease = await registry.lease(base, {
    expected_repository_state: selected.expected,
  });
  resolved = registry.resolve(lease.opaque_handle);
  if (boundary === 'released_before_close') {
    await registry.verifyAndRelease(lease);
    resolved = null;
  }
}
const payload = {
  boundary,
  authority: registry.recoveryAuthority(),
  inspection: materializer.inspectForTest(),
  resolved,
};
process.stdout.write(`${JSON.stringify(payload)}\n`, () => {
  setInterval(() => {}, 60_000);
});
