#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spawnTrustedGit } from '../scripts/safe-runner/git.mjs';
import { collectionDigest } from '../benchmarks/real-repository-oracle-v1/contract.mjs';
import { processIdentity } from '../scripts/safe-runner/processes.mjs';
import {
  recoverPersistentScenarioMaterializer,
} from '../benchmarks/real-repository-oracle-v1/persistent-materializer.mjs';

if (process.platform !== 'linux') {
  console.log('real repository oracle persistent recovery skipped: Linux SIGKILL and process evidence required');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = path.join(ROOT, 'tests/fixtures/persistent-materializer-crash-helper.mjs');
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
const makeWritable = (root) => {
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

const temporary = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-persistent-recovery-test-'),
));
fs.chmodSync(temporary, 0o700);
try {
  const origin = path.join(temporary, 'synthetic-origin');
  runGit(temporary, ['init', '--quiet', origin]);
  runGit(origin, ['config', 'user.name', 'Lamina Test']);
  runGit(origin, ['config', 'user.email', 'lamina@example.invalid']);
  fs.mkdirSync(path.join(origin, 'src'));
  fs.writeFileSync(path.join(origin, 'src/a.txt'), 'alpha\n', { mode: 0o600 });
  runGit(origin, ['add', '--', 'src/a.txt']);
  runGit(origin, ['commit', '--quiet', '-m', 'synthetic recovery fixture']);
  const commit = runGit(origin, ['rev-parse', 'HEAD']);
  const treeOid = runGit(origin, ['rev-parse', 'HEAD^{tree}']);
  runGit(origin, ['-c', 'pack.writeReverseIndex=false',
    'repack', '-Ad', '--no-write-bitmap-index']);
  runGit(origin, ['prune-packed']);
  const identity = {
    schema: 'lamina.real-repository-collection/v1', id: 'collection.synthetic-recovery',
    fixture_id: 'synthetic-recovery', fixture_class: 'synthetic-recovery',
    repository_url: 'https://example.invalid/recovery.git', commit, tree_oid: treeOid,
    baseline_manifest_sha256: 'a'.repeat(64), candidate_policy_sha256: 'b'.repeat(64),
  };
  const collection = { ...identity, collection_digest: collectionDigest(identity) };
  const cleanState = (role = 'primary', branch = '(detached)') => ({
    head: commit, branch, upstream: null, ahead: 0, behind: 0,
    worktree_role: role, changes: [],
  });
  const config = {
    runnerTemporaryRoot: temporary,
    seedBareRepository: path.join(origin, '.git'),
    collection,
    clean: { scenario: { kind: 'clean', name: 'clean', operations: [] }, expected: cleanState() },
    worktree: {
      scenario: { kind: 'worktree', name: 'worktree', operations: [{
        op: 'add_worktree', branch: 'lamina-oracle/recovery-worktree',
        worktree_id: 'oracle-worktree-recovery',
      }] },
      expected: cleanState('oracle-worktree-recovery', 'lamina-oracle/recovery-worktree'),
    },
  };
  const configFile = path.join(temporary, 'helper-config.json');
  fs.writeFileSync(configFile, JSON.stringify(config), { flag: 'wx', mode: 0o600 });

  async function killAt(boundary) {
    const child = spawn(process.execPath, [HELPER, configFile, boundary], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const recoveryOwnerIdentity = processIdentity(child.pid);
    assert.ok(recoveryOwnerIdentity, 'parent resolves the helper host PID and start ticks');
    child.send({ recovery_owner_identity: recoveryOwnerIdentity });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    const payload = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`helper timed out: ${stderr}`)), 20_000);
      child.stdout.on('data', (chunk) => {
        output += chunk.toString('utf8');
        if (Buffer.byteLength(output) > 128 * 1024) reject(new Error('helper output exceeded bound'));
        const newline = output.indexOf('\n');
        if (newline >= 0) {
          clearTimeout(timer);
          try { resolve(JSON.parse(output.slice(0, newline))); } catch (error) { reject(error); }
        }
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code !== null || signal !== null) reject(new Error(`helper exited before boundary: ${code}/${signal}: ${stderr}`));
      });
    });
    assert.equal(payload.boundary, boundary);
    assert.deepEqual(payload.authority.recovery_owner_identity, recoveryOwnerIdentity);
    assert.equal(fs.existsSync(payload.authority.root), true);
    if (boundary === 'logical_worktree_active') {
      assert.equal(payload.resolved.worktree_role, 'oracle-worktree-recovery');
      assert.equal(fs.existsSync(payload.resolved.repository), true);
      assert.equal(fs.existsSync(path.join(payload.inspection.active_lease_root,
        'repository', '.git', 'worktrees', 'oracle-worktree-recovery')), true);
    }
    if (boundary === 'released_before_close') {
      assert.equal(payload.inspection.active_count, 0);
      assert.deepEqual(fs.readdirSync(payload.inspection.leases), []);
    }
    const exitPromise = new Promise((resolve) => child.once('exit',
      (code, signal) => resolve({ code, signal })));
    assert.throws(() => recoverPersistentScenarioMaterializer(payload.authority),
      /owner process is still alive/);
    child.kill('SIGKILL');
    const exit = await exitPromise;
    assert.equal(exit.code, null);
    assert.equal(exit.signal, 'SIGKILL');
    return payload;
  }

  for (const boundary of [
    'cache_ready', 'lease_allocated', 'logical_worktree_active', 'released_before_close',
  ]) {
    const payload = await killAt(boundary);
    assert.deepEqual(recoverPersistentScenarioMaterializer(payload.authority), {
      recovered: true, root_removed: true,
    });
    assert.equal(absent(payload.authority.root), true, `${boundary} recovery removes its exact owned root`);
  }

  const substituted = await killAt('cache_ready');
  const markerFile = path.join(substituted.authority.root, '.owner.json');
  const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  marker.authority_token = 'f'.repeat(64);
  fs.writeFileSync(markerFile, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
  assert.throws(() => recoverPersistentScenarioMaterializer(substituted.authority),
    /marker was substituted/);

  const foreign = await killAt('cache_ready');
  fs.writeFileSync(path.join(foreign.authority.root, 'foreign'), 'foreign\n', { mode: 0o600 });
  assert.throws(() => recoverPersistentScenarioMaterializer(foreign.authority),
    /foreign entries/);

  const symlink = await killAt('cache_ready');
  fs.symlinkSync(configFile, path.join(symlink.inspection.leases, 'foreign-link'));
  assert.throws(() => recoverPersistentScenarioMaterializer(symlink.authority),
    /contains a symlink/);

  const hardlink = await killAt('cache_ready');
  const hardlinkSource = path.join(temporary, 'hardlink-source');
  fs.writeFileSync(hardlinkSource, 'linked\n', { mode: 0o600 });
  fs.linkSync(hardlinkSource, path.join(hardlink.inspection.leases, 'foreign-hardlink'));
  assert.throws(() => recoverPersistentScenarioMaterializer(hardlink.authority),
    /special path or hardlink/);

  const fifoTool = ['/usr/bin/mkfifo', '/bin/mkfifo'].find((candidate) => fs.existsSync(candidate));
  if (fifoTool) {
    const special = await killAt('cache_ready');
    const fifo = path.join(special.inspection.leases, 'foreign-fifo');
    const created = spawnSync(fifoTool, [fifo], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    assert.throws(() => recoverPersistentScenarioMaterializer(special.authority),
      /special path or hardlink/);
  }

  console.log('real repository oracle persistent materializer recovery passed');
} finally {
  makeWritable(temporary);
  fs.rmSync(temporary, { recursive: true, force: true });
}
