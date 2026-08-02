import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeRunnerContext } from '../../packages/cli/lib/safe-runner-context.mjs';
import { spawnTrustedGit } from '../../scripts/safe-runner/git.mjs';
import { isExcludedPath } from '../runtime-baseline-v1/contract.mjs';
import { pinnedCollectionForTier, reviewedCollectionForTier } from './collection-authority.mjs';

const SOURCE_NAMES = new Set(['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']);
const SCRATCH_SCHEMA = 'lamina.real-repository-oracle-scratch/v1';
const MAX_GIT_OUTPUT = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_TRACKED_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PORTABLE_LINK_BYTES = 4 * 1024;
const MAX_RETAINED_LINK_BYTES = 4 * 1024 * 1024;
const MAX_SYMLINK_TRAVERSALS = 40;
const REQUIRED_PORTABLE_CHECKOUT_CONFIG = Object.freeze(new Map([
  ['core.repositoryformatversion', new Set(['0'])],
  ['core.filemode', new Set(['true', 'false'])],
  ['core.bare', new Set(['false'])],
  ['core.logallrefupdates', new Set(['true'])],
]));
const OPTIONAL_PORTABLE_CHECKOUT_CONFIG = Object.freeze(new Map([
  ['core.ignorecase', new Set(['true', 'false'])],
  ['core.precomposeunicode', new Set(['true', 'false'])],
]));
const HAS_POSIX_OWNERSHIP = process.platform !== 'win32'
  && typeof process.getuid === 'function';
export const RECONSTRUCTION_LIMITS = Object.freeze({
  max_tracked_entries: 6_000,
  max_counted_tracked_bytes: 256 * 1024 * 1024,
  max_followed_file_bytes: MAX_TRACKED_FILE_BYTES,
  max_retained_link_bytes: MAX_RETAINED_LINK_BYTES,
  max_symlink_traversals: MAX_SYMLINK_TRAVERSALS,
});

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function checkedGit(cwd, args, timeout = 20 * 60_000) {
  const result = spawnTrustedGit(cwd, ['-c', 'core.symlinks=false', ...args], {
    encoding: 'utf8', timeout, maxBuffer: MAX_GIT_OUTPUT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(`trusted Git failed (${args[0]}): ${String(result.stderr || '').slice(-2000)}`);
  }
  return String(result.stdout || '');
}

function optionalGit(cwd, args, timeout = 60_000) {
  const result = spawnTrustedGit(cwd, ['-c', 'core.symlinks=false', ...args], {
    encoding: 'utf8', timeout, maxBuffer: MAX_GIT_OUTPUT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw result.error || new Error(`trusted Git failed (${args[0]})`);
  }
  return result.status === 0 ? String(result.stdout || '') : null;
}

function safeRelativePath(relative) {
  return typeof relative === 'string' && relative.length > 0 && !relative.includes('\0')
    && !relative.includes('\\') && !relative.startsWith('/') && !/^[A-Za-z]:/.test(relative)
    && relative.split('/').every((piece) => piece && piece !== '.' && piece !== '..');
}

function readPhysicalTrackedFile(
  repository,
  relative,
  maximumFileBytes = MAX_TRACKED_FILE_BYTES,
  maximumAggregateRemaining = Number.MAX_SAFE_INTEGER,
) {
  if (!safeRelativePath(relative)) throw new Error(`unsafe tracked path: ${JSON.stringify(relative)}`);
  const file = path.join(repository, relative);
  const canonical = fs.realpathSync.native(file);
  if (canonical !== file || !canonical.startsWith(`${repository}${path.sep}`)) {
    throw new Error(`tracked path is not a physical repository file: ${relative}`);
  }
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    throw new Error(`tracked path is not a regular file: ${relative}`);
  }
  if (before.size > BigInt(maximumFileBytes)) {
    throw new Error(`tracked path exceeds the bounded physical-file budget: ${relative}`);
  }
  if (!Number.isSafeInteger(maximumAggregateRemaining) || maximumAggregateRemaining < 0
    || before.size > BigInt(maximumAggregateRemaining)) {
    throw new Error('tracked regular files exceed the fixed aggregate retained-byte bound');
  }
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || opened.mode !== before.mode || opened.nlink !== 1n) {
      throw new Error(`tracked path changed while opening: ${relative}`);
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const pathAfter = fs.lstatSync(file, { bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.mode !== opened.mode
      || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs
      || after.ctimeNs !== opened.ctimeNs || after.nlink !== 1n
      || JSON.stringify(stableStatIdentity(pathAfter).map(String))
        !== JSON.stringify(stableStatIdentity(after).map(String))
      || BigInt(bytes.length) !== opened.size) {
      throw new Error(`tracked path changed while reading: ${relative}`);
    }
    return { bytes, mode: Number(opened.mode & 0o777n) };
  } finally {
    fs.closeSync(descriptor);
  }
}

function gitBlobOid(objectFormat, bytes) {
  if (!['sha1', 'sha256'].includes(objectFormat)) {
    throw new Error('tracked blob verification requires the repository object format');
  }
  return crypto.createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function stableStatIdentity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs];
}

function assertPortableCheckoutConfig(repository) {
  const records = checkedGit(repository, ['config', '--local', '--null', '--list'], 60_000)
    .split('\0').filter(Boolean);
  const seen = new Map();
  for (const record of records) {
    const separator = record.indexOf('\n');
    if (separator <= 0) throw new Error('portable checkout Git config is malformed');
    const key = record.slice(0, separator).toLowerCase();
    const value = record.slice(separator + 1);
    const admittedValues = REQUIRED_PORTABLE_CHECKOUT_CONFIG.get(key)
      || OPTIONAL_PORTABLE_CHECKOUT_CONFIG.get(key);
    if (seen.has(key) || !admittedValues?.has(value)) {
      throw new Error(`portable checkout Git config is outside the exact allowlist: ${key}`);
    }
    seen.set(key, value);
  }
  if ([...REQUIRED_PORTABLE_CHECKOUT_CONFIG.keys()].some((key) => !seen.has(key))) {
    throw new Error('portable checkout requires the exact inert local Git config');
  }
}

function portableLinkResolver(
  repository, entries, objectFormat, regularFiles, trackedPaths, maximumRetainedLinkBytes,
) {
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const impliedDirectories = new Set(['']);
  for (const trackedPath of trackedPaths) {
    let parent = path.posix.dirname(trackedPath);
    while (parent !== '.') {
      impliedDirectories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const linkBodies = new Map();
  const retainedBodies = new Set();
  let retainedLinkBytes = 0;

  function readLinkBody(entry) {
    const file = path.join(repository, entry.path);
    const before = fs.lstatSync(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
      throw new Error(`stage-0 portable link is not a physical single-link regular file: ${entry.path}`);
    }
    if (linkBodies.has(entry.path)) {
      const retained = linkBodies.get(entry.path);
      if (JSON.stringify(stableStatIdentity(before).map(String)) !== retained.stat_identity) {
        throw new Error(`stage-0 portable link changed after validation: ${entry.path}`);
      }
      return retained;
    }
    const physical = readPhysicalTrackedFile(repository, entry.path, MAX_PORTABLE_LINK_BYTES);
    if (entry.oid !== gitBlobOid(objectFormat, physical.bytes)) {
      throw new Error(`portable link bytes do not match the stage-0 Git object: ${entry.path}`);
    }
    if (!retainedBodies.has(entry.path)) {
      retainedLinkBytes += physical.bytes.length;
      if (retainedLinkBytes > maximumRetainedLinkBytes) {
        throw new Error('portable links exceed the fixed aggregate retained-link-byte bound');
      }
      retainedBodies.add(entry.path);
    }
    let targetText;
    try {
      targetText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
        .decode(physical.bytes);
    } catch { throw new Error(`portable link target is not UTF-8: ${entry.path}`); }
    if (!targetText || targetText.includes('\0') || targetText.includes('\\')
      || path.posix.isAbsolute(targetText) || /^[A-Za-z]:/.test(targetText)) {
      throw new Error(`portable link target must be relative UTF-8: ${entry.path}`);
    }
    const after = fs.lstatSync(file, { bigint: true });
    const identity = JSON.stringify(stableStatIdentity(before).map(String));
    if (JSON.stringify(stableStatIdentity(after).map(String)) !== identity) {
      throw new Error(`stage-0 portable link changed after reading: ${entry.path}`);
    }
    const result = Object.freeze({
      bytes: physical.bytes,
      text: targetText,
      components: targetText.split('/').filter((component) => component !== ''),
      trailingSlash: targetText.endsWith('/'),
      stat_identity: identity,
    });
    linkBodies.set(entry.path, result);
    return result;
  }

  function physicalNode(relative, origin) {
    const physicalPath = relative ? path.join(repository, relative) : repository;
    let stat;
    try { stat = fs.lstatSync(physicalPath); }
    catch { throw new Error(`portable link target is broken: ${origin.path}`); }
    if (stat.isSymbolicLink()) {
      throw new Error(`portable link target traverses a physical symlink: ${origin.path}`);
    }
    if (stat.isDirectory()) {
      if (!impliedDirectories.has(relative) || fs.realpathSync.native(physicalPath) !== physicalPath) {
        throw new Error(`portable link targets an untracked directory: ${origin.path}`);
      }
      return { kind: 'directory', path: relative };
    }
    if (!stat.isFile()) throw new Error(`portable link targets a special file: ${origin.path}`);
    throw new Error(`portable link targets an untracked file: ${origin.path}`);
  }

  function resolve(entry, enforceTraversalLimit = true) {
    const pending = [];
    const traversed = new Set();
    let current = '';
    let traversalHops = 0;
    let requireDirectory = false;
    let topBody = null;

    const follow = (linkEntry) => {
      traversalHops += 1;
      if (enforceTraversalLimit && traversalHops > MAX_SYMLINK_TRAVERSALS) return false;
      if (traversed.has(linkEntry.path)) {
        throw new Error(`portable link target is cyclic: ${entry.path}`);
      }
      traversed.add(linkEntry.path);
      const body = readLinkBody(linkEntry);
      if (topBody === null) topBody = body;
      if (body.trailingSlash && pending.length === 0) requireDirectory = true;
      for (let index = body.components.length - 1; index >= 0; index -= 1) {
        pending.push(body.components[index]);
      }
      const parent = path.posix.dirname(linkEntry.path);
      current = parent === '.' ? '' : parent;
      return true;
    };

    const finish = (node, nativeSkipReason = null) => {
      return {
        physical: nativeSkipReason || node.kind !== 'file' ? null : node.physical,
        resolution: Object.freeze({
          path: entry.path,
          link_oid: entry.oid,
          link_target_text: topBody.text,
          link_byte_length: topBody.bytes.length,
          traversal_hops: traversalHops,
          traversal_limit: MAX_SYMLINK_TRAVERSALS,
          outcome: nativeSkipReason ? 'skipped' : node.kind,
          skip_reason: nativeSkipReason,
          target_kind: node.kind,
          target_path: node.path,
          target_oid: node.kind === 'file' ? node.oid : null,
          target_size: node.kind === 'file' ? node.physical.bytes.length : null,
        }),
      };
    };

    const traversalLimit = () => ({
      physical: null,
      resolution: Object.freeze({
        path: entry.path,
        link_oid: entry.oid,
        link_target_text: topBody.text,
        link_byte_length: topBody.bytes.length,
        traversal_hops: traversalHops,
        traversal_limit: MAX_SYMLINK_TRAVERSALS,
        outcome: 'skipped',
        skip_reason: 'symlink_traversal_limit',
        target_kind: null,
        target_path: null,
        target_oid: null,
        target_size: null,
      }),
    });

    if (!follow(entry)) return traversalLimit();
    while (pending.length) {
      const component = pending.pop();
      if (component === '.') continue;
      if (component === '..') {
        if (!current) throw new Error(`portable link target escapes repository content: ${entry.path}`);
        current = path.posix.dirname(current);
        if (current === '.') current = '';
        continue;
      }
      const candidate = current ? `${current}/${component}` : component;
      if (candidate === '.git' || candidate.startsWith('.git/')) {
        throw new Error(`portable link target escapes repository content: ${entry.path}`);
      }
      const targetEntry = entryByPath.get(candidate);
      if (targetEntry?.mode === '120000') {
        if (!follow(targetEntry)) return traversalLimit();
        continue;
      }
      if (targetEntry && ['100644', '100755'].includes(targetEntry.mode)) {
        const target = regularFiles.get(candidate);
        if (!target) throw new Error(`portable link targets an unverified tracked file: ${entry.path}`);
        const node = { kind: 'file', physical: target, path: candidate, oid: targetEntry.oid };
        if (pending.length || requireDirectory) {
          return finish(node, 'not_directory');
        }
        return finish(node);
      }
      if (impliedDirectories.has(candidate)) {
        const directory = physicalNode(candidate, entry);
        current = directory.path;
        continue;
      }
      physicalNode(candidate, entry);
    }
    return finish(physicalNode(current, entry));
  }
  // Validate the complete bounded Git-declared link graph independently of
  // Linux's pathname limit. Metric resolution below still stops at hop 41,
  // while malformed suffixes cannot hide behind that native ELOOP result.
  // This walk is iterative: even the 6,000-entry cap cannot consume JS stack.
  for (const entry of entries) {
    if (entry.mode === '120000') resolve(entry, false);
  }
  return (entry) => resolve(entry, true);
}

function trackedEntries(repository, maximumEntries = Number.MAX_SAFE_INTEGER) {
  const output = checkedGit(repository, ['ls-files', '--stage', '-z'], 60_000);
  const entries = output.split('\0').filter(Boolean).map((record) => {
    const match = record.match(/^([0-7]{6}) ([a-f0-9]{40,64}) ([0-3])\t([\s\S]+)$/);
    if (!match || !['100644', '100755', '120000'].includes(match[1]) || match[3] !== '0'
      || !safeRelativePath(match[4])) {
      throw new Error('pinned collection contains an unsafe, special, gitlink, or unmerged tracked entry');
    }
    return { mode: match[1], oid: match[2], path: match[4] };
  });
  if (entries.length > maximumEntries) {
    throw new Error(`pinned collection exceeds the ${maximumEntries}-entry reconstruction cap`);
  }
  const paths = entries.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length
    || JSON.stringify(paths) !== JSON.stringify([...paths].sort((a, b) => Buffer.from(a).compare(Buffer.from(b))))) {
    throw new Error('pinned collection tracked paths are duplicate or not in Git byte order');
  }
  return entries;
}

export function candidateInventoryFromTracked(repository, entries, manifest, fixture, {
  objectFormat = null,
  maximumTrackedBytes = Number.MAX_SAFE_INTEGER,
  maximumEntries = Number.MAX_SAFE_INTEGER,
  maximumFileBytes = MAX_TRACKED_FILE_BYTES,
  maximumRetainedLinkBytes = MAX_RETAINED_LINK_BYTES,
  portableCheckout = false,
  portableResolutionEvidence = null,
} = {}) {
  const physicalRepository = fs.realpathSync.native(repository);
  if (physicalRepository !== path.resolve(repository)) {
    throw new Error('candidate inventory requires a canonical physical repository');
  }
  const sourceExtensions = new Set(manifest.source_extensions);
  const retrievalExtensions = new Set(manifest.retrieval_extensions);
  const observationPaths = [];
  const retrievalPaths = [];
  let trackedBytes = 0;
  let observationBytes = 0;
  let retrievalBytes = 0;
  let sourceFiles = 0;
  let sourceBytes = 0;
  let sourceLoc = 0;
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 0 || entries.length > maximumEntries
    || !Number.isSafeInteger(maximumTrackedBytes) || maximumTrackedBytes < 0
    || !Number.isSafeInteger(maximumFileBytes) || maximumFileBytes <= 0
    || maximumFileBytes > MAX_TRACKED_FILE_BYTES
    || !Number.isSafeInteger(maximumRetainedLinkBytes) || maximumRetainedLinkBytes <= 0
    || maximumRetainedLinkBytes > MAX_RETAINED_LINK_BYTES
    || (portableResolutionEvidence !== null && !Array.isArray(portableResolutionEvidence))) {
    throw new Error('candidate inventory bounds are invalid or exceeded');
  }
  const trackedPaths = entries.map((entry) => (typeof entry === 'string' ? entry : entry.path));
  const regularFiles = new Map();
  let retainedRegularBytes = 0;
  for (const entry of entries) {
    if (typeof entry === 'string' || !['100644', '100755'].includes(entry.mode)) continue;
    const physical = readPhysicalTrackedFile(
      physicalRepository,
      entry.path,
      maximumFileBytes,
      maximumTrackedBytes - retainedRegularBytes,
    );
    const physicalMode = (physical.mode & 0o111) === 0 ? '100644' : '100755';
    if (entry.mode !== physicalMode || entry.oid !== gitBlobOid(objectFormat, physical.bytes)) {
      throw new Error(`tracked physical bytes or mode do not match the stage-0 Git object: ${entry.path}`);
    }
    retainedRegularBytes += physical.bytes.length;
    regularFiles.set(entry.path, physical);
  }
  const portableEntries = entries.filter((entry) => typeof entry !== 'string' && entry.mode === '120000');
  let resolvePortableLink = null;
  if (portableEntries.length) {
    if (portableCheckout !== true) {
      throw new Error('portable link inventory requires proved command-line core.symlinks=false checkout');
    }
    assertPortableCheckoutConfig(physicalRepository);
    resolvePortableLink = portableLinkResolver(
      physicalRepository, entries, objectFormat, regularFiles, trackedPaths,
      maximumRetainedLinkBytes,
    );
  }
  for (const entry of entries) {
    const relative = typeof entry === 'string' ? entry : entry.path;
    if (typeof entry !== 'string' && !['100644', '100755', '120000'].includes(entry.mode)) {
      throw new Error('candidate inventory received a special, gitlink, or unmerged tracked entry');
    }
    const portableResolution = typeof entry !== 'string' && entry.mode === '120000'
      ? resolvePortableLink(entry)
      : null;
    const physical = typeof entry === 'string'
      ? readPhysicalTrackedFile(physicalRepository, relative, maximumFileBytes)
      : portableResolution
        ? portableResolution.physical
        : regularFiles.get(relative);
    const contribution = {
      tracked_bytes: 0,
      observation_included: false,
      observation_bytes: 0,
      retrieval_included: false,
      retrieval_bytes: 0,
      source_included: false,
      source_bytes: 0,
      source_loc: 0,
    };
    // #60 counted the tracked path but skipped bytes and candidates when
    // fs.stat failed (including ELOOP/ENOTDIR) or resolved a tracked symlink
    // to an internal directory.
    if (physical === null) {
      if (portableResolutionEvidence && portableResolution) {
        portableResolutionEvidence.push(Object.freeze({
          ...portableResolution.resolution,
          contribution: Object.freeze(contribution),
        }));
      }
      continue;
    }
    const { bytes } = physical;
    trackedBytes += bytes.length;
    contribution.tracked_bytes = bytes.length;
    if (trackedBytes > maximumTrackedBytes) {
      throw new Error('tracked collection exceeds the fixed aggregate counted-byte bound');
    }
    if (!isExcludedPath(relative, manifest.exclusions)) {
      observationPaths.push(relative);
      observationBytes += bytes.length;
      contribution.observation_included = true;
      contribution.observation_bytes = bytes.length;
    }
    const extension = path.extname(relative).toLowerCase();
    if (retrievalExtensions.has(extension) && bytes.length <= manifest.retrieval_max_file_bytes) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        retrievalPaths.push(relative);
        retrievalBytes += bytes.length;
        contribution.retrieval_included = true;
        contribution.retrieval_bytes = bytes.length;
      } catch {}
    }
    if (sourceExtensions.has(extension) || SOURCE_NAMES.has(path.basename(relative))) {
      sourceFiles += 1;
      sourceBytes += bytes.length;
      contribution.source_included = true;
      contribution.source_bytes = bytes.length;
      if (bytes.length <= MAX_SOURCE_BYTES) {
        const lines = bytes.toString('utf8').split(/\r?\n/).filter((line) => line.trim()).length;
        sourceLoc += lines;
        contribution.source_loc = lines;
      }
    }
    if (portableResolutionEvidence && portableResolution) {
      portableResolutionEvidence.push(Object.freeze({
        ...portableResolution.resolution,
        contribution: Object.freeze(contribution),
      }));
    }
  }
  if (sourceLoc < fixture.source_loc.minimum || sourceLoc > fixture.source_loc.maximum) {
    throw new Error(`fixture ${fixture.id} source LOC ${sourceLoc} is outside its frozen class`);
  }
  return Object.freeze({
    tracked_files: entries.length,
    tracked_bytes: trackedBytes,
    tracked_source_files: sourceFiles,
    tracked_source_bytes: sourceBytes,
    tracked_source_loc: sourceLoc,
    observation_indexed_files: observationPaths.length,
    observation_indexed_bytes: observationBytes,
    observation_paths_digest: sha256(observationPaths.join('\n')),
    retrieval_candidate_files: retrievalPaths.length,
    retrieval_candidate_bytes: retrievalBytes,
    retrieval_paths_digest: sha256(retrievalPaths.join('\n')),
  });
}

export function candidateInventoryDigest(inventory) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    throw new Error('candidate inventory digest requires an object');
  }
  const canonical = Object.fromEntries(Object.keys(inventory).sort().map((key) => [key, inventory[key]]));
  return sha256(JSON.stringify(canonical));
}

function assertReviewedInventory(actual, expected) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error('reviewed inventory field semantics changed');
  }
  for (const key of expectedKeys) {
    if (actual[key] !== expected[key]) {
      throw new Error(`reviewed inventory mismatch for ${key}: expected ${expected[key]}, received ${actual[key]}`);
    }
  }
}

function readPinnedRepositoryState(repository) {
  const head = checkedGit(repository, ['rev-parse', '--verify', 'HEAD^{commit}'], 60_000).trim();
  const treeOid = checkedGit(repository, ['rev-parse', '--verify', 'HEAD^{tree}'], 60_000).trim();
  const branch = optionalGit(repository, ['symbolic-ref', '--quiet', 'HEAD'], 60_000);
  const remotes = checkedGit(repository, ['remote'], 60_000).trim();
  const changes = checkedGit(repository, [
    'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all',
  ], 60_000).split('\0').filter((record) => record && !record.startsWith('# '));
  return { head, tree_oid: treeOid, branch, remotes, changes };
}

function assertPinnedRepositoryState(state, collection, message) {
  if (state.head !== collection.commit || state.tree_oid !== collection.tree_oid
    || state.branch !== null || state.remotes || state.changes.length) throw new Error(message);
}

function assertNoPhysicalSymlinks(repository, maximumEntries = 100_000) {
  const pending = [repository];
  let visited = 0;
  while (pending.length) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory).sort()) {
      visited += 1;
      if (visited > maximumEntries) {
        throw new Error('portable checkout exceeds the bounded physical-entry scan');
      }
      const candidate = path.join(directory, name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        throw new Error(`portable checkout contains a physical symlink: ${path.relative(repository, candidate)}`);
      }
      if (stat.isDirectory()) pending.push(candidate);
    }
  }
}

export function verifyPinnedRepository(repository, collection) {
  const physicalRepository = fs.realpathSync.native(repository);
  if (physicalRepository !== path.resolve(repository)) {
    throw new Error('pinned collection must use its canonical physical path');
  }
  assertPinnedRepositoryState(readPinnedRepositoryState(physicalRepository), collection,
    'materialized repository is not the exact detached, clean, remote-free pinned collection');
  assertPortableCheckoutConfig(physicalRepository);
  assertNoPhysicalSymlinks(physicalRepository);
  const objectFormat = checkedGit(physicalRepository, ['rev-parse', '--show-object-format'], 60_000).trim();
  const maximumEntries = collection.reviewed_inventory.tracked_files;
  const inventory = candidateInventoryFromTracked(
    physicalRepository, trackedEntries(physicalRepository, maximumEntries),
    collection.manifest, collection.fixture,
    {
      objectFormat,
      maximumTrackedBytes: collection.reviewed_inventory.tracked_bytes,
      maximumEntries,
      portableCheckout: true,
    },
  );
  assertReviewedInventory(inventory, collection.reviewed_inventory);
  assertPinnedRepositoryState(readPinnedRepositoryState(physicalRepository), collection,
    'pinned collection changed during inventory admission');
  assertPortableCheckoutConfig(physicalRepository);
  assertNoPhysicalSymlinks(physicalRepository);
  return inventory;
}

export function reconstructPinnedRepositoryInventory(repository, collection) {
  const physicalRepository = fs.realpathSync.native(repository);
  if (physicalRepository !== path.resolve(repository)) {
    throw new Error('pinned reconstruction collection must use its canonical physical path');
  }
  assertPinnedRepositoryState(readPinnedRepositoryState(physicalRepository), collection,
    'reconstruction repository is not the exact detached, clean, remote-free pinned collection');
  assertPortableCheckoutConfig(physicalRepository);
  assertNoPhysicalSymlinks(physicalRepository);
  const objectFormat = checkedGit(physicalRepository, ['rev-parse', '--show-object-format'], 60_000).trim();
  const portableResolutionEvidence = [];
  const inventory = candidateInventoryFromTracked(
    physicalRepository,
    trackedEntries(physicalRepository, RECONSTRUCTION_LIMITS.max_tracked_entries),
    collection.manifest,
    collection.fixture,
    {
      objectFormat,
      maximumTrackedBytes: RECONSTRUCTION_LIMITS.max_counted_tracked_bytes,
      maximumEntries: RECONSTRUCTION_LIMITS.max_tracked_entries,
      maximumFileBytes: RECONSTRUCTION_LIMITS.max_followed_file_bytes,
      maximumRetainedLinkBytes: RECONSTRUCTION_LIMITS.max_retained_link_bytes,
      portableCheckout: true,
      portableResolutionEvidence,
    },
  );
  assertPinnedRepositoryState(readPinnedRepositoryState(physicalRepository), collection,
    'pinned collection changed during inventory reconstruction');
  assertPortableCheckoutConfig(physicalRepository);
  assertNoPhysicalSymlinks(physicalRepository);
  const portableLinkResolution = Object.freeze({
    schema: 'lamina.real-repository-oracle-portable-link-resolution/v1',
    max_symlink_traversals: MAX_SYMLINK_TRAVERSALS,
    alias_count: portableResolutionEvidence.length,
    records: Object.freeze(portableResolutionEvidence),
    sha256: sha256(JSON.stringify({
      max_symlink_traversals: MAX_SYMLINK_TRAVERSALS,
      records: portableResolutionEvidence,
    })),
  });
  return Object.freeze({
    inventory,
    candidate_inventory_sha256: candidateInventoryDigest(inventory),
    portable_link_resolution: portableLinkResolution,
  });
}

function assertPrivateTemporaryRoot(runnerTemporaryRoot) {
  const supplied = String(runnerTemporaryRoot || '');
  const declared = path.resolve(supplied);
  const physical = fs.realpathSync.native(declared);
  const stat = fs.lstatSync(declared);
  if (!path.isAbsolute(supplied) || supplied !== declared || physical !== declared
    || !stat.isDirectory() || stat.isSymbolicLink()
    || (HAS_POSIX_OWNERSHIP
      && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) {
    throw new Error('real-repository oracle requires the canonical private safe-runner temporary authority');
  }
  return physical;
}

export function createScratch(runnerTemporaryRoot) {
  const physicalRoot = assertPrivateTemporaryRoot(runnerTemporaryRoot);
  const root = fs.mkdtempSync(path.join(physicalRoot, 'real-repository-oracle-v1-'));
  try {
    fs.chmodSync(root, 0o700);
    const rootStat = fs.lstatSync(root, { bigint: true });
    const template = path.join(root, 'template');
    fs.mkdirSync(template, { mode: 0o700 });
    const marker = path.join(root, '.owner.json');
    fs.writeFileSync(marker, `${JSON.stringify({
      schema: SCRATCH_SCHEMA,
      root,
      dev: String(rootStat.dev),
      ino: String(rootStat.ino),
      uid: Number(rootStat.uid),
      nonce: crypto.randomUUID(),
      owned: ['source', 'template'],
    })}\n`, { flag: 'wx', mode: 0o600 });
    return Object.freeze({ root, marker, source: path.join(root, 'source'), template });
  } catch (error) {
    try {
      const marker = path.join(root, '.owner.json');
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
      if (fs.existsSync(path.join(root, 'template'))
        && fs.readdirSync(path.join(root, 'template')).length === 0) fs.rmdirSync(path.join(root, 'template'));
      if (fs.readdirSync(root).length === 0) fs.rmdirSync(root);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'scratch creation and cleanup both failed');
    }
    throw error;
  }
}

function validatedScratch(scratch) {
  if (!scratch || path.dirname(scratch.marker || '') !== scratch.root
    || scratch.source !== path.join(scratch.root || '', 'source')
    || scratch.template !== path.join(scratch.root || '', 'template')) {
    throw new Error('real-repository scratch paths are invalid');
  }
  const root = fs.realpathSync.native(scratch.root);
  const stat = fs.lstatSync(root, { bigint: true });
  const markerStat = fs.lstatSync(scratch.marker, { bigint: true });
  const templateStat = fs.lstatSync(scratch.template, { bigint: true });
  const marker = JSON.parse(fs.readFileSync(scratch.marker, 'utf8'));
  const invalidPosixOwnership = HAS_POSIX_OWNERSHIP
    && ((stat.mode & 0o077n) !== 0n || stat.uid !== BigInt(process.getuid())
      || markerStat.uid !== stat.uid || (markerStat.mode & 0o077n) !== 0n
      || templateStat.uid !== stat.uid || (templateStat.mode & 0o077n) !== 0n
      || marker.uid !== Number(stat.uid));
  if (root !== scratch.root || !stat.isDirectory() || stat.isSymbolicLink()
    || !markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink !== 1n
    || invalidPosixOwnership
    || !templateStat.isDirectory() || templateStat.isSymbolicLink()
    || fs.realpathSync.native(scratch.template) !== scratch.template
    || fs.readdirSync(scratch.template).length !== 0
    || marker.schema !== SCRATCH_SCHEMA || marker.root !== root
    || marker.dev !== String(stat.dev) || marker.ino !== String(stat.ino)
    || !/^[0-9a-f-]{36}$/i.test(marker.nonce)
    || JSON.stringify(marker.owned) !== JSON.stringify(['source', 'template'])) {
    throw new Error('real-repository scratch ownership marker is invalid');
  }
  return marker;
}

export function removeScratch(scratch) {
  validatedScratch(scratch);
  const allowed = new Set(['.owner.json', 'source', 'template']);
  const foreign = fs.readdirSync(scratch.root).filter((name) => !allowed.has(name));
  if (foreign.length) {
    throw new Error(`real-repository scratch contains foreign entries: ${foreign.join(', ')}`);
  }
  if (fs.existsSync(scratch.source)) {
    const sourceStat = fs.lstatSync(scratch.source);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()
      || fs.realpathSync.native(scratch.source) !== scratch.source) {
      throw new Error('real-repository owned source is not a canonical physical directory');
    }
    fs.rmSync(scratch.source, { recursive: true, force: false });
  }
  fs.rmdirSync(scratch.template);
  fs.unlinkSync(scratch.marker);
  fs.rmdirSync(scratch.root);
}

export function withOwnedScratch(runnerTemporaryRoot, action) {
  const scratch = createScratch(runnerTemporaryRoot);
  let primaryError = null;
  try {
    return action(scratch);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      removeScratch(scratch);
    } catch (cleanupError) {
      if (primaryError) {
        throw new AggregateError([primaryError, cleanupError], 'scratch action and cleanup both failed');
      }
      throw cleanupError;
    }
  }
}

function materializePinnedRepository(scratch, collection) {
  validatedScratch(scratch);
  checkedGit(scratch.root, ['init', `--template=${scratch.template}`, '--quiet', scratch.source], 60_000);
  assertPortableCheckoutConfig(scratch.source);
  checkedGit(scratch.source, [
    'fetch', '--quiet', '--no-tags', '--depth', '1', collection.repository_url,
    `+${collection.commit}:refs/lamina/oracle-pin`,
  ]);
  checkedGit(scratch.source, ['checkout', '--quiet', '--detach', collection.commit], 60_000);
  assertNoPhysicalSymlinks(scratch.source);
  return scratch.source;
}

export function inspectSignedTier() {
  const context = assertSafeRunnerContext('real-repository inventory admission');
  const collection = reviewedCollectionForTier(context.tier);
  if (context.tier !== collection.fixture_id || context.tier !== collection.fixture_class) {
    throw new Error('signed safe-runner tier does not match the frozen collection class');
  }
  // The temporary refusal above is intentionally before temporary allocation or
  // network access for tiers whose inventories have not been independently reviewed.
  return withOwnedScratch(process.env.LAMINA_SAFE_RUNNER_TEMP_DIR, (scratch) => {
    const repository = materializePinnedRepository(scratch, collection);
    const inventory = verifyPinnedRepository(repository, collection);
    return Object.freeze({ collection, inventory });
  });
}

export function reconstructSignedTier() {
  const context = assertSafeRunnerContext('real-repository inventory reconstruction');
  const collection = pinnedCollectionForTier(context.tier);
  if (context.tier !== collection.fixture_id || context.tier !== collection.fixture_class) {
    throw new Error('signed safe-runner tier does not match the frozen reconstruction collection class');
  }
  return withOwnedScratch(process.env.LAMINA_SAFE_RUNNER_TEMP_DIR, (scratch) => {
    const repository = materializePinnedRepository(scratch, collection);
    const candidate = reconstructPinnedRepositoryInventory(repository, collection);
    return Object.freeze({ collection, ...candidate, bounds: RECONSTRUCTION_LIMITS });
  });
}
