import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RETRIEVAL_BENCHMARK_ENTRYPOINT = 'benchmarks/retrieval-v1/benchmark.mjs';
export const RETRIEVAL_MANIFEST_MAX_BYTES = 1024 * 1024;
export const RETRIEVAL_MODEL_MAX_BYTES = 256 * 1024 * 1024;
export const RETRIEVAL_WORKER_MAX_BYTES = 256 * 1024 * 1024;
export const RETRIEVAL_TOKENIZER_MAX_BYTES = 64 * 1024 * 1024;
const MODES = Object.freeze(['--evaluate', '--calibrate']);
const PATH_FLAGS = Object.freeze([
  ['--worker', true],
  ['--model', false],
  ['--tokenizer', false],
]);
const REQUIRED_FLAGS = Object.freeze([...PATH_FLAGS.map(([flag]) => flag), '--model-digest']);
const MODEL_MANIFEST_RELATIVE = 'packages/cli/retrieval-model-manifest.json';

function sha256PhysicalFile(file, named, maximumBytes) {
  if (named.size < 0n || named.size > BigInt(maximumBytes)) {
    throw new Error(`retrieval qualification input exceeds its pre-hash size cap: ${file}`);
  }
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino
      || opened.size !== named.size || opened.uid !== named.uid || opened.mode !== named.mode
      || opened.nlink !== named.nlink) {
      throw new Error(`retrieval qualification input changed while opening: ${file}`);
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (offset < Number(opened.size)) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      offset += count;
    }
    const final = fs.fstatSync(descriptor, { bigint: true });
    if (offset !== Number(opened.size) || final.dev !== opened.dev || final.ino !== opened.ino
      || final.size !== opened.size || final.uid !== opened.uid || final.mode !== opened.mode
      || final.nlink !== opened.nlink) {
      throw new Error(`retrieval qualification input changed while reading: ${file}`);
    }
    return {
      digest: hash.digest('hex'), size: Number(opened.size),
      dev: String(opened.dev), ino: String(opened.ino), uid: Number(opened.uid),
      nlink: Number(opened.nlink), mode: Number(opened.mode & 0o777n),
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function exactFlagValue(command, flag) {
  const exact = [];
  let malformedAssignment = false;
  for (let index = 0; index < command.length; index += 1) {
    if (command[index] === flag) exact.push(index);
    else if (String(command[index]).startsWith(`${flag}=`)) malformedAssignment = true;
  }
  if (malformedAssignment || exact.length !== 1) {
    throw new Error(`retrieval qualification requires exactly one ${flag} <value>`);
  }
  const value = command[exact[0] + 1];
  if (!value || String(value).startsWith('--')) {
    throw new Error(`retrieval qualification requires exactly one ${flag} <value>`);
  }
  return { value: String(value), index: exact[0] + 1 };
}

function physicalRepositoryInput(repository, cwd, flag, value, executable, maximumBytes) {
  const declared = path.resolve(cwd, value);
  const relative = path.relative(repository, declared).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`retrieval ${flag} must name a physical file inside the repository`);
  }
  let named;
  let physical;
  try {
    named = fs.lstatSync(declared, { bigint: true });
    physical = fs.realpathSync.native(declared);
  } catch {
    throw new Error(`retrieval ${flag} must name a physical file inside the repository`);
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!named.isFile() || named.isSymbolicLink() || physical !== declared
    || named.nlink !== 1n || (uid !== null && Number(named.uid) !== uid)) {
    throw new Error(`retrieval ${flag} must name a physical file inside the repository`);
  }
  if (named.size > BigInt(maximumBytes)) {
    throw new Error(`retrieval ${flag} exceeds its pre-hash size cap of ${maximumBytes} bytes`);
  }
  let ancestor = path.dirname(declared);
  while (ancestor !== repository) {
    if (!ancestor.startsWith(`${repository}${path.sep}`)) {
      throw new Error(`retrieval ${flag} must name a physical file inside the repository`);
    }
    const stat = fs.lstatSync(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || fs.realpathSync.native(ancestor) !== ancestor) {
      throw new Error(`retrieval ${flag} must have canonical physical repository ancestors`);
    }
    ancestor = path.dirname(ancestor);
  }
  if (executable && (named.mode & 0o111n) === 0n) {
    throw new Error('retrieval --worker must name an executable physical file inside the repository');
  }
  return { flag, path: declared, relative, executable, maximumBytes, named };
}

function hashRepositoryInput(record) {
  const { maximumBytes, named, ...input } = record;
  return { ...input, ...sha256PhysicalFile(record.path, named, maximumBytes) };
}

function modelManifestAuthority(repository, injectedManifest = null) {
  if (injectedManifest) {
    const bytes = Buffer.from(JSON.stringify(injectedManifest));
    if (bytes.length > RETRIEVAL_MANIFEST_MAX_BYTES) {
      throw new Error('retrieval model manifest exceeds its 1 MiB pre-read size cap');
    }
    return {
      manifest: injectedManifest,
      authority: {
        path: null, relative: MODEL_MANIFEST_RELATIVE, size: bytes.length,
        digest: crypto.createHash('sha256').update(bytes).digest('hex'), injected: true,
      },
    };
  }
  const file = path.join(repository, MODEL_MANIFEST_RELATIVE);
  const named = fs.lstatSync(file, { bigint: true });
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n
    || fs.realpathSync.native(file) !== file
    || (uid !== null && Number(named.uid) !== uid)) {
    throw new Error('retrieval model manifest must be a same-user canonical physical file');
  }
  if (named.size > BigInt(RETRIEVAL_MANIFEST_MAX_BYTES)) {
    throw new Error('retrieval model manifest exceeds its 1 MiB pre-read size cap');
  }
  const identity = sha256PhysicalFile(file, named, RETRIEVAL_MANIFEST_MAX_BYTES);
  const bytes = fs.readFileSync(file);
  const final = fs.lstatSync(file, { bigint: true });
  if (final.dev !== named.dev || final.ino !== named.ino || final.uid !== named.uid
    || final.size !== named.size || final.mode !== named.mode || final.nlink !== named.nlink
    || crypto.createHash('sha256').update(bytes).digest('hex') !== identity.digest) {
    throw new Error('retrieval model manifest changed while reading');
  }
  return {
    manifest: JSON.parse(bytes.toString('utf8')),
    authority: { path: file, relative: MODEL_MANIFEST_RELATIVE, ...identity },
  };
}

export function assertRetrievalModelManifest({ model, modelDigest, manifest }) {
  if (manifest?.schema !== 'lamina.retrieval-model/v1'
    || !/^[a-f0-9]{64}$/.test(manifest?.sha256 || '')
    || !Number.isSafeInteger(manifest?.bytes) || manifest.bytes <= 0
    || manifest.bytes > RETRIEVAL_MODEL_MAX_BYTES) {
    throw new Error('retrieval model manifest is malformed');
  }
  if (modelDigest !== manifest.sha256) {
    throw new Error('retrieval --model-digest does not match the canonical model manifest');
  }
  if (model.size !== manifest.bytes) {
    throw new Error('retrieval --model size does not match the canonical model manifest');
  }
  if (model.digest !== modelDigest) {
    throw new Error('retrieval --model-digest does not match the physical --model bytes');
  }
  return true;
}

export function retrievalQualificationAuthority({
  repository, cwd = repository, command = [], manifest: injectedManifest = null,
}) {
  const physicalRepository = fs.realpathSync.native(repository);
  const normalized = command.map((value) => String(value));
  const executable = path.basename(normalized[0] || '').toLowerCase();
  let entrypoint = null;
  try {
    if (/^node(?:\.exe)?$/.test(executable)
      && path.relative(physicalRepository, path.resolve(cwd, normalized[1] || ''))
        .replaceAll('\\', '/') === RETRIEVAL_BENCHMARK_ENTRYPOINT) entrypoint = normalized[1];
  } catch {}
  if (!entrypoint) return null;
  if (normalized.length === 2) return null;
  const requestedModes = MODES.filter((mode) => normalized.includes(mode));
  if (requestedModes.length !== 1
    || MODES.some((mode) => normalized.filter((value) => value === mode).length > 1)) {
    throw new Error('retrieval qualification requires exactly one of --evaluate or --calibrate');
  }
  const parsed = Object.fromEntries(REQUIRED_FLAGS.map((flag) => [
    flag, exactFlagValue(normalized, flag),
  ]));
  const consumed = new Set([0, 1, normalized.indexOf(requestedModes[0])]);
  for (const flag of REQUIRED_FLAGS) {
    consumed.add(parsed[flag].index - 1);
    consumed.add(parsed[flag].index);
  }
  if (normalized.length !== 11 || consumed.size !== normalized.length) {
    throw new Error('retrieval qualification command contains an unknown flag or positional token');
  }
  const modelDigest = parsed['--model-digest'].value;
  if (!/^[a-f0-9]{64}$/.test(modelDigest)) {
    throw new Error('retrieval --model-digest must be a normalized lowercase 64-hex SHA-256');
  }
  const manifestRecord = modelManifestAuthority(physicalRepository, injectedManifest);
  const manifest = manifestRecord.manifest;
  assertRetrievalModelManifest({
    model: { size: manifest?.bytes, digest: modelDigest }, modelDigest, manifest,
  });
  const physicalInputs = {
    worker: physicalRepositoryInput(physicalRepository, cwd, '--worker',
      parsed['--worker'].value, true, RETRIEVAL_WORKER_MAX_BYTES),
    model: physicalRepositoryInput(physicalRepository, cwd, '--model',
      parsed['--model'].value, false, RETRIEVAL_MODEL_MAX_BYTES),
    tokenizer: physicalRepositoryInput(physicalRepository, cwd, '--tokenizer',
      parsed['--tokenizer'].value, false, RETRIEVAL_TOKENIZER_MAX_BYTES),
  };
  if (physicalInputs.model.named.size !== BigInt(manifest.bytes)) {
    throw new Error('retrieval --model size does not match the canonical model manifest');
  }
  const inputs = Object.fromEntries(Object.entries(physicalInputs).map(([name, input]) => [
    name, hashRepositoryInput(input),
  ]));
  assertRetrievalModelManifest({ model: inputs.model, modelDigest, manifest });
  return Object.freeze({
    mode: requestedModes[0].slice(2),
    model_digest: modelDigest,
    manifest: Object.freeze(manifestRecord.authority),
    argument_value_indexes: Object.freeze(PATH_FLAGS.map(([flag]) => parsed[flag].index)),
    worker: Object.freeze(inputs.worker),
    model: Object.freeze(inputs.model),
    tokenizer: Object.freeze(inputs.tokenizer),
  });
}

function retrievalAuthorityProjection(authority) {
  if (!authority) return null;
  const input = (value) => value && Object.fromEntries([
    'flag', 'path', 'relative', 'executable', 'digest', 'size', 'dev', 'ino', 'uid', 'nlink', 'mode',
  ].map((field) => [field, value[field]]));
  return {
    mode: authority.mode,
    model_digest: authority.model_digest,
    argument_value_indexes: [...(authority.argument_value_indexes || [])],
    manifest: input(authority.manifest),
    worker: input(authority.worker),
    model: input(authority.model),
    tokenizer: input(authority.tokenizer),
  };
}

export function assertRetrievalAuthorityContinuity(expected, actual) {
  if (JSON.stringify(retrievalAuthorityProjection(expected))
    !== JSON.stringify(retrievalAuthorityProjection(actual))) {
    throw new Error('retrieval qualification authority changed after preflight');
  }
  return actual;
}
