import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const JOURNAL_SCHEMA = 'lamina.safe-runner-publication/v1';
const MAX_JOURNAL_BYTES = 1024 * 1024;
const HARD_LIMITS = Object.freeze({
  maxBytes: 512 * 1024 ** 2,
  maxInodes: 16_384,
  maxDepth: 64,
});
const STATES = new Set(['prepared', 'old_saved', 'new_installed', 'committed']);

function sameUser(stat) {
  return typeof process.getuid !== 'function' || Number(stat.uid) === process.getuid();
}

function identity(stat) {
  return {
    dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
    mode: Number(stat.mode & 0o777n), nlink: Number(stat.nlink),
  };
}

function sameIdentity(stat, expected) {
  return String(stat.dev) === expected.dev && String(stat.ino) === expected.ino
    && Number(stat.uid) === expected.uid && Number(stat.mode & 0o777n) === expected.mode;
}

function sameRecordedIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid
    && left.mode === right.mode;
}

function physicalOwnedDirectory(candidate, label) {
  const declared = path.resolve(candidate);
  const physical = fs.realpathSync.native(declared);
  const stat = fs.lstatSync(declared, { bigint: true });
  if (declared !== physical || !stat.isDirectory() || stat.isSymbolicLink()
    || !sameUser(stat)) {
    throw new Error(`${label} must be a physical same-user directory`);
  }
  return { path: physical, identity: identity(stat), dev: String(stat.dev) };
}

function transactionPath(value) {
  return path.resolve(typeof value === 'string' ? value : value?.transaction || '');
}

function transactionReservation(value) {
  if (!value || typeof value === 'string' || !value.transaction_identity
    || !value.registry || !value.registry_identity) {
    throw new Error('publication cleanup requires its pre-registered transaction identity');
  }
  return {
    transaction: path.resolve(value.transaction), transaction_identity: value.transaction_identity,
    registry: path.resolve(value.registry), registry_identity: value.registry_identity,
  };
}

export function reservePublication({ registry, transactionId = crypto.randomUUID() }) {
  const authority = physicalOwnedDirectory(registry, 'publication registry');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(transactionId)) {
    throw new Error('publication transaction id is invalid');
  }
  const transaction = path.join(authority.path, `publication-${transactionId}`);
  fs.mkdirSync(transaction, { mode: 0o700 });
  fsyncDirectory(authority.path);
  return Object.freeze({
    transaction, transaction_identity: identity(fs.lstatSync(transaction, { bigint: true })),
    registry: authority.path, registry_identity: authority.identity,
  });
}

function boundedLimits(values = {}) {
  const limits = {};
  for (const name of ['maxBytes', 'maxInodes', 'maxDepth']) {
    const value = values[name] ?? HARD_LIMITS[name];
    if (!Number.isSafeInteger(value) || value < 1 || value > HARD_LIMITS[name]) {
      throw new Error(`publication ${name} is outside its hard bound`);
    }
    limits[name] = value;
  }
  return limits;
}

function assertBudget(counter, limits) {
  if (counter.bytes > limits.maxBytes || counter.inodes > limits.maxInodes) {
    throw new Error('publication content exceeds its bounded byte/inode budget');
  }
}

function boundedSortedNames(directory, maximum, label) {
  const handle = fs.opendirSync(directory);
  const names = [];
  try {
    for (let item = handle.readSync(); item; item = handle.readSync()) {
      names.push(item.name);
      if (names.length > maximum) throw new Error(`${label} exceeds its hard inode bound`);
    }
  } finally { handle.closeSync(); }
  return names.sort();
}

function fileDigest(file, stat, counter, limits, durable = false) {
  if (stat.nlink !== 1n) throw new Error(`publication rejects multi-link file: ${file}`);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino
      || opened.size !== stat.size || opened.nlink !== 1n || !sameUser(opened)) {
      throw new Error(`publication file changed while opening: ${file}`);
    }
    counter.bytes += Number(opened.size);
    assertBudget(counter, limits);
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (offset < Number(opened.size)) {
      const count = fs.readSync(descriptor, buffer, 0,
        Math.min(buffer.length, Number(opened.size) - offset), offset);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      offset += count;
    }
    if (durable) fs.fsyncSync(descriptor);
    const final = fs.fstatSync(descriptor, { bigint: true });
    if (offset !== Number(opened.size) || final.dev !== opened.dev || final.ino !== opened.ino
      || final.size !== opened.size || final.nlink !== 1n) {
      throw new Error(`publication file changed while reading: ${file}`);
    }
    return { size: offset, digest: hash.digest('hex') };
  } finally {
    fs.closeSync(descriptor);
  }
}

function contentManifest(candidate, expectedType, limits,
  counter = { bytes: 0, inodes: 0 }, durable = false) {
  const root = path.resolve(candidate);
  const rootStat = fs.lstatSync(root, { bigint: true });
  const startingBytes = counter.bytes;
  const startingInodes = counter.inodes;
  if (!sameUser(rootStat)) throw new Error(`publication content is not same-user: ${root}`);
  const entries = [];
  const walk = (current, relative, depth) => {
    if (depth > limits.maxDepth) throw new Error('publication content exceeds its bounded depth');
    const stat = fs.lstatSync(current, { bigint: true });
    if (!sameUser(stat) || String(stat.dev) !== String(rootStat.dev)) {
      throw new Error(`publication content crosses filesystem or owner authority: ${current}`);
    }
    counter.inodes += 1;
    assertBudget(counter, limits);
    const base = { path: relative, ...identity(stat) };
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(current);
      if (path.isAbsolute(target)) throw new Error(`publication rejects absolute symlink: ${current}`);
      let physical;
      try { physical = fs.realpathSync.native(current); }
      catch { throw new Error(`publication rejects dangling symlink: ${current}`); }
      const targetRelative = path.relative(root, physical);
      if (!targetRelative || targetRelative.startsWith('..') || path.isAbsolute(targetRelative)) {
        throw new Error(`publication rejects external symlink resolution: ${current}`);
      }
      entries.push({ ...base, type: 'symlink', target });
      return;
    }
    if (stat.isFile()) {
      entries.push({ ...base, type: 'file',
        ...fileDigest(current, stat, counter, limits, durable) });
      return;
    }
    if (!stat.isDirectory()) throw new Error(`publication rejects special file: ${current}`);
    entries.push({ ...base, type: 'directory' });
    const names = boundedSortedNames(current, limits.maxInodes - counter.inodes,
      'publication content');
    for (const name of names) {
      walk(path.join(current, name), relative === '.' ? name : `${relative}/${name}`, depth + 1);
    }
    if (durable) fsyncDirectory(current);
  };
  const actualType = rootStat.isFile() ? 'file' : rootStat.isDirectory() ? 'directory' : null;
  if (actualType !== expectedType) throw new Error(`publication payload must be ${expectedType}: ${root}`);
  walk(root, '.', 0);
  if (durable) fsyncDirectory(path.dirname(root));
  return {
    type: actualType, entries,
    bytes: counter.bytes - startingBytes, inodes: counter.inodes - startingInodes,
  };
}

function exactManifest(candidate, manifest, limits) {
  try {
    return JSON.stringify(contentManifest(candidate, manifest.type, limits)) === JSON.stringify(manifest);
  } catch { return false; }
}

function presence(candidate) {
  try { fs.lstatSync(candidate); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function copyFileBounded(source, destination, sourceStat, counter, limits) {
  if (sourceStat.nlink !== 1n) throw new Error(`publication rejects multi-link file: ${source}`);
  counter.inodes += 1;
  counter.bytes += Number(sourceStat.size);
  assertBudget(counter, limits);
  const input = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let output = null;
  try {
    const opened = fs.fstatSync(input, { bigint: true });
    if (!opened.isFile() || opened.dev !== sourceStat.dev || opened.ino !== sourceStat.ino
      || opened.size !== sourceStat.size || opened.nlink !== 1n) {
      throw new Error(`publication source changed while copying: ${source}`);
    }
    const intendedMode = Number(sourceStat.mode & 0o777n);
    output = fs.openSync(destination, fs.constants.O_CREAT | fs.constants.O_EXCL
      | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    const buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (offset < Number(opened.size)) {
      const count = fs.readSync(input, buffer, 0,
        Math.min(buffer.length, Number(opened.size) - offset), offset);
      if (count === 0) break;
      let written = 0;
      while (written < count) {
        const next = fs.writeSync(output, buffer, written, count - written);
        if (next === 0) throw new Error(`publication destination stopped accepting bytes: ${destination}`);
        written += next;
      }
      offset += count;
    }
    const final = fs.fstatSync(input, { bigint: true });
    if (offset !== Number(opened.size) || final.dev !== opened.dev || final.ino !== opened.ino
      || final.size !== opened.size || final.nlink !== 1n) {
      throw new Error(`publication source changed while copying: ${source}`);
    }
    fs.fchmodSync(output, intendedMode);
    fs.fsyncSync(output);
  } finally {
    if (output !== null) fs.closeSync(output);
    fs.closeSync(input);
  }
}

function copyTree(source, destination, expectedType, limits,
  counter = { bytes: 0, inodes: 0 }) {
  const sourceRoot = path.resolve(source);
  const sourceStat = fs.lstatSync(sourceRoot, { bigint: true });
  const walk = (from, to, depth) => {
    if (depth > limits.maxDepth) throw new Error('publication content exceeds its bounded depth');
    const stat = fs.lstatSync(from, { bigint: true });
    if (!sameUser(stat) || String(stat.dev) !== String(sourceStat.dev)) {
      throw new Error(`publication content crosses filesystem or owner authority: ${from}`);
    }
    if (stat.isSymbolicLink()) {
      counter.inodes += 1;
      assertBudget(counter, limits);
      const target = fs.readlinkSync(from);
      if (path.isAbsolute(target)) throw new Error(`publication rejects absolute symlink: ${from}`);
      let physical;
      try { physical = fs.realpathSync.native(from); }
      catch { throw new Error(`publication rejects dangling symlink: ${from}`); }
      const relative = path.relative(sourceRoot, physical);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`publication rejects external symlink resolution: ${from}`);
      }
      fs.symlinkSync(target, to);
      return;
    }
    if (stat.isFile()) {
      copyFileBounded(from, to, stat, counter, limits);
      return;
    }
    if (!stat.isDirectory()) throw new Error(`publication rejects special file: ${from}`);
    counter.inodes += 1;
    assertBudget(counter, limits);
    fs.mkdirSync(to, { mode: 0o700 });
    const names = boundedSortedNames(from, limits.maxInodes - counter.inodes,
      'publication copy');
    for (const name of names) walk(path.join(from, name), path.join(to, name), depth + 1);
    fs.chmodSync(to, Number(stat.mode & 0o777n));
    fsyncDirectory(to);
  };
  const actualType = sourceStat.isFile() ? 'file' : sourceStat.isDirectory() ? 'directory' : null;
  if (actualType !== expectedType) throw new Error(`publication source must be ${expectedType}`);
  walk(sourceRoot, destination, 0);
  fsyncDirectory(path.dirname(destination));
}

function ancestorRecords(repository, parent) {
  const relative = path.relative(repository, parent);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('publication target escapes repository');
  }
  const records = [];
  let current = repository;
  const components = relative ? relative.split(path.sep) : [];
  for (const component of ['', ...components]) {
    if (component) current = path.join(current, component);
    const stat = fs.lstatSync(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameUser(stat)
      || fs.realpathSync.native(current) !== current) {
      throw new Error(`publication target ancestor is not a physical same-user directory: ${current}`);
    }
    records.push({ path: path.relative(repository, current).replaceAll('\\', '/') || '.',
      identity: identity(stat) });
  }
  return records;
}

function validateAncestors(journal, output) {
  for (const record of output.ancestors) {
    const current = record.path === '.' ? journal.repository
      : path.join(journal.repository, ...record.path.split('/'));
    const stat = fs.lstatSync(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameIdentity(stat, record.identity)
      || fs.realpathSync.native(current) !== current) {
      throw new Error(`publication target ancestor identity changed: ${record.path}`);
    }
  }
}

function bodyChecksum(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function journalPath(transaction) {
  return path.join(path.resolve(transaction), 'journal.json');
}

function recordedIdentityShape(value) {
  return value && typeof value.dev === 'string' && typeof value.ino === 'string'
    && Number.isSafeInteger(value.uid) && Number.isSafeInteger(value.mode);
}

function validateJournalStructure(body) {
  if (!body || !Array.isArray(body.outputs) || body.outputs.length === 0
    || typeof body.repository !== 'string' || path.resolve(body.repository) !== body.repository
    || typeof body.registry !== 'string' || path.resolve(body.registry) !== body.registry
    || typeof body.transaction !== 'string' || path.resolve(body.transaction) !== body.transaction
    || !recordedIdentityShape(body.repository_identity)
    || !recordedIdentityShape(body.registry_identity)
    || !recordedIdentityShape(body.transaction_identity)
    || !recordedIdentityShape(body.stage_root_identity)
    || !recordedIdentityShape(body.old_root_identity)) {
    throw new Error('publication journal structure is invalid');
  }
  boundedLimits(body.limits);
  const targets = [];
  for (const [index, output] of body.outputs.entries()) {
    const target = typeof output?.target === 'string' ? output.target : '';
    if (output?.id !== String(index) || !target || target === '.' || path.isAbsolute(target)
      || target.includes('\\')
      || target.split('/').some((part) => !part || part === '.' || part === '..')
      || !['file', 'directory'].includes(output.type)
      || !['pure-output', 'copy-on-write'].includes(output.mode)
      || output.stage !== `stage/${output.id}/payload`
      || output.old !== `old/${output.id}/payload`
      || !recordedIdentityShape(output.stage_slot_identity)
      || !recordedIdentityShape(output.old_slot_identity)
      || !Array.isArray(output.ancestors)) {
      throw new Error('publication journal output structure is invalid');
    }
    const parent = path.posix.dirname(target);
    const expectedAncestors = ['.'];
    let accumulated = '';
    if (parent !== '.') {
      for (const component of parent.split('/')) {
        accumulated = accumulated ? `${accumulated}/${component}` : component;
        expectedAncestors.push(accumulated);
      }
    }
    if (output.ancestors.length !== expectedAncestors.length
      || output.ancestors.some((ancestor, ancestorIndex) => ancestor?.path !== expectedAncestors[ancestorIndex]
        || !recordedIdentityShape(ancestor.identity))) {
      throw new Error('publication journal ancestor structure is invalid');
    }
    targets.push(target);
  }
  for (const [index, target] of targets.entries()) {
    for (const other of targets.slice(index + 1)) {
      if (target === other || target.startsWith(`${other}/`) || other.startsWith(`${target}/`)) {
        throw new Error('publication journal output targets overlap');
      }
    }
  }
}

function writeJournal(transaction, body) {
  if (!STATES.has(body.state)) throw new Error('invalid publication journal state');
  const value = Buffer.from(`${JSON.stringify({ schema: JOURNAL_SCHEMA, body,
    checksum: bodyChecksum(body) })}\n`);
  if (value.length > MAX_JOURNAL_BYTES) throw new Error('publication journal exceeds its bound');
  const temporary = path.join(transaction, `.journal-${crypto.randomUUID()}.tmp`);
  let descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL
    | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  try {
    fs.renameSync(temporary, journalPath(transaction));
    fsyncDirectory(transaction);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function readJournal(transaction, optional = false) {
  const file = journalPath(transaction);
  let stat;
  try { stat = fs.lstatSync(file, { bigint: true }); } catch (error) {
    if (optional && error.code === 'ENOENT') {
      if (!presence(transaction)) return null;
      const missing = new Error('publication journal is absent from registered transaction');
      missing.code = 'LAMINA_PUBLICATION_JOURNAL_ABSENT';
      throw missing;
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || !sameUser(stat)
    || stat.nlink !== 1n || stat.size > BigInt(MAX_JOURNAL_BYTES)) {
    throw new Error('publication journal is not a bounded physical same-user file');
  }
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes;
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size
      || opened.nlink !== 1n) {
      throw new Error('publication journal changed while opening');
    }
    bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const final = fs.fstatSync(descriptor, { bigint: true });
    if (offset !== bytes.length || final.dev !== opened.dev || final.ino !== opened.ino
      || final.size !== opened.size || final.nlink !== 1n) {
      throw new Error('publication journal changed while reading');
    }
  } finally { fs.closeSync(descriptor); }
  let record;
  try { record = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('publication journal JSON is invalid'); }
  if (record.schema !== JOURNAL_SCHEMA || !record.body || !STATES.has(record.body.state)
    || record.checksum !== bodyChecksum(record.body)) {
    throw new Error('publication journal integrity check failed');
  }
  validateJournalStructure(record.body);
  const resolved = path.resolve(transaction);
  if (record.body.transaction !== resolved || path.dirname(resolved) !== record.body.registry) {
    throw new Error('publication journal transaction binding changed');
  }
  const transactionStat = fs.lstatSync(resolved, { bigint: true });
  if (!transactionStat.isDirectory() || transactionStat.isSymbolicLink()
    || !sameIdentity(transactionStat, record.body.transaction_identity)) {
    throw new Error('publication transaction identity changed');
  }
  for (const [directory, expected, label] of [
    [record.body.repository, record.body.repository_identity, 'repository'],
    [record.body.registry, record.body.registry_identity, 'registry'],
  ]) {
    const directoryStat = fs.lstatSync(directory, { bigint: true });
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
      || !sameIdentity(directoryStat, expected)
      || fs.realpathSync.native(directory) !== directory) {
      throw new Error(`publication ${label} identity changed`);
    }
  }
  return record.body;
}

function outputPaths(journal, output) {
  return {
    target: path.join(journal.repository, ...output.target.split('/')),
    stage: path.join(journal.transaction, ...output.stage.split('/')),
    old: path.join(journal.transaction, ...output.old.split('/')),
  };
}

function validateRecordedDirectory(candidate, expected, label) {
  const stat = fs.lstatSync(candidate, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameUser(stat)
    || !sameIdentity(stat, expected) || fs.realpathSync.native(candidate) !== candidate) {
    throw new Error(`publication ${label} identity changed`);
  }
}

function validateTransactionLayout(journal, output) {
  validateRecordedDirectory(path.join(journal.transaction, 'stage'),
    journal.stage_root_identity, 'stage root');
  validateRecordedDirectory(path.join(journal.transaction, 'old'),
    journal.old_root_identity, 'old root');
  validateRecordedDirectory(path.join(journal.transaction, 'stage', output.id),
    output.stage_slot_identity, `stage slot ${output.id}`);
  validateRecordedDirectory(path.join(journal.transaction, 'old', output.id),
    output.old_slot_identity, `old slot ${output.id}`);
}

function crash(hook, event, journal) {
  if (!hook) return;
  try { hook(event, structuredClone(journal)); }
  catch (error) {
    error.publicationCrash = true;
    throw error;
  }
}

function removeOwnedTransaction(value, crashHook = null) {
  const reservation = transactionReservation(value);
  if (!presence(reservation.transaction)) return;
  const registryStat = fs.lstatSync(reservation.registry, { bigint: true });
  if (!registryStat.isDirectory() || registryStat.isSymbolicLink()
    || !sameIdentity(registryStat, reservation.registry_identity)) {
    throw new Error('publication registry identity changed before cleanup');
  }
  const rootStat = fs.lstatSync(reservation.transaction, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
    || !sameIdentity(rootStat, reservation.transaction_identity) || !sameUser(rootStat)) {
    throw new Error('publication transaction identity changed before cleanup');
  }
  const counter = { inodes: 0, bytes: 0 };
  const walk = (current, relative, depth, expectedRoot = false) => {
    if (depth > HARD_LIMITS.maxDepth + 4) {
      throw new Error('publication cleanup exceeds its hard depth');
    }
    const stat = fs.lstatSync(current, { bigint: true });
    if (!sameUser(stat) || String(stat.dev) !== String(rootStat.dev)
      || (expectedRoot && !sameIdentity(stat, reservation.transaction_identity))) {
      throw new Error(`publication cleanup object escapes recorded identity: ${relative}`);
    }
    counter.inodes += 1;
    if (stat.isFile()) counter.bytes += Number(stat.size);
    if (counter.inodes > HARD_LIMITS.maxInodes + 1024
      || counter.bytes > HARD_LIMITS.maxBytes + MAX_JOURNAL_BYTES * 4) {
      throw new Error('publication cleanup exceeds its hard transaction bound');
    }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      const names = boundedSortedNames(current,
        HARD_LIMITS.maxInodes + 1024 - counter.inodes, 'publication cleanup')
        .sort((left, right) => {
        if (left === 'journal.json') return 1;
        if (right === 'journal.json') return -1;
        return left.localeCompare(right);
      });
      for (const name of names) walk(path.join(current, name),
        relative === '.' ? name : `${relative}/${name}`, depth + 1);
    }
    crash(crashHook, `before_cleanup_remove:${relative}`, { transaction: reservation.transaction });
    const currentStat = fs.lstatSync(current, { bigint: true });
    if (String(currentStat.dev) !== String(stat.dev) || String(currentStat.ino) !== String(stat.ino)
      || !sameUser(currentStat)) throw new Error(`publication cleanup identity raced: ${relative}`);
    if (stat.isDirectory() && !stat.isSymbolicLink()) fs.rmdirSync(current);
    else fs.unlinkSync(current);
    crash(crashHook, `after_cleanup_remove:${relative}`, { transaction: reservation.transaction });
  };
  walk(reservation.transaction, '.', 0, true);
  fsyncDirectory(reservation.registry);
}

function cleanupTransaction(journal, crashHook = null) {
  removeOwnedTransaction({
    transaction: journal.transaction, transaction_identity: journal.transaction_identity,
    registry: journal.registry, registry_identity: journal.registry_identity,
  }, crashHook);
}

function validateCommittedTargets(journal) {
  const limits = boundedLimits(journal.limits);
  for (const output of journal.outputs) {
    validateAncestors(journal, output);
    if (!exactManifest(outputPaths(journal, output).target, output.new_manifest, limits)) {
      throw new Error(`committed publication target changed: ${output.target}`);
    }
  }
}

function validateRestoredTargets(journal) {
  const limits = boundedLimits(journal.limits);
  for (const output of journal.outputs) {
    validateAncestors(journal, output);
    const target = outputPaths(journal, output).target;
    if (output.pre_manifest ? !exactManifest(target, output.pre_manifest, limits)
      : presence(target)) {
      throw new Error(`publication restored target changed: ${output.target}`);
    }
  }
}

export function preparePublication({
  repository, reservation: value, outputs, limits: values = {}, crashHook = null,
}) {
  const repositoryAuthority = physicalOwnedDirectory(repository, 'publication repository');
  const reservation = transactionReservation(value);
  const registryAuthority = physicalOwnedDirectory(reservation.registry, 'publication registry');
  if (!sameRecordedIdentity(registryAuthority.identity, reservation.registry_identity)) {
    throw new Error('publication registry reservation identity changed');
  }
  const transaction = reservation.transaction;
  const transactionStat = fs.lstatSync(transaction, { bigint: true });
  if (!transactionStat.isDirectory() || transactionStat.isSymbolicLink()
    || !sameIdentity(transactionStat, reservation.transaction_identity)) {
    throw new Error('publication reservation must be its empty exact transaction directory');
  }
  const reservationDirectory = fs.opendirSync(transaction);
  try {
    if (reservationDirectory.readSync()) {
      throw new Error('publication reservation must be its empty exact transaction directory');
    }
  } finally { reservationDirectory.closeSync(); }
  const limits = boundedLimits(values);
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error('publication requires explicit output descriptors');
  }
  const normalized = outputs.map((output, index) => {
    const target = String(output.target || '').replaceAll('\\', '/');
    if (!target || target === '.' || path.isAbsolute(target)
      || target.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`publication output target is not repository-contained: ${target}`);
    }
    if (!['file', 'directory'].includes(output.type)
      || !['pure-output', 'copy-on-write'].includes(output.mode)) {
      throw new Error(`publication output descriptor is invalid: ${target}`);
    }
    return { id: String(index), target, type: output.type, mode: output.mode };
  });
  for (const [index, output] of normalized.entries()) {
    for (const other of normalized.slice(index + 1)) {
      if (output.target === other.target || output.target.startsWith(`${other.target}/`)
        || other.target.startsWith(`${output.target}/`)) {
        throw new Error('publication output targets overlap');
      }
    }
  }
  fs.mkdirSync(path.join(transaction, 'stage'), { mode: 0o700 });
  fs.mkdirSync(path.join(transaction, 'old'), { mode: 0o700 });
  fsyncDirectory(transaction);
  try {
    const stageRootStat = fs.lstatSync(path.join(transaction, 'stage'), { bigint: true });
    const oldRootStat = fs.lstatSync(path.join(transaction, 'old'), { bigint: true });
    const journal = {
      state: 'prepared', sealed: false,
      repository: repositoryAuthority.path, registry: registryAuthority.path, transaction,
      repository_identity: repositoryAuthority.identity,
      registry_identity: registryAuthority.identity,
      transaction_identity: reservation.transaction_identity,
      stage_root_identity: identity(stageRootStat), old_root_identity: identity(oldRootStat),
      limits, outputs: [], success_authority_digest: null,
    };
    const prestateCounter = { bytes: 0, inodes: 0 };
    const copyCounter = { bytes: 0, inodes: 0 };
    for (const output of normalized) {
      const target = path.join(repositoryAuthority.path, ...output.target.split('/'));
      const parent = path.dirname(target);
      const ancestors = ancestorRecords(repositoryAuthority.path, parent);
      const parentStat = fs.lstatSync(parent, { bigint: true });
      if (String(parentStat.dev) !== registryAuthority.dev) {
        throw new Error(`publication registry is cross-device for target: ${output.target}`);
      }
      const relativeRegistry = path.relative(repositoryAuthority.path, registryAuthority.path);
      if (!relativeRegistry.startsWith('..') && !path.isAbsolute(relativeRegistry)
        && (output.target === relativeRegistry.replaceAll('\\', '/')
          || output.target.startsWith(`${relativeRegistry.replaceAll('\\', '/')}/`))) {
        throw new Error('publication output overlaps its registry');
      }
      let preManifest = null;
      if (presence(target)) {
        preManifest = contentManifest(target, output.type, limits, prestateCounter, true);
        if (preManifest.entries[0].dev !== registryAuthority.dev) {
          throw new Error(`publication registry is cross-device for target: ${output.target}`);
        }
      }
      else if (output.mode === 'copy-on-write') {
        throw new Error(`copy-on-write publication target must exist: ${output.target}`);
      }
      const stageSlot = path.join(transaction, 'stage', output.id);
      const oldSlot = path.join(transaction, 'old', output.id);
      fs.mkdirSync(stageSlot, { mode: 0o700 });
      fs.mkdirSync(oldSlot, { mode: 0o700 });
      fsyncDirectory(path.join(transaction, 'stage'));
      fsyncDirectory(path.join(transaction, 'old'));
      const stage = path.join(stageSlot, 'payload');
      if (output.mode === 'copy-on-write') {
        copyTree(target, stage, output.type, limits, copyCounter);
        if (!exactManifest(target, preManifest, limits)) {
          throw new Error(`copy-on-write source changed while staging: ${output.target}`);
        }
      } else if (output.type === 'directory') {
        fs.mkdirSync(stage, { mode: 0o700 });
        fsyncDirectory(stageSlot);
      }
      journal.outputs.push({
        ...output, ancestors, pre_manifest: preManifest, new_manifest: null,
        stage: `stage/${output.id}/payload`, old: `old/${output.id}/payload`,
        stage_slot_identity: identity(fs.lstatSync(stageSlot, { bigint: true })),
        old_slot_identity: identity(fs.lstatSync(oldSlot, { bigint: true })),
      });
    }
    crash(crashHook, 'before_initial_prepared_write', journal);
    writeJournal(transaction, journal);
    crash(crashHook, 'after_initial_prepared_write', journal);
    return {
      ...reservation,
      outputs: journal.outputs.map((output) => ({
        target: output.target, type: output.type, mode: output.mode,
        stage: outputPaths(journal, output).stage,
      })),
    };
  } catch (error) {
    if (!error.publicationCrash) {
      try { removeOwnedTransaction(reservation); } catch {}
    }
    throw error;
  }
}

export function sealPublication(transaction, { crashHook = null } = {}) {
  const journal = readJournal(transactionPath(transaction));
  if (journal.state !== 'prepared') return journal;
  const limits = boundedLimits(journal.limits);
  if (journal.sealed) {
    for (const output of journal.outputs) {
      if (!exactManifest(outputPaths(journal, output).stage, output.new_manifest, limits)) {
        throw new Error(`sealed publication payload changed: ${output.target}`);
      }
    }
    return journal;
  }
  const counter = { bytes: 0, inodes: 0 };
  for (const output of journal.outputs) {
    validateTransactionLayout(journal, output);
    output.new_manifest = contentManifest(outputPaths(journal, output).stage,
      output.type, limits, counter, true);
  }
  journal.sealed = true;
  crash(crashHook, 'before_sealed_prepared_write', journal);
  writeJournal(journal.transaction, journal);
  crash(crashHook, 'after_sealed_prepared_write', journal);
  return journal;
}

export function installPublication(transaction, { crashHook = null } = {}) {
  const journal = readJournal(transactionPath(transaction));
  if (journal.state === 'new_installed' || journal.state === 'committed') return journal;
  if (!journal.sealed) throw new Error('publication payload must be sealed before install');
  const limits = boundedLimits(journal.limits);
  for (const output of journal.outputs) validateAncestors(journal, output);
  if (journal.state === 'prepared') {
    for (const [index, output] of journal.outputs.entries()) {
      validateTransactionLayout(journal, output);
      const { target, old } = outputPaths(journal, output);
      if (!output.pre_manifest) {
        if (presence(target)) throw new Error(`publication absent prestate changed: ${output.target}`);
        continue;
      }
      if (presence(old)) {
        if (!exactManifest(old, output.pre_manifest, limits) || presence(target)) {
          throw new Error(`publication old-save state is ambiguous: ${output.target}`);
        }
        continue;
      }
      if (!exactManifest(target, output.pre_manifest, limits)) {
        throw new Error(`publication exact prestate changed: ${output.target}`);
      }
      crash(crashHook, `before_old_rename:${index}`, journal);
      fs.renameSync(target, old);
      fsyncDirectory(path.dirname(target));
      fsyncDirectory(path.dirname(old));
      crash(crashHook, `after_old_rename:${index}`, journal);
    }
    crash(crashHook, 'before_old_saved_write', journal);
    journal.state = 'old_saved';
    writeJournal(journal.transaction, journal);
    crash(crashHook, 'after_old_saved_write', journal);
  }
  if (journal.state === 'old_saved') {
    for (const [index, output] of journal.outputs.entries()) {
      validateTransactionLayout(journal, output);
      const { target, stage } = outputPaths(journal, output);
      if (presence(target)) {
        if (!exactManifest(target, output.new_manifest, limits) || presence(stage)) {
          throw new Error(`publication install state is ambiguous: ${output.target}`);
        }
        continue;
      }
      if (!exactManifest(stage, output.new_manifest, limits)) {
        throw new Error(`publication sealed stage changed: ${output.target}`);
      }
      crash(crashHook, `before_new_rename:${index}`, journal);
      fs.renameSync(stage, target);
      fsyncDirectory(path.dirname(stage));
      fsyncDirectory(path.dirname(target));
      crash(crashHook, `after_new_rename:${index}`, journal);
    }
    crash(crashHook, 'before_new_installed_write', journal);
    journal.state = 'new_installed';
    writeJournal(journal.transaction, journal);
    crash(crashHook, 'after_new_installed_write', journal);
  }
  return journal;
}

function validatedSuccess(journal, successAuthority, validateSuccessAuthority) {
  if (successAuthority === undefined || typeof validateSuccessAuthority !== 'function'
    || validateSuccessAuthority(successAuthority, structuredClone(journal)) !== true) {
    throw new Error('publication commit requires explicitly validated success authority');
  }
}

export function commitPublication(transaction, {
  successAuthority, validateSuccessAuthority, crashHook = null,
} = {}) {
  const journal = readJournal(transactionPath(transaction), true);
  if (!journal) return { status: 'absent' };
  if (journal.state === 'committed') {
    validateCommittedTargets(journal);
    cleanupTransaction(journal, crashHook);
    return { status: 'committed' };
  }
  if (journal.state !== 'new_installed') throw new Error('publication is not installed');
  validatedSuccess(journal, successAuthority, validateSuccessAuthority);
  const limits = boundedLimits(journal.limits);
  for (const output of journal.outputs) {
    validateAncestors(journal, output);
    if (!exactManifest(outputPaths(journal, output).target, output.new_manifest, limits)) {
      throw new Error(`publication installed target changed before commit: ${output.target}`);
    }
  }
  journal.success_authority_digest = crypto.createHash('sha256')
    .update(JSON.stringify(successAuthority)).digest('hex');
  crash(crashHook, 'before_committed_write', journal);
  journal.state = 'committed';
  writeJournal(journal.transaction, journal);
  crash(crashHook, 'after_committed_write', journal);
  cleanupTransaction(journal, crashHook);
  return { status: 'committed' };
}

export function rollbackPublication(transaction, { crashHook = null } = {}) {
  let journal = readJournal(transactionPath(transaction), true);
  if (!journal) return { status: 'absent' };
  if (journal.state === 'committed') throw new Error('committed publication cannot roll back');
  if (journal.rollback_restored) {
    validateRestoredTargets(journal);
    cleanupTransaction(journal, crashHook);
    return { status: 'rolled_back' };
  }
  const limits = boundedLimits(journal.limits);
  if (!journal.rollback_started) {
    crash(crashHook, 'before_rollback_started_write', journal);
    journal.rollback_started = true;
    writeJournal(journal.transaction, journal);
    crash(crashHook, 'after_rollback_started_write', journal);
  }
  for (const [index, output] of journal.outputs.entries()) {
    validateTransactionLayout(journal, output);
    validateAncestors(journal, output);
    const { target, stage, old } = outputPaths(journal, output);
    if (presence(target) && output.new_manifest
      && exactManifest(target, output.new_manifest, limits)) {
      if (presence(stage)) {
        throw new Error(`publication rollback stage is occupied: ${output.target}`);
      }
      crash(crashHook, `before_rollback_new_rename:${index}`, journal);
      fs.renameSync(target, stage);
      fsyncDirectory(path.dirname(target));
      fsyncDirectory(path.dirname(stage));
      crash(crashHook, `after_rollback_new_rename:${index}`, journal);
    }
    if (output.pre_manifest) {
      if (presence(old)) {
        if (!exactManifest(old, output.pre_manifest, limits)) {
          throw new Error(`publication saved prestate changed: ${output.target}`);
        }
        if (presence(target)) {
          throw new Error(`publication target blocks exact prestate restore: ${output.target}`);
        }
        crash(crashHook, `before_rollback_old_rename:${index}`, journal);
        fs.renameSync(old, target);
        fsyncDirectory(path.dirname(old));
        fsyncDirectory(path.dirname(target));
        crash(crashHook, `after_rollback_old_rename:${index}`, journal);
      } else if (!exactManifest(target, output.pre_manifest, limits)) {
        throw new Error(`publication cannot locate exact prestate: ${output.target}`);
      }
    } else {
      if (presence(old)) throw new Error(`publication absent prestate has an old object: ${output.target}`);
      if (presence(target)) {
        throw new Error(`publication absent prestate was replaced by an unknown target: ${output.target}`);
      }
    }
  }
  crash(crashHook, 'before_rollback_restored_write', journal);
  journal.rollback_restored = true;
  writeJournal(journal.transaction, journal);
  crash(crashHook, 'after_rollback_restored_write', journal);
  cleanupTransaction(journal, crashHook);
  return { status: 'rolled_back' };
}

export function recoverPublication(transaction, {
  successAuthority, validateSuccessAuthority, crashHook = null,
} = {}) {
  let journal;
  try { journal = readJournal(transactionPath(transaction), true); }
  catch (error) {
    if (error.code !== 'LAMINA_PUBLICATION_JOURNAL_ABSENT'
      || !presence(transactionPath(transaction))) throw error;
    removeOwnedTransaction(transaction, crashHook);
    return { status: 'discarded_prepare' };
  }
  if (!journal) return { status: 'absent' };
  if (journal.state === 'committed') {
    validateCommittedTargets(journal);
    cleanupTransaction(journal, crashHook);
    return { status: 'committed' };
  }
  if (journal.state === 'new_installed' && successAuthority !== undefined) {
    return commitPublication(transaction, {
      successAuthority, validateSuccessAuthority, crashHook,
    });
  }
  return rollbackPublication(transaction, { crashHook });
}

export function readPublicationJournal(transaction) {
  return structuredClone(readJournal(transactionPath(transaction)));
}
