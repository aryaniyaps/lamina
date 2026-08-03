#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnTrustedGit } from '../scripts/safe-runner/git.mjs';
import { collectionDigest } from '../benchmarks/real-repository-oracle-v1/contract.mjs';
import { createMaterializationRegistry } from '../benchmarks/real-repository-oracle-v1/materialization-registry.mjs';
import { createPersistentScenarioMaterializer } from '../benchmarks/real-repository-oracle-v1/persistent-materializer.mjs';
import { readRepositoryState } from '../benchmarks/real-repository-oracle-v1/repository-state.mjs';

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

if (process.platform === 'win32') {
  console.log('real repository oracle persistent materializer skipped: POSIX ownership required');
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
  runGit(origin, ['commit', '--quiet', '-m', 'synthetic pinned fixture']);
  const commit = runGit(origin, ['rev-parse', 'HEAD']);
  const treeOid = runGit(origin, ['rev-parse', 'HEAD^{tree}']);
  runGit(origin, ['repack', '-Ad', '--no-write-bitmap-index']);
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

  const materializer = createPersistentScenarioMaterializer({
    runnerTemporaryRoot: temporary,
    collection,
    seedBareRepository: path.join(origin, '.git'),
    maximumPackBytes: 16 * 1024 * 1024,
    maximumSnapshotBytes: 32 * 1024 * 1024,
  });
  const registry = createMaterializationRegistry(materializer);
  const initialInspection = materializer.inspectForTest();
  assert.ok([2, 3].includes(initialInspection.cache_pack_files.length));
  assert.equal(initialInspection.cache_pack_files.filter((name) => name.endsWith('.pack')).length, 1);
  assert.equal(initialInspection.cache_pack_files.filter((name) => name.endsWith('.idx')).length, 1);
  assert.equal(fs.existsSync(path.join(initialInspection.root, 'template')), false,
    'persistent materializer has no checked-out template copy');

  const handles = new Set();
  const leaseGitIdentities = new Set();
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
      assert.equal(fs.readFileSync(path.join(primary, '.git', 'shallow'), 'utf8'), `${commit}\n`,
        'exact shallow metadata is copied into every self-contained lease');
      const gitStat = fs.lstatSync(path.join(primary, '.git'), { bigint: true });
      leaseGitIdentities.add(`${gitStat.dev}:${gitStat.ino}`);
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
      const leaseRoot = inspection.active_lease_root;
      const release = await registry.verifyAndRelease(lease);
      assert.deepEqual(release, { end_digest: base.content_digest, cleanup_verified: true });
      assert.equal(absent(leaseRoot), true);
      assert.equal(materializer.inspectForTest().active_count, 0);
      assert.throws(() => registry.resolve(lease.opaque_handle), /unknown|no longer active/);
    }
  }
  assert.equal(handles.size, scenarios.length * 4);
  assert.equal(leaseGitIdentities.size, handles.size,
    'every current/candidate first/replay action receives an independent mutable Git directory');
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
