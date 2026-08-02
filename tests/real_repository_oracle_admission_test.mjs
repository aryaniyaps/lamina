#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_MANIFEST_SHA256, CANDIDATE_POLICY_SHA256, COLLECTION_PINS,
  REVIEWED_INVENTORIES, pinnedCollectionForTier, reviewedCollectionForTier,
} from '../benchmarks/real-repository-oracle-v1/collection-authority.mjs';
import {
  RECONSTRUCTION_LIMITS, candidateInventoryDigest, candidateInventoryFromTracked,
  createScratch, reconstructPinnedRepositoryInventory, removeScratch,
  verifyPinnedRepository, withOwnedScratch,
} from '../benchmarks/real-repository-oracle-v1/materialize.mjs';
import {
  EXACT_COMMAND, INVENTORY_ADMISSION_SCHEMA, INVENTORY_RECONSTRUCTION_SCHEMA,
  RECONSTRUCTION_EXACT_COMMAND, RECONSTRUCTION_WORKLOAD_ID, WORKLOAD_ID,
  inventoryAdmissionResult, inventoryReconstructionResult,
} from '../benchmarks/real-repository-oracle-v1/workload.mjs';
import { isExcludedPath, loadManifest } from '../benchmarks/runtime-baseline-v1/contract.mjs';
import {
  REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE, prepareExecutionSnapshot,
} from '../scripts/safe-runner/execution-snapshot.mjs';
import { spawnTrustedGit } from '../scripts/safe-runner/git.mjs';
import { sanitizedPayloadEnvironment } from '../scripts/safe-runner/infrastructure.mjs';
import {
  REAL_REPOSITORY_ORACLE_ENTRYPOINT, REAL_REPOSITORY_ORACLE_RECONSTRUCTION_WORKLOAD_ID,
  REAL_REPOSITORY_ORACLE_WORKLOAD_ID,
  auditedCommand, preflightRun,
} from '../scripts/safe-runner/preflight.mjs';
import { validatedSealedGitIdentity } from '../scripts/safe-runner/sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRYPOINT = path.join(ROOT, REAL_REPOSITORY_ORACLE_ENTRYPOINT);
const adapterInfo = {
  id: 'oracle-admission-test', platform: process.platform,
  production_enforcement: false, aggregate_memory: false, aggregate_pids: false,
  complete_descendant_ownership: false, controllers: [], reasons: ['test-only'],
};
const TEST_SOURCE_NAMES = new Set(['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']);
const testSha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function literalNativeSymlinkInventory(repository, entries, manifest, fixture) {
  const observationPaths = [];
  const retrievalPaths = [];
  let trackedBytes = 0;
  let observationBytes = 0;
  let retrievalBytes = 0;
  let sourceFiles = 0;
  let sourceBytes = 0;
  let sourceLoc = 0;
  const sourceExtensions = new Set(manifest.source_extensions);
  const retrievalExtensions = new Set(manifest.retrieval_extensions);
  for (const entry of entries) {
    const physical = path.join(repository, entry.path);
    let stat;
    try { stat = fs.statSync(physical); } catch { continue; }
    if (!stat.isFile()) continue;
    trackedBytes += stat.size;
    if (!isExcludedPath(entry.path, manifest.exclusions)) {
      observationPaths.push(entry.path);
      observationBytes += stat.size;
    }
    const extension = path.extname(entry.path).toLowerCase();
    if (retrievalExtensions.has(extension) && stat.size <= manifest.retrieval_max_file_bytes) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(physical));
        retrievalPaths.push(entry.path);
        retrievalBytes += stat.size;
      } catch {}
    }
    if (sourceExtensions.has(extension) || TEST_SOURCE_NAMES.has(path.basename(entry.path))) {
      sourceFiles += 1;
      sourceBytes += stat.size;
      if (stat.size <= 4 * 1024 * 1024) {
        sourceLoc += fs.readFileSync(physical, 'utf8')
          .split(/\r?\n/).filter((line) => line.trim()).length;
      }
    }
  }
  assert.ok(sourceLoc >= fixture.source_loc.minimum && sourceLoc <= fixture.source_loc.maximum);
  return {
    tracked_files: entries.length,
    tracked_bytes: trackedBytes,
    tracked_source_files: sourceFiles,
    tracked_source_bytes: sourceBytes,
    tracked_source_loc: sourceLoc,
    observation_indexed_files: observationPaths.length,
    observation_indexed_bytes: observationBytes,
    observation_paths_digest: testSha256(observationPaths.join('\n')),
    retrieval_candidate_files: retrievalPaths.length,
    retrieval_candidate_bytes: retrievalBytes,
    retrieval_paths_digest: testSha256(retrievalPaths.join('\n')),
  };
}

assert.equal(WORKLOAD_ID, REAL_REPOSITORY_ORACLE_WORKLOAD_ID);
assert.deepEqual(EXACT_COMMAND, ['admit-inventory']);
assert.equal(RECONSTRUCTION_WORKLOAD_ID, REAL_REPOSITORY_ORACLE_RECONSTRUCTION_WORKLOAD_ID);
assert.deepEqual(RECONSTRUCTION_EXACT_COMMAND, ['reconstruct-inventory']);
assert.deepEqual(RECONSTRUCTION_LIMITS, {
  max_tracked_entries: 6_000,
  max_counted_tracked_bytes: 256 * 1024 * 1024,
  max_followed_file_bytes: 64 * 1024 * 1024,
  max_retained_link_bytes: 4 * 1024 * 1024,
  max_symlink_traversals: 40,
  max_full_validation_work_units_per_alias: 32_768,
  max_full_validation_work_units_aggregate: 262_144,
});
assert.deepEqual(COLLECTION_PINS.small, {
  fixture_id: 'small', fixture_class: 'small',
  repository_url: 'https://github.com/alan2207/bulletproof-react.git',
  commit: '9506629ed003a561c6627735480cce4994244bb4',
  tree_oid: 'b03782f905ffcd394bdaf597c06322afbc8ed991',
});
assert.deepEqual(REVIEWED_INVENTORIES.small, {
  tracked_files: 535, tracked_bytes: 2_640_087,
  tracked_source_files: 438, tracked_source_bytes: 628_504, tracked_source_loc: 20_450,
  observation_indexed_files: 535, observation_indexed_bytes: 2_640_087,
  observation_paths_digest: 'a751c5ae498aad42ec231daf714f8bede3e76f1d6f083ccbe3b6097f666b07cc',
  retrieval_candidate_files: 467, retrieval_candidate_bytes: 693_785,
  retrieval_paths_digest: '8915cb111c9232dd2645d5b470e95fcfddc8a2293f4cc6881a9727c52864d52b',
});
const small = reviewedCollectionForTier('small');
assert.equal(small.baseline_manifest_sha256, BASELINE_MANIFEST_SHA256);
assert.equal(small.candidate_policy_sha256, CANDIDATE_POLICY_SHA256);
assert.equal(Object.isFrozen(small), true);
assert.equal(Object.isFrozen(small.manifest), true);
assert.equal(Object.isFrozen(small.manifest.fixtures[0]), true);
assert.equal(Object.isFrozen(small.fixture), true);
assert.throws(() => { small.fixture.commit = '0'.repeat(40); }, TypeError);
for (const tier of ['medium', 'large']) {
  const reconstructionCollection = pinnedCollectionForTier(tier);
  assert.equal(reconstructionCollection.fixture_id, tier);
  assert.equal(reconstructionCollection.fixture_class, tier);
  assert.equal('reviewed_inventory' in reconstructionCollection, false,
    'reconstruction authority must not consult or relabel reviewed inventory');
  assert.throws(() => reviewedCollectionForTier(tier),
    new RegExp(`${tier} inventory is temporarily unreviewed`));
}

const exactAudit = auditedCommand([process.execPath, ENTRYPOINT, 'admit-inventory'], ROOT);
assert.deepEqual({
  audited: exactAudit.audited,
  allow_network: exactAudit.allow_network,
  entrypoint: exactAudit.entrypoint,
}, { audited: true, allow_network: true, entrypoint: REAL_REPOSITORY_ORACLE_ENTRYPOINT });
const reconstructionAudit = auditedCommand(
  [process.execPath, ENTRYPOINT, 'reconstruct-inventory'], ROOT,
);
assert.deepEqual({
  audited: reconstructionAudit.audited,
  allow_network: reconstructionAudit.allow_network,
  entrypoint: reconstructionAudit.entrypoint,
}, { audited: true, allow_network: true, entrypoint: REAL_REPOSITORY_ORACLE_ENTRYPOINT });
for (const argv of [
  [process.execPath, ENTRYPOINT],
  [process.execPath, ENTRYPOINT, 'validate'],
  [process.execPath, ENTRYPOINT, 'admit-inventory', '--output', '/tmp/result'],
  [process.execPath, ENTRYPOINT, 'reconstruct-inventory', '--output', '/tmp/result'],
]) {
  const audit = auditedCommand(argv, ROOT);
  assert.equal(audit.audited, false);
  assert.equal(audit.allow_network, false);
}

const missingIdentity = preflightRun({
  tier: 'small', command: [process.execPath, ENTRYPOINT, 'admit-inventory'], cwd: ROOT,
  adapterInfo, injectedExistingProcesses: [], workloadId: null,
});
assert.ok(missingIdentity.reasons.some((reason) => reason.includes(REAL_REPOSITORY_ORACLE_WORKLOAD_ID)));
const exactIdentity = preflightRun({
  tier: 'small', command: [process.execPath, ENTRYPOINT, 'admit-inventory'], cwd: ROOT,
  adapterInfo, injectedExistingProcesses: [], workloadId: REAL_REPOSITORY_ORACLE_WORKLOAD_ID,
});
assert.ok(!exactIdentity.reasons.some((reason) => reason.includes('inventory admission requires --workload')));
const missingReconstructionIdentity = preflightRun({
  tier: 'small', command: [process.execPath, ENTRYPOINT, 'reconstruct-inventory'], cwd: ROOT,
  adapterInfo, injectedExistingProcesses: [], workloadId: null,
});
assert.ok(missingReconstructionIdentity.reasons
  .some((reason) => reason.includes(REAL_REPOSITORY_ORACLE_RECONSTRUCTION_WORKLOAD_ID)));
const crossedAdmissionIdentity = preflightRun({
  tier: 'small', command: [process.execPath, ENTRYPOINT, 'admit-inventory'], cwd: ROOT,
  adapterInfo, injectedExistingProcesses: [],
  workloadId: REAL_REPOSITORY_ORACLE_RECONSTRUCTION_WORKLOAD_ID,
});
assert.ok(crossedAdmissionIdentity.reasons
  .some((reason) => reason.includes(`inventory admission requires --workload ${REAL_REPOSITORY_ORACLE_WORKLOAD_ID}`)));
const crossedReconstructionIdentity = preflightRun({
  tier: 'small', command: [process.execPath, ENTRYPOINT, 'reconstruct-inventory'], cwd: ROOT,
  adapterInfo, injectedExistingProcesses: [], workloadId: REAL_REPOSITORY_ORACLE_WORKLOAD_ID,
});
assert.ok(crossedReconstructionIdentity.reasons
  .some((reason) => reason.includes(`inventory reconstruction requires --workload ${REAL_REPOSITORY_ORACLE_RECONSTRUCTION_WORKLOAD_ID}`)));
for (const tier of ['medium', 'large']) {
  const reconstructionPreflight = preflightRun({
    tier, command: [process.execPath, ENTRYPOINT, 'reconstruct-inventory'], cwd: ROOT,
    adapterInfo, injectedExistingProcesses: [],
    workloadId: REAL_REPOSITORY_ORACLE_RECONSTRUCTION_WORKLOAD_ID,
  });
  assert.equal(reconstructionPreflight.ownership.proven, true);
  assert.equal(reconstructionPreflight.ownership.network_access, 'audited-required');
  assert.ok(!reconstructionPreflight.reasons
    .some((reason) => reason.includes('inventory reconstruction requires --workload')));
}

const directUnknown = spawnSync(process.execPath, [ENTRYPOINT, 'unknown'], {
  cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
});
assert.notEqual(directUnknown.status, 0);
assert.match(`${directUnknown.stdout}\n${directUnknown.stderr}`,
  /usage: workload\.mjs <admit-inventory\|reconstruct-inventory>/);
const directExact = spawnSync(process.execPath, [ENTRYPOINT, 'admit-inventory'], {
  cwd: ROOT,
  env: { ...process.env, LAMINA_SAFE_RUNNER_BROKER: '' },
  encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
});
assert.notEqual(directExact.status, 0);
assert.match(`${directExact.stdout}\n${directExact.stderr}`, /must run through the canonical crash-safe command/);
const directReconstruction = spawnSync(process.execPath, [ENTRYPOINT, 'reconstruct-inventory'], {
  cwd: ROOT,
  env: { ...process.env, LAMINA_SAFE_RUNNER_BROKER: '' },
  encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
});
assert.notEqual(directReconstruction.status, 0);
assert.match(`${directReconstruction.stdout}\n${directReconstruction.stderr}`,
  /must run through the canonical crash-safe command/);

const semanticPoison = {
  SAFE_VALUE: 'kept', ORACLE_FIXTURE: '/caller/fixture', ORACLE_OUTPUT: '/caller/output',
  LAMINA_RETRIEVAL_MODEL_PATH: '/caller/retrieval', LAMINA_RETRIEVAL_TOKENIZER_PATH: '/caller/tokenizer',
  LAMINA_UV_BINARY: '/caller/uv', LAMINA_STANDALONE: '/caller/standalone',
  LAMINA_WORKER: '/caller/worker', LAMINA_MODEL: '/caller/model', LAMINA_BINARY: '/caller/binary',
  LAMINA_TEST_ARBITRARY_BYPASS: '1',
};
const payloadEnvironment = sanitizedPayloadEnvironment({
  sources: [semanticPoison], mode: 'run', auditedEntrypoint: REAL_REPOSITORY_ORACLE_ENTRYPOINT,
});
assert.equal(payloadEnvironment.SAFE_VALUE, 'kept');
for (const name of Object.keys(semanticPoison).filter((name) => name !== 'SAFE_VALUE')) {
  assert.equal(payloadEnvironment[name], undefined, `oracle payload must strip ${name}`);
}

assert.deepEqual(REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE, [
  'benchmarks/real-repository-oracle-v1/workload.mjs',
  'benchmarks/real-repository-oracle-v1/materialize.mjs',
  'benchmarks/real-repository-oracle-v1/collection-authority.mjs',
  'benchmarks/runtime-baseline-v1/contract.mjs',
  'benchmarks/runtime-baseline-v1/manifest.json',
  'packages/cli/lib/safe-runner-context.mjs',
  'packages/cli/lib/safe-runner-broker-client.mjs',
  'scripts/safe-runner/git.mjs',
  'scripts/safe-runner/infrastructure.mjs',
]);

const temporaryRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-oracle-admission-')));
fs.chmodSync(temporaryRoot, 0o700);
try {
  // Windows has no production trusted-Git/materialization adapter: keep all
  // pure contracts portable, but do not manufacture authority from PATH Git.
  const productionGitMaterializationClaim = process.platform !== 'win32';
  if (process.platform === 'win32') {
    assert.equal(productionGitMaterializationClaim, false,
      'Windows intentionally makes no production Git/materialization claim');
  } else {
    const sealProbe = path.join(ROOT, 'tests/fixtures/spawn-trusted-git-seal-probe.mjs');
    for (const mode of [
      'malformed', 'oversized', 'extra-field', 'mismatched', 'inode-mismatch',
      'mode-mismatch', 'arbitrary-path', 'valid',
    ]) {
      const probe = spawnSync(process.execPath, [sealProbe, mode], {
        cwd: temporaryRoot,
        env: { ...process.env, LAMINA_SAFE_GIT_IDENTITY: '' },
        encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.equal(probe.status, 0, `${mode}: ${probe.stderr}`);
      const evidence = JSON.parse(probe.stdout);
      assert.equal(evidence.removed_after_first, true);
      assert.equal(evidence.first.ok, mode === 'valid');
      assert.equal(evidence.retry.ok, mode === 'valid',
        `${mode} retry must ${mode === 'valid' ? 'retain verified continuity' : 'remain poisoned'}`);
    }

    const snapshotRepository = path.join(temporaryRoot, 'snapshot-repository');
    const snapshotInit = spawnTrustedGit(temporaryRoot, ['init', '--quiet', snapshotRepository], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(snapshotInit.status, 0, snapshotInit.stderr);
    for (const relative of REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE) {
      const source = path.join(ROOT, relative);
      const destination = path.join(snapshotRepository, relative);
      const stat = fs.lstatSync(source);
      assert.equal(stat.isFile() && !stat.isSymbolicLink(), true,
        `${relative} must be a physical source file`);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, stat.mode & 0o777);
    }
    function snapshotGit(args) {
      const result = spawnTrustedGit(snapshotRepository, args, {
        encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
      return String(result.stdout || '').trim();
    }
    snapshotGit(['add', '--', ...REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE]);
    snapshotGit(['-c', 'user.name=Lamina Test', '-c', 'user.email=lamina@example.invalid',
      'commit', '--quiet', '-m', 'sealed oracle source fixture']);
    const snapshotCommit = snapshotGit(['rev-parse', 'HEAD']);
    snapshotGit(['checkout', '--quiet', '--detach', snapshotCommit]);
    const snapshotEntrypoint = path.join(snapshotRepository, REAL_REPOSITORY_ORACLE_ENTRYPOINT);
    for (const commandName of ['admit-inventory', 'reconstruct-inventory']) {
      const snapshotTemporary = path.join(temporaryRoot, `snapshot-${commandName}`);
      fs.mkdirSync(snapshotTemporary, { mode: 0o700 });
      const snapshot = prepareExecutionSnapshot({
        cwd: snapshotRepository,
        command: [process.execPath, snapshotEntrypoint, commandName],
        temporaryDirectory: snapshotTemporary,
      });
      assert.equal(snapshot.audited_entrypoint, REAL_REPOSITORY_ORACLE_ENTRYPOINT);
      assert.deepEqual(snapshot.entries
        .filter((entry) => entry.label.startsWith('repository:'))
        .map((entry) => entry.label.slice('repository:'.length)).sort(),
      [...REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE].sort());
      assert.deepEqual(snapshot.environment_overrides, {},
        'oracle snapshot reintroduces no model or worker assets');
      assert.deepEqual(snapshot.writable_bindings, [],
        'oracle argv supplies no writable repository or output binding');
      assert.equal(snapshot.launch_command.length, 3);
      assert.equal(snapshot.launch_command[2], commandName);
      assert.match(snapshot.git_executable_identity?.digest || '', /^[a-f0-9]{64}$/);
      assert.match(validatedSealedGitIdentity(snapshot), /^[A-Za-z0-9_-]+$/);
    }
  }

  assert.throws(() => createScratch(`${temporaryRoot}${path.sep}.`),
    /canonical private safe-runner temporary authority/,
    'a lexically noncanonical quota-root path must not gain cleanup authority');
  if (process.platform !== 'win32') {
    const quotaRootLink = path.join(temporaryRoot, 'quota-root-link');
    fs.symlinkSync(temporaryRoot, quotaRootLink);
    assert.throws(() => createScratch(quotaRootLink),
      /canonical private safe-runner temporary authority/,
      'a symlinked quota root must not gain cleanup authority');
    fs.unlinkSync(quotaRootLink);

    const permissiveQuotaRoot = path.join(temporaryRoot, 'permissive-quota-root');
    fs.mkdirSync(permissiveQuotaRoot, { mode: 0o755 });
    fs.chmodSync(permissiveQuotaRoot, 0o755);
    assert.throws(() => createScratch(permissiveQuotaRoot),
      /canonical private safe-runner temporary authority/,
      'the workload keeps the private-root contract that bwrap now creates with --perms 0700');
    fs.rmdirSync(permissiveQuotaRoot);
  }

  const quotaForeignSibling = path.join(temporaryRoot, 'foreign-sibling');
  fs.writeFileSync(quotaForeignSibling, 'never workload-owned');
  const successScratch = createScratch(temporaryRoot);
  assert.deepEqual(fs.readdirSync(successScratch.template), [],
    'the Git template authority starts empty');
  assert.equal(fs.realpathSync.native(successScratch.template), successScratch.template);
  if (process.platform !== 'win32') {
    assert.equal(fs.lstatSync(successScratch.root).mode & 0o077, 0,
      'the workload-owned scratch child must remain private');
    assert.equal(fs.lstatSync(successScratch.marker).mode & 0o077, 0,
      'the workload-owned marker must remain private');
    assert.equal(fs.lstatSync(successScratch.template).mode & 0o077, 0,
      'the empty Git template authority must remain private');
  }
  fs.mkdirSync(successScratch.source);
  fs.writeFileSync(path.join(successScratch.source, 'owned'), 'owned');
  removeScratch(successScratch);
  assert.equal(fs.existsSync(successScratch.root), false);
  assert.equal(fs.readFileSync(quotaForeignSibling, 'utf8'), 'never workload-owned',
    'success cleanup must preserve foreign siblings at the quota root');
  assert.equal(fs.existsSync(temporaryRoot), true, 'cleanup must never delete the quota root');

  if (productionGitMaterializationClaim) {
    const templateScratch = createScratch(temporaryRoot);
    const templateInit = spawnTrustedGit(templateScratch.root, [
      '-c', 'core.symlinks=false', 'init', `--template=${templateScratch.template}`,
      '--quiet', templateScratch.source,
    ], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(templateInit.status, 0, templateInit.stderr);
    assert.deepEqual(fs.readdirSync(templateScratch.template), [],
      'Git init cannot import ambient hooks through the owned empty template');
    const persistedSymlinks = spawnTrustedGit(templateScratch.source, [
      'config', '--local', '--get-all', 'core.symlinks',
    ], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(persistedSymlinks.status, 1,
      'command-line symlink policy must not persist mutable repository config');
    removeScratch(templateScratch);
  }

  let failedScratchRoot;
  assert.throws(() => withOwnedScratch(temporaryRoot, (scratch) => {
    failedScratchRoot = scratch.root;
    fs.mkdirSync(scratch.source);
    fs.writeFileSync(path.join(scratch.source, 'owned-before-failure'), 'owned');
    throw new Error('simulated inventory error');
  }), /simulated inventory error/);
  assert.equal(fs.existsSync(failedScratchRoot), false, 'owned scratch is removed after workload error');
  assert.equal(fs.readFileSync(quotaForeignSibling, 'utf8'), 'never workload-owned',
    'failure cleanup must preserve foreign siblings at the quota root');
  assert.equal(fs.existsSync(temporaryRoot), true, 'failure cleanup must preserve the quota root');

  const foreignScratch = createScratch(temporaryRoot);
  const foreign = path.join(foreignScratch.root, 'foreign');
  fs.writeFileSync(foreign, 'do not delete');
  assert.throws(() => removeScratch(foreignScratch), /contains foreign entries/);
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'do not delete');
  fs.rmSync(foreignScratch.root, { recursive: true, force: false });
  fs.unlinkSync(quotaForeignSibling);

  if (productionGitMaterializationClaim) {
  const repository = path.join(temporaryRoot, 'tiny-repository');
  function git(args) {
    const result = spawnTrustedGit(temporaryRoot, args, {
      encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    return String(result.stdout || '').trim();
  }
  git(['init', '--quiet', repository]);
  fs.writeFileSync(path.join(repository, 'a.ts'), 'export const answer = 42;\n');
  fs.writeFileSync(path.join(repository, 'package.json'), '{"name":"tiny"}\n');
  function repositoryGit(args) {
    const result = spawnTrustedGit(repository, args, {
      encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    return String(result.stdout || '').trim();
  }
  repositoryGit(['add', '--', 'a.ts', 'package.json']);
  repositoryGit(['-c', 'user.name=Lamina Test', '-c', 'user.email=lamina@example.invalid',
    'commit', '--quiet', '-m', 'tiny fixture']);
  const commit = repositoryGit(['rev-parse', 'HEAD']);
  const treeOid = repositoryGit(['rev-parse', 'HEAD^{tree}']);
  repositoryGit(['checkout', '--quiet', '--detach', commit]);
  const { manifest } = loadManifest();
  const fixture = { id: 'tiny', class: 'tiny', source_loc: { minimum: 1, maximum: 100 } };
  const entries = ['a.ts', 'package.json'];
  const inventory = candidateInventoryFromTracked(repository, entries, manifest, fixture);
  const stageRecord = repositoryGit(['ls-files', '--stage', '--', 'a.ts']);
  const stageMatch = stageRecord.match(/^([0-7]{6}) ([a-f0-9]{40,64}) 0\t(.+)$/);
  assert.ok(stageMatch);
  const stageEntries = repositoryGit(['ls-files', '--stage', '-z']).split('\0').filter(Boolean)
    .map((record) => {
      const match = record.match(/^([0-7]{6}) ([a-f0-9]{40,64}) ([0-3])\t([\s\S]+)$/);
      assert.ok(match);
      return { mode: match[1], oid: match[2], path: match[4] };
    });
  assert.throws(() => candidateInventoryFromTracked(repository, stageEntries, manifest, fixture, {
    objectFormat: repositoryGit(['rev-parse', '--show-object-format']),
    maximumTrackedBytes: 1,
    maximumEntries: 10,
  }), /aggregate retained-byte bound/,
  'the first pass refuses before retaining regular-file buffers beyond the aggregate bound');
  fs.writeFileSync(path.join(repository, 'a.ts'), 'export const answer = 41;\n');
  assert.throws(() => candidateInventoryFromTracked(repository, [{
    mode: stageMatch[1], oid: stageMatch[2], path: stageMatch[3],
  }], manifest, fixture, {
    objectFormat: repositoryGit(['rev-parse', '--show-object-format']),
    maximumTrackedBytes: 1024,
  }), /physical bytes or mode do not match the stage-0 Git object/);
  fs.writeFileSync(path.join(repository, 'a.ts'), 'export const answer = 42;\n');
  const collection = {
    commit, tree_oid: treeOid, manifest, fixture, reviewed_inventory: inventory,
  };
  assert.deepEqual(verifyPinnedRepository(repository, collection), inventory);
  function inventoryWithLateMutation(action, targetInventory = inventory) {
    let mutated = false;
    return new Proxy(targetInventory, {
      get(target, property, receiver) {
        if (!mutated && property === 'tracked_bytes') {
          mutated = true;
          action();
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }
  assert.throws(() => verifyPinnedRepository(repository, {
    ...collection,
    reviewed_inventory: inventoryWithLateMutation(() => {
      repositoryGit(['checkout', '--quiet', '-b', 'late-branch']);
    }),
  }), /changed during inventory admission/,
  'final verification must reread and reject a branch attached during inventory');
  repositoryGit(['checkout', '--quiet', '--detach', commit]);
  repositoryGit(['branch', '-D', 'late-branch']);
  assert.throws(() => verifyPinnedRepository(repository, {
    ...collection,
    reviewed_inventory: inventoryWithLateMutation(() => {
      repositoryGit(['remote', 'add', 'late', 'https://example.invalid/tiny.git']);
    }),
  }), /changed during inventory admission/,
  'final verification must reread and reject a remote added during inventory');
  repositoryGit(['remote', 'remove', 'late']);
  assert.throws(() => verifyPinnedRepository(repository, {
    ...collection, reviewed_inventory: { ...inventory, tracked_bytes: inventory.tracked_bytes + 1 },
  }), /reviewed inventory mismatch for tracked_bytes/);
  assert.throws(() => verifyPinnedRepository(repository, {
    ...collection, tree_oid: '0'.repeat(40),
  }), /exact detached, clean, remote-free pinned collection/);
  const emptyUntrackedDirectory = path.join(repository, 'untracked-empty-directory');
  fs.mkdirSync(emptyUntrackedDirectory);
  assert.equal(repositoryGit(['status', '--porcelain=v2', '--untracked-files=all']), '');
  assert.throws(() => verifyPinnedRepository(repository, collection),
    /directory is not implied by stage-0/,
  'physical exactness rejects empty directories that Git status cannot report');
  fs.rmdirSync(emptyUntrackedDirectory);
  if (process.platform === 'linux') {
    repositoryGit(['config', '--local', '--bool', 'core.ignorecase', 'true']);
    fs.copyFileSync(path.join(repository, 'a.ts'), path.join(repository, 'A.ts'));
    assert.equal(repositoryGit(['status', '--porcelain=v2', '--untracked-files=all']), '',
      'the regression reproduces Git status hiding a case-colliding worktree path');
    assert.throws(() => verifyPinnedRepository(repository, collection),
      /file is not an exact stage-0 path: A\.ts/,
    'stage-authoritative physical exactness rejects the hidden case collision');
    fs.unlinkSync(path.join(repository, 'A.ts'));
    repositoryGit(['config', '--local', '--unset', 'core.ignorecase']);
  }
  fs.writeFileSync(path.join(repository, 'untracked.txt'), 'dirty');
  assert.throws(() => verifyPinnedRepository(repository, collection), /exact detached, clean, remote-free pinned collection/);

  {
    const runRepositoryGit = (cwd, args) => {
      const completed = spawnTrustedGit(cwd, args, {
        encoding: 'utf8', timeout: 5_000, maxBuffer: 256 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.equal(completed.status, 0, `${args.join(' ')}: ${completed.stderr}`);
      return String(completed.stdout || '');
    };
    const parseStageEntries = (cwd) => runRepositoryGit(cwd, ['ls-files', '--stage', '-z'])
      .split('\0').filter(Boolean).map((record) => {
        const match = record.match(/^([0-7]{6}) ([a-f0-9]{40,64}) ([0-3])\t([\s\S]+)$/);
        assert.ok(match);
        assert.equal(match[3], '0');
        return { mode: match[1], oid: match[2], path: match[4] };
      });
    const portableRepository = path.join(temporaryRoot, 'portable-link-repository');
    runRepositoryGit(temporaryRoot, ['init', '--quiet', portableRepository]);
    fs.mkdirSync(path.join(portableRepository, 'docs'));
    const targetText = 'export const linked = true;\n';
    const excludedTargetText = 'export const excludedTarget = true;\n';
    const readmeText = '# Tracked docs\n';
    fs.mkdirSync(path.join(portableRepository, 'dist'));
    fs.writeFileSync(path.join(portableRepository, 'target.txt'), targetText);
    fs.writeFileSync(path.join(portableRepository, 'dist/target.txt'), excludedTargetText);
    fs.writeFileSync(path.join(portableRepository, 'docs/readme.md'), readmeText);
    fs.symlinkSync('target.txt', path.join(portableRepository, 'alias.ts'));
    fs.symlinkSync('target.txt', path.join(portableRepository, 'alias-copy.ts'));
    fs.symlinkSync('dist/target.txt', path.join(portableRepository, 'included-alias.ts'));
    fs.symlinkSync('../target.txt', path.join(portableRepository, 'dist/excluded-alias.ts'));
    fs.symlinkSync('docs', path.join(portableRepository, 'docs-link'));
    const portablePaths = [
      'target.txt', 'dist/target.txt', 'docs/readme.md', 'alias.ts', 'alias-copy.ts',
      'included-alias.ts', 'dist/excluded-alias.ts', 'docs-link',
    ];
    runRepositoryGit(portableRepository, ['add', '--', ...portablePaths]);
    runRepositoryGit(portableRepository, [
      '-c', 'user.name=Lamina Test', '-c', 'user.email=lamina@example.invalid',
      'commit', '--quiet', '-m', 'tracked symlink fixture',
    ]);
    const portableCommit = runRepositoryGit(portableRepository, ['rev-parse', 'HEAD']).trim();
    const portableTree = runRepositoryGit(portableRepository, ['rev-parse', 'HEAD^{tree}']).trim();
    runRepositoryGit(portableRepository, ['checkout', '--quiet', '--detach', portableCommit]);
    const portableEntries = parseStageEntries(portableRepository);
    const portableObjectFormat = runRepositoryGit(
      portableRepository, ['rev-parse', '--show-object-format'],
    ).trim();
    assert.equal(fs.statSync(path.join(portableRepository, 'alias.ts')).isFile(), true);
    assert.equal(fs.statSync(path.join(portableRepository, 'docs-link')).isDirectory(), true);
    const portableFixture = {
      id: 'portable-link', class: 'portable-link', source_loc: { minimum: 0, maximum: 100 },
    };
    const nativeInventory = literalNativeSymlinkInventory(
      portableRepository, portableEntries, manifest, portableFixture,
    );
    assert.throws(() => candidateInventoryFromTracked(
      portableRepository, portableEntries, manifest, portableFixture,
      {
        objectFormat: portableObjectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, portableCheckout: true,
      },
    ), /not a physical single-link regular file/,
    'an actual filesystem symlink remains refused even with core.symlinks=false');
    fs.unlinkSync(path.join(portableRepository, 'alias.ts'));
    fs.unlinkSync(path.join(portableRepository, 'alias-copy.ts'));
    fs.unlinkSync(path.join(portableRepository, 'included-alias.ts'));
    fs.unlinkSync(path.join(portableRepository, 'dist/excluded-alias.ts'));
    fs.unlinkSync(path.join(portableRepository, 'docs-link'));
    runRepositoryGit(portableRepository, [
      '-c', 'core.symlinks=false', 'checkout-index', '--force', '--',
      'alias.ts', 'alias-copy.ts', 'included-alias.ts', 'dist/excluded-alias.ts', 'docs-link',
    ]);
    assert.equal(fs.lstatSync(path.join(portableRepository, 'alias.ts')).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(portableRepository, 'alias.ts'), 'utf8'), 'target.txt');
    const portableCandidate = reconstructPinnedRepositoryInventory(portableRepository, {
      commit: portableCommit, tree_oid: portableTree, manifest, fixture: portableFixture,
    });
    assert.deepEqual(portableCandidate.inventory, nativeInventory,
      'portable checkout must preserve all eleven #60 native-symlink inventory fields');
    assert.equal(portableCandidate.inventory.tracked_bytes,
      nativeInventory.tracked_bytes,
    'portable reconstruction preserves the native symlink checkout byte semantics');
    assert.equal(portableCandidate.candidate_inventory_sha256,
      candidateInventoryDigest(portableCandidate.inventory));
    assert.equal(portableCandidate.portable_link_resolution.alias_count, 5);
    assert.equal(portableCandidate.portable_link_resolution.max_symlink_traversals, 40);
    assert.deepEqual({
      work_unit: portableCandidate.portable_link_resolution.full_validation.work_unit,
      per_alias: portableCandidate.portable_link_resolution.full_validation.max_work_units_per_alias,
      aggregate: portableCandidate.portable_link_resolution.full_validation.max_work_units_aggregate,
    }, {
      work_unit: 'one_link_follow_or_one_popped_expansion_token',
      per_alias: 32_768,
      aggregate: 262_144,
    });
    assert.ok(portableCandidate.portable_link_resolution.full_validation.consumed_work_units > 0);
    const portableEntryByPath = new Map(portableEntries.map((entry) => [entry.path, entry]));
    for (const record of portableCandidate.portable_link_resolution.records) {
      assert.equal(record.link_oid, portableEntryByPath.get(record.path).oid);
      assert.equal(record.link_byte_length, Buffer.byteLength(record.link_target_text));
      assert.equal(record.traversal_limit, 40);
      if (record.target_kind === 'file') {
        assert.equal(record.target_oid, portableEntryByPath.get(record.target_path).oid);
        assert.equal(record.target_size,
          fs.statSync(path.join(portableRepository, record.target_path)).size);
      } else {
        assert.equal(record.target_oid, null);
        assert.equal(record.target_size, null);
      }
      assert.equal(record.contribution.tracked_bytes,
        record.target_kind === 'file' ? record.target_size : 0);
    }
    assert.deepEqual(portableCandidate.portable_link_resolution.records.map((record) => ({
      path: record.path, target_kind: record.target_kind, target_path: record.target_path,
    })), [
      { path: 'alias-copy.ts', target_kind: 'file', target_path: 'target.txt' },
      { path: 'alias.ts', target_kind: 'file', target_path: 'target.txt' },
      { path: 'dist/excluded-alias.ts', target_kind: 'file', target_path: 'target.txt' },
      { path: 'docs-link', target_kind: 'directory', target_path: 'docs' },
      { path: 'included-alias.ts', target_kind: 'file', target_path: 'dist/target.txt' },
    ]);
    assert.match(portableCandidate.portable_link_resolution.sha256, /^[a-f0-9]{64}$/,
      'portable alias decisions are emitted as digestible reconstruction evidence');
    assert.equal(portableCandidate.portable_link_resolution.sha256,
      testSha256(JSON.stringify({
        max_symlink_traversals: 40,
        full_validation: portableCandidate.portable_link_resolution.full_validation,
        records: portableCandidate.portable_link_resolution.records,
      })),
    'archive evidence SHA covers target text, OIDs, sizes, traversal, and metric contributions');
    const portableCollection = {
      commit: portableCommit, tree_oid: portableTree, manifest,
      fixture: portableFixture, reviewed_inventory: portableCandidate.inventory,
    };
    assert.deepEqual(verifyPinnedRepository(portableRepository, portableCollection),
      portableCandidate.inventory);
    assert.throws(() => verifyPinnedRepository(portableRepository, {
      ...portableCollection,
      reviewed_inventory: inventoryWithLateMutation(() => {
        runRepositoryGit(portableRepository, [
          'config', '--local', '--bool', 'core.symlinks', 'true',
        ]);
      }, portableCandidate.inventory),
    }), /outside the exact allowlist/,
    'final verification rejects a checkout-policy mutation during inventory comparison');
    runRepositoryGit(portableRepository, ['config', '--local', '--unset', 'core.symlinks']);
    assert.throws(() => candidateInventoryFromTracked(
      portableRepository, portableEntries, manifest, portableFixture,
      {
        objectFormat: portableObjectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, maximumRetainedLinkBytes: 1, portableCheckout: true,
      },
    ), /aggregate retained-link-byte bound/,
    'portable link bodies have a separate aggregate retention cap');

    const portableCounterexample = (name, links, afterAdd = () => {}) => {
      const cwd = path.join(temporaryRoot, name);
      runRepositoryGit(temporaryRoot, ['init', '--quiet', cwd]);
      for (const [link, target] of links) fs.symlinkSync(target, path.join(cwd, link));
      runRepositoryGit(cwd, ['add', '--', ...links.map(([link]) => link)]);
      afterAdd(cwd);
      const entries = parseStageEntries(cwd);
      const nativeInventory = literalNativeSymlinkInventory(
        cwd, entries, manifest, portableFixture,
      );
      for (const [link] of links) fs.unlinkSync(path.join(cwd, link));
      runRepositoryGit(cwd, [
        '-c', 'core.symlinks=false', 'checkout-index', '--force', '--',
        ...links.map(([link]) => link),
      ]);
      return {
        cwd,
        entries,
        nativeInventory,
        objectFormat: runRepositoryGit(cwd, ['rev-parse', '--show-object-format']).trim(),
      };
    };
    fs.writeFileSync(path.join(temporaryRoot, 'outside-target.ts'), 'outside\n');
    const outside = portableCounterexample('outside-link', [['outside.ts', '../outside-target.ts']]);
    assert.throws(() => candidateInventoryFromTracked(
      outside.cwd, outside.entries, manifest, portableFixture,
      {
        objectFormat: outside.objectFormat,
        maximumTrackedBytes: RECONSTRUCTION_LIMITS.max_counted_tracked_bytes,
        maximumEntries: RECONSTRUCTION_LIMITS.max_tracked_entries,
        maximumFileBytes: RECONSTRUCTION_LIMITS.max_followed_file_bytes,
        portableCheckout: true,
      },
    ), /target escapes repository content/);
    const broken = portableCounterexample('broken-link', [['broken.ts', 'missing.ts']]);
    assert.throws(() => candidateInventoryFromTracked(
      broken.cwd, broken.entries, manifest, portableFixture,
      {
        objectFormat: broken.objectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, portableCheckout: true,
      },
    ), /target is broken/);
    const cyclic = portableCounterexample('cyclic-link', [['a.ts', 'b.ts'], ['b.ts', 'a.ts']]);
    assert.throws(() => candidateInventoryFromTracked(
      cyclic.cwd, cyclic.entries, manifest, portableFixture,
      {
        objectFormat: cyclic.objectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, portableCheckout: true,
      },
    ), /target is cyclic/);
    const untracked = portableCounterexample(
      'untracked-link', [['alias.ts', 'untracked.ts']],
      (cwd) => fs.writeFileSync(path.join(cwd, 'untracked.ts'), 'untracked\n'),
    );
    assert.throws(() => candidateInventoryFromTracked(
      untracked.cwd, untracked.entries, manifest, portableFixture,
      {
        objectFormat: untracked.objectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, portableCheckout: true,
      },
    ), /targets an untracked file/);
    const invalidUtf8 = portableCounterexample(
      'invalid-utf8-link', [['invalid.ts', Buffer.from([0xff])]],
    );
    assert.throws(() => candidateInventoryFromTracked(
      invalidUtf8.cwd, invalidUtf8.entries, manifest, portableFixture,
      {
        objectFormat: invalidUtf8.objectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, portableCheckout: true,
      },
    ), /target is not UTF-8/);

    const invalidContentRepository = path.join(temporaryRoot, 'invalid-target-content');
    runRepositoryGit(temporaryRoot, ['init', '--quiet', invalidContentRepository]);
    fs.writeFileSync(path.join(invalidContentRepository, 'invalid.bin'), Buffer.from([0xff, 0x0a]));
    fs.symlinkSync('invalid.bin', path.join(invalidContentRepository, 'invalid-content.ts'));
    runRepositoryGit(invalidContentRepository, [
      'add', '--', 'invalid.bin', 'invalid-content.ts',
    ]);
    const invalidContentEntries = parseStageEntries(invalidContentRepository);
    const invalidContentFixture = {
      id: 'invalid-content', class: 'invalid-content', source_loc: { minimum: 1, maximum: 1 },
    };
    const nativeInvalidContentInventory = literalNativeSymlinkInventory(
      invalidContentRepository, invalidContentEntries, manifest, invalidContentFixture,
    );
    fs.unlinkSync(path.join(invalidContentRepository, 'invalid-content.ts'));
    runRepositoryGit(invalidContentRepository, [
      '-c', 'core.symlinks=false', 'checkout-index', '--force', '--', 'invalid-content.ts',
    ]);
    const invalidContentEvidence = [];
    const portableInvalidContentInventory = candidateInventoryFromTracked(
      invalidContentRepository, invalidContentEntries, manifest, invalidContentFixture,
      {
        objectFormat: runRepositoryGit(
          invalidContentRepository, ['rev-parse', '--show-object-format'],
        ).trim(),
        maximumTrackedBytes: 1024, maximumEntries: 10, portableCheckout: true,
        portableResolutionEvidence: invalidContentEvidence,
      },
    );
    assert.deepEqual(portableInvalidContentInventory, nativeInvalidContentInventory,
      'invalid UTF-8 target file content preserves all eleven native inventory fields');
    assert.equal(portableInvalidContentInventory.retrieval_candidate_files, 0);
    assert.equal(portableInvalidContentInventory.tracked_source_files, 1);
    assert.equal(portableInvalidContentInventory.tracked_source_loc, 1);
    assert.deepEqual({
      retrieval_included: invalidContentEvidence[0].contribution.retrieval_included,
      source_included: invalidContentEvidence[0].contribution.source_included,
      source_loc: invalidContentEvidence[0].contribution.source_loc,
    }, { retrieval_included: false, source_included: true, source_loc: 1 });

    const bomRepository = path.join(temporaryRoot, 'bom-target-name');
    runRepositoryGit(temporaryRoot, ['init', '--quiet', bomRepository]);
    const bomTarget = '\uFEFFtarget.txt';
    fs.writeFileSync(path.join(bomRepository, bomTarget), targetText);
    fs.symlinkSync(bomTarget, path.join(bomRepository, 'bom-alias.ts'));
    runRepositoryGit(bomRepository, ['add', '--', bomTarget, 'bom-alias.ts']);
    const bomEntries = parseStageEntries(bomRepository);
    const nativeBomInventory = literalNativeSymlinkInventory(
      bomRepository, bomEntries, manifest, portableFixture,
    );
    fs.unlinkSync(path.join(bomRepository, 'bom-alias.ts'));
    runRepositoryGit(bomRepository, [
      '-c', 'core.symlinks=false', 'checkout-index', '--force', '--', 'bom-alias.ts',
    ]);
    const bomEvidence = [];
    const portableBomInventory = candidateInventoryFromTracked(
      bomRepository, bomEntries, manifest, portableFixture,
      {
        objectFormat: runRepositoryGit(bomRepository, ['rev-parse', '--show-object-format']).trim(),
        maximumTrackedBytes: 1024, maximumEntries: 10, portableCheckout: true,
        portableResolutionEvidence: bomEvidence,
      },
    );
    assert.deepEqual(portableBomInventory, nativeBomInventory,
      'a BOM-prefixed tracked filename remains byte-for-byte addressable');
    assert.equal(bomEvidence[0].link_target_text, bomTarget,
      'UTF-8 decoding preserves the leading BOM as a filename character');
    assert.equal(bomEvidence[0].target_oid,
      new Map(bomEntries.map((entry) => [entry.path, entry])).get(bomTarget).oid);

    fs.writeFileSync(path.join(portableRepository, 'alias.ts'), 'docs');
    assert.throws(() => candidateInventoryFromTracked(
      portableRepository, portableEntries, manifest, portableFixture,
      {
        objectFormat: portableObjectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, portableCheckout: true,
      },
    ), /bytes do not match the stage-0 Git object/,
    'a regular file with the wrong link body cannot choose another target');
    fs.writeFileSync(path.join(portableRepository, 'alias.ts'), 'target.txt');

    runRepositoryGit(portableRepository, ['config', '--local', '--bool', 'core.symlinks', 'true']);
    assert.throws(() => candidateInventoryFromTracked(
      portableRepository, portableEntries, manifest, portableFixture,
      {
        objectFormat: portableObjectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, portableCheckout: true,
      },
    ), /exact allowlist/);
    runRepositoryGit(portableRepository, ['config', '--local', '--unset', 'core.symlinks']);
    assert.throws(() => candidateInventoryFromTracked(
      portableRepository, portableEntries, manifest, portableFixture,
      { objectFormat: portableObjectFormat, maximumTrackedBytes: 1024, maximumEntries: 10 },
    ), /requires proved command-line core\.symlinks=false checkout/);
    runRepositoryGit(portableRepository, ['config', '--local', '--bool', 'core.ignorecase', 'true']);
    runRepositoryGit(portableRepository, [
      'config', '--local', '--bool', 'core.precomposeunicode', 'false',
    ]);
    const optionalProbeInventory = () => candidateInventoryFromTracked(
      portableRepository, portableEntries, manifest, portableFixture,
      {
        objectFormat: portableObjectFormat, maximumTrackedBytes: 4096,
        maximumEntries: 10, portableCheckout: true,
      },
    );
    if (process.platform === 'darwin') {
      assert.deepEqual(optionalProbeInventory(), portableCandidate.inventory,
        'Darwin admits only Git init filesystem probe keys with boolean values');
    } else {
      assert.throws(optionalProbeInventory, /outside the exact allowlist/,
        'Linux admits no mutable case-folding or Unicode-composition probe');
    }
    runRepositoryGit(portableRepository, ['config', '--local', '--unset', 'core.ignorecase']);
    runRepositoryGit(portableRepository, ['config', '--local', '--unset', 'core.precomposeunicode']);
    if (process.platform === 'darwin') {
      runRepositoryGit(portableRepository, ['config', '--local', 'core.ignorecase', 'auto']);
      assert.throws(optionalProbeInventory, /outside the exact allowlist/);
      runRepositoryGit(portableRepository, ['config', '--local', '--unset', 'core.ignorecase']);
    }
    runRepositoryGit(portableRepository, ['config', '--local', 'core.autocrlf', 'false']);
    assert.throws(() => candidateInventoryFromTracked(
      portableRepository, portableEntries, manifest, portableFixture,
      {
        objectFormat: portableObjectFormat, maximumTrackedBytes: 4096,
        maximumEntries: 10, portableCheckout: true,
      },
    ), /outside the exact allowlist/);
    runRepositoryGit(portableRepository, ['config', '--local', '--unset', 'core.autocrlf']);

    const hardLinkPath = path.join(portableRepository, 'alias.ts');
    fs.unlinkSync(hardLinkPath);
    fs.linkSync(path.join(portableRepository, 'docs-link'), hardLinkPath);
    assert.throws(() => candidateInventoryFromTracked(
      portableRepository, portableEntries, manifest, portableFixture,
      {
        objectFormat: portableObjectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, portableCheckout: true,
      },
    ), /not a physical single-link regular file/);
    fs.unlinkSync(hardLinkPath);
    runRepositoryGit(portableRepository, [
      '-c', 'core.symlinks=false', 'checkout-index', '--force', '--', 'alias.ts',
    ]);

    const copiedRepository = path.join(temporaryRoot, 'copied-link-body');
    runRepositoryGit(temporaryRoot, ['init', '--quiet', copiedRepository]);
    fs.writeFileSync(path.join(copiedRepository, 'target.ts'), targetText);
    fs.writeFileSync(path.join(copiedRepository, 'copied.ts'), 'target.ts');
    runRepositoryGit(copiedRepository, ['add', '--', 'target.ts', 'copied.ts']);
    const copiedInventory = candidateInventoryFromTracked(
      copiedRepository, parseStageEntries(copiedRepository), manifest, portableFixture,
      {
        objectFormat: runRepositoryGit(copiedRepository, ['rev-parse', '--show-object-format']).trim(),
        maximumTrackedBytes: 1024, maximumEntries: 10,
      },
    );
    assert.equal(copiedInventory.tracked_bytes,
      Buffer.byteLength(targetText) + Buffer.byteLength('target.ts'),
    'a copied link body staged as 100644 remains ordinary bytes, never an alias');

    const componentRepository = path.join(temporaryRoot, 'component-link-resolution');
    runRepositoryGit(temporaryRoot, ['init', '--quiet', componentRepository]);
    fs.mkdirSync(path.join(componentRepository, 'real'));
    fs.mkdirSync(path.join(componentRepository, 'nested'));
    fs.writeFileSync(path.join(componentRepository, 'real/file.ts'), targetText);
    const componentLinks = [
      ['dir-link', 'real'],
      ['through.ts', 'dir-link/file.ts'],
      ['chain.ts', 'through.ts'],
      ['root-dir', '.'],
      ['slash-dir', 'real/'],
      ['nested/only-link', '.'],
    ];
    for (const [link, target] of componentLinks) {
      fs.symlinkSync(target, path.join(componentRepository, link));
    }
    runRepositoryGit(componentRepository, [
      'add', '--', 'real/file.ts', ...componentLinks.map(([link]) => link),
    ]);
    const componentEntries = parseStageEntries(componentRepository);
    const nativeComponentInventory = literalNativeSymlinkInventory(
      componentRepository, componentEntries, manifest, portableFixture,
    );
    for (const [link] of componentLinks) fs.unlinkSync(path.join(componentRepository, link));
    runRepositoryGit(componentRepository, [
      '-c', 'core.symlinks=false', 'checkout-index', '--force', '--all',
    ]);
    const componentInventory = candidateInventoryFromTracked(
      componentRepository, componentEntries, manifest, portableFixture,
      {
        objectFormat: runRepositoryGit(
          componentRepository, ['rev-parse', '--show-object-format'],
        ).trim(),
        maximumTrackedBytes: 4096, maximumEntries: 20, portableCheckout: true,
      },
    );
    assert.deepEqual(componentInventory, nativeComponentInventory,
      'all eleven fields preserve native chained, intermediate-directory, root, and implied-parent alias semantics');

    const repeatedLinkRepository = path.join(temporaryRoot, 'finite-repeated-links');
    runRepositoryGit(temporaryRoot, ['init', '--quiet', repeatedLinkRepository]);
    fs.mkdirSync(path.join(repeatedLinkRepository, 'dir'));
    fs.writeFileSync(path.join(repeatedLinkRepository, 'target.ts'), targetText);
    fs.writeFileSync(path.join(repeatedLinkRepository, 'dir/target.ts'), targetText);
    const repeatedLinks = [
      ['a', '.'],
      ['alias.ts', 'a/a/target.ts'],
      ['dir/a', '.'],
      ['separated.ts', 'dir/a/../dir/a/target.ts'],
    ];
    for (const [link, target] of repeatedLinks) {
      fs.symlinkSync(target, path.join(repeatedLinkRepository, link));
    }
    runRepositoryGit(repeatedLinkRepository, [
      'add', '--', 'target.ts', 'dir/target.ts', ...repeatedLinks.map(([link]) => link),
    ]);
    const repeatedLinkEntries = parseStageEntries(repeatedLinkRepository);
    const nativeRepeatedLinkInventory = literalNativeSymlinkInventory(
      repeatedLinkRepository, repeatedLinkEntries, manifest, portableFixture,
    );
    for (const [link] of repeatedLinks) fs.unlinkSync(path.join(repeatedLinkRepository, link));
    runRepositoryGit(repeatedLinkRepository, [
      '-c', 'core.symlinks=false', 'checkout-index', '--force', '--',
      ...repeatedLinks.map(([link]) => link),
    ]);
    const repeatedLinkEvidence = [];
    const portableRepeatedLinkInventory = candidateInventoryFromTracked(
      repeatedLinkRepository, repeatedLinkEntries, manifest, portableFixture,
      {
        objectFormat: runRepositoryGit(
          repeatedLinkRepository, ['rev-parse', '--show-object-format'],
        ).trim(),
        maximumTrackedBytes: 4096, maximumEntries: 20, portableCheckout: true,
        portableResolutionEvidence: repeatedLinkEvidence,
      },
    );
    assert.deepEqual(portableRepeatedLinkInventory, nativeRepeatedLinkInventory,
      'finite repeated directory links preserve all eleven native inventory fields');
    const repeatedEvidenceByPath = new Map(
      repeatedLinkEvidence.map((record) => [record.path, record]),
    );
    for (const alias of ['alias.ts', 'separated.ts']) {
      assert.deepEqual({
        outcome: repeatedEvidenceByPath.get(alias).outcome,
        hops: repeatedEvidenceByPath.get(alias).traversal_hops,
        target_kind: repeatedEvidenceByPath.get(alias).target_kind,
      }, { outcome: 'file', hops: 3, target_kind: 'file' });
    }

    const portableDoublingGraph = (name, depth, rootCount = 0) => {
      const cwd = path.join(temporaryRoot, name);
      runRepositoryGit(temporaryRoot, ['init', '--quiet', cwd]);
      fs.mkdirSync(path.join(cwd, 'd'));
      fs.writeFileSync(path.join(cwd, 'd/target.ts'), targetText);
      const links = [];
      for (let index = depth; index >= 0; index -= 1) {
        const link = `l${String(index).padStart(2, '0')}`;
        const next = `l${String(index + 1).padStart(2, '0')}`;
        const target = index === depth ? 'd' : `${next}/../${next}`;
        fs.symlinkSync(target, path.join(cwd, link));
        links.push(link);
      }
      for (let index = 0; index < rootCount; index += 1) {
        const link = `root-${String(index).padStart(3, '0')}`;
        fs.symlinkSync('l00', path.join(cwd, link));
        links.push(link);
      }
      runRepositoryGit(cwd, ['add', '--', 'd/target.ts', ...links]);
      const entries = parseStageEntries(cwd);
      for (const link of links) fs.unlinkSync(path.join(cwd, link));
      runRepositoryGit(cwd, [
        '-c', 'core.symlinks=false', 'checkout-index', '--force', '--', ...links,
      ]);
      return {
        cwd,
        entries,
        objectFormat: runRepositoryGit(cwd, ['rev-parse', '--show-object-format']).trim(),
      };
    };
    const perAliasDoubling = portableDoublingGraph('per-alias-doubling-graph', 18);
    const perAliasStarted = Date.now();
    assert.throws(() => candidateInventoryFromTracked(
      perAliasDoubling.cwd, perAliasDoubling.entries, manifest, portableFixture,
      {
        objectFormat: perAliasDoubling.objectFormat,
        maximumTrackedBytes: 4096, maximumEntries: 100, portableCheckout: true,
      },
    ), /per-alias follow-or-pop work-unit bound/,
    'an acyclic doubling graph is refused by a deterministic per-alias work budget');
    assert.ok(Date.now() - perAliasStarted < 5_000,
      'the exponential graph must fail closed without expanding exponentially');

    const aggregateDoubling = portableDoublingGraph('aggregate-doubling-graph', 9, 70);
    assert.throws(() => candidateInventoryFromTracked(
      aggregateDoubling.cwd, aggregateDoubling.entries, manifest, portableFixture,
      {
        objectFormat: aggregateDoubling.objectFormat,
        maximumTrackedBytes: 4096, maximumEntries: 100, portableCheckout: true,
      },
    ), /aggregate follow-or-pop work-unit bound/,
    'many individually bounded starts cannot exceed the aggregate validation work budget');

    const longChainRepository = path.join(temporaryRoot, 'forty-eight-link-chain');
    runRepositoryGit(temporaryRoot, ['init', '--quiet', longChainRepository]);
    fs.writeFileSync(path.join(longChainRepository, 'target.txt'), targetText);
    const longChainLinks = Array.from({ length: 48 }, (_, index) => {
      const link = `link-${String(index).padStart(2, '0')}.ts`;
      const target = index === 47
        ? 'target.txt'
        : `link-${String(index + 1).padStart(2, '0')}.ts`;
      fs.symlinkSync(target, path.join(longChainRepository, link));
      return link;
    });
    runRepositoryGit(longChainRepository, ['add', '--', 'target.txt', ...longChainLinks]);
    const longChainEntries = parseStageEntries(longChainRepository);
    const longChainFixture = {
      id: 'long-chain', class: 'long-chain', source_loc: { minimum: 40, maximum: 40 },
    };
    const nativeLongChainInventory = process.platform === 'linux'
      ? literalNativeSymlinkInventory(
          longChainRepository, longChainEntries, manifest, longChainFixture,
        )
      : null;
    for (const link of longChainLinks) fs.unlinkSync(path.join(longChainRepository, link));
    runRepositoryGit(longChainRepository, [
      '-c', 'core.symlinks=false', 'checkout-index', '--force', '--', ...longChainLinks,
    ]);
    const longChainEvidence = [];
    const portableLongChainInventory = candidateInventoryFromTracked(
      longChainRepository, longChainEntries, manifest, longChainFixture,
      {
        objectFormat: runRepositoryGit(
          longChainRepository, ['rev-parse', '--show-object-format'],
        ).trim(),
        maximumTrackedBytes: 4096, maximumEntries: 100, portableCheckout: true,
        portableResolutionEvidence: longChainEvidence,
      },
    );
    if (process.platform === 'linux') {
      assert.deepEqual(portableLongChainInventory, nativeLongChainInventory,
        '48-link portable resolution preserves all eleven Linux #60 inventory fields');
    }
    assert.deepEqual({
      tracked_files: portableLongChainInventory.tracked_files,
      tracked_bytes: portableLongChainInventory.tracked_bytes,
      tracked_source_files: portableLongChainInventory.tracked_source_files,
      tracked_source_loc: portableLongChainInventory.tracked_source_loc,
    }, {
      tracked_files: 49,
      tracked_bytes: Buffer.byteLength(targetText) * 41,
      tracked_source_files: 40,
      tracked_source_loc: 40,
    });
    const evidenceByPath = new Map(longChainEvidence.map((record) => [record.path, record]));
    assert.deepEqual({
      outcome: evidenceByPath.get('link-07.ts').outcome,
      reason: evidenceByPath.get('link-07.ts').skip_reason,
      hops: evidenceByPath.get('link-07.ts').traversal_hops,
      target: evidenceByPath.get('link-07.ts').target_path,
    }, {
      outcome: 'skipped', reason: 'symlink_traversal_limit', hops: 41, target: null,
    }, 'the 41st traversal reproduces Linux ELOOP and remains unresolved');
    assert.deepEqual({
      outcome: evidenceByPath.get('link-08.ts').outcome,
      reason: evidenceByPath.get('link-08.ts').skip_reason,
      hops: evidenceByPath.get('link-08.ts').traversal_hops,
      target: evidenceByPath.get('link-08.ts').target_path,
    }, {
      outcome: 'file', reason: null, hops: 40, target: 'target.txt',
    }, 'exactly forty traversals still resolve and contribute target bytes');

    const boundaryRepository = path.join(temporaryRoot, 'native-portable-boundary-parity');
    runRepositoryGit(temporaryRoot, ['init', '--quiet', boundaryRepository]);
    const boundaryFiles = [
      ['two-mib.bin', Buffer.alloc(2 * 1024 * 1024, 0x61)],
      ['two-mib-plus-one.bin', Buffer.alloc(2 * 1024 * 1024 + 1, 0x62)],
      ['four-mib.bin', Buffer.alloc(4 * 1024 * 1024, 0x63)],
      ['four-mib-plus-one.bin', Buffer.alloc(4 * 1024 * 1024 + 1, 0x64)],
    ];
    for (const [name, bytes] of boundaryFiles) {
      fs.writeFileSync(path.join(boundaryRepository, name), bytes);
    }
    const boundaryLinks = [
      ['retrieval-at.ts', 'two-mib.bin'],
      ['retrieval-over.ts', 'two-mib-plus-one.bin'],
      ['source-at.ts', 'four-mib.bin'],
      ['source-over.ts', 'four-mib-plus-one.bin'],
    ];
    for (const [link, target] of boundaryLinks) {
      fs.symlinkSync(target, path.join(boundaryRepository, link));
    }
    runRepositoryGit(boundaryRepository, [
      'add', '--', ...boundaryFiles.map(([name]) => name),
      ...boundaryLinks.map(([name]) => name),
    ]);
    const boundaryEntries = parseStageEntries(boundaryRepository);
    const boundaryFixture = {
      id: 'boundary-parity', class: 'boundary-parity', source_loc: { minimum: 3, maximum: 3 },
    };
    const nativeBoundaryInventory = literalNativeSymlinkInventory(
      boundaryRepository, boundaryEntries, manifest, boundaryFixture,
    );
    for (const [link] of boundaryLinks) fs.unlinkSync(path.join(boundaryRepository, link));
    runRepositoryGit(boundaryRepository, [
      '-c', 'core.symlinks=false', 'checkout-index', '--force', '--',
      ...boundaryLinks.map(([name]) => name),
    ]);
    const portableBoundaryInventory = candidateInventoryFromTracked(
      boundaryRepository, boundaryEntries, manifest, boundaryFixture,
      {
        objectFormat: runRepositoryGit(
          boundaryRepository, ['rev-parse', '--show-object-format'],
        ).trim(),
        maximumTrackedBytes: 64 * 1024 * 1024,
        maximumEntries: 20,
        portableCheckout: true,
      },
    );
    assert.deepEqual(portableBoundaryInventory, nativeBoundaryInventory,
      'portable aliases preserve complete native inventory semantics at 2 MiB retrieval and 4 MiB LOC boundaries');
    assert.equal(portableBoundaryInventory.retrieval_candidate_files, 1);
    assert.equal(portableBoundaryInventory.tracked_source_loc, 3);

    const fileSlash = portableCounterexample(
      'file-trailing-slash', [['alias.ts', 'real.ts/']],
      (cwd) => {
        fs.writeFileSync(path.join(cwd, 'real.ts'), targetText);
        runRepositoryGit(cwd, ['add', '--', 'real.ts']);
      },
    );
    const fileSlashInventory = candidateInventoryFromTracked(
      fileSlash.cwd, fileSlash.entries, manifest, portableFixture,
      {
        objectFormat: fileSlash.objectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, portableCheckout: true,
      },
    );
    assert.deepEqual(fileSlashInventory, fileSlash.nativeInventory,
      'a trailing slash on a file reproduces #60 stat ENOTDIR skip semantics');

    const fileDot = portableCounterexample(
      'intermediate-link-file-dot', [['file-link', 'real.ts'], ['alias.ts', 'file-link/.']],
      (cwd) => {
        fs.writeFileSync(path.join(cwd, 'real.ts'), targetText);
        runRepositoryGit(cwd, ['add', '--', 'real.ts']);
      },
    );
    const fileDotEvidence = [];
    const fileDotInventory = candidateInventoryFromTracked(
      fileDot.cwd, fileDot.entries, manifest, portableFixture,
      {
        objectFormat: fileDot.objectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, portableCheckout: true,
        portableResolutionEvidence: fileDotEvidence,
      },
    );
    assert.deepEqual(fileDotInventory, fileDot.nativeInventory,
      'link-to-file/. preserves #60 ENOTDIR skip behavior instead of accepting the file');
    assert.equal(new Map(fileDotEvidence.map((record) => [record.path, record]))
      .get('alias.ts').skip_reason, 'not_directory');

    const missingBeforeParent = portableCounterexample(
      'missing-before-parent', [['alias.ts', 'missing/../real.ts']],
      (cwd) => {
        fs.writeFileSync(path.join(cwd, 'real.ts'), targetText);
        runRepositoryGit(cwd, ['add', '--', 'real.ts']);
      },
    );
    assert.throws(() => candidateInventoryFromTracked(
      missingBeforeParent.cwd, missingBeforeParent.entries, manifest, portableFixture,
      {
        objectFormat: missingBeforeParent.objectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, portableCheckout: true,
      },
    ), /target is broken/,
    'virtual resolution checks a component exists before applying a later parent traversal');

    const special = portableCounterexample(
      'special-link', [['special.ts', 'pipe']],
      (cwd) => {
        const made = spawnSync('/usr/bin/mkfifo', [path.join(cwd, 'pipe')], { encoding: 'utf8' });
        assert.equal(made.status, 0, made.stderr);
      },
    );
    assert.throws(() => candidateInventoryFromTracked(
      special.cwd, special.entries, manifest, portableFixture,
      {
        objectFormat: special.objectFormat, maximumTrackedBytes: 1024,
        maximumEntries: 10, portableCheckout: true,
      },
    ), /targets a special file/);

    assert.throws(() => candidateInventoryFromTracked(
      portableRepository,
      [{ mode: '160000', oid: '0'.repeat(40), path: 'gitlink' }],
      manifest, portableFixture,
      { objectFormat: 'sha1', maximumTrackedBytes: 1024, maximumEntries: 10 },
    ), /special, gitlink, or unmerged tracked entry/);
  }

  }

  const resultInventory = REVIEWED_INVENTORIES.small;
  const result = inventoryAdmissionResult(pinnedCollectionForTier('small'), resultInventory);
  assert.equal(result.schema, INVENTORY_ADMISSION_SCHEMA);
  assert.equal(result.evidence_mode, 'reviewed_collection_inventory_admission_only');
  assert.ok(Object.values(result.quality_claims).every((claim) => claim === false));
  assert.match(result.limitation, /not routed through the oracle grade controller/);
  const reconstructionResult = inventoryReconstructionResult({
    collection: pinnedCollectionForTier('medium'),
    inventory: resultInventory,
    candidate_inventory_sha256: candidateInventoryDigest(resultInventory),
    portable_link_resolution: {
      schema: 'lamina.real-repository-oracle-portable-link-resolution/v1',
      max_symlink_traversals: 40,
      full_validation: {
        work_unit: 'one_link_follow_or_one_popped_expansion_token',
        max_work_units_per_alias: 32_768,
        max_work_units_aggregate: 262_144,
        consumed_work_units: 0,
        maximum_alias_work_units: 0,
      },
      alias_count: 0, records: [], sha256: '0'.repeat(64),
    },
    bounds: RECONSTRUCTION_LIMITS,
  });
  assert.deepEqual(Object.keys(reconstructionResult).sort(), [
    'admission', 'bounds', 'candidate_inventory_sha256', 'collection', 'evidence_mode',
    'grade_controller_evidence', 'inventory', 'limitation', 'portable_link_resolution',
    'quality_claims', 'schema', 'status', 'workload_id',
  ]);
  assert.equal(reconstructionResult.schema, INVENTORY_RECONSTRUCTION_SCHEMA);
  assert.equal(reconstructionResult.workload_id, RECONSTRUCTION_WORKLOAD_ID);
  assert.equal(reconstructionResult.status, 'unreviewed_reconstruction_candidate');
  assert.equal(reconstructionResult.admission, 'not_performed');
  assert.equal(reconstructionResult.grade_controller_evidence, false);
  assert.equal(reconstructionResult.collection.fixture_id, 'medium');
  assert.equal('reviewed_inventory' in reconstructionResult.collection, false);
  assert.ok(Object.values(reconstructionResult.quality_claims).every((claim) => claim === false));
  assert.equal(reconstructionResult.candidate_inventory_sha256,
    candidateInventoryDigest(resultInventory));
  assert.equal(reconstructionResult.portable_link_resolution.alias_count, 0);
  assert.match(reconstructionResult.limitation, /unreviewed inventory reconstruction candidate only/);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: false });
}

console.log('real repository oracle inventory admission tests passed');
