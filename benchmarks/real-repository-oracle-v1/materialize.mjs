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
const HAS_POSIX_OWNERSHIP = process.platform !== 'win32'
  && typeof process.getuid === 'function';
export const RECONSTRUCTION_LIMITS = Object.freeze({
  max_tracked_entries: 6_000,
  max_counted_tracked_bytes: 256 * 1024 * 1024,
  max_followed_file_bytes: MAX_TRACKED_FILE_BYTES,
});

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function checkedGit(cwd, args, timeout = 20 * 60_000) {
  const result = spawnTrustedGit(cwd, args, {
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
  const result = spawnTrustedGit(cwd, args, {
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
  if (!before.isFile() || before.isSymbolicLink()) {
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
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error(`tracked path changed while opening: ${relative}`);
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs || BigInt(bytes.length) !== opened.size) {
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

function readTrackedSymlink(repository, entry, objectFormat, regularFiles, trackedPaths) {
  const file = path.join(repository, entry.path);
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isSymbolicLink()) {
    throw new Error(`stage-0 symlink is not a physical symlink: ${entry.path}`);
  }
  let linkBytes;
  try { linkBytes = fs.readlinkSync(file, { encoding: 'buffer' }); }
  catch { throw new Error(`stage-0 symlink cannot be read: ${entry.path}`); }
  const after = fs.lstatSync(file, { bigint: true });
  if (JSON.stringify(stableStatIdentity(before).map(String))
    !== JSON.stringify(stableStatIdentity(after).map(String))) {
    throw new Error(`stage-0 symlink changed while reading: ${entry.path}`);
  }
  if (entry.oid !== gitBlobOid(objectFormat, linkBytes)) {
    throw new Error(`tracked symlink bytes do not match the stage-0 Git object: ${entry.path}`);
  }
  let targetText;
  try { targetText = new TextDecoder('utf-8', { fatal: true }).decode(linkBytes); }
  catch { throw new Error(`tracked symlink target is not UTF-8: ${entry.path}`); }
  if (!targetText || targetText.includes('\0') || targetText.includes('\\')
    || path.isAbsolute(targetText) || /^[A-Za-z]:/.test(targetText)) {
    throw new Error(`tracked symlink target must be relative: ${entry.path}`);
  }
  const declaredTarget = path.resolve(path.dirname(file), targetText);
  let canonicalTarget;
  try { canonicalTarget = fs.realpathSync.native(declaredTarget); }
  catch { throw new Error(`tracked symlink target is broken or cyclic: ${entry.path}`); }
  const gitDirectory = path.join(repository, '.git');
  if ((canonicalTarget !== repository && !canonicalTarget.startsWith(`${repository}${path.sep}`))
    || canonicalTarget === gitDirectory || canonicalTarget.startsWith(`${gitDirectory}${path.sep}`)) {
    throw new Error(`tracked symlink target escapes repository content: ${entry.path}`);
  }
  const targetStat = fs.statSync(canonicalTarget);
  if (targetStat.isFile()) {
    const targetRelative = path.relative(repository, canonicalTarget).replaceAll('\\', '/');
    const target = regularFiles.get(targetRelative);
    if (!target || canonicalTarget !== path.join(repository, targetRelative)) {
      throw new Error(`tracked symlink targets an unverified or untracked file: ${entry.path}`);
    }
    return target;
  }
  if (targetStat.isDirectory()) {
    const targetRelative = path.relative(repository, canonicalTarget).replaceAll('\\', '/');
    const prefix = targetRelative ? `${targetRelative}/` : '';
    if (!trackedPaths.some((candidate) => candidate !== entry.path && candidate.startsWith(prefix))) {
      throw new Error(`tracked symlink targets an untracked directory: ${entry.path}`);
    }
    return null;
  }
  throw new Error(`tracked symlink targets a special file: ${entry.path}`);
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
    || maximumFileBytes > MAX_TRACKED_FILE_BYTES) {
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
  for (const entry of entries) {
    const relative = typeof entry === 'string' ? entry : entry.path;
    if (typeof entry !== 'string' && !['100644', '100755', '120000'].includes(entry.mode)) {
      throw new Error('candidate inventory received a special, gitlink, or unmerged tracked entry');
    }
    const physical = typeof entry === 'string'
      ? readPhysicalTrackedFile(physicalRepository, relative, maximumFileBytes)
      : entry.mode === '120000'
        ? readTrackedSymlink(physicalRepository, entry, objectFormat, regularFiles, trackedPaths)
        : regularFiles.get(relative);
    // #60 counted the tracked path but skipped bytes and candidates when
    // fs.stat resolved a tracked symlink to an internal directory.
    if (physical === null) continue;
    const { bytes } = physical;
    trackedBytes += bytes.length;
    if (trackedBytes > maximumTrackedBytes) {
      throw new Error('tracked collection exceeds the fixed aggregate counted-byte bound');
    }
    if (!isExcludedPath(relative, manifest.exclusions)) {
      observationPaths.push(relative);
      observationBytes += bytes.length;
    }
    const extension = path.extname(relative).toLowerCase();
    if (retrievalExtensions.has(extension) && bytes.length <= manifest.retrieval_max_file_bytes) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        retrievalPaths.push(relative);
        retrievalBytes += bytes.length;
      } catch {}
    }
    if (sourceExtensions.has(extension) || SOURCE_NAMES.has(path.basename(relative))) {
      sourceFiles += 1;
      sourceBytes += bytes.length;
      if (bytes.length <= MAX_SOURCE_BYTES) {
        sourceLoc += bytes.toString('utf8').split(/\r?\n/).filter((line) => line.trim()).length;
      }
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

export function verifyPinnedRepository(repository, collection) {
  const physicalRepository = fs.realpathSync.native(repository);
  if (physicalRepository !== path.resolve(repository)) {
    throw new Error('pinned collection must use its canonical physical path');
  }
  assertPinnedRepositoryState(readPinnedRepositoryState(physicalRepository), collection,
    'materialized repository is not the exact detached, clean, remote-free pinned collection');
  const objectFormat = checkedGit(physicalRepository, ['rev-parse', '--show-object-format'], 60_000).trim();
  const maximumEntries = collection.reviewed_inventory.tracked_files;
  const inventory = candidateInventoryFromTracked(
    physicalRepository, trackedEntries(physicalRepository, maximumEntries),
    collection.manifest, collection.fixture,
    {
      objectFormat,
      maximumTrackedBytes: collection.reviewed_inventory.tracked_bytes,
      maximumEntries,
    },
  );
  assertReviewedInventory(inventory, collection.reviewed_inventory);
  assertPinnedRepositoryState(readPinnedRepositoryState(physicalRepository), collection,
    'pinned collection changed during inventory admission');
  return inventory;
}

export function reconstructPinnedRepositoryInventory(repository, collection) {
  const physicalRepository = fs.realpathSync.native(repository);
  if (physicalRepository !== path.resolve(repository)) {
    throw new Error('pinned reconstruction collection must use its canonical physical path');
  }
  assertPinnedRepositoryState(readPinnedRepositoryState(physicalRepository), collection,
    'reconstruction repository is not the exact detached, clean, remote-free pinned collection');
  const objectFormat = checkedGit(physicalRepository, ['rev-parse', '--show-object-format'], 60_000).trim();
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
    },
  );
  assertPinnedRepositoryState(readPinnedRepositoryState(physicalRepository), collection,
    'pinned collection changed during inventory reconstruction');
  return Object.freeze({ inventory, candidate_inventory_sha256: candidateInventoryDigest(inventory) });
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
    const marker = path.join(root, '.owner.json');
    fs.writeFileSync(marker, `${JSON.stringify({
      schema: SCRATCH_SCHEMA,
      root,
      dev: String(rootStat.dev),
      ino: String(rootStat.ino),
      uid: Number(rootStat.uid),
      nonce: crypto.randomUUID(),
      owned: ['source'],
    })}\n`, { flag: 'wx', mode: 0o600 });
    return Object.freeze({ root, marker, source: path.join(root, 'source') });
  } catch (error) {
    try {
      const entries = fs.readdirSync(root);
      if (entries.length === 1 && entries[0] === '.owner.json') fs.unlinkSync(path.join(root, entries[0]));
      if (fs.readdirSync(root).length === 0) fs.rmdirSync(root);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'scratch creation and cleanup both failed');
    }
    throw error;
  }
}

function validatedScratch(scratch) {
  if (!scratch || path.dirname(scratch.marker || '') !== scratch.root
    || scratch.source !== path.join(scratch.root || '', 'source')) {
    throw new Error('real-repository scratch paths are invalid');
  }
  const root = fs.realpathSync.native(scratch.root);
  const stat = fs.lstatSync(root, { bigint: true });
  const markerStat = fs.lstatSync(scratch.marker, { bigint: true });
  const marker = JSON.parse(fs.readFileSync(scratch.marker, 'utf8'));
  const invalidPosixOwnership = HAS_POSIX_OWNERSHIP
    && ((stat.mode & 0o077n) !== 0n || stat.uid !== BigInt(process.getuid())
      || markerStat.uid !== stat.uid || (markerStat.mode & 0o077n) !== 0n
      || marker.uid !== Number(stat.uid));
  if (root !== scratch.root || !stat.isDirectory() || stat.isSymbolicLink()
    || !markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink !== 1n
    || invalidPosixOwnership
    || marker.schema !== SCRATCH_SCHEMA || marker.root !== root
    || marker.dev !== String(stat.dev) || marker.ino !== String(stat.ino)
    || !/^[0-9a-f-]{36}$/i.test(marker.nonce)
    || JSON.stringify(marker.owned) !== JSON.stringify(['source'])) {
    throw new Error('real-repository scratch ownership marker is invalid');
  }
  return marker;
}

export function removeScratch(scratch) {
  validatedScratch(scratch);
  const allowed = new Set(['.owner.json', 'source']);
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
  checkedGit(scratch.root, ['init', '--quiet', scratch.source], 60_000);
  checkedGit(scratch.source, [
    'fetch', '--quiet', '--no-tags', '--depth', '1', collection.repository_url,
    `+${collection.commit}:refs/lamina/oracle-pin`,
  ]);
  checkedGit(scratch.source, ['checkout', '--quiet', '--detach', collection.commit], 60_000);
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
