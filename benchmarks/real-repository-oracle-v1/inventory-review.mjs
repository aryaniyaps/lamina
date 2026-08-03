import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeRunnerContext } from '../../packages/cli/lib/safe-runner-context.mjs';
import { spawnTrustedGit } from '../../scripts/safe-runner/git.mjs';
import { isExcludedPath } from '../runtime-baseline-v1/contract.mjs';
import { pinnedCollectionForTier } from './collection-pins.mjs';

const SOURCE_NAMES = new Set(['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']);
const MAX_GIT_LIST_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_LOC_BYTES = 4 * 1024 * 1024;
const MAX_OBJECT_BATCH_OVERHEAD = 16 * 1024 * 1024;
const HAS_POSIX_OWNERSHIP = process.platform !== 'win32' && typeof process.getuid === 'function';
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export const INVENTORY_REVIEW_LIMITS = Object.freeze({
  max_tracked_entries: 6_000,
  max_object_bytes: 256 * 1024 * 1024,
  max_object_bytes_per_file: 64 * 1024 * 1024,
  max_retained_link_bytes: 4 * 1024 * 1024,
  max_link_target_bytes: 4 * 1024,
  max_symlink_traversals: 40,
  max_validation_work_units_per_alias: 32_768,
  max_validation_work_units_aggregate: 262_144,
});

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function checkedGit(cwd, args, {
  input = undefined, encoding = 'utf8', maxBuffer = MAX_GIT_LIST_BYTES,
  timeout = 20 * 60_000,
} = {}) {
  const result = spawnTrustedGit(cwd, args, {
    input, encoding, timeout, maxBuffer, stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(`trusted Git review plumbing failed (${args[0]}): ${String(result.stderr || '').slice(-2000)}`);
  }
  return result.stdout;
}

function safeGitPath(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
    && !value.includes('\\') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value)
    && value.split('/').every((piece) => piece && piece !== '.' && piece !== '..');
}

function decodeUtf8(bytes, label) {
  try { return UTF8.decode(bytes); }
  catch { throw new Error(`${label} is not UTF-8`); }
}

function objectOid(objectFormat, bytes) {
  return crypto.createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export function parseReviewedTreeRecords(output, objectFormat, maximumEntries) {
  if (!Buffer.isBuffer(output)) throw new Error('Git tree review requires byte-preserving output');
  if (!['sha1', 'sha256'].includes(objectFormat)
    || !Number.isSafeInteger(maximumEntries) || maximumEntries < 0) {
    throw new Error('Git tree review received invalid object-format or entry bounds');
  }
  const oidLength = objectFormat === 'sha256' ? 64 : 40;
  const entries = [];
  let offset = 0;
  let previousPath = null;
  while (offset < output.length) {
    const end = output.indexOf(0, offset);
    if (end < 0) throw new Error('pinned Git tree output is missing its NUL terminator');
    const record = output.subarray(offset, end);
    const tab = record.indexOf(9);
    if (tab < 0) throw new Error('pinned Git tree record is malformed');
    const header = record.subarray(0, tab).toString('ascii');
    const match = header.match(new RegExp(`^([0-7]{6}) (blob|commit) ([a-f0-9]{${oidLength}})$`));
    const pathBytes = record.subarray(tab + 1);
    const relative = decodeUtf8(pathBytes, 'pinned Git path');
    if (!match || match[2] !== 'blob' || !['100644', '100755', '120000'].includes(match[1])
      || !safeGitPath(relative)) {
      throw new Error('pinned collection contains an unsafe, special, gitlink, or non-blob tree entry');
    }
    if (previousPath !== null && Buffer.compare(previousPath, pathBytes) >= 0) {
      throw new Error('pinned collection paths are duplicate or not in Git byte order');
    }
    entries.push(Object.freeze({ mode: match[1], oid: match[3], path: relative }));
    if (entries.length > maximumEntries) {
      throw new Error(`pinned collection exceeds the ${maximumEntries}-entry review cap`);
    }
    previousPath = Buffer.from(pathBytes);
    offset = end + 1;
  }
  return Object.freeze(entries);
}

function readBlobBatch(repository, entries, objectFormat, limits) {
  const oids = [...new Set(entries.map((entry) => entry.oid))];
  const output = checkedGit(repository, ['cat-file', '--batch'], {
    input: `${oids.join('\n')}\n`, encoding: null,
    maxBuffer: limits.max_object_bytes + MAX_OBJECT_BATCH_OVERHEAD,
  });
  if (!Buffer.isBuffer(output)) throw new Error('Git object review requires byte-preserving output');
  const blobs = new Map();
  let offset = 0;
  let aggregateBytes = 0;
  for (const expectedOid of oids) {
    const headerEnd = output.indexOf(10, offset);
    if (headerEnd < 0) throw new Error('Git object batch ended before its header');
    const header = output.subarray(offset, headerEnd).toString('ascii');
    const match = header.match(/^([a-f0-9]{40,64}) blob (0|[1-9]\d*)$/);
    if (!match || match[1] !== expectedOid) throw new Error('Git object batch returned an unexpected object');
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size > limits.max_object_bytes_per_file) {
      throw new Error(`tracked Git blob exceeds the bounded per-object review budget: ${expectedOid}`);
    }
    aggregateBytes += size;
    if (aggregateBytes > limits.max_object_bytes) {
      throw new Error('tracked Git blobs exceed the bounded aggregate review budget');
    }
    const start = headerEnd + 1;
    const end = start + size;
    if (end >= output.length || output[end] !== 10) throw new Error('Git object batch payload is truncated');
    const bytes = Buffer.from(output.subarray(start, end));
    if (objectOid(objectFormat, bytes) !== expectedOid) {
      throw new Error(`Git object bytes do not match their declared OID: ${expectedOid}`);
    }
    blobs.set(expectedOid, bytes);
    offset = end + 1;
  }
  if (offset !== output.length) throw new Error('Git object batch returned trailing data');
  return blobs;
}

function impliedDirectorySet(entries) {
  const directories = new Set(['']);
  for (const entry of entries) {
    let current = path.posix.dirname(entry.path);
    while (current !== '.') {
      directories.add(current);
      current = path.posix.dirname(current);
    }
  }
  return directories;
}

function createObjectAliasResolver(entries, blobs, limits) {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const directories = impliedDirectorySet(entries);
  const linkBodies = new Map();
  let retainedLinkBytes = 0;
  let aggregateWork = 0;
  let maximumAliasWork = 0;

  const bodyFor = (entry) => {
    if (linkBodies.has(entry.path)) return linkBodies.get(entry.path);
    const bytes = blobs.get(entry.oid);
    if (!bytes || bytes.length === 0 || bytes.length > limits.max_link_target_bytes) {
      throw new Error(`Git link target exceeds its bounded non-empty review budget: ${entry.path}`);
    }
    retainedLinkBytes += bytes.length;
    if (retainedLinkBytes > limits.max_retained_link_bytes) {
      throw new Error('Git link targets exceed the bounded aggregate review budget');
    }
    const text = decodeUtf8(bytes, `Git link target ${entry.path}`);
    if (text.includes('\0') || text.includes('\\') || path.posix.isAbsolute(text)
      || /^[A-Za-z]:/.test(text)) {
      throw new Error(`Git link target must be relative UTF-8: ${entry.path}`);
    }
    const result = Object.freeze({
      bytes, text, components: text.split('/').filter(Boolean), trailingSlash: text.endsWith('/'),
    });
    linkBodies.set(entry.path, result);
    return result;
  };

  function resolve(origin, bounded) {
    const tokens = [];
    const active = new Set();
    let directory = [];
    let topBody = null;
    let hops = 0;
    let localWork = 0;

    const work = () => {
      if (bounded) return;
      localWork += 1;
      aggregateWork += 1;
      if (localWork > limits.max_validation_work_units_per_alias) {
        throw new Error('Git link validation exceeds the bounded per-alias work budget');
      }
      if (aggregateWork > limits.max_validation_work_units_aggregate) {
        throw new Error('Git link validation exceeds the bounded aggregate work budget');
      }
    };

    const skipped = (reason, targetKind = null, targetPath = null) => {
      if (!bounded) maximumAliasWork = Math.max(maximumAliasWork, localWork);
      return {
        bytes: null,
        resolution: Object.freeze({
          path: origin.path, link_oid: origin.oid, link_target_text: topBody.text,
          link_byte_length: topBody.bytes.length, traversal_hops: hops,
          traversal_limit: limits.max_symlink_traversals, outcome: 'skipped',
          skip_reason: reason, target_kind: targetKind, target_path: targetPath,
          target_oid: null, target_size: null,
        }),
      };
    };

    const finish = (kind, relative, entry = null) => {
      if (!bounded) maximumAliasWork = Math.max(maximumAliasWork, localWork);
      return {
        bytes: kind === 'file' ? blobs.get(entry.oid) : null,
        resolution: Object.freeze({
          path: origin.path, link_oid: origin.oid, link_target_text: topBody.text,
          link_byte_length: topBody.bytes.length, traversal_hops: hops,
          traversal_limit: limits.max_symlink_traversals, outcome: kind,
          skip_reason: null, target_kind: kind, target_path: relative,
          target_oid: entry?.oid || null,
          target_size: entry ? blobs.get(entry.oid).length : null,
        }),
      };
    };

    const follow = (entry) => {
      work();
      hops += 1;
      if (bounded && hops > limits.max_symlink_traversals) return false;
      if (active.has(entry.path)) throw new Error(`Git link target is cyclic: ${origin.path}`);
      active.add(entry.path);
      const body = bodyFor(entry);
      if (topBody === null) topBody = body;
      tokens.push(Object.freeze({ kind: 'leave', path: entry.path }));
      if (body.trailingSlash) tokens.push(Object.freeze({ kind: 'require_directory' }));
      for (let index = body.components.length - 1; index >= 0; index -= 1) {
        tokens.push(body.components[index]);
      }
      const parent = path.posix.dirname(entry.path);
      directory = parent === '.' ? [] : parent.split('/');
      return true;
    };

    if (!follow(origin)) return skipped('symlink_traversal_limit');
    while (tokens.length) {
      work();
      const token = tokens.pop();
      if (typeof token !== 'string') {
        if (token.kind === 'leave') active.delete(token.path);
        continue;
      }
      if (token === '.') continue;
      if (token === '..') {
        if (directory.length === 0) {
          throw new Error(`Git link target escapes repository content: ${origin.path}`);
        }
        directory.pop();
        continue;
      }
      const relative = [...directory, token].join('/');
      if (relative === '.git' || relative.startsWith('.git/')) {
        throw new Error(`Git link target escapes repository content: ${origin.path}`);
      }
      const entry = byPath.get(relative);
      if (entry?.mode === '120000') {
        if (!follow(entry)) return skipped('symlink_traversal_limit');
        continue;
      }
      if (entry) {
        const suffixRequiresDirectory = tokens.some((item) => typeof item === 'string'
          || item.kind === 'require_directory');
        if (suffixRequiresDirectory) return skipped('not_directory', 'file', relative);
        return finish('file', relative, entry);
      }
      if (!directories.has(relative)) {
        throw new Error(`Git link target is broken: ${origin.path}`);
      }
      directory.push(token);
    }
    return finish('directory', directory.join('/'));
  }

  for (const entry of entries) if (entry.mode === '120000') resolve(entry, false);
  return Object.freeze({
    resolve: (entry) => resolve(entry, true),
    validation: Object.freeze({
      work_unit: 'one_object_link_follow_or_one_popped_expansion_token',
      max_work_units_per_alias: limits.max_validation_work_units_per_alias,
      max_work_units_aggregate: limits.max_validation_work_units_aggregate,
      consumed_work_units: aggregateWork,
      maximum_alias_work_units: maximumAliasWork,
    }),
  });
}

export function inventoryFromObjectRecords(entries, blobs, manifest, fixture, {
  limits = INVENTORY_REVIEW_LIMITS,
} = {}) {
  if (!Array.isArray(entries) || !(blobs instanceof Map)) {
    throw new Error('object inventory review requires explicit tree records and blob bytes');
  }
  if (entries.length > limits.max_tracked_entries) {
    throw new Error(`object inventory review exceeds the ${limits.max_tracked_entries}-entry bound`);
  }
  let previousPath = null;
  let retainedObjectBytes = 0;
  const retainedOids = new Set();
  for (const entry of entries) {
    const bytes = blobs.get(entry?.oid);
    const objectFormat = entry?.oid?.length === 64 ? 'sha256'
      : entry?.oid?.length === 40 ? 'sha1' : null;
    if (!safeGitPath(entry?.path) || !['100644', '100755', '120000'].includes(entry?.mode)
      || !objectFormat || !Buffer.isBuffer(bytes) || objectOid(objectFormat, bytes) !== entry.oid) {
      throw new Error('object inventory review received a malformed or missing tree blob');
    }
    if (bytes.length > limits.max_object_bytes_per_file) {
      throw new Error(`object inventory review blob exceeds its per-object bound: ${entry.path}`);
    }
    if (!retainedOids.has(entry.oid)) {
      retainedOids.add(entry.oid);
      retainedObjectBytes += bytes.length;
      if (retainedObjectBytes > limits.max_object_bytes) {
        throw new Error('object inventory review blobs exceed the aggregate retained-byte bound');
      }
    }
    const pathBytes = Buffer.from(entry.path);
    if (previousPath !== null && Buffer.compare(previousPath, pathBytes) >= 0) {
      throw new Error('object inventory review paths are duplicate or not in Git byte order');
    }
    previousPath = pathBytes;
  }
  const sourceExtensions = new Set(manifest.source_extensions);
  const retrievalExtensions = new Set(manifest.retrieval_extensions);
  const observations = [];
  const retrieval = [];
  const aliasRecords = [];
  const aliases = createObjectAliasResolver(entries, blobs, limits);
  let trackedBytes = 0;
  let observationBytes = 0;
  let retrievalBytes = 0;
  let sourceFiles = 0;
  let sourceBytes = 0;
  let sourceLoc = 0;

  for (const entry of entries) {
    const resolution = entry.mode === '120000' ? aliases.resolve(entry) : null;
    const bytes = resolution ? resolution.bytes : blobs.get(entry.oid);
    const contribution = {
      tracked_bytes: 0, observation_included: false, observation_bytes: 0,
      retrieval_included: false, retrieval_bytes: 0, source_included: false,
      source_bytes: 0, source_loc: 0,
    };
    if (bytes !== null) {
      trackedBytes += bytes.length;
      if (trackedBytes > limits.max_object_bytes) {
        throw new Error('reviewed tracked bytes exceed the bounded aggregate review budget');
      }
      contribution.tracked_bytes = bytes.length;
      if (!isExcludedPath(entry.path, manifest.exclusions)) {
        observations.push(entry.path);
        observationBytes += bytes.length;
        contribution.observation_included = true;
        contribution.observation_bytes = bytes.length;
      }
      const extension = path.posix.extname(entry.path).toLowerCase();
      if (retrievalExtensions.has(extension) && bytes.length <= manifest.retrieval_max_file_bytes) {
        try {
          UTF8.decode(bytes);
          retrieval.push(entry.path);
          retrievalBytes += bytes.length;
          contribution.retrieval_included = true;
          contribution.retrieval_bytes = bytes.length;
        } catch {}
      }
      if (sourceExtensions.has(extension) || SOURCE_NAMES.has(path.posix.basename(entry.path))) {
        sourceFiles += 1;
        sourceBytes += bytes.length;
        contribution.source_included = true;
        contribution.source_bytes = bytes.length;
        if (bytes.length <= MAX_SOURCE_LOC_BYTES) {
          const lines = bytes.toString('utf8').split(/\r?\n/).filter((line) => line.trim()).length;
          sourceLoc += lines;
          contribution.source_loc = lines;
        }
      }
    }
    if (resolution) aliasRecords.push(Object.freeze({
      ...resolution.resolution, contribution: Object.freeze(contribution),
    }));
  }
  if (sourceLoc < fixture.source_loc.minimum || sourceLoc > fixture.source_loc.maximum) {
    throw new Error(`fixture ${fixture.id} source LOC ${sourceLoc} is outside its frozen class`);
  }
  const inventory = Object.freeze({
    tracked_files: entries.length,
    tracked_bytes: trackedBytes,
    tracked_source_files: sourceFiles,
    tracked_source_bytes: sourceBytes,
    tracked_source_loc: sourceLoc,
    observation_indexed_files: observations.length,
    observation_indexed_bytes: observationBytes,
    observation_paths_digest: sha256(observations.join('\n')),
    retrieval_candidate_files: retrieval.length,
    retrieval_candidate_bytes: retrievalBytes,
    retrieval_paths_digest: sha256(retrieval.join('\n')),
  });
  const aliasEvidenceValue = {
    max_symlink_traversals: limits.max_symlink_traversals,
    full_validation: aliases.validation,
    records: aliasRecords,
  };
  return Object.freeze({
    inventory,
    review_inventory_sha256: inventoryReviewDigest(inventory),
    object_link_resolution: Object.freeze({
      schema: 'lamina.real-repository-oracle-object-link-review/v1',
      ...aliasEvidenceValue,
      alias_count: aliasRecords.length,
      sha256: sha256(JSON.stringify(aliasEvidenceValue)),
    }),
  });
}

export function inventoryReviewDigest(inventory) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    throw new Error('inventory review digest requires an object');
  }
  return sha256(JSON.stringify(Object.fromEntries(
    Object.keys(inventory).sort().map((key) => [key, inventory[key]]),
  )));
}

export function reviewPinnedGitObjects(repository, collection, {
  limits = INVENTORY_REVIEW_LIMITS,
} = {}) {
  const physical = fs.realpathSync.native(repository);
  if (physical !== path.resolve(repository)) throw new Error('Git object review requires a canonical repository');
  const objectFormat = String(checkedGit(physical, ['rev-parse', '--show-object-format'])).trim();
  if (!['sha1', 'sha256'].includes(objectFormat)) throw new Error('Git object review requires a supported object format');
  const commit = String(checkedGit(physical, ['rev-parse', '--verify', `${collection.commit}^{commit}`])).trim();
  const tree = String(checkedGit(physical, ['rev-parse', '--verify', `${collection.commit}^{tree}`])).trim();
  if (commit !== collection.commit || tree !== collection.tree_oid) {
    throw new Error('Git object review repository does not match the exact pinned commit and tree');
  }
  const treeOutput = checkedGit(physical, [
    'ls-tree', '-rz', '--full-tree', '-r', collection.commit,
  ], { encoding: null, maxBuffer: MAX_GIT_LIST_BYTES });
  const entries = parseReviewedTreeRecords(treeOutput, objectFormat, limits.max_tracked_entries);
  const blobs = readBlobBatch(physical, entries, objectFormat, limits);
  const result = inventoryFromObjectRecords(entries, blobs, collection.manifest, collection.fixture, { limits });
  const finalCommit = String(checkedGit(physical, ['rev-parse', '--verify', `${collection.commit}^{commit}`])).trim();
  const finalTree = String(checkedGit(physical, ['rev-parse', '--verify', `${collection.commit}^{tree}`])).trim();
  if (finalCommit !== commit || finalTree !== tree) throw new Error('pinned Git objects changed during review');
  return Object.freeze({
    ...result,
    git_object_identity: Object.freeze({ object_format: objectFormat, commit, tree_oid: tree }),
  });
}

function assertPrivateRoot(root) {
  const declared = path.resolve(String(root || ''));
  const physical = fs.realpathSync.native(declared);
  const stat = fs.lstatSync(physical);
  if (!path.isAbsolute(String(root || '')) || declared !== root || physical !== declared
    || !stat.isDirectory() || stat.isSymbolicLink()
    || (HAS_POSIX_OWNERSHIP && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) {
    throw new Error('inventory review requires the canonical private safe-runner temporary authority');
  }
  return physical;
}

function withReviewRepository(temporaryRoot, collection, action) {
  const parent = assertPrivateRoot(temporaryRoot);
  const root = fs.mkdtempSync(path.join(parent, 'real-repository-review-v1-'));
  const repository = path.join(root, 'objects.git');
  let primary = null;
  try {
    fs.chmodSync(root, 0o700);
    fs.mkdirSync(repository, { mode: 0o700 });
    checkedGit(repository, ['init', '--bare', '--quiet']);
    checkedGit(repository, [
      'fetch', '--quiet', '--no-tags', '--depth', '1', collection.repository_url,
      `+${collection.commit}:refs/lamina/review-pin`,
    ]);
    return action(repository);
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      const physicalRoot = fs.realpathSync.native(root);
      if (physicalRoot !== root || path.dirname(root) !== parent
        || !path.basename(root).startsWith('real-repository-review-v1-')) {
        throw new Error('inventory review scratch identity changed before cleanup');
      }
      fs.rmSync(root, { recursive: true, force: false });
    } catch (cleanupError) {
      if (primary) throw new AggregateError([primary, cleanupError], 'inventory review and cleanup both failed');
      throw cleanupError;
    }
  }
}

export function reviewSignedTier() {
  const context = assertSafeRunnerContext('real-repository independent inventory review');
  const collection = pinnedCollectionForTier(context.tier);
  if (context.tier !== collection.fixture_id || context.tier !== collection.fixture_class) {
    throw new Error('signed safe-runner tier does not match the pinned review collection class');
  }
  return withReviewRepository(process.env.LAMINA_SAFE_RUNNER_TEMP_DIR, collection, (repository) =>
    Object.freeze({
      collection,
      ...reviewPinnedGitObjects(repository, collection),
      bounds: INVENTORY_REVIEW_LIMITS,
    }));
}

// Tests use this only to establish that the module has no accidental dependency
// on checkout-based reconstruction or reviewed inventory authority.
export const INVENTORY_REVIEW_IMPORT_BOUNDARY = Object.freeze([
  'collection-pins.mjs', 'runtime-baseline-v1/contract.mjs', 'safe-runner-context.mjs',
  'safe-runner/git.mjs',
]);
