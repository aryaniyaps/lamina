#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  INVENTORY_REVIEW_IMPORT_BOUNDARY, INVENTORY_REVIEW_LIMITS,
  inventoryFromObjectRecords, inventoryReviewDigest, parseReviewedTreeRecords,
  reviewPinnedGitObjects,
} from '../benchmarks/real-repository-oracle-v1/inventory-review.mjs';
import { isExcludedPath, loadManifest } from '../benchmarks/runtime-baseline-v1/contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_SOURCE = fs.readFileSync(path.join(
  ROOT, 'benchmarks/real-repository-oracle-v1/inventory-review.mjs',
), 'utf8');
const SOURCE_NAMES = new Set(['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const blobOid = (objectFormat, bytes) => crypto.createHash(objectFormat)
  .update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

assert.deepEqual(INVENTORY_REVIEW_IMPORT_BOUNDARY, [
  'collection-pins.mjs', 'runtime-baseline-v1/contract.mjs', 'safe-runner-context.mjs',
  'safe-runner/git.mjs',
]);
for (const forbidden of [
  './materialize.mjs', './collection-authority.mjs', 'REVIEWED_INVENTORIES',
  './inventory-review-receipt.mjs', 'reviews/inventory-v1.json',
  'candidateInventoryFromTracked', 'candidate_inventory_sha256',
]) {
  assert.equal(REVIEW_SOURCE.includes(forbidden), false,
    `independent reviewer must not reference ${forbidden}`);
}

function git(cwd, args, encoding = 'utf8') {
  const result = spawnSync('/usr/bin/git', [
    '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'credential.helper=', '-c', 'protocol.file.allow=never', ...args,
  ], { cwd, encoding, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${String(result.stderr)}`);
  return result.stdout;
}

function write(root, relative, bytes) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function initialize(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Lamina Review Test']);
  git(root, ['config', 'user.email', 'review-test@lamina.invalid']);
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
  const commitOid = git(root, ['rev-parse', 'HEAD']).trim();
  const treeOid = git(root, ['rev-parse', 'HEAD^{tree}']).trim();
  return { commit: commitOid, tree_oid: treeOid };
}

const { manifest: baselineManifest } = loadManifest();
const fixture = { id: 'review-test', source_loc: { minimum: 0, maximum: 1_000_000 } };
function collection(root, identity, manifest = baselineManifest) {
  return {
    repository_url: `https://github.com/lamina/review-${path.basename(root)}.git`,
    fixture_id: 'review-test', fixture_class: 'review-test', ...identity, manifest, fixture,
  };
}

function trackedEntries(root) {
  return git(root, ['ls-files', '--stage', '-z'], null).toString('utf8')
    .split('\0').filter(Boolean).map((record) => {
      const match = record.match(/^([0-7]{6}) ([a-f0-9]{40,64}) 0\t([\s\S]+)$/);
      assert.ok(match, record);
      return { mode: match[1], oid: match[2], path: match[3] };
    });
}

function literalNativeInventory(root, entries, manifest = baselineManifest) {
  const observations = [];
  const retrieval = [];
  const sourceExtensions = new Set(manifest.source_extensions);
  const retrievalExtensions = new Set(manifest.retrieval_extensions);
  let trackedBytes = 0;
  let observationBytes = 0;
  let retrievalBytes = 0;
  let sourceFiles = 0;
  let sourceBytes = 0;
  let sourceLoc = 0;
  for (const entry of entries) {
    const physical = path.join(root, entry.path);
    let stat;
    try { stat = fs.statSync(physical); } catch { continue; }
    if (!stat.isFile()) continue;
    const bytes = fs.readFileSync(physical);
    trackedBytes += stat.size;
    if (!isExcludedPath(entry.path, manifest.exclusions)) {
      observations.push(entry.path);
      observationBytes += stat.size;
    }
    const extension = path.extname(entry.path).toLowerCase();
    if (retrievalExtensions.has(extension) && stat.size <= manifest.retrieval_max_file_bytes) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        retrieval.push(entry.path);
        retrievalBytes += stat.size;
      } catch {}
    }
    if (sourceExtensions.has(extension) || SOURCE_NAMES.has(path.basename(entry.path))) {
      sourceFiles += 1;
      sourceBytes += stat.size;
      if (stat.size <= 4 * 1024 * 1024) {
        sourceLoc += bytes.toString('utf8').split(/\r?\n/).filter((line) => line.trim()).length;
      }
    }
  }
  return {
    tracked_files: entries.length, tracked_bytes: trackedBytes,
    tracked_source_files: sourceFiles, tracked_source_bytes: sourceBytes,
    tracked_source_loc: sourceLoc,
    observation_indexed_files: observations.length,
    observation_indexed_bytes: observationBytes,
    observation_paths_digest: sha256(observations.join('\n')),
    retrieval_candidate_files: retrieval.length,
    retrieval_candidate_bytes: retrievalBytes,
    retrieval_paths_digest: sha256(retrieval.join('\n')),
  };
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-object-review-test-'));
if (process.platform !== 'linux') {
  fs.rmSync(temporary, { recursive: true, force: true });
  console.log('real repository independent inventory review tests skipped: Linux production semantics required');
} else {
try {
  const parity = path.join(temporary, 'parity');
  initialize(parity);
  write(parity, 'src/base.ts', 'export const base = 1;\n');
  fs.chmodSync(path.join(parity, 'src/base.ts'), 0o755);
  write(parity, 'src/dir/item.ts', 'export const item = 2;\n');
  write(parity, 'src/invalid-content.bin', Buffer.from([0xff]));
  write(parity, '\uFEFFbom-target.ts', 'export const bom = true;\n');
  fs.symlinkSync('src/base.ts', path.join(parity, 'file-link.ts'));
  fs.symlinkSync('file-link.ts', path.join(parity, 'chain-link.ts'));
  fs.symlinkSync('src/dir', path.join(parity, 'directory-link'));
  fs.symlinkSync('src/invalid-content.bin', path.join(parity, 'invalid-content-link.ts'));
  fs.symlinkSync('\uFEFFbom-target.ts', path.join(parity, 'bom-target-link.ts'));
  const parityIdentity = commit(parity, 'file directory and chain aliases');
  const entries = trackedEntries(parity);
  assert.equal(entries.find((entry) => entry.path === 'src/base.ts').mode, '100755');
  const reviewed = reviewPinnedGitObjects(parity, collection(parity, parityIdentity));
  assert.deepEqual(reviewed.inventory, literalNativeInventory(parity, entries),
    'object reviewer must reproduce native Linux file, directory, and chained-link inventory');
  assert.equal(reviewed.object_link_resolution.alias_count, 5);
  assert.equal(reviewed.object_link_resolution.records.find((item) =>
    item.path === 'directory-link').target_kind, 'directory');
  assert.equal(reviewed.object_link_resolution.records.find((item) =>
    item.path === 'invalid-content-link.ts').contribution.retrieval_included, false);
  assert.equal(reviewed.object_link_resolution.records.find((item) =>
    item.path === 'bom-target-link.ts').target_path, '\uFEFFbom-target.ts');
  assert.equal(reviewed.review_inventory_sha256, inventoryReviewDigest(reviewed.inventory));
  assert.deepEqual(reviewed.git_object_identity, {
    object_format: 'sha1', commit: parityIdentity.commit, tree_oid: parityIdentity.tree_oid,
  });

  const hop = path.join(temporary, 'hop');
  initialize(hop);
  write(hop, 'target.ts', 'export const target = true;\n');
  for (let index = 40; index >= 1; index -= 1) {
    fs.symlinkSync(index === 40 ? 'target.ts' : `link-${index + 1}.ts`,
      path.join(hop, `link-${index}.ts`));
  }
  fs.symlinkSync('link-1.ts', path.join(hop, 'link-41.ts'));
  const hopIdentity = commit(hop, 'forty and forty-one hops');
  const hopReviewed = reviewPinnedGitObjects(hop, collection(hop, hopIdentity));
  assert.deepEqual(hopReviewed.inventory, literalNativeInventory(hop, trackedEntries(hop)),
    'hop 40 resolves while hop 41 preserves native ELOOP zero contribution');
  const atForty = hopReviewed.object_link_resolution.records.find((item) => item.path === 'link-1.ts');
  const atFortyOne = hopReviewed.object_link_resolution.records.find((item) => item.path === 'link-41.ts');
  assert.equal(atForty.outcome, 'file');
  assert.equal(atForty.traversal_hops, 40);
  assert.equal(atFortyOne.skip_reason, 'symlink_traversal_limit');
  assert.equal(atFortyOne.traversal_hops, 41);

  for (const [name, links, diagnostic] of [
    ['cycle', [['a.ts', 'b.ts'], ['b.ts', 'a.ts']], /cyclic/],
    ['broken', [['a.ts', 'missing.ts']], /broken/],
    ['escape', [['a.ts', '../outside.ts']], /escapes repository/],
    ['not-directory', [['a.ts', 'file.ts/child']], /not_directory|not directory/],
  ]) {
    const root = path.join(temporary, name);
    initialize(root);
    if (name === 'not-directory') write(root, 'file.ts', 'file\n');
    for (const [relative, target] of links) fs.symlinkSync(target, path.join(root, relative));
    const identity = commit(root, name);
    if (name === 'not-directory') {
      const result = reviewPinnedGitObjects(root, collection(root, identity));
      assert.equal(result.object_link_resolution.records.find((item) => item.path === 'a.ts').skip_reason,
        'not_directory');
      assert.deepEqual(result.inventory, literalNativeInventory(root, trackedEntries(root)));
    } else {
      assert.throws(() => reviewPinnedGitObjects(root, collection(root, identity)), diagnostic);
    }
  }

  const objectFormat = 'sha1';
  const oid = (bytes) => blobOid(objectFormat, bytes);
  const invalidTarget = Buffer.from([0xff]);
  assert.throws(() => inventoryFromObjectRecords(
    [{ mode: '120000', oid: oid(invalidTarget), path: 'invalid.ts' }],
    new Map([[oid(invalidTarget), invalidTarget]]), baselineManifest, fixture,
  ), /not UTF-8/);

  const policy = {
    ...baselineManifest,
    retrieval_extensions: ['.ts'], retrieval_max_file_bytes: 4,
    exclusions: [...baselineManifest.exclusions, 'excluded'],
  };
  const kept = Buffer.from('12345');
  const excluded = Buffer.from('ok\n');
  const objectEntries = [
    { mode: '100644', oid: oid(excluded), path: 'excluded/drop.ts' },
    { mode: '100644', oid: oid(kept), path: 'src/kept.ts' },
  ];
  const policyResult = inventoryFromObjectRecords(
    objectEntries, new Map([[oid(kept), kept], [oid(excluded), excluded]]), policy, fixture,
  );
  assert.equal(policyResult.inventory.observation_indexed_files, 1);
  assert.equal(policyResult.inventory.retrieval_candidate_files, 1,
    'excluded observation files remain retrieval candidates while oversized retrieval files do not');
  assert.equal(policyResult.inventory.retrieval_paths_digest, sha256('excluded/drop.ts'));
  assert.throws(() => inventoryFromObjectRecords(
    objectEntries, new Map([[oid(kept), kept], [oid(excluded), excluded]]), policy, fixture,
    { limits: { ...INVENTORY_REVIEW_LIMITS, max_object_bytes: 4 } },
  ), /aggregate retained-byte bound/);

  const retrievalBoundary = baselineManifest.retrieval_max_file_bytes;
  assert.equal(retrievalBoundary, 2 * 1024 * 1024);
  const retrievalExact = Buffer.alloc(retrievalBoundary, 0x61);
  const retrievalOver = Buffer.alloc(retrievalBoundary + 1, 0x62);
  const retrievalBoundaryResult = inventoryFromObjectRecords([
    { mode: '100644', oid: oid(retrievalExact), path: 'exact.ts' },
    { mode: '100644', oid: oid(retrievalOver), path: 'over.ts' },
  ], new Map([
    [oid(retrievalExact), retrievalExact], [oid(retrievalOver), retrievalOver],
  ]), baselineManifest, fixture);
  assert.equal(retrievalBoundaryResult.inventory.retrieval_candidate_files, 1);
  assert.equal(retrievalBoundaryResult.inventory.retrieval_candidate_bytes, retrievalBoundary);
  assert.equal(retrievalBoundaryResult.inventory.retrieval_paths_digest, sha256('exact.ts'));

  const locBoundary = 4 * 1024 * 1024;
  const locExact = Buffer.alloc(locBoundary, 0x61);
  const locOver = Buffer.alloc(locBoundary + 1, 0x62);
  const locBoundaryResult = inventoryFromObjectRecords([
    { mode: '100644', oid: oid(locExact), path: 'loc-exact.go' },
    { mode: '100644', oid: oid(locOver), path: 'loc-over.go' },
  ], new Map([
    [oid(locExact), locExact], [oid(locOver), locOver],
  ]), baselineManifest, fixture);
  assert.equal(locBoundaryResult.inventory.tracked_source_files, 2);
  assert.equal(locBoundaryResult.inventory.tracked_source_bytes, (locBoundary * 2) + 1);
  assert.equal(locBoundaryResult.inventory.tracked_source_loc, 1,
    'exactly 4 MiB contributes LOC while 4 MiB plus one byte does not');

  const invalidContent = Buffer.from([0xff]);
  const invalidContentLink = Buffer.from('invalid-content.bin');
  const invalidContentResult = inventoryFromObjectRecords([
    { mode: '120000', oid: oid(invalidContentLink), path: 'invalid-alias.ts' },
    { mode: '100644', oid: oid(invalidContent), path: 'invalid-content.bin' },
  ], new Map([
    [oid(invalidContentLink), invalidContentLink], [oid(invalidContent), invalidContent],
  ]), baselineManifest, fixture);
  assert.equal(invalidContentResult.inventory.tracked_bytes, 2);
  assert.equal(invalidContentResult.inventory.tracked_source_files, 1);
  assert.equal(invalidContentResult.inventory.tracked_source_bytes, 1);
  assert.equal(invalidContentResult.inventory.tracked_source_loc, 1);
  assert.equal(invalidContentResult.inventory.retrieval_candidate_files, 0,
    'invalid UTF-8 regular target bytes are followed for native counts but refused for retrieval');
  assert.equal(invalidContentResult.object_link_resolution.records[0].target_path,
    'invalid-content.bin');

  const bomTargetPath = '\uFEFFtarget.ts';
  const bomTarget = Buffer.from('export const bom = true;\n');
  const bomLink = Buffer.from(bomTargetPath, 'utf8');
  const bomResult = inventoryFromObjectRecords([
    { mode: '120000', oid: oid(bomLink), path: 'bom-link.ts' },
    { mode: '100644', oid: oid(bomTarget), path: bomTargetPath },
  ], new Map([
    [oid(bomLink), bomLink], [oid(bomTarget), bomTarget],
  ]), baselineManifest, fixture);
  assert.equal(bomResult.object_link_resolution.records[0].link_target_text, bomTargetPath);
  assert.equal(bomResult.object_link_resolution.records[0].target_path, bomTargetPath,
    'a UTF-8 BOM is part of the link target name rather than a decoder signature');
  assert.equal(bomResult.inventory.tracked_bytes, bomTarget.length * 2);

  const executableBytes = Buffer.from('#!/bin/sh\nexit 0\n');
  const executableOid = oid(executableBytes);
  const executableResult = inventoryFromObjectRecords([
    { mode: '100755', oid: executableOid, path: 'script.ts' },
  ], new Map([[executableOid, executableBytes]]), baselineManifest, fixture);
  assert.equal(executableResult.inventory.tracked_files, 1);
  assert.equal(executableResult.inventory.tracked_bytes, executableBytes.length);

  const a = Buffer.from('100644 blob 1111111111111111111111111111111111111111\ta.ts\0');
  const b = Buffer.from('100644 blob 2222222222222222222222222222222222222222\tb.ts\0');
  assert.deepEqual(parseReviewedTreeRecords(Buffer.concat([a, b]), 'sha1', 2)
    .map((item) => item.path), ['a.ts', 'b.ts']);
  assert.throws(() => parseReviewedTreeRecords(Buffer.concat([b, a]), 'sha1', 2),
    /not in Git byte order/);
  const gitlink = Buffer.from('160000 commit 1111111111111111111111111111111111111111\tdep\0');
  assert.throws(() => parseReviewedTreeRecords(gitlink, 'sha1', 2), /special, gitlink/);
  assert.throws(() => parseReviewedTreeRecords(a, 'sha1', 0), /entry review cap/);

  const sha256Bytes = Buffer.from('sha256 object format\n');
  const sha256Oid = blobOid('sha256', sha256Bytes);
  const sha256Record = Buffer.from(`100755 blob ${sha256Oid}\tsha256.ts\0`);
  assert.deepEqual(parseReviewedTreeRecords(sha256Record, 'sha256', 1), [
    { mode: '100755', oid: sha256Oid, path: 'sha256.ts' },
  ]);
  const sha256Unit = inventoryFromObjectRecords([
    { mode: '100755', oid: sha256Oid, path: 'sha256.ts' },
  ], new Map([[sha256Oid, sha256Bytes]]), baselineManifest, fixture);
  assert.equal(sha256Unit.inventory.tracked_bytes, sha256Bytes.length,
    'SHA-256 OIDs are recomputed with the repository object format');

  const sha256Repository = path.join(temporary, 'sha256-host');
  const sha256Init = spawnSync('/usr/bin/git', [
    'init', '-q', '--object-format=sha256', sha256Repository,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 });
  if (sha256Init.status === 0) {
    git(sha256Repository, ['config', 'user.name', 'Lamina SHA256 Review Test']);
    git(sha256Repository, ['config', 'user.email', 'sha256-review@lamina.invalid']);
    write(sha256Repository, 'executable.ts', executableBytes);
    fs.chmodSync(path.join(sha256Repository, 'executable.ts'), 0o755);
    const sha256Identity = commit(sha256Repository, 'sha256 object review');
    assert.equal(sha256Identity.commit.length, 64);
    assert.equal(sha256Identity.tree_oid.length, 64);
    const sha256HostReview = reviewPinnedGitObjects(
      sha256Repository, collection(sha256Repository, sha256Identity),
    );
    assert.equal(sha256HostReview.git_object_identity.object_format, 'sha256');
    assert.equal(trackedEntries(sha256Repository)[0].mode, '100755');
    assert.equal(sha256HostReview.inventory.tracked_bytes, executableBytes.length);
  } else {
    assert.notEqual(sha256Init.status, null,
      `SHA-256 Git feature probe could not launch: ${sha256Init.error?.message || ''}`);
    assert.match(`${sha256Init.stdout}\n${sha256Init.stderr}`, /sha256|object-format|unknown/i,
      'an unsupported host must explicitly reject the SHA-256 object-format probe');
  }

  assert.throws(() => reviewPinnedGitObjects(parity, {
    ...collection(parity, parityIdentity), tree_oid: 'f'.repeat(40),
  }), /does not match the exact pinned commit and tree/);
  assert.throws(() => inventoryFromObjectRecords(
    [{ mode: '100644', oid: '1'.repeat(40), path: 'missing.ts' }],
    new Map(), baselineManifest, fixture,
  ), /malformed or missing tree blob/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('real repository independent inventory review tests passed');
}
