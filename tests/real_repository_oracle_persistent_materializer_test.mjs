#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnTrustedGit } from '../scripts/safe-runner/git.mjs';
import {
  collectionDigest, digest, materializationBaseDigest, materializationProvenanceDigest,
} from '../benchmarks/real-repository-oracle-v1/contract.mjs';
import { createMaterializationRegistry } from '../benchmarks/real-repository-oracle-v1/materialization-registry.mjs';
import {
  createPersistentScenarioMaterializer,
  createSyntheticPersistentScenarioMaterializer,
  SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY,
} from '../benchmarks/real-repository-oracle-v1/persistent-materializer.mjs';
import { readRepositoryState } from '../benchmarks/real-repository-oracle-v1/repository-state.mjs';
import { processIdentity } from '../scripts/safe-runner/processes.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const runGit = (cwd, args) => {
  const result = spawnTrustedGit(cwd, ['-c', 'core.symlinks=false', ...args], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  return String(result.stdout || '').trim();
};
const absent = (candidate) => {
  try { fs.lstatSync(candidate); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
};
const makeWritableForTestCleanup = (root) => {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    let stat;
    try { stat = fs.lstatSync(current); } catch { continue; }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      fs.chmodSync(current, 0o700);
      for (const name of fs.readdirSync(current)) pending.push(path.join(current, name));
    } else if (stat.isFile() && !stat.isSymbolicLink()) fs.chmodSync(current, 0o600);
  }
};

if (process.platform !== 'linux') {
  console.log('real repository oracle persistent materializer skipped: Linux ownership and process evidence required');
  process.exit(0);
}

const temporary = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-persistent-materializer-test-'),
));
fs.chmodSync(temporary, 0o700);
try {
  const origin = path.join(temporary, 'synthetic-origin');
  runGit(temporary, ['init', '--quiet', origin]);
  runGit(origin, ['config', 'user.name', 'Lamina Test']);
  runGit(origin, ['config', 'user.email', 'lamina@example.invalid']);
  fs.mkdirSync(path.join(origin, 'src'));
  fs.writeFileSync(path.join(origin, 'src/a.txt'), 'alpha\n', { mode: 0o600 });
  fs.writeFileSync(path.join(origin, 'src/b.txt'), 'bravo\n', { mode: 0o600 });
  runGit(origin, ['add', '--', 'src/a.txt', 'src/b.txt']);
  fs.writeFileSync(path.join(origin, 'src/alias-target'), 'a.txt', { mode: 0o600 });
  const linkBlob = runGit(origin, ['hash-object', '-w', '--', 'src/alias-target']);
  fs.unlinkSync(path.join(origin, 'src/alias-target'));
  runGit(origin, ['update-index', '--add', '--cacheinfo', '120000', linkBlob, 'src/alias.txt']);
  runGit(origin, ['commit', '--quiet', '-m', 'synthetic pinned fixture']);
  const commit = runGit(origin, ['rev-parse', 'HEAD']);
  const treeOid = runGit(origin, ['rev-parse', 'HEAD^{tree}']);
  runGit(origin, ['-c', 'pack.writeReverseIndex=false',
    'repack', '-Ad', '--no-write-bitmap-index']);
  runGit(origin, ['prune-packed']);
  fs.writeFileSync(path.join(origin, '.git', 'shallow'), `${commit}\n`, { mode: 0o600 });
  const objectCounts = runGit(origin, ['count-objects', '-v']);
  assert.match(objectCounts, /^count: 0$/m);
  assert.match(objectCounts, /^packs: 1$/m);

  const collectionIdentity = {
    schema: 'lamina.real-repository-collection/v1',
    id: 'collection.synthetic',
    fixture_id: 'synthetic',
    fixture_class: 'synthetic',
    repository_url: 'https://example.invalid/synthetic.git',
    commit,
    tree_oid: treeOid,
    baseline_manifest_sha256: 'a'.repeat(64),
    candidate_policy_sha256: 'b'.repeat(64),
  };
  const collection = {
    ...collectionIdentity,
    collection_digest: collectionDigest(collectionIdentity),
  };
  const cleanState = (role = 'primary', branch = '(detached)') => ({
    head: commit, branch, upstream: null, ahead: 0, behind: 0,
    worktree_role: role, changes: [],
  });
  const scenarios = [
    {
      scenario: { kind: 'clean', name: 'clean', operations: [] },
      expected: cleanState(),
    },
    {
      scenario: { kind: 'dirty', name: 'modify', operations: [{
        op: 'modify', path: 'src/a.txt', content: 'tail\n',
      }] },
      expected: { ...cleanState(), changes: [{
        kind: 'ordinary', path: 'src/a.txt', original_path: null, xy: '.M', submodule: 'N...',
      }] },
    },
    {
      scenario: { kind: 'dirty', name: 'rename', operations: [{
        op: 'rename', path: 'src/a.txt', to: 'renamed.txt',
      }] },
      expected: { ...cleanState(), changes: [{
        kind: 'renamed', path: 'renamed.txt', original_path: 'src/a.txt', xy: 'R.', submodule: 'N...',
      }] },
    },
    {
      scenario: { kind: 'dirty', name: 'delete', operations: [{ op: 'delete', path: 'src/b.txt' }] },
      expected: { ...cleanState(), changes: [{
        kind: 'deleted', path: 'src/b.txt', original_path: null, xy: '.D', submodule: 'N...',
      }] },
    },
    {
      scenario: { kind: 'branch', name: 'branch', operations: [{
        op: 'checkout_branch', branch: 'lamina-oracle/synthetic-branch',
      }] },
      expected: cleanState('primary', 'lamina-oracle/synthetic-branch'),
    },
    {
      scenario: { kind: 'worktree', name: 'worktree', operations: [{
        op: 'add_worktree', branch: 'lamina-oracle/synthetic-worktree',
        worktree_id: 'oracle-worktree-synthetic',
      }] },
      expected: cleanState('oracle-worktree-synthetic', 'lamina-oracle/synthetic-worktree'),
    },
  ];

  const fakeScenario = scenarios[0].scenario;
  const fakeScenarioDigest = digest(fakeScenario);
  const fakeBase = {
    schema: 'lamina.materialized-repository-base/v1', resolved_commit: commit,
    tree_oid: treeOid, scenario_digest: fakeScenarioDigest,
    provenance_digest: materializationProvenanceDigest(collection, fakeScenarioDigest),
    content_digest: materializationBaseDigest(collection, fakeScenarioDigest),
  };
  let fakePhysicalReleases = 0;
  const failedReleaseRegistry = createMaterializationRegistry({
    async prepare() { return fakeBase; },
    async lease() {
      return {
        schema: 'lamina.materialized-repository-lease/v1', opaque_handle: 'fake-release-handle',
        provenance_digest: fakeBase.provenance_digest, start_digest: fakeBase.content_digest,
      };
    },
    resolve() { return { repository: '/fake/repository', worktree_role: 'primary' }; },
    async verifyAndRelease() {
      fakePhysicalReleases += 1;
      throw new Error('fake failure after physical release');
    },
  });
  const failedBase = await failedReleaseRegistry.prepare(fakeScenario, collection);
  const failedLease = await failedReleaseRegistry.lease(failedBase, {});
  await assert.rejects(failedReleaseRegistry.verifyAndRelease({
    ...failedLease, start_digest: 'f'.repeat(64),
  }), /differs from the exact issued lease/);
  assert.equal(fakePhysicalReleases, 0, 'forged release is a pre-transition no-op');
  assert.deepEqual(failedReleaseRegistry.resolve(failedLease.opaque_handle), {
    repository: '/fake/repository', worktree_role: 'primary',
  });
  await assert.rejects(failedReleaseRegistry.verifyAndRelease(failedLease),
    /fake failure after physical release/);
  assert.equal(fakePhysicalReleases, 1);
  assert.throws(() => failedReleaseRegistry.resolve(failedLease.opaque_handle), /recovery-only/);
  await assert.rejects(failedReleaseRegistry.verifyAndRelease(failedLease), /recovery-only/);
  assert.equal(fakePhysicalReleases, 1, 'ambiguous physical release is never retried');
  assert.throws(() => failedReleaseRegistry.assertEmpty(), /1 repository leases remain active/);

  const ownerIdentity = processIdentity(process.pid);
  const acknowledgeRecoveryAuthority = () => true;
  assert.throws(() => createPersistentScenarioMaterializer({
    runnerTemporaryRoot: temporary, collection, recoveryOwnerIdentity: ownerIdentity,
    publishRecoveryAuthority: acknowledgeRecoveryAuthority,
  }), /not an exact reviewed fixture pin/,
  'arbitrary self-digested HTTPS metadata cannot enter the production factory');
  assert.throws(() => createSyntheticPersistentScenarioMaterializer({
    runnerTemporaryRoot: temporary, collection, recoveryOwnerIdentity: ownerIdentity,
    publishRecoveryAuthority: acknowledgeRecoveryAuthority,
    seedBareRepository: path.join(origin, '.git'),
  }), /explicit test-only authority/);

  let invalidSeedIndex = 0;
  const expectSeedRefusal = (mutate, options, pattern) => {
    invalidSeedIndex += 1;
    const seed = path.join(temporary, `invalid-seed-${invalidSeedIndex}`);
    fs.cpSync(path.join(origin, '.git'), seed, { recursive: true, preserveTimestamps: true });
    mutate?.(seed);
    assert.throws(() => createSyntheticPersistentScenarioMaterializer({
      runnerTemporaryRoot: temporary, collection, recoveryOwnerIdentity: ownerIdentity,
      publishRecoveryAuthority: acknowledgeRecoveryAuthority,
      seedBareRepository: seed, ...options,
    }, SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY), pattern);
  };
  const originPackDirectory = path.join(origin, '.git', 'objects', 'pack');
  const originPackNames = fs.readdirSync(originPackDirectory).sort();
  assert.equal(originPackNames.length, 2);
  const originPackSizes = originPackNames.map((name) =>
    Number(fs.statSync(path.join(originPackDirectory, name)).size));
  expectSeedRefusal(null, {
    maximumPackBytes: originPackSizes.reduce((sum, size) => sum + size, 0) - 1,
  }, /byte bound|exceeds its byte bound/);
  expectSeedRefusal((seed) => {
    fs.writeFileSync(path.join(seed, 'objects', 'pack', 'foreign'), 'foreign\n');
  }, {}, /exactly one pack and one index/);
  expectSeedRefusal((seed) => {
    const packDirectory = path.join(seed, 'objects', 'pack');
    const index = fs.readdirSync(packDirectory).find((name) => name.endsWith('.idx'));
    const replacement = `pack-${index.slice(5, 45).replace(/^./, (value) => value === 'a' ? 'b' : 'a')}.idx`;
    fs.renameSync(path.join(packDirectory, index), path.join(packDirectory, replacement));
  }, {}, /mismatched companions/);
  expectSeedRefusal((seed) => {
    fs.writeFileSync(path.join(seed, 'shallow'), Buffer.alloc(1024 * 1024 + 1, 0x61));
  }, {}, /bounded physical single-link file/);
  expectSeedRefusal((seed) => {
    const packDirectory = path.join(seed, 'objects', 'pack');
    const pack = fs.readdirSync(packDirectory).find((name) => name.endsWith('.pack'));
    const target = path.join(packDirectory, pack);
    const source = path.join(temporary, `symlink-source-${invalidSeedIndex}`);
    fs.copyFileSync(target, source);
    fs.unlinkSync(target);
    fs.symlinkSync(source, target);
  }, {}, /bounded physical single-link file/);
  expectSeedRefusal((seed) => {
    const packDirectory = path.join(seed, 'objects', 'pack');
    const pack = fs.readdirSync(packDirectory).find((name) => name.endsWith('.pack'));
    const target = path.join(packDirectory, pack);
    const source = path.join(temporary, `hardlink-source-${invalidSeedIndex}`);
    fs.copyFileSync(target, source);
    fs.unlinkSync(target);
    fs.linkSync(source, target);
  }, {}, /bounded physical single-link file/);
  expectSeedRefusal(null, { maximumSnapshotFiles: 1 }, /bounded file or byte authority/);
  expectSeedRefusal(null, { maximumSnapshotBytes: 1 }, /bounded file or byte authority/);
  expectSeedRefusal(null, {
    syntheticCopyInterposition(source) {
      fs.chmodSync(source, 0o600);
      fs.appendFileSync(source, 'source changed during controller copy\n');
    },
  }, /source after copy|byte-exact and physically independent/);

  const materializerRoots = () => fs.readdirSync(temporary)
    .filter((name) => name.startsWith('real-repository-oracle-materializer-')).sort();
  const rootsBeforeOwnerRefusals = materializerRoots();
  const forgedOwner = { ...ownerIdentity, start_ticks: `${Number(ownerIdentity.start_ticks) + 1}` };
  assert.throws(() => createSyntheticPersistentScenarioMaterializer({
    runnerTemporaryRoot: temporary, collection, recoveryOwnerIdentity: forgedOwner,
    publishRecoveryAuthority: acknowledgeRecoveryAuthority,
    seedBareRepository: path.join(origin, '.git'),
  }, SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY), /exact current live host process/);
  assert.deepEqual(materializerRoots(), rootsBeforeOwnerRefusals,
    'forged recovery owner is refused before a root is created');
  assert.throws(() => createSyntheticPersistentScenarioMaterializer({
    runnerTemporaryRoot: temporary, collection, recoveryOwnerIdentity: ownerIdentity,
    publishRecoveryAuthority() { return false; },
    seedBareRepository: path.join(origin, '.git'),
  }, SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY), /publication was not acknowledged/);
  assert.deepEqual(materializerRoots(), rootsBeforeOwnerRefusals,
    'unacknowledged construction authority is synchronously cleaned');
  assert.throws(() => createSyntheticPersistentScenarioMaterializer({
    runnerTemporaryRoot: temporary, collection,
    recoveryOwnerIdentity: { pid: 2_147_483_647, start_ticks: '1' },
    publishRecoveryAuthority: acknowledgeRecoveryAuthority,
    seedBareRepository: path.join(origin, '.git'),
  }, SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY), /exact current live host process/);
  assert.deepEqual(materializerRoots(), rootsBeforeOwnerRefusals,
    'nonexistent recovery owner is refused before a root is created');
  const inheritedProduction = Object.create({ seedBareRepository: path.join(origin, '.git') });
  Object.assign(inheritedProduction, {
    runnerTemporaryRoot: temporary, collection, recoveryOwnerIdentity: ownerIdentity,
    publishRecoveryAuthority: acknowledgeRecoveryAuthority,
  });
  assert.throws(() => createPersistentScenarioMaterializer(inheritedProduction),
    /rejects inherited synthetic-only authority/);
  const inheritedSynthetic = Object.create({ syntheticCopyInterposition() {} });
  Object.assign(inheritedSynthetic, {
    runnerTemporaryRoot: temporary, collection, recoveryOwnerIdentity: ownerIdentity,
    publishRecoveryAuthority: acknowledgeRecoveryAuthority,
    seedBareRepository: path.join(origin, '.git'),
  });
  assert.throws(() => createSyntheticPersistentScenarioMaterializer(
    inheritedSynthetic, SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY,
  ), /exact plain data object/);

  let publishedAuthority = null;
  const materializer = createSyntheticPersistentScenarioMaterializer({
    runnerTemporaryRoot: temporary,
    collection,
    recoveryOwnerIdentity: ownerIdentity,
    publishRecoveryAuthority(authority) { publishedAuthority = authority; return true; },
    seedBareRepository: path.join(origin, '.git'),
    maximumPackBytes: 16 * 1024 * 1024,
    maximumSnapshotBytes: 32 * 1024 * 1024,
  }, SYNTHETIC_PERSISTENT_MATERIALIZER_TEST_AUTHORITY);
  assert.deepEqual(materializer.recoveryAuthority(), publishedAuthority,
    'recovery authority is synchronously published before construction completes');
  const registry = createMaterializationRegistry(materializer);
  const initialInspection = materializer.inspectForTest();
  assert.equal(initialInspection.cache_pack_files.length, 2);
  assert.equal(initialInspection.cache_pack_files.filter((name) => name.endsWith('.pack')).length, 1);
  assert.equal(initialInspection.cache_pack_files.filter((name) => name.endsWith('.idx')).length, 1);
  assert.equal(fs.existsSync(path.join(initialInspection.root, 'template')), false,
    'persistent materializer has no checked-out template copy');

  const handles = new Set();
  const leaseRoots = new Set();
  for (const { scenario, expected } of scenarios) {
    const base = await registry.prepare(scenario, collection);
    for (const side of ['current-first', 'current-replay', 'candidate-first', 'candidate-replay']) {
      const lease = await registry.lease(base, {
        side,
        expected_repository_state: expected,
      });
      assert.equal(handles.has(lease.opaque_handle), false);
      handles.add(lease.opaque_handle);
      const inspection = materializer.inspectForTest();
      assert.equal(inspection.active_count, 1);
      assert.equal(leaseRoots.has(inspection.active_lease_root), false,
        'every action receives a never-reused random physical lease path');
      leaseRoots.add(inspection.active_lease_root);
      const resolved = registry.resolve(lease.opaque_handle);
      assert.deepEqual(Object.keys(resolved).sort(), ['repository', 'worktree_role']);
      assert.deepEqual(readRepositoryState(resolved.repository, {
        worktreeRole: resolved.worktree_role,
      }), expected);
      if (scenario.kind === 'branch') {
        assert.equal(runGit(resolved.repository, ['branch', '--show-current']),
          scenario.operations[0].branch, 'scenario branch remains checked out during candidate action');
      }
      if (scenario.kind === 'worktree') {
        const primary = path.join(inspection.active_lease_root, 'repository');
        assert.deepEqual(readRepositoryState(primary, { worktreeRole: 'primary' }), cleanState());
        assert.equal(fs.existsSync(resolved.repository), true,
          'logical worktree path remains active during candidate action');
      }
      const primary = path.join(inspection.active_lease_root, 'repository');
      const portableAlias = path.join(primary, 'src', 'alias.txt');
      assert.equal(fs.lstatSync(portableAlias).isSymbolicLink(), false);
      assert.equal(fs.readFileSync(portableAlias, 'utf8'), 'a.txt',
        'tracked mode-120000 entry remains a clean portable regular file');
      assert.equal(fs.readFileSync(path.join(primary, '.git', 'shallow'), 'utf8'), `${commit}\n`,
        'exact shallow metadata is copied into every self-contained lease');
      const cachePack = path.join(initialInspection.cache, 'objects', 'pack',
        initialInspection.cache_pack_files.find((name) => name.endsWith('.pack')));
      const leasePack = path.join(primary, '.git', 'objects', 'pack',
        initialInspection.cache_pack_files.find((name) => name.endsWith('.pack')));
      const cachePackStat = fs.lstatSync(cachePack, { bigint: true });
      const leasePackStat = fs.lstatSync(leasePack, { bigint: true });
      assert.equal(leasePackStat.nlink, 1n);
      assert.equal(cachePackStat.nlink, 1n);
      assert.notDeepEqual([leasePackStat.dev, leasePackStat.ino],
        [cachePackStat.dev, cachePackStat.ino], 'lease pack is a byte copy, never a cache hardlink');
      assert.equal(sha256(fs.readFileSync(leasePack)), sha256(fs.readFileSync(cachePack)));
      assert.equal(materializer.inspectForTest().cache_digest, initialInspection.cache_digest);
      await assert.rejects(registry.lease(base, {
        expected_repository_state: expected,
      }), /only one physical repository lease may be active/);
      const forgedLease = { ...lease, start_digest: 'f'.repeat(64) };
      await assert.rejects(registry.verifyAndRelease(forgedLease),
        /differs from the exact issued lease/);
      assert.equal(materializer.inspectForTest().active_count, 1,
        'forged release input cannot mutate the physical lease lifecycle');
      assert.deepEqual(registry.resolve(lease.opaque_handle), resolved);
      const leaseRoot = inspection.active_lease_root;
      const release = await registry.verifyAndRelease(lease);
      assert.deepEqual(release, { end_digest: base.content_digest, cleanup_verified: true });
      assert.equal(absent(leaseRoot), true);
      assert.equal(materializer.inspectForTest().active_count, 0);
      assert.throws(() => registry.resolve(lease.opaque_handle), /unknown|no longer active/);
    }
  }
  assert.equal(handles.size, scenarios.length * 4);
  assert.equal(leaseRoots.size, handles.size);
  registry.assertEmpty();
  const root = materializer.inspectForTest().root;
  await registry.close();
  assert.equal(absent(root), true);
  await assert.rejects(registry.prepare(scenarios[0].scenario, collection), /closed/);

  console.log('real repository oracle persistent materializer passed');
} finally {
  makeWritableForTestCleanup(temporary);
  fs.rmSync(temporary, { recursive: true, force: true });
}
