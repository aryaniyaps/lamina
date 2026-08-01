import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RETRIEVAL_BENCHMARK_ENTRYPOINT = 'benchmarks/retrieval-v1/benchmark.mjs';
const MODES = Object.freeze(['--evaluate', '--calibrate']);
const PATH_FLAGS = Object.freeze([
  ['--worker', true],
  ['--model', false],
  ['--tokenizer', false],
]);
const REQUIRED_FLAGS = Object.freeze([...PATH_FLAGS.map(([flag]) => flag), '--model-digest']);
const MODEL_MANIFEST_RELATIVE = 'packages/cli/retrieval-model-manifest.json';

function sha256PhysicalFile(file, named) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino
      || opened.size !== named.size) {
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
      || final.size !== opened.size) {
      throw new Error(`retrieval qualification input changed while reading: ${file}`);
    }
    return {
      digest: hash.digest('hex'), size: Number(opened.size),
      dev: String(opened.dev), ino: String(opened.ino), mode: Number(opened.mode & 0o777n),
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

function physicalRepositoryInput(repository, cwd, flag, value, executable) {
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
  return {
    flag, path: declared, relative, executable,
    ...sha256PhysicalFile(declared, named),
  };
}

function modelManifestAuthority(repository, injectedManifest = null) {
  if (injectedManifest) {
    const bytes = Buffer.from(JSON.stringify(injectedManifest));
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
  const identity = sha256PhysicalFile(file, named);
  const bytes = fs.readFileSync(file);
  const final = fs.lstatSync(file, { bigint: true });
  if (final.dev !== named.dev || final.ino !== named.ino || final.uid !== named.uid
    || final.size !== named.size
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
    || !Number.isSafeInteger(manifest?.bytes) || manifest.bytes <= 0) {
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
  const entrypoint = normalized.slice(1).find((argument) => {
    try {
      return path.relative(physicalRepository, path.resolve(cwd, argument)).replaceAll('\\', '/')
        === RETRIEVAL_BENCHMARK_ENTRYPOINT;
    } catch { return false; }
  });
  if (!entrypoint) return null;
  const requestedModes = MODES.filter((mode) => normalized.includes(mode));
  const hasQualificationFlags = REQUIRED_FLAGS.some((flag) =>
    normalized.some((value) => value === flag || value.startsWith(`${flag}=`)));
  if (requestedModes.length === 0 && !hasQualificationFlags) return null;
  if (requestedModes.length !== 1
    || MODES.some((mode) => normalized.filter((value) => value === mode).length > 1)) {
    throw new Error('retrieval qualification requires exactly one of --evaluate or --calibrate');
  }
  const parsed = Object.fromEntries(REQUIRED_FLAGS.map((flag) => [
    flag, exactFlagValue(normalized, flag),
  ]));
  const inputs = Object.fromEntries(PATH_FLAGS.map(([flag, executable]) => [
    flag.slice(2), physicalRepositoryInput(
      physicalRepository, cwd, flag, parsed[flag].value, executable,
    ),
  ]));
  const modelDigest = parsed['--model-digest'].value;
  if (!/^[a-f0-9]{64}$/.test(modelDigest)) {
    throw new Error('retrieval --model-digest must be a normalized lowercase 64-hex SHA-256');
  }
  const manifestRecord = modelManifestAuthority(physicalRepository, injectedManifest);
  const manifest = manifestRecord.manifest;
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
