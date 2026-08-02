#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_MANIFEST_SHA256, CANDIDATE_POLICY_SHA256, COLLECTION_PINS,
  REVIEWED_INVENTORIES, reviewedCollectionForTier,
} from '../benchmarks/real-repository-oracle-v1/collection-authority.mjs';
import {
  candidateInventoryFromTracked, createScratch, removeScratch,
  verifyPinnedRepository, withOwnedScratch,
} from '../benchmarks/real-repository-oracle-v1/materialize.mjs';
import {
  EXACT_COMMAND, INVENTORY_ADMISSION_SCHEMA, WORKLOAD_ID, inventoryAdmissionResult,
} from '../benchmarks/real-repository-oracle-v1/workload.mjs';
import { loadManifest } from '../benchmarks/runtime-baseline-v1/contract.mjs';
import {
  REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE, prepareExecutionSnapshot,
} from '../scripts/safe-runner/execution-snapshot.mjs';
import { spawnTrustedGit } from '../scripts/safe-runner/git.mjs';
import { sanitizedPayloadEnvironment } from '../scripts/safe-runner/infrastructure.mjs';
import {
  REAL_REPOSITORY_ORACLE_ENTRYPOINT, REAL_REPOSITORY_ORACLE_WORKLOAD_ID,
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

assert.equal(WORKLOAD_ID, REAL_REPOSITORY_ORACLE_WORKLOAD_ID);
assert.deepEqual(EXACT_COMMAND, ['admit-inventory']);
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
  assert.throws(() => reviewedCollectionForTier(tier),
    new RegExp(`${tier} inventory is temporarily unreviewed`));
}

const exactAudit = auditedCommand([process.execPath, ENTRYPOINT, 'admit-inventory'], ROOT);
assert.deepEqual({
  audited: exactAudit.audited,
  allow_network: exactAudit.allow_network,
  entrypoint: exactAudit.entrypoint,
}, { audited: true, allow_network: true, entrypoint: REAL_REPOSITORY_ORACLE_ENTRYPOINT });
for (const argv of [
  [process.execPath, ENTRYPOINT],
  [process.execPath, ENTRYPOINT, 'validate'],
  [process.execPath, ENTRYPOINT, 'admit-inventory', '--output', '/tmp/result'],
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

const directUnknown = spawnSync(process.execPath, [ENTRYPOINT, 'unknown'], {
  cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
});
assert.notEqual(directUnknown.status, 0);
assert.match(`${directUnknown.stdout}\n${directUnknown.stderr}`, /usage: workload\.mjs admit-inventory/);
const directExact = spawnSync(process.execPath, [ENTRYPOINT, 'admit-inventory'], {
  cwd: ROOT,
  env: { ...process.env, LAMINA_SAFE_RUNNER_BROKER: '' },
  encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
});
assert.notEqual(directExact.status, 0);
assert.match(`${directExact.stdout}\n${directExact.stderr}`, /must run through the canonical crash-safe command/);

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
    assert.equal(stat.isFile() && !stat.isSymbolicLink(), true, `${relative} must be a physical source file`);
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
  const snapshotTemporary = path.join(temporaryRoot, 'snapshot');
  fs.mkdirSync(snapshotTemporary, { mode: 0o700 });
  const snapshot = prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: [process.execPath, snapshotEntrypoint, 'admit-inventory'],
    temporaryDirectory: snapshotTemporary,
  });
  assert.equal(snapshot.audited_entrypoint, REAL_REPOSITORY_ORACLE_ENTRYPOINT);
  assert.deepEqual(snapshot.entries
    .filter((entry) => entry.label.startsWith('repository:'))
    .map((entry) => entry.label.slice('repository:'.length)).sort(),
  [...REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE].sort());
  assert.deepEqual(snapshot.environment_overrides, {}, 'oracle snapshot reintroduces no model or worker assets');
  assert.deepEqual(snapshot.writable_bindings, [], 'oracle argv supplies no writable repository or output binding');
  assert.equal(snapshot.launch_command.length, 3);
  assert.equal(snapshot.launch_command[2], 'admit-inventory');
  assert.match(snapshot.git_executable_identity?.digest || '', /^[a-f0-9]{64}$/);
  assert.match(validatedSealedGitIdentity(snapshot), /^[A-Za-z0-9_-]+$/);

  const successScratch = createScratch(temporaryRoot);
  fs.mkdirSync(successScratch.source);
  fs.writeFileSync(path.join(successScratch.source, 'owned'), 'owned');
  removeScratch(successScratch);
  assert.equal(fs.existsSync(successScratch.root), false);

  let failedScratchRoot;
  assert.throws(() => withOwnedScratch(temporaryRoot, (scratch) => {
    failedScratchRoot = scratch.root;
    throw new Error('simulated inventory error');
  }), /simulated inventory error/);
  assert.equal(fs.existsSync(failedScratchRoot), false, 'owned scratch is removed after workload error');

  const foreignScratch = createScratch(temporaryRoot);
  const foreign = path.join(foreignScratch.root, 'foreign');
  fs.writeFileSync(foreign, 'do not delete');
  assert.throws(() => removeScratch(foreignScratch), /contains foreign entries/);
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'do not delete');
  fs.rmSync(foreignScratch.root, { recursive: true, force: false });

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
  assert.throws(() => verifyPinnedRepository(repository, {
    ...collection, reviewed_inventory: { ...inventory, tracked_bytes: inventory.tracked_bytes + 1 },
  }), /reviewed inventory mismatch for tracked_bytes/);
  assert.throws(() => verifyPinnedRepository(repository, {
    ...collection, tree_oid: '0'.repeat(40),
  }), /exact detached, clean, remote-free pinned collection/);
  fs.writeFileSync(path.join(repository, 'untracked.txt'), 'dirty');
  assert.throws(() => verifyPinnedRepository(repository, collection), /exact detached, clean, remote-free pinned collection/);

  const result = inventoryAdmissionResult({
    fixture_id: 'tiny', fixture_class: 'tiny', repository_url: 'https://example.invalid/tiny.git',
    commit, tree_oid: treeOid, baseline_manifest_sha256: BASELINE_MANIFEST_SHA256,
    candidate_policy_sha256: CANDIDATE_POLICY_SHA256,
  }, inventory);
  assert.equal(result.schema, INVENTORY_ADMISSION_SCHEMA);
  assert.equal(result.evidence_mode, 'reviewed_collection_inventory_admission_only');
  assert.ok(Object.values(result.quality_claims).every((claim) => claim === false));
  assert.match(result.limitation, /not routed through the oracle grade controller/);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: false });
}

console.log('real repository oracle inventory admission tests passed');
