#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnTrustedGit } from '../scripts/safe-runner/git.mjs';
import {
  realRepositoryOracleSourceClosure, realRepositoryOracleSourceClosureIdentity,
} from '../scripts/safe-runner/real-repository-source-closure.mjs';
import { repositorySourceDigest, runnerBuildDigest } from '../scripts/safe-runner/source-identity.mjs';
import {
  GENERIC_TEMPORARY_MAX_INODES,
  SCENARIO_VERIFICATION_LARGE_TEMPORARY_INODE_RESERVATION,
  temporaryMaxInodesForBytes,
} from '../scripts/safe-runner/constants.mjs';
import {
  decodeScenarioVerificationPayload, decodeScenarioVerificationReport,
  encodeScenarioVerificationPayload, executeScenario, executeScenarioForTest,
  parseScenarioPorcelainV2Z, SCENARIO_VERIFICATION_BOUNDS,
  SCENARIO_VERIFICATION_PAYLOAD_PREFIX, SCENARIO_VERIFICATION_SCHEMA,
  SCENARIO_VERIFICATION_REPORT_STDERR_TAIL_BYTES,
  SCENARIO_VERIFICATION_REPORT_STDOUT_TAIL_BYTES,
  SCENARIO_VERIFICATION_WORKLOAD_ID, validateScenarioVerification,
} from '../benchmarks/real-repository-oracle-v1/scenario-verification.mjs';
import {
  loadScenarioSelection, SCENARIO_SELECTION_CANONICAL_SHA256, SCENARIO_SELECTION_RAW_SHA256,
} from '../benchmarks/real-repository-oracle-v1/scenario-selection.mjs';
import { REVIEWED_INVENTORIES } from '../benchmarks/real-repository-oracle-v1/collection-authority.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = path.join(ROOT, 'benchmarks/real-repository-oracle-v1/scenario-verification.mjs');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => sha256(Buffer.from(JSON.stringify(canonical(value))));
const git = (cwd, args) => {
  const result = spawnTrustedGit(cwd, args, { encoding: 'utf8', timeout: 10_000,
    maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  return String(result.stdout || '').trim();
};

const oid = '1'.repeat(40);
const cleanStatus = `# branch.oid ${oid}\0# branch.head (detached)\0`;
assert.deepEqual(parseScenarioPorcelainV2Z(cleanStatus), {
  head: oid, branch: null, upstream: null, changes: [],
});
const modifiedStatus = `${cleanStatus}1 .M N... 100644 100644 100644 ${oid} ${oid} src/a.txt\0`;
assert.equal(parseScenarioPorcelainV2Z(modifiedStatus).changes[0].xy, '.M');
const typeChangedStatus = `${cleanStatus}1 .T N... 120000 120000 100644 ${oid} ${oid} src/alias.txt\0`;
assert.throws(() => parseScenarioPorcelainV2Z(typeChangedStatus),
  /unsupported porcelain record/);
const renameStatus = `${cleanStatus}2 R. N... 100644 100644 100644 ${oid} ${oid} R100 dst.txt\0src.txt\0`;
assert.deepEqual(parseScenarioPorcelainV2Z(renameStatus).changes[0], {
  record_type: '2', xy: 'R.', sub: 'N...', mode_head: '100644', mode_index: '100644',
  mode_worktree: '100644', oid_head: oid, oid_index: oid, rename_kind: 'R',
  rename_score: 100, path: 'dst.txt', original_path: 'src.txt',
});
for (const invalid of [cleanStatus.slice(0, -1), `${cleanStatus}# branch.head other\0`,
  `${cleanStatus}# branch.upstream origin/main\0`, `${cleanStatus}? stray\0`,
  `${cleanStatus}2 R. N... 100644 100644 100644 ${oid} ${oid} R100 dst.txt\0`]) {
  assert.throws(() => parseScenarioPorcelainV2Z(invalid));
}

const temporaryRoot = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-scenario-verification-test-'),
));
try {
  for (const [order, kind] of ['clean', 'modify', 'rename', 'delete', 'branch', 'logical_worktree'].entries()) {
    const repository = path.join(temporaryRoot, `repository-${kind}`);
    const linked = path.join(temporaryRoot, `linked-${kind}`);
    fs.mkdirSync(linked, { mode: 0o700 });
    git(temporaryRoot, ['init', '--quiet', repository]);
    fs.mkdirSync(path.join(repository, 'src'));
    const original = Buffer.from('alpha\n');
    fs.writeFileSync(path.join(repository, 'src/a.txt'), original, { mode: 0o644 });
    git(repository, ['add', '--', 'src/a.txt']);
    git(repository, ['-c', 'user.name=Lamina Test', '-c', 'user.email=lamina@example.invalid',
      'commit', '--quiet', '-m', 'fixture']);
    const commit = git(repository, ['rev-parse', 'HEAD']);
    const blob = git(repository, ['rev-parse', 'HEAD:src/a.txt']);
    git(repository, ['checkout', '--quiet', '--detach', commit]);
    const scenario = {
      order, kind, identity_sha256: sha256(kind), path: 'src/a.txt', blob_oid: blob,
      original_content_sha256: sha256(original), discovery_operation_kind: kind,
      discovery_index: 0, authored_operation_kind: kind,
    };
    if (kind === 'modify') {
      scenario.append_utf8 = 'tail\n';
      scenario.result_bytes = original.length + Buffer.byteLength(scenario.append_utf8);
      scenario.result_content_sha256 = sha256(Buffer.concat([original, Buffer.from(scenario.append_utf8)]));
    } else if (kind === 'rename') scenario.destination = 'renamed.txt';
    else if (kind === 'branch') scenario.branch = 'lamina-oracle/test-branch';
    else if (kind === 'logical_worktree') {
      scenario.derived_branch = 'lamina-oracle/worktree-test';
      scenario.logical_worktree_id = 'oracle-worktree-test';
    }
    const record = executeScenario(repository, { linked }, { commit }, scenario);
    assert.equal(record.kind, kind);
    assert.equal(record.internal_cleanup_verified, false);
    assert.equal(record.pre.head, commit);
    assert.equal(record.stage.before_count, 1);
    if (kind === 'logical_worktree') assert.equal(fs.readdirSync(linked).length, 0);
    if (kind === 'branch') {
      const absent = spawnTrustedGit(repository,
        ['show-ref', '--verify', '--quiet', `refs/heads/${scenario.branch}`], {
          encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      assert.equal(absent.status, 1);
    }
  }

  const portableRepository = (name) => {
    const repository = path.join(temporaryRoot, `portable-repository-${name}`);
    const linked = path.join(temporaryRoot, `portable-linked-${name}`);
    fs.mkdirSync(linked, { mode: 0o700 });
    git(temporaryRoot, ['init', '--quiet', repository]);
    fs.mkdirSync(path.join(repository, 'src'));
    const target = Buffer.from('portable target\n');
    const linkBody = Buffer.from('target.txt');
    fs.writeFileSync(path.join(repository, 'src/target.txt'), target, { mode: 0o644 });
    fs.writeFileSync(path.join(repository, 'src/alias.txt'), linkBody, { mode: 0o644 });
    git(repository, ['add', '--', 'src/target.txt']);
    const linkBlob = git(repository, ['hash-object', '-w', '--', 'src/alias.txt']);
    git(repository, ['update-index', '--add', '--cacheinfo', '120000', linkBlob,
      'src/alias.txt']);
    git(repository, ['-c', 'user.name=Lamina Test', '-c', 'user.email=lamina@example.invalid',
      'commit', '--quiet', '-m', 'portable link fixture']);
    const commit = git(repository, ['rev-parse', 'HEAD']);
    const targetBlob = git(repository, ['rev-parse', 'HEAD:src/target.txt']);
    fs.unlinkSync(path.join(repository, 'src/alias.txt'));
    git(repository, ['-c', 'core.symlinks=false', 'checkout-index', '--force', '--',
      'src/alias.txt']);
    git(repository, ['-c', 'core.symlinks=false', 'checkout', '--quiet', '--detach', commit]);
    const alias = fs.lstatSync(path.join(repository, 'src/alias.txt'), { bigint: true });
    assert.equal(alias.isFile() && !alias.isSymbolicLink() && alias.nlink === 1n, true,
      'portable alias must be a physical single-link regular file');
    assert.deepEqual(fs.readFileSync(path.join(repository, 'src/alias.txt')), linkBody,
      'portable alias must contain only its exact Git link body');
    return { repository, scratch: { linked }, commit, target, targetBlob, linkBody, linkBlob };
  };

  const counterexample = portableRepository('counterexample');
  const rawTypeChange = spawnTrustedGit(counterexample.repository, [
    '-c', 'core.symlinks=true', 'status', '--porcelain=v2', '-z', '--branch',
    '--untracked-files=all',
  ], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(rawTypeChange.status, 0, 'explicit-true portable status probe must succeed');
  const typeChangeRecord = String(rawTypeChange.stdout || '').split('\0')
    .find((record) => record.startsWith('1 '));
  assert.equal(typeChangeRecord,
    `1 .T N... 120000 120000 100644 ${counterexample.linkBlob} ${counterexample.linkBlob} src/alias.txt`,
    'explicit-true status must expose the portable alias as a type-change counterexample');
  assert.throws(() => parseScenarioPorcelainV2Z(String(rawTypeChange.stdout || '')),
    /unsupported porcelain record/);

  const cleanPortable = portableRepository('clean');
  const cleanAliasStage = `120000 ${cleanPortable.linkBlob} 0\tsrc/alias.txt`;
  assert.equal(git(cleanPortable.repository,
    ['ls-files', '--stage', '--', 'src/alias.txt']), cleanAliasStage);
  const cleanPortableRecord = executeScenario(cleanPortable.repository, cleanPortable.scratch,
    { commit: cleanPortable.commit }, {
      order: 0, kind: 'clean', identity_sha256: sha256('portable-clean'),
    });
  assert.deepEqual(cleanPortableRecord.pre.changes, []);
  assert.deepEqual(cleanPortableRecord.post.changes, []);
  assert.equal(git(cleanPortable.repository,
    ['ls-files', '--stage', '--', 'src/alias.txt']), cleanAliasStage);
  const cleanAlias = fs.lstatSync(path.join(cleanPortable.repository, 'src/alias.txt'),
    { bigint: true });
  assert.equal(cleanAlias.isFile() && !cleanAlias.isSymbolicLink()
    && cleanAlias.nlink === 1n && (cleanAlias.mode & 0o111n) === 0n, true,
    'clean scenario must retain the portable alias as a non-executable single-link regular file');
  assert.deepEqual(fs.readFileSync(path.join(cleanPortable.repository, 'src/alias.txt')),
    cleanPortable.linkBody);

  const modifyPortable = portableRepository('modify');
  const append = 'portable tail\n';
  const modifyPortableRecord = executeScenario(modifyPortable.repository,
    modifyPortable.scratch, { commit: modifyPortable.commit }, {
      order: 1, kind: 'modify', identity_sha256: sha256('portable-modify'),
      path: 'src/target.txt', blob_oid: modifyPortable.targetBlob,
      original_content_sha256: sha256(modifyPortable.target), append_utf8: append,
      result_bytes: modifyPortable.target.length + Buffer.byteLength(append),
      result_content_sha256: sha256(Buffer.concat([modifyPortable.target, Buffer.from(append)])),
    });
  assert.deepEqual(modifyPortableRecord.pre.changes, []);
  assert.equal(modifyPortableRecord.post.changes.length, 1);
  assert.equal(modifyPortableRecord.post.changes[0].xy, '.M');
  assert.equal(modifyPortableRecord.post.changes[0].path, 'src/target.txt');

  const logicalPortable = portableRepository('logical');
  let linkedAliasProved = false;
  const logicalPortableRecord = executeScenarioForTest(logicalPortable.repository,
    logicalPortable.scratch, { commit: logicalPortable.commit }, {
      order: 5, kind: 'logical_worktree', identity_sha256: sha256('portable-logical'),
      path: 'src/target.txt', blob_oid: logicalPortable.targetBlob,
      original_content_sha256: sha256(logicalPortable.target),
      derived_branch: 'lamina-oracle/portable-worktree',
      logical_worktree_id: 'oracle-worktree-portable',
    }, {
      after_logical_worktree_add: ({ linked }) => {
        const aliasPath = path.join(linked, 'src/alias.txt');
        const alias = fs.lstatSync(aliasPath, { bigint: true });
        assert.equal(alias.isFile() && !alias.isSymbolicLink() && alias.nlink === 1n, true,
          'linked portable alias must remain a physical single-link regular file');
        assert.deepEqual(fs.readFileSync(aliasPath), logicalPortable.linkBody,
          'linked portable alias must retain its exact Git link body');
        linkedAliasProved = true;
      },
    });
  assert.equal(linkedAliasProved, true);
  assert.deepEqual(logicalPortableRecord.pre.changes, []);
  assert.deepEqual(logicalPortableRecord.post.changes, []);
  assert.deepEqual(logicalPortableRecord.auxiliary.changes, []);
  assert.equal(logicalPortableRecord.stage.before_count, 2);
  assert.equal(logicalPortableRecord.stage.after_count, 2);
  assert.equal(fs.readdirSync(logicalPortable.scratch.linked).length, 0);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: false });
}

const loaded = loadScenarioSelection();
const noClaims = { workflow_selection: false, observation: false, obligations: false,
  source_localization: false, retrieval_ranking: false, end_to_end_runtime: false };
const checks = () => ({ source_blob: null, source_content: null, result_content: null,
  destination_absence: null, ref_lifecycle: null, linked_marker: null, linked_admin: null,
  primary_clean: null, linked_topology_sha256: null });
const sourceSha = sha256(fs.readFileSync(MODULE));
function validResult(tier) {
  const selected = loaded.selection.tiers[tier];
  const trackedFiles = REVIEWED_INVENTORIES[tier].tracked_files;
  const records = selected.scenarios.map((scenario, order) => {
  const before = 'a'.repeat(64);
  const afterStage = scenario.kind === 'rename' ? 'b'.repeat(64) : before;
  const afterPhysical = ['clean', 'branch', 'logical_worktree'].includes(scenario.kind)
    ? before : 'c'.repeat(64);
  const change = scenario.kind === 'modify' || scenario.kind === 'delete' ? {
    record_type: '1', xy: scenario.kind === 'modify' ? '.M' : '.D', sub: 'N...',
    mode_head: '100644', mode_index: '100644',
    mode_worktree: scenario.kind === 'modify' ? '100644' : '000000',
    oid_head: scenario.blob_oid, oid_index: scenario.blob_oid, rename_kind: null,
    rename_score: null, path: scenario.path, original_path: null,
  } : scenario.kind === 'rename' ? {
    record_type: '2', xy: 'R.', sub: 'N...', mode_head: '100644', mode_index: '100644',
    mode_worktree: '100644', oid_head: scenario.blob_oid, oid_index: scenario.blob_oid,
    rename_kind: 'R', rename_score: 100, path: scenario.destination, original_path: scenario.path,
  } : null;
  const valueChecks = checks();
  if (scenario.kind !== 'clean') valueChecks.source_blob = valueChecks.source_content = true;
  if (['modify', 'rename'].includes(scenario.kind)) valueChecks.result_content = true;
  if (scenario.kind === 'rename') valueChecks.destination_absence = true;
  if (['branch', 'logical_worktree'].includes(scenario.kind)) valueChecks.ref_lifecycle = true;
  if (scenario.kind === 'logical_worktree') {
    valueChecks.linked_marker = valueChecks.linked_admin = valueChecks.primary_clean = true;
    valueChecks.linked_topology_sha256 = digest([
      { role: 'primary', head: selected.pin.commit, branch: null },
      { role: scenario.logical_worktree_id, head: selected.pin.commit,
        branch: scenario.derived_branch },
    ]);
  }
  const pre = { head: selected.pin.commit, branch: null, upstream: null, changes: [] };
  const selectedBefore = scenario.kind === 'clean' ? []
    : [{ mode: '100644', oid: scenario.blob_oid, path: scenario.path }];
  const selectedAfter = scenario.kind === 'clean' ? [] : [{ mode: '100644', oid: scenario.blob_oid,
    path: scenario.kind === 'rename' ? scenario.destination : scenario.path }];
  const physicalBefore = scenario.kind === 'clean' ? []
    : [{ mode: '100644', path: scenario.path, sha256: scenario.original_content_sha256 }];
  const physicalSelectedAfter = scenario.kind === 'clean' || scenario.kind === 'delete' ? []
    : [{ mode: '100644', path: scenario.kind === 'rename' ? scenario.destination : scenario.path,
      sha256: scenario.kind === 'modify'
        ? scenario.result_content_sha256 : scenario.original_content_sha256 }];
  return {
    order, scenario_identity_sha256: scenario.identity_sha256,
    scratch_lease_sha256: sha256(`${tier}-lease-${order}`), kind: scenario.kind,
    selection_provenance: {
      discovery_operation_kind: scenario.discovery_operation_kind ?? null,
      discovery_index: scenario.discovery_index ?? null,
      authored_operation_kind: scenario.authored_operation_kind ?? null,
    },
    pre,
    post: { head: selected.pin.commit,
      branch: scenario.kind === 'branch' ? scenario.branch
        : scenario.kind === 'logical_worktree' ? scenario.derived_branch : null,
      upstream: null, changes: change ? [change] : [] },
    auxiliary: scenario.kind === 'logical_worktree' ? pre : null,
    stage: { before_count: trackedFiles, before_sha256: before, after_count: trackedFiles,
      after_sha256: afterStage, selected_before: selectedBefore, selected_after: selectedAfter,
      physical_before_count: trackedFiles, physical_before_sha256: before,
      physical_after_count: trackedFiles + (scenario.kind === 'delete' ? -1 : 0),
      physical_after_sha256: afterPhysical, physical_selected_before: physicalBefore,
      physical_selected_after: physicalSelectedAfter },
    checks: valueChecks, internal_cleanup_verified: true,
  };
  });
  const recordsSha = digest(records);
  return {
    schema: SCENARIO_VERIFICATION_SCHEMA, workload_id: SCENARIO_VERIFICATION_WORKLOAD_ID,
    status: 'reviewer_selected_scenarios_verified_lexically',
    collection: { fixture_id: tier, ...selected.pin },
    selection_raw_sha256: SCENARIO_SELECTION_RAW_SHA256,
    selection_canonical_sha256: SCENARIO_SELECTION_CANONICAL_SHA256,
    bounds: SCENARIO_VERIFICATION_BOUNDS, records, records_sha256: recordsSha,
    source_sha256: sourceSha,
    workload_sha256: digest({ workload_id: SCENARIO_VERIFICATION_WORKLOAD_ID,
      source_sha256: sourceSha, selection_raw_sha256: SCENARIO_SELECTION_RAW_SHA256,
      selection_canonical_sha256: SCENARIO_SELECTION_CANONICAL_SHA256,
      records_sha256: recordsSha }),
    expectations_loaded: false, grade_controller_evidence: false, quality_claims: noClaims,
    selection_provenance: { status: 'selection_provenance_not_replayed', ...selected.discovery },
    limitation: 'Lexical Git state verification only. Accepted discovery provenance is carried from the digest-locked reviewer selection and is not independently replayed. No Workflow, expectation, retrieval, grade, quality, or end-to-end runtime claim.',
  };
}
const result = validResult('small');
assert.deepEqual(validateScenarioVerification(result), { valid: true, errors: [] });
const line = encodeScenarioVerificationPayload(result);
assert.ok(line.startsWith(SCENARIO_VERIFICATION_PAYLOAD_PREFIX));
assert.ok(Buffer.byteLength(line) < 7_680);
assert.equal(SCENARIO_VERIFICATION_REPORT_STDOUT_TAIL_BYTES, 8 * 1024);
assert.equal(SCENARIO_VERIFICATION_REPORT_STDERR_TAIL_BYTES, 8 * 1024);
assert.ok(SCENARIO_VERIFICATION_PAYLOAD_PREFIX.length
  + Math.ceil(SCENARIO_VERIFICATION_BOUNDS.transport_bytes * 4 / 3)
  < SCENARIO_VERIFICATION_BOUNDS.encoded_line_bytes);
assert.deepEqual(decodeScenarioVerificationPayload(line), canonical(result));
assert.throws(() => decodeScenarioVerificationPayload(`${line}\n`), /malformed/);
assert.throws(() => decodeScenarioVerificationPayload(
  `${SCENARIO_VERIFICATION_PAYLOAD_PREFIX}${'A'.repeat(7_680)}`,
), /retained-output contract/);
const reusedLease = structuredClone(result);
reusedLease.records[1].scratch_lease_sha256 = reusedLease.records[0].scratch_lease_sha256;
assert.equal(validateScenarioVerification(reusedLease).valid, false);
const wrongPin = structuredClone(result);
wrongPin.collection.commit = 'f'.repeat(40);
assert.equal(validateScenarioVerification(wrongPin).valid, false);
const absoluteLeak = structuredClone(result);
absoluteLeak.records[1].post.changes[0].path = '/tmp/leak';
assert.equal(validateScenarioVerification(absoluteLeak).valid, false);
const rebindResult = (value) => {
  value.records_sha256 = digest(value.records);
  value.workload_sha256 = digest({ workload_id: value.workload_id,
    source_sha256: value.source_sha256, selection_raw_sha256: value.selection_raw_sha256,
    selection_canonical_sha256: value.selection_canonical_sha256,
    records_sha256: value.records_sha256 });
  return value;
};
for (const tier of ['small', 'medium', 'large']) {
  const exact = validResult(tier);
  assert.deepEqual(validateScenarioVerification(exact), { valid: true, errors: [] });
  assert.ok(Buffer.byteLength(encodeScenarioVerificationPayload(exact)) < 7_680);
  const countTamper = structuredClone(exact);
  for (const key of ['before_count', 'after_count', 'physical_before_count',
    'physical_after_count']) countTamper.records[0].stage[key] += 1;
  assert.equal(validateScenarioVerification(rebindResult(countTamper)).valid, false,
    `${tier} must reject a coordinated reviewed-base count tamper`);
  const digestTamper = structuredClone(exact);
  for (const key of ['before_sha256', 'after_sha256', 'physical_before_sha256',
    'physical_after_sha256']) digestTamper.records[0].stage[key] = '9'.repeat(64);
  assert.equal(validateScenarioVerification(rebindResult(digestTamper)).valid, false,
    `${tier} must reject a coordinated cross-record base digest tamper`);
}
const topologyTamper = structuredClone(result);
topologyTamper.records[5].checks.linked_topology_sha256 = '8'.repeat(64);
assert.equal(validateScenarioVerification(rebindResult(topologyTamper)).valid, false,
  'logical topology must be recomputed rather than accepted as an arbitrary digest');

const raceRoot = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-scenario-race-test-'),
));
function raceRepository(name, secondCommit = false) {
  const repository = path.join(raceRoot, name);
  const linked = path.join(raceRoot, `${name}-linked`);
  fs.mkdirSync(linked, { mode: 0o700 });
  git(raceRoot, ['init', '--quiet', repository]);
  fs.mkdirSync(path.join(repository, 'src'));
  const bytes = Buffer.from('race-original\n');
  fs.writeFileSync(path.join(repository, 'src/a.txt'), bytes, { mode: 0o644 });
  git(repository, ['add', '--', 'src/a.txt']);
  git(repository, ['-c', 'user.name=Lamina Test', '-c', 'user.email=lamina@example.invalid',
    'commit', '--quiet', '-m', 'race fixture']);
  const first = git(repository, ['rev-parse', 'HEAD']);
  if (secondCommit) git(repository, ['-c', 'user.name=Lamina Test',
    '-c', 'user.email=lamina@example.invalid', 'commit', '--quiet', '--allow-empty',
    '-m', 'second pin']);
  const commit = git(repository, ['rev-parse', 'HEAD']);
  const blob = git(repository, ['rev-parse', 'HEAD:src/a.txt']);
  git(repository, ['checkout', '--quiet', '--detach', commit]);
  return { repository, scratch: { linked }, bytes, first, commit, blob };
}
try {
  for (const kind of ['modify', 'delete']) {
    const fixture = raceRepository(`race-${kind}`);
    const target = path.join(fixture.repository, 'src/a.txt');
    const backup = path.join(fixture.repository, 'src/original-held.txt');
    const scenario = { order: kind === 'modify' ? 1 : 3, kind,
      identity_sha256: sha256(`race-${kind}`), path: 'src/a.txt', blob_oid: fixture.blob,
      original_content_sha256: sha256(fixture.bytes), discovery_operation_kind: kind,
      discovery_index: 0, authored_operation_kind: kind };
    if (kind === 'modify') {
      scenario.append_utf8 = 'forbidden-append\n';
      scenario.result_bytes = fixture.bytes.length + Buffer.byteLength(scenario.append_utf8);
      scenario.result_content_sha256 = sha256(Buffer.concat(
        [fixture.bytes, Buffer.from(scenario.append_utf8)],
      ));
    }
    const hook = () => {
      fs.renameSync(target, backup);
      fs.writeFileSync(target, fixture.bytes, { mode: 0o644 });
    };
    const hooks = kind === 'modify' ? { after_append_open_before_write: hook }
      : { after_delete_open_before_unlink: hook };
    assert.throws(() => executeScenarioForTest(
      fixture.repository, fixture.scratch, { commit: fixture.commit }, scenario, hooks,
    ), /changed before mutation/);
    assert.deepEqual(fs.readFileSync(target), fixture.bytes,
      `${kind} substitution target must not be mutated`);
    assert.deepEqual(fs.readFileSync(backup), fixture.bytes,
      `${kind} originally opened inode must not be mutated`);
  }
  const dirtyBranch = raceRepository('branch-dirty');
  const branchScenario = { order: 4, kind: 'branch', identity_sha256: sha256('branch-dirty'),
    path: 'src/a.txt', blob_oid: dirtyBranch.blob,
    original_content_sha256: sha256(dirtyBranch.bytes), branch: 'lamina-oracle/final-dirty',
    discovery_operation_kind: 'branch', discovery_index: 0, authored_operation_kind: 'branch' };
  assert.throws(() => executeScenarioForTest(dirtyBranch.repository, dirtyBranch.scratch,
    { commit: dirtyBranch.commit }, branchScenario, {
      before_branch_final_proof: ({ repository }) => fs.writeFileSync(
        path.join(repository, 'unexpected.txt'), 'dirty\n',
      ),
    }), /unsupported porcelain|lexical contract/);
  assert.equal(spawnTrustedGit(dirtyBranch.repository,
    ['show-ref', '--verify', '--quiet', `refs/heads/${branchScenario.branch}`], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).status, 1, 'failed final branch proof cannot leave its temporary ref');
  const nonPinBranch = raceRepository('branch-non-pin', true);
  const nonPinScenario = { ...branchScenario, identity_sha256: sha256('branch-non-pin'),
    blob_oid: nonPinBranch.blob, original_content_sha256: sha256(nonPinBranch.bytes),
    branch: 'lamina-oracle/final-non-pin' };
  assert.throws(() => executeScenarioForTest(nonPinBranch.repository, nonPinBranch.scratch,
    { commit: nonPinBranch.commit }, nonPinScenario, {
      before_branch_final_proof: ({ repository }) => git(
        repository, ['checkout', '--quiet', '--detach', nonPinBranch.first],
      ),
    }), /lexical contract/);
  assert.equal(spawnTrustedGit(nonPinBranch.repository,
    ['show-ref', '--verify', '--quiet', `refs/heads/${nonPinScenario.branch}`], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).status, 1, 'non-pin final proof cannot leave its temporary ref');
  for (const residue of ['ref', 'config', 'reflog']) {
    const residueBranch = raceRepository(`branch-${residue}-residue`);
    const residueScenario = { ...branchScenario,
      identity_sha256: sha256(`branch-${residue}-residue`),
      blob_oid: residueBranch.blob,
      original_content_sha256: sha256(residueBranch.bytes),
      branch: `lamina-oracle/final-${residue}-residue` };
    const recreateResidue = ({ repository }) => {
      if (residue === 'ref') {
        git(repository, ['update-ref', `refs/heads/${residueScenario.branch}`,
          residueBranch.commit]);
      } else if (residue === 'config') {
        git(repository, ['config', '--local', `branch.${residueScenario.branch}.remote`,
          'origin']);
      } else {
        const reflog = path.join(repository, '.git', 'logs', 'refs', 'heads',
          ...residueScenario.branch.split('/'));
        fs.mkdirSync(path.dirname(reflog), { recursive: true });
        fs.writeFileSync(reflog, 'recreated final-window residue\n');
      }
    };
    assert.throws(() => executeScenarioForTest(residueBranch.repository,
      residueBranch.scratch, { commit: residueBranch.commit }, residueScenario, {
        before_branch_final_proof: recreateResidue,
      }), new RegExp(`selected branch ${residue} remains`));
  }
} finally {
  fs.rmSync(raceRoot, { recursive: true, force: false });
}

const reportSourceParent = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-scenario-report-source-'),
));
try {
const reportSourceRepository = path.join(reportSourceParent, 'repository');
git(reportSourceParent, ['init', '--quiet', reportSourceRepository]);
for (const relative of realRepositoryOracleSourceClosure('verify-scenarios')) {
  const destination = path.join(reportSourceRepository, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(ROOT, relative), destination);
}
git(reportSourceRepository, ['add', '--', '.']);
git(reportSourceRepository, ['-c', 'user.name=Lamina Test',
  '-c', 'user.email=lamina@example.invalid', 'commit', '--quiet',
  '-m', 'isolated scenario report source']);
const reportSourceRoot = fs.realpathSync.native(reportSourceRepository);
const reportSourceConfig = path.join(reportSourceRoot, '.git', 'config');
const inertReportSourceConfig = fs.readFileSync(reportSourceConfig);
for (const executableConfig of [
  '\n[include]\n\tpath = ../outside-config\n',
  '\n[includeIf "gitdir:**/repository"]\n\tpath = ../outside-config\n',
]) {
  fs.writeFileSync(reportSourceConfig, Buffer.concat([
    inertReportSourceConfig, Buffer.from(executableConfig),
  ]));
  assert.throws(() => repositorySourceDigest(reportSourceRoot), /Git config|include/i,
    'synthetic report staging must still refuse include/includeIf Git config');
  fs.writeFileSync(reportSourceConfig, inertReportSourceConfig);
}
const command = [process.execPath,
  path.join(reportSourceRoot, 'benchmarks/real-repository-oracle-v1/workload.mjs'), 'verify-scenarios'];
const executableStat = fs.lstatSync(process.execPath, { bigint: true });
const executable = { path: process.execPath, dev: String(executableStat.dev),
  ino: String(executableStat.ino), uid: Number(executableStat.uid),
  mode: Number(executableStat.mode & 0o777n), size: String(executableStat.size),
  digest: sha256(fs.readFileSync(process.execPath)) };
const entrypoint = command[1];
const entrypointStat = fs.lstatSync(entrypoint, { bigint: true });
const entrypointIdentity = { path: entrypoint, size: String(entrypointStat.size),
  digest: sha256(fs.readFileSync(entrypoint)) };
const sourceClosure = realRepositoryOracleSourceClosureIdentity(reportSourceRoot, 'verify-scenarios');
const sourceValue = { repository: reportSourceRoot, command, executable,
  workload_inputs: [entrypointIdentity], retrieval_authority: null,
  runtime_baseline_inputs: null, repository_source: repositorySourceDigest(reportSourceRoot),
  runner_build: runnerBuildDigest() };
const sourceIdentity = { ...sourceValue, digest: sha256(JSON.stringify(sourceValue)) };
const snapshotDigest = '1'.repeat(64);
const executionIdentity = { ...sourceIdentity, source_identity_digest: sourceIdentity.digest,
  execution_snapshot_digest: snapshotDigest,
  digest: sha256(JSON.stringify({ source_identity_digest: sourceIdentity.digest,
    execution_snapshot_digest: snapshotDigest })) };
const stdoutTail = `${line}\n`;
const safeReport = {
  schema: 'lamina.safe-runner-report/v1', schema_version: 1, run_id: 'synthetic-scenario-report',
  report_file: path.join(os.tmpdir(), 'synthetic-scenario-report.json'), outcome: 'success',
  tier: 'small', command, cwd: reportSourceRoot, started_at: '2026-08-03T00:00:00.000Z',
  finished_at: '2026-08-03T00:00:01.000Z', duration_ms: 1000,
  adapter: { id: 'linux-systemd-cgroup-v2', production_enforcement: true },
  limits: { stdout_tail_max_bytes: 8 * 1024, stderr_tail_max_bytes: 8 * 1024,
    temporary_max_bytes: 2 * 1024 ** 3,
    temporary_max_inodes: GENERIC_TEMPORARY_MAX_INODES },
  preflight: { ok: true, workload_id: SCENARIO_VERIFICATION_WORKLOAD_ID,
    temporary_inode_reservation: null,
    ownership: { proven: true,
      audited_entrypoint: 'benchmarks/real-repository-oracle-v1/workload.mjs',
      executable: process.execPath }, execution_command: command, source_identity: sourceIdentity,
    execution_snapshot: { schema: 'lamina.safe-runner-execution-snapshot/v1', digest: snapshotDigest,
      file_count: sourceClosure.file_count, total_bytes: sourceClosure.total_bytes,
      source_closure: sourceClosure, snapshot_roots: [reportSourceRoot], writable_roots: [] },
    execution_identity: executionIdentity,
    retry: { ok: true, signature: sourceIdentity.digest, previous: null },
    promotion: { ok: true, required: [], missing: [], completed: [],
      deferred_to_execution_snapshot: false }, scope_proof: { production_enforcement: true } },
  samples: [{ elapsed_ms: 1, aggregate_rss_bytes: 1, cgroup_memory_bytes: 1,
    pids: 1, temporary_bytes: 1, temporary_inodes: 1 }],
  peaks: { aggregate_rss_bytes: 1, cgroup_memory_bytes: 1, pids: 1,
    temporary_bytes: 1, temporary_inodes: 1 }, descendants: [],
  output: { stdout_bytes: Buffer.byteLength(stdoutTail), stderr_bytes: 0,
    total_bytes: Buffer.byteLength(stdoutTail), stdout_tail: stdoutTail, stderr_tail: '',
    truncated: false },
  termination: { reason: 'completed', limit: null, requested_signals: [], child_exit_code: 0,
    child_signal: null, cgroup_events: {} },
  cleanup: { attempted: true, descendants_remaining: [], managed_paths_remaining: [],
    scope_removed: true, temporary_directory_removed: true, lock_released: null, errors: [] },
  error: null,
};
assert.deepEqual(decodeScenarioVerificationReport(safeReport), canonical(result));
const safeReportForTier = (tier, temporaryMaxBytes = 2 * 1024 ** 3) => {
  const tierResult = validResult(tier);
  const tierTail = `${encodeScenarioVerificationPayload(tierResult)}\n`;
  const report = structuredClone(safeReport);
  const promotionRequired = tier === 'small' ? [] : tier === 'medium' ? ['small']
    : ['small', 'medium'];
  const inodeCeiling = tier === 'large'
    ? SCENARIO_VERIFICATION_LARGE_TEMPORARY_INODE_RESERVATION.requested_max_inodes
    : GENERIC_TEMPORARY_MAX_INODES;
  report.tier = tier;
  report.limits.temporary_max_bytes = temporaryMaxBytes;
  report.limits.temporary_max_inodes = temporaryMaxInodesForBytes(
    temporaryMaxBytes, inodeCeiling,
  );
  report.preflight.temporary_inode_reservation = tier === 'large'
    ? SCENARIO_VERIFICATION_LARGE_TEMPORARY_INODE_RESERVATION : null;
  report.preflight.promotion.required = promotionRequired;
  report.preflight.promotion.completed = promotionRequired;
  report.cleanup.lock_released = tier === 'small' ? null : true;
  report.samples[0].temporary_inodes = tier === 'large' ? 11_880 : 1;
  report.peaks.temporary_inodes = report.samples[0].temporary_inodes;
  report.output.stdout_bytes = Buffer.byteLength(tierTail);
  report.output.total_bytes = Buffer.byteLength(tierTail);
  report.output.stdout_tail = tierTail;
  return { report, result: tierResult };
};
const mediumSafe = safeReportForTier('medium');
assert.deepEqual(decodeScenarioVerificationReport(mediumSafe.report), canonical(mediumSafe.result));
const largeSafe = safeReportForTier('large');
assert.equal(largeSafe.report.limits.temporary_max_inodes, 16_384);
assert.deepEqual(decodeScenarioVerificationReport(largeSafe.report), canonical(largeSafe.result));
const downwardLargeSafe = safeReportForTier('large', 16 * 1024 ** 2);
downwardLargeSafe.report.samples[0].temporary_inodes = 1;
downwardLargeSafe.report.peaks.temporary_inodes = 1;
assert.equal(downwardLargeSafe.report.limits.temporary_max_inodes, 4_096);
assert.throws(() => decodeScenarioVerificationReport(downwardLargeSafe.report),
  /exact safe-runner authority/,
  'a successful large report is impossible when downward byte semantics cannot fit the geometry');
for (const wrongLimit of [8_192, 16_385]) {
  const tampered = structuredClone(largeSafe.report);
  tampered.limits.temporary_max_inodes = wrongLimit;
  assert.throws(() => decodeScenarioVerificationReport(tampered), /exact safe-runner authority/);
}
for (const tier of ['small', 'medium']) {
  const tampered = safeReportForTier(tier).report;
  tampered.limits.temporary_max_inodes = 16_384;
  assert.throws(() => decodeScenarioVerificationReport(tampered), /exact safe-runner authority/);
}
const wrongReservationTier = structuredClone(largeSafe.report);
wrongReservationTier.preflight.temporary_inode_reservation.tier = 'medium';
assert.throws(() => decodeScenarioVerificationReport(wrongReservationTier),
  /exact safe-runner authority/);
const geometryOverCeiling = structuredClone(largeSafe.report);
geometryOverCeiling.preflight.temporary_inode_reservation.occupied_destination_count = 8_000;
assert.throws(() => decodeScenarioVerificationReport(geometryOverCeiling),
  /exact safe-runner authority/);
const peakOverCeiling = structuredClone(largeSafe.report);
peakOverCeiling.samples[0].temporary_inodes = 16_385;
peakOverCeiling.peaks.temporary_inodes = 16_385;
assert.throws(() => decodeScenarioVerificationReport(peakOverCeiling),
  /exact safe-runner authority/);
const missingPromotion = structuredClone(safeReport);
missingPromotion.preflight.promotion.ok = false;
missingPromotion.preflight.promotion.missing = ['small'];
assert.throws(() => decodeScenarioVerificationReport(missingPromotion), /exact safe-runner authority/);
const crossedRetry = structuredClone(safeReport);
crossedRetry.preflight.retry.signature = '0'.repeat(64);
assert.throws(() => decodeScenarioVerificationReport(crossedRetry), /exact safe-runner authority/);
const rebindReportSource = (report) => {
  const source = report.preflight.source_identity;
  const sourceValue = { repository: source.repository, command: source.command,
    executable: source.executable, workload_inputs: source.workload_inputs,
    retrieval_authority: source.retrieval_authority,
    runtime_baseline_inputs: source.runtime_baseline_inputs,
    repository_source: source.repository_source, runner_build: source.runner_build };
  source.digest = sha256(JSON.stringify(sourceValue));
  report.preflight.retry.signature = source.digest;
  report.preflight.execution_identity.source_identity_digest = source.digest;
  report.preflight.execution_identity.digest = sha256(JSON.stringify({
    source_identity_digest: source.digest,
    execution_snapshot_digest: report.preflight.execution_snapshot.digest,
  }));
  return report;
};
const repositorySourceTamper = structuredClone(safeReport);
repositorySourceTamper.preflight.source_identity.repository_source = '7'.repeat(64);
assert.throws(() => decodeScenarioVerificationReport(
  rebindReportSource(repositorySourceTamper),
), /exact safe-runner authority/,
'a self-consistent source/execution digest cannot replace the live checkout identity');
const entrypointTamper = structuredClone(safeReport);
entrypointTamper.preflight.source_identity.workload_inputs[0].digest = '6'.repeat(64);
assert.throws(() => decodeScenarioVerificationReport(rebindReportSource(entrypointTamper)),
  /exact safe-runner authority/,
  'a rebound source identity cannot replace the current entrypoint bytes');
const closureTamper = structuredClone(safeReport);
closureTamper.preflight.execution_snapshot.source_closure.files_sha256 = '5'.repeat(64);
closureTamper.preflight.execution_snapshot.digest = '4'.repeat(64);
closureTamper.preflight.execution_identity.execution_snapshot_digest = '4'.repeat(64);
closureTamper.preflight.execution_identity.digest = sha256(JSON.stringify({
  source_identity_digest: closureTamper.preflight.source_identity.digest,
  execution_snapshot_digest: '4'.repeat(64),
}));
assert.throws(() => decodeScenarioVerificationReport(closureTamper),
  /exact safe-runner authority/,
  'a rebound execution digest cannot replace exact source-closure membership and bytes');

console.log('real repository oracle scenario verification tests passed');
} finally {
  fs.rmSync(reportSourceParent, { recursive: true, force: false });
}
