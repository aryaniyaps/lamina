import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from './constants.mjs';
import { inertRepositoryConfig, spawnTrustedGit, trustedGitIdentity } from './git.mjs';
import {
  assertTrustedBinaryIdentity, sanitizedEnvironment, trustedRootBinaryIdentity,
  trustedRootHostBinary,
} from './infrastructure.mjs';
import {
  attestOracleKeeperBwrapHelp,
  ORACLE_HOST_LAUNCH_PROFILE,
  ORACLE_HOST_PROBE_COMMAND,
} from './oracle-host-profile.mjs';
import {
  exactLandlockCandidateProbeCommand, LANDLOCK_CANDIDATE_PROBE_LAUNCH_PROFILE,
} from './landlock-candidate-profile.mjs';
import {
  CANDIDATE_SMOKE_LAUNCH_PROFILE, exactCandidateSmokeCommand,
} from './candidate-smoke-profile.mjs';
import { auditedNpxCommand } from './npx-authority.mjs';
import { repositoryOutputRefusal } from './output-policy.mjs';
import {
  assertRetrievalAuthorityContinuity,
  RETRIEVAL_BENCHMARK_ENTRYPOINT,
  retrievalQualificationAuthority,
} from './retrieval-authority.mjs';
import {
  REAL_REPOSITORY_ORACLE_ENTRYPOINT,
  REAL_REPOSITORY_ORACLE_ADMISSION_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_CANDIDATE_SMOKE_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_DISCOVERY_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_EVIDENCE_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_HOST_PROBE_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_REVIEW_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_SCENARIO_VERIFICATION_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE,
  realRepositoryOracleSourceClosure,
  realRepositoryOracleSourceClosureIdentity,
} from './real-repository-source-closure.mjs';
export {
  REAL_REPOSITORY_ORACLE_ADMISSION_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_CANDIDATE_SMOKE_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_DISCOVERY_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_EVIDENCE_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_HOST_PROBE_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_REVIEW_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_SCENARIO_VERIFICATION_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE,
  REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE_SCHEMA,
  realRepositoryOracleSourceClosure,
  realRepositoryOracleSourceClosureIdentity,
} from './real-repository-source-closure.mjs';

const MAX_FILES = DEFAULTS.executionAuthorityMaxFiles;
const MAX_BYTES = DEFAULTS.executionAuthorityMaxBytes;
const MAX_GIT_OBJECTS = 262_144;
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const MAX_PACKAGE_TREE_DEPTH = 64;
const MAX_CLOSURE_PACKAGES = 4_096;
const MAX_CLOSURE_INODES = 2_000_000;
const MAX_CLOSURE_BYTES = 16 * 1024 ** 3;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_BASELINE_ENTRYPOINT = 'benchmarks/runtime-baseline-v1/workload.mjs';
const RUNTIME_BASELINE_SCENARIOS = new Set([
  'footprint', 'doctor-status-startup', 'initial-observation',
  'initial-retrieval-readiness', 'first-useful-preparation', 'warm-preparation',
  'noop-synchronization', 'one-file-change', 'multi-file-change',
  'full-derived-state-rebuild', 'post-command-idle-rss',
  'cancellation-shutdown-cleanup',
]);

export function requiresSystemBwrapPath(infrastructure) {
  const identity = infrastructure?.identities?.bwrap;
  return infrastructure?.pinned_bwrap === false
    && identity?.uid === 0
    && identity?.root_owned_path === true
    && identity?.path === infrastructure?.bwrap;
}

export function assertGitObjectClosureBudget(objectCount, uncompressedBytes, currentBytes = 0) {
  if (!Number.isSafeInteger(objectCount) || objectCount < 0 || objectCount > MAX_GIT_OBJECTS
    || !Number.isSafeInteger(uncompressedBytes) || uncompressedBytes < 0
    || !Number.isSafeInteger(currentBytes) || currentBytes < 0
    || currentBytes + uncompressedBytes > MAX_BYTES) {
    throw new Error('execution Git object closure exceeds its bounded budget');
  }
  return true;
}

export function assertExecutionDependencyInodeBudget(entryCount, createdDirectoryCount) {
  if (!Number.isSafeInteger(entryCount) || entryCount < 0
    || !Number.isSafeInteger(createdDirectoryCount) || createdDirectoryCount < 0
    || entryCount + createdDirectoryCount > MAX_FILES) {
    throw new Error('execution dependency snapshot exceeds its bounded inode budget');
  }
  return true;
}
const EXPLICIT_ENTRYPOINT_DEPENDENCIES = new Map([
  ['scripts/build-standalone-cli.mjs', [
    { name: 'postject', resolver: 'package.json', destination: 'node_modules' },
  ]],
  ['scripts/prepare-retrieval-assets.mjs', [
    {
      name: '@ladybugdb/core', resolver: 'packages/cli/package.json',
      destination: 'packages/cli/node_modules',
    },
  ]],
  [RUNTIME_BASELINE_ENTRYPOINT, [
    {
      name: '@ladybugdb/core', resolver: 'packages/cli/package.json',
      destination: 'packages/cli/node_modules',
      // @ladybugdb/core@0.19.0 loads only its relative JS modules and native
      // addon at runtime. Its declared dependencies are build/install tooling.
      omit_dependency_edges: true,
    },
  ]],
]);
const EXPLICIT_ENTRYPOINT_ARGV_OUTPUTS = new Map([
  ['tests/fixtures/safe-runner-graphd-client.mjs', [{ index: 2, kind: 'directory' }]],
  ['tests/fixtures/safe-runner-mutable.mjs', [{ index: 2, kind: 'file' }]],
]);
const EXPLICIT_ENTRYPOINT_ENV_FILE_INPUTS = new Map([
  ['tests/cli_binary_smoke_test.mjs', [
    'LAMINA_BINARY', 'LAMINA_WORKER', 'LAMINA_MODEL',
    'LAMINA_RETRIEVAL_TOKENIZER_PATH', 'LAMINA_RETRIEVAL_FTS_EXTENSION_PATH',
    'LAMINA_RETRIEVAL_VECTOR_EXTENSION_PATH',
  ]],
  ['tests/retrieval_native_index_test.mjs', [
    'LAMINA_RETRIEVAL_TOKENIZER_PATH', 'LAMINA_RETRIEVAL_FTS_EXTENSION_PATH',
    'LAMINA_RETRIEVAL_VECTOR_EXTENSION_PATH',
  ]],
]);

function copyPhysicalFile(source, destination, executable = false) {
  const named = fs.lstatSync(source, { bigint: true });
  if (!named.isFile() || named.isSymbolicLink()) throw new Error(`snapshot source is not physical: ${source}`);
  const input = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let output = null;
  try {
    const opened = fs.fstatSync(input, { bigint: true });
    if (opened.dev !== named.dev || opened.ino !== named.ino || opened.size !== named.size
      || opened.uid !== named.uid || opened.mode !== named.mode || opened.nlink !== named.nlink) {
      throw new Error(`snapshot source changed while opening: ${source}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    output = fs.openSync(destination, fs.constants.O_CREAT | fs.constants.O_EXCL
      | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, executable ? 0o500 : 0o400);
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (offset < Number(opened.size)) {
      const bytes = fs.readSync(input, buffer, 0, buffer.length, offset);
      if (bytes === 0) break;
      fs.writeSync(output, buffer, 0, bytes);
      hash.update(buffer.subarray(0, bytes));
      offset += bytes;
    }
    const final = fs.fstatSync(input, { bigint: true });
    if (offset !== Number(opened.size) || final.dev !== opened.dev || final.ino !== opened.ino
      || final.size !== opened.size || final.uid !== opened.uid || final.mode !== opened.mode
      || final.nlink !== opened.nlink) throw new Error(`snapshot source changed while copying: ${source}`);
    fs.fchmodSync(output, executable ? 0o500 : 0o400);
    fs.fsyncSync(output);
    return {
      size: offset, digest: hash.digest('hex'),
      source_dev: String(opened.dev), source_ino: String(opened.ino),
      source_uid: Number(opened.uid), source_nlink: Number(opened.nlink),
      source_mode: Number(opened.mode & 0o777n),
    };
  } finally {
    if (output !== null) fs.closeSync(output);
    fs.closeSync(input);
  }
}

function repositoryRoot(cwd) {
  const result = spawnTrustedGit(cwd, ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000,
    maxBuffer: 64 * 1024,
  });
  if (result.status !== 0) throw new Error('execution snapshot requires a Git worktree');
  return fs.realpathSync.native(String(result.stdout).trim());
}

function gitOutput(repository, args, { input = undefined, maxBuffer = 16 * 1024 * 1024 } = {}) {
  const result = spawnTrustedGit(repository, args, {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 15_000, maxBuffer,
  });
  if (result.status !== 0) {
    throw new Error(`cannot construct sealed Git authority: ${String(result.stderr || '').trim()}`);
  }
  return String(result.stdout || '').trim();
}

function gitBuffer(repository, args, { input = undefined, maxBuffer = MAX_BYTES,
  objectDirectory = null } = {}) {
  const result = spawnTrustedGit(repository, args, {
    input, encoding: null, stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000, maxBuffer, objectDirectory,
  });
  if (result.status !== 0) {
    throw new Error(`cannot construct sealed Git authority: ${String(result.stderr || '').trim()}`);
  }
  return result.stdout;
}

function optionalGitOutput(repository, args, options = {}) {
  try { return gitOutput(repository, args, options); } catch { return null; }
}

function physicalOwnedDirectory(candidate, label) {
  const declared = path.resolve(candidate);
  const physical = fs.realpathSync.native(declared);
  const stat = fs.lstatSync(declared);
  if (declared !== physical || !stat.isDirectory() || stat.isSymbolicLink()
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw new Error(`${label} must be a physical same-user directory without symlink indirection`);
  }
  return physical;
}

function ensureContainedWritableDirectory(boundary, target, label) {
  const physicalBoundary = physicalOwnedDirectory(boundary, `${label} boundary`);
  const absolute = path.resolve(target);
  const relative = path.relative(physicalBoundary, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its physical boundary`);
  }
  let current = physicalBoundary;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()
        || fs.realpathSync.native(current) !== current) {
        throw new Error(`${label} ancestor is not a canonical physical directory: ${current}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.mkdirSync(current, { mode: 0o700 });
      const created = fs.lstatSync(current);
      if (!created.isDirectory() || created.isSymbolicLink()
        || fs.realpathSync.native(current) !== current) {
        throw new Error(`${label} creation lost canonical containment: ${current}`);
      }
    }
  }
  return absolute;
}

function gitAuthority(repository) {
  const declaredGitDirectory = path.resolve(repository,
    gitOutput(repository, ['rev-parse', '--absolute-git-dir']));
  const declaredCommon = path.resolve(repository,
    gitOutput(repository, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const gitDirectory = physicalOwnedDirectory(declaredGitDirectory, 'Git worktree directory');
  const common = physicalOwnedDirectory(declaredCommon, 'Git common directory');
  const marker = path.join(repository, '.git');
  const markerStat = fs.lstatSync(marker);
  if (markerStat.isFile() && !markerStat.isSymbolicLink()) {
    const markerFd = fs.openSync(marker, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let markerText;
    try { markerText = fs.readFileSync(markerFd, 'utf8').trim(); } finally { fs.closeSync(markerFd); }
    const match = markerText.match(/^gitdir:\s*(.+)$/i);
    if (!match || fs.realpathSync.native(path.resolve(repository, match[1])) !== gitDirectory) {
      throw new Error('linked-worktree .git marker does not bind the resolved Git directory');
    }
    const relative = path.relative(path.join(common, 'worktrees'), gitDirectory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('linked-worktree Git directory escapes the common worktrees authority');
    }
  } else if (!markerStat.isDirectory() || markerStat.isSymbolicLink()
    || fs.realpathSync.native(marker) !== gitDirectory || gitDirectory !== common) {
    throw new Error('primary-worktree .git authority is not a physical common directory');
  }
  return { gitDirectory, common, linked: gitDirectory !== common };
}

function repositoryFiles(root) {
  const result = spawnTrustedGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('cannot enumerate the bounded execution source snapshot');
  const files = String(result.stdout).split('\0').filter(Boolean).sort();
  if (files.length > MAX_FILES) throw new Error(`execution snapshot exceeds ${MAX_FILES} files`);
  return files;
}

function resolveProgram(candidate, cwd, environment) {
  const value = String(candidate || '');
  const candidates = path.isAbsolute(value) || value.includes(path.sep)
    ? [path.resolve(cwd, value)]
    : String(environment.PATH || process.env.PATH || '').split(path.delimiter)
      .filter(Boolean).map((directory) => path.resolve(directory, value));
  for (const item of candidates) {
    try {
      const physical = fs.realpathSync.native(item);
      const stat = fs.lstatSync(physical);
      if (stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111) !== 0) return physical;
    } catch {}
  }
  throw new Error(`required audited child executable is unavailable: ${value}`);
}

function entrypointRelative(repository, command, cwd = repository) {
  for (const argument of command.slice(1)) {
    const relative = path.relative(repository, path.resolve(cwd, String(argument)))
      .replaceAll('\\', '/');
    if (!relative.startsWith('../') && (repositoryOutputRefusal(relative)
      || EXPLICIT_ENTRYPOINT_ARGV_OUTPUTS.has(relative)
      || EXPLICIT_ENTRYPOINT_ENV_FILE_INPUTS.has(relative)
      || relative === RUNTIME_BASELINE_ENTRYPOINT
      || relative === REAL_REPOSITORY_ORACLE_ENTRYPOINT
      || relative === RETRIEVAL_BENCHMARK_ENTRYPOINT)) return relative;
  }
  return null;
}

function importSpecifiers(source) {
  const values = new Set();
  const pattern = /(?:\b(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) values.add(match[1]);
  return [...values];
}

const BUILTIN_MODULES = new Set(builtinModules.flatMap((name) => [
  name, name.startsWith('node:') ? name.slice(5) : `node:${name}`,
]));

export function packageName(specifier) {
  if (BUILTIN_MODULES.has(specifier) || specifier.startsWith('.') || path.isAbsolute(specifier)) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function validPackageName(name) {
  if (typeof name !== 'string') return false;
  const components = name.split('/');
  return components.every((component) => component !== '.' && component !== '..')
    && (/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(name)
      || /^@[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(name));
}

export function dependencyPackageTarget(logicalName, specification) {
  if (!validPackageName(logicalName) || BUILTIN_MODULES.has(logicalName)) {
    throw new Error(`invalid execution dependency package name: ${logicalName}`);
  }
  if (typeof specification !== 'string') {
    throw new Error(`invalid execution dependency specification: ${logicalName}`);
  }
  if (!specification.startsWith('npm:')) {
    return { logical_name: logicalName, manifest_name: logicalName };
  }
  const alias = specification.slice(4);
  const separator = alias.lastIndexOf('@');
  const manifestName = alias.slice(0, separator);
  const range = alias.slice(separator + 1);
  if (separator <= 0 || !validPackageName(manifestName) || BUILTIN_MODULES.has(manifestName)
    || !range || range.length > 512 || /[\s\0]/.test(range)) {
    throw new Error(`malformed npm alias for execution dependency: ${logicalName}`);
  }
  return { logical_name: logicalName, manifest_name: manifestName };
}

export function readBoundedPackageManifest(manifestPath,
  maximumBytes = MAX_PACKAGE_MANIFEST_BYTES) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || maximumBytes > MAX_PACKAGE_MANIFEST_BYTES) {
    throw new Error('execution dependency manifest byte bound is invalid');
  }
  const named = fs.lstatSync(manifestPath, { bigint: true });
  if (!named.isFile() || named.isSymbolicLink() || named.size > BigInt(maximumBytes)) {
    throw new Error(`execution dependency manifest exceeds its physical byte bound: ${manifestPath}`);
  }
  const descriptor = fs.openSync(manifestPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino
      || opened.size !== named.size || opened.size > BigInt(maximumBytes)) {
      throw new Error(`execution dependency manifest changed while opening: ${manifestPath}`);
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const final = fs.fstatSync(descriptor, { bigint: true });
    if (offset !== bytes.length || final.dev !== opened.dev || final.ino !== opened.ino
      || final.size !== opened.size) {
      throw new Error(`execution dependency manifest changed while reading: ${manifestPath}`);
    }
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error(`execution dependency manifest is not an object: ${manifestPath}`);
    }
    return manifest;
  } finally {
    fs.closeSync(descriptor);
  }
}

function packageEdges(manifest, { omitOptionalDependencies = false } = {}) {
  const edges = new Map();
  const add = (values, optional, kind) => {
    for (const [logicalName, specification] of Object.entries(values || {})) {
      if (BUILTIN_MODULES.has(logicalName)) continue;
      const target = dependencyPackageTarget(logicalName, specification);
      const prior = edges.get(logicalName);
      if (prior && prior.manifest_name !== target.manifest_name) {
        throw new Error(`execution dependency alias has incompatible targets: ${logicalName}`);
      }
      edges.set(logicalName, {
        ...target,
        optional: prior ? prior.optional && optional : optional,
        kinds: [...new Set([...(prior?.kinds || []), kind])],
      });
    }
  };
  const optionalDependencies = manifest.optionalDependencies || {};
  const requiredDependencies = Object.fromEntries(Object.entries(manifest.dependencies || {})
    .filter(([name]) => !Object.hasOwn(optionalDependencies, name)));
  add(requiredDependencies, false, 'dependency');
  if (!omitOptionalDependencies) add(optionalDependencies, true, 'optional');
  for (const [name, specification] of Object.entries(manifest.peerDependencies || {})) {
    add({ [name]: specification }, manifest.peerDependenciesMeta?.[name]?.optional === true, 'peer');
  }
  return edges;
}

function boundedTreeLimit(value, fallback, hardMaximum, name) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > hardMaximum) {
    throw new Error(`${name} is outside the bounded package-tree limit`);
  }
  return resolved;
}

export function measurePhysicalPackageTree(packageRoot, limits = {}) {
  const root = fs.realpathSync.native(packageRoot);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`execution dependency root is not physical: ${packageRoot}`);
  }
  const maximumInodes = boundedTreeLimit(limits.maxInodes, MAX_FILES,
    MAX_CLOSURE_INODES, 'package-tree inode bound');
  const maximumBytes = boundedTreeLimit(limits.maxBytes, MAX_BYTES,
    MAX_CLOSURE_BYTES, 'package-tree byte bound');
  const maximumDepth = boundedTreeLimit(limits.maxDepth, MAX_PACKAGE_TREE_DEPTH,
    256, 'package-tree depth bound');
  const measurement = {
    files: 0, directories: 0, symlinks: 0, inodes: 0, bytes: 0, max_depth: 0,
  };
  const assertBudget = () => {
    if (measurement.inodes > maximumInodes || measurement.bytes > maximumBytes) {
      throw new Error('execution dependency package tree exceeds its bounded metadata budget');
    }
  };
  const walk = (directory, depth) => {
    if (depth > maximumDepth) {
      throw new Error('execution dependency package tree exceeds its bounded depth');
    }
    measurement.directories += 1;
    measurement.inodes += 1;
    measurement.max_depth = Math.max(measurement.max_depth, depth);
    assertBudget();
    const handle = fs.opendirSync(directory);
    try {
      for (let item = handle.readSync(); item; item = handle.readSync()) {
        if (item.name === 'node_modules') continue;
        const source = path.join(directory, item.name);
        const stat = fs.lstatSync(source);
        measurement.inodes += 1;
        if (stat.isSymbolicLink()) {
          const physical = fs.realpathSync.native(source);
          const relative = path.relative(root, physical);
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
            || relative === 'node_modules' || relative.startsWith(`node_modules${path.sep}`)) {
            throw new Error(`execution dependency symlink escapes its physical package root: ${source}`);
          }
          measurement.symlinks += 1;
        } else if (stat.isDirectory()) {
          measurement.inodes -= 1;
          walk(source, depth + 1);
        } else if (stat.isFile()) {
          measurement.files += 1;
          measurement.bytes += stat.size;
        } else {
          throw new Error(`execution dependency package tree contains a special file: ${source}`);
        }
        assertBudget();
      }
    } finally {
      handle.closeSync();
    }
  };
  walk(root, 0);
  return measurement;
}

export function resolveInstalledPackage(repository, resolverFile, logicalName, optional = false,
  expectedManifestName = logicalName) {
  if (!validPackageName(logicalName) || !validPackageName(expectedManifestName)
    || BUILTIN_MODULES.has(logicalName) || BUILTIN_MODULES.has(expectedManifestName)) {
    if (optional || BUILTIN_MODULES.has(logicalName)) return null;
    throw new Error(`invalid execution dependency package name: ${logicalName}`);
  }
  const physicalRepository = fs.realpathSync.native(repository);
  let current = fs.realpathSync.native(path.dirname(resolverFile));
  while (current === physicalRepository || current.startsWith(`${physicalRepository}${path.sep}`)) {
    const declared = path.join(current, 'node_modules', ...logicalName.split('/'), 'package.json');
    try {
      const physicalManifest = fs.realpathSync.native(declared);
      const relative = path.relative(physicalRepository, physicalManifest);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
        || !relative.split(path.sep).includes('node_modules')) {
        throw new Error(`execution dependency resolves outside repository node_modules: ${logicalName}`);
      }
      const stat = fs.lstatSync(physicalManifest);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`execution dependency manifest is not physical: ${logicalName}`);
      }
      const manifest = readBoundedPackageManifest(physicalManifest);
      if (manifest.name !== expectedManifestName) {
        throw new Error(`execution dependency manifest name mismatch: ${logicalName}`);
      }
      return {
        root: path.dirname(physicalManifest), manifest, manifest_path: physicalManifest,
        logical_name: logicalName, expected_manifest_name: expectedManifestName,
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (current === physicalRepository) break;
    current = path.dirname(current);
  }
  if (optional) return null;
  throw new Error(`cannot resolve installed execution dependency: ${logicalName}`);
}

function measurePackageClosure(repository, rootName, limits = {}, rootPolicy = {}) {
  const physicalRepository = fs.realpathSync.native(repository);
  const maximumPackages = boundedTreeLimit(limits.maxPackages, MAX_CLOSURE_PACKAGES,
    MAX_CLOSURE_PACKAGES, 'package-closure package bound');
  const maximumInodes = boundedTreeLimit(limits.maxInodes, MAX_CLOSURE_INODES,
    MAX_CLOSURE_INODES, 'package-closure inode bound');
  const maximumBytes = boundedTreeLimit(limits.maxBytes, MAX_CLOSURE_BYTES,
    MAX_CLOSURE_BYTES, 'package-closure byte bound');
  const maximumDepth = boundedTreeLimit(limits.maxDepth, MAX_PACKAGE_TREE_DEPTH, 256,
    'package-closure depth bound');
  const root = resolveInstalledPackage(physicalRepository,
    path.join(physicalRepository, 'package.json'), rootName);
  const pending = [root];
  const visited = new Set();
  const result = {
    root: rootName, packages: 0, logical_edges: 0, optional_missing: 0,
    files: 0, directories: 0, symlinks: 0, content_inodes: 0,
    logical_links: 1, synthetic_directories: 2 + (rootName.startsWith('@') ? 1 : 0),
    inodes: 0, bytes: 0, max_depth: 0,
  };
  while (pending.length > 0) {
    const dependency = pending.pop();
    const physicalRoot = fs.realpathSync.native(dependency.root);
    if (visited.has(physicalRoot)) continue;
    visited.add(physicalRoot);
    result.packages += 1;
    if (result.packages > maximumPackages) {
      throw new Error('execution dependency closure exceeds its bounded package count');
    }
    const tree = measurePhysicalPackageTree(physicalRoot, {
      maxInodes: Math.min(maximumInodes, 100_000),
      maxBytes: Math.min(maximumBytes, 8 * 1024 ** 3),
      maxDepth: maximumDepth,
    });
    for (const key of ['files', 'directories', 'symlinks', 'bytes']) {
      result[key] += tree[key];
    }
    result.content_inodes += tree.inodes;
    result.max_depth = Math.max(result.max_depth, tree.max_depth);
    let installedEdges = 0;
    const installedScopes = new Set();
    const isRoot = physicalRoot === fs.realpathSync.native(root.root);
    for (const edge of packageEdges(dependency.manifest, {
      omitOptionalDependencies: isRoot && rootPolicy.omit_direct_optional_dependencies === true,
    }).values()) {
      result.logical_edges += 1;
      const child = resolveInstalledPackage(physicalRepository, dependency.manifest_path,
        edge.logical_name, edge.optional, edge.manifest_name);
      if (!child) {
        result.optional_missing += 1;
        continue;
      }
      installedEdges += 1;
      if (edge.logical_name.startsWith('@')) installedScopes.add(edge.logical_name.split('/')[0]);
      pending.push(child);
    }
    if (installedEdges > 0) result.synthetic_directories += 1 + installedScopes.size;
    result.logical_links += installedEdges;
    result.inodes = result.content_inodes + result.logical_links + result.synthetic_directories;
    if (result.inodes > maximumInodes || result.bytes > maximumBytes) {
      throw new Error(`execution dependency closure exceeds its bounded metadata budget: ${result.inodes} inodes, ${result.bytes} bytes`);
    }
  }
  result.fits_default_dependency_budget = result.inodes <= MAX_FILES && result.bytes <= MAX_BYTES
    && result.max_depth <= MAX_PACKAGE_TREE_DEPTH;
  result.default_authority_refusal = result.fits_default_dependency_budget ? null
    : `package closure exceeds ${MAX_FILES} inodes, ${MAX_BYTES} bytes, or depth ${MAX_PACKAGE_TREE_DEPTH}`;
  return result;
}

export function measureInstalledPackageClosure(repository, rootName, limits = {}) {
  return measurePackageClosure(repository, rootName, limits);
}

export function measureAuditedNpxPackageClosure(repository, command, limits = {}) {
  const contract = auditedNpxCommand(repository, command, repository);
  const measurement = measurePackageClosure(repository, contract.package_name, limits, contract);
  return { ...measurement, npx_authority: contract };
}

export function auditedNpxPackage(repository, name) {
  const dependency = resolveInstalledPackage(
    repository, path.join(repository, 'package.json'), name,
  );
  const bins = typeof dependency.manifest.bin === 'string'
    ? { [name.split('/').at(-1)]: dependency.manifest.bin }
    : dependency.manifest.bin || {};
  const binRelative = bins[name.split('/').at(-1)] || Object.values(bins)[0];
  if (typeof binRelative !== 'string') throw new Error(`audited npx package has no declared bin: ${name}`);
  const bin = path.resolve(dependency.root, binRelative);
  const relative = path.relative(dependency.root, bin);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
    || !fs.lstatSync(bin).isFile() || fs.lstatSync(bin).isSymbolicLink()) {
    throw new Error(`audited npx package bin escapes its physical package root: ${name}`);
  }
  return { ...dependency, bin_relative: relative.replaceAll('\\', '/') };
}

function importerPackageAuthority(repository, importer) {
  let current = path.dirname(importer);
  while (current === repository || current.startsWith(`${repository}${path.sep}`)) {
    const manifest = path.join(current, 'package.json');
    try {
      const stat = fs.lstatSync(manifest);
      if (stat.isFile() && !stat.isSymbolicLink()) {
        const relative = path.relative(repository, current).replaceAll('\\', '/');
        return {
          resolver: path.relative(repository, manifest).replaceAll('\\', '/'),
          destination: relative ? `${relative}/node_modules` : 'node_modules',
        };
      }
    } catch {}
    if (current === repository) break;
    current = path.dirname(current);
  }
  throw new Error(`cannot resolve package authority for importer: ${importer}`);
}

function dependencyNames(repository, command, cwd, npxAuthority = null) {
  const pending = [];
  for (const argument of command.slice(1)) {
    const candidate = path.resolve(cwd, String(argument));
    if (candidate.startsWith(`${repository}${path.sep}`) && fs.existsSync(candidate)) pending.push(candidate);
  }
  const visited = new Set();
  const packages = new Map();
  const addPackage = (record) => packages.set(
    `${record.resolver}\0${record.destination}\0${record.name}`, record,
  );
  if (npxAuthority) {
    addPackage({
      name: npxAuthority.package_name, resolver: 'package.json', destination: 'node_modules',
      omit_direct_optional_dependencies: npxAuthority.omit_direct_optional_dependencies,
    });
  }
  for (const argument of command.slice(1)) {
    const relative = path.relative(repository, path.resolve(cwd, String(argument)))
      .replaceAll('\\', '/');
    for (const dependency of EXPLICIT_ENTRYPOINT_DEPENDENCIES.get(relative) || []) addPackage(dependency);
  }
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file) || !/\.(?:[cm]?js|json)$/.test(file)) continue;
    visited.add(file);
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const specifier of importSpecifiers(source)) {
      const dependency = packageName(specifier);
      if (dependency) {
        addPackage({ name: dependency, ...importerPackageAuthority(repository, file) });
        continue;
      }
      if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) continue;
      const base = path.resolve(path.dirname(file), specifier);
      for (const candidate of [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, `${base}.json`,
        path.join(base, 'index.mjs'), path.join(base, 'index.js')]) {
        try { if (fs.lstatSync(candidate).isFile()) { pending.push(candidate); break; } } catch {}
      }
    }
  }
  return [...packages.values()];
}

export function prepareExecutionSnapshot({
  cwd, command, temporaryDirectory, infrastructure = null, environment = {}, onProgress = null,
  expectedRetrievalAuthority = null,
  _testAfterRetrievalAuthorityValidated = null,
  _testBeforeRetrievalCopyValidation = null,
}) {
  const repository = repositoryRoot(cwd);
  const npxAuthority = /^npx(?:\.cmd)?$/i.test(path.basename(command[0]))
    ? auditedNpxCommand(repository, command, cwd) : null;
  if (npxAuthority?.launch_admitted === false) {
    throw new Error(npxAuthority.launch_refusal);
  }
  const auditedEntrypoint = entrypointRelative(repository, command, cwd);
  const oracleHostProbe = auditedEntrypoint === REAL_REPOSITORY_ORACLE_ENTRYPOINT
    && command.length === 3 && command[2] === ORACLE_HOST_PROBE_COMMAND;
  const landlockCandidateProbe = exactLandlockCandidateProbeCommand(command);
  const candidateSmoke = exactCandidateSmokeCommand(command);
  const resolvedRealRepositoryClosure = realRepositoryOracleSourceClosure(command[2]);
  if (auditedEntrypoint === REAL_REPOSITORY_ORACLE_ENTRYPOINT
    && !resolvedRealRepositoryClosure) {
    throw new Error('real-repository execution snapshot command has no exact source closure');
  }
  const realRepositoryClosure = resolvedRealRepositoryClosure
    || REAL_REPOSITORY_ORACLE_ADMISSION_SOURCE_CLOSURE;
  const realRepositorySourceSet = new Set(realRepositoryClosure);
  const repositoryOutputReason = repositoryOutputRefusal(auditedEntrypoint);
  if (repositoryOutputReason) throw new Error(repositoryOutputReason);
  const retrievalAuthority = retrievalQualificationAuthority({ repository, cwd, command });
  assertRetrievalAuthorityContinuity(expectedRetrievalAuthority, retrievalAuthority);
  _testAfterRetrievalAuthorityValidated?.(retrievalAuthority);
  const sourceGit = gitAuthority(repository);
  const root = path.join(temporaryDirectory, 'execution-authority');
  const snapshotRepository = path.join(root, 'repository');
  fs.mkdirSync(snapshotRepository, { recursive: true, mode: 0o700 });
  const entries = [];
  const environmentOverrides = {};
  let totalBytes = 0;
  let dependencyCreatedDirectories = 0;
  const sourceFiles = repositoryFiles(repository).filter((relative) => {
    if (auditedEntrypoint === RUNTIME_BASELINE_ENTRYPOINT) {
      return relative === RUNTIME_BASELINE_ENTRYPOINT
        || relative.startsWith('benchmarks/runtime-baseline-v1/')
        || relative.startsWith('packages/cli/');
    }
    if (auditedEntrypoint === REAL_REPOSITORY_ORACLE_ENTRYPOINT) {
      return realRepositorySourceSet.has(relative);
    }
    return true;
  });
  for (const relative of sourceFiles) {
    const source = path.join(repository, relative);
    const destination = path.join(snapshotRepository, relative);
    const stat = fs.lstatSync(source, { bigint: true });
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(source);
      const physicalTarget = fs.realpathSync.native(source);
      const targetRelative = path.relative(repository, physicalTarget);
      if (targetRelative.startsWith('..') || path.isAbsolute(targetRelative)) {
        throw new Error(`execution snapshot symlink escapes the repository: ${relative}`);
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.symlinkSync(target, destination);
      entries.push({ label: `repository:${relative}`, path: destination, type: 'symlink', target });
      onProgress?.({ files: entries.length, bytes: totalBytes });
      continue;
    }
    if (!stat.isFile()) continue;
    const copied = copyPhysicalFile(source, destination, (stat.mode & 0o111n) !== 0n);
    totalBytes += copied.size;
    if (totalBytes > MAX_BYTES) throw new Error(`execution snapshot exceeds ${MAX_BYTES} bytes`);
    entries.push({ label: `repository:${relative}`, path: destination, type: 'file', ...copied });
    onProgress?.({ files: entries.length, bytes: totalBytes });
  }
  const realRepositorySourceClosureIdentity = auditedEntrypoint === REAL_REPOSITORY_ORACLE_ENTRYPOINT
    ? realRepositoryOracleSourceClosureIdentity(repository, command[2]) : null;
  if (realRepositorySourceClosureIdentity) {
    const copiedRows = realRepositoryClosure.map((relative) => {
      const copied = entries.find((entry) => entry.label === `repository:${relative}`);
      if (!copied || copied.type !== 'file') {
        throw new Error(`real-repository source closure was not copied exactly: ${relative}`);
      }
      return { relative, bytes: copied.size, sha256: copied.digest };
    });
    if (copiedRows.length !== realRepositorySourceClosureIdentity.file_count
      || copiedRows.reduce((total, row) => total + row.bytes, 0)
        !== realRepositorySourceClosureIdentity.total_bytes
      || crypto.createHash('sha256').update(JSON.stringify(realRepositoryClosure)).digest('hex')
        !== realRepositorySourceClosureIdentity.paths_sha256
      || crypto.createHash('sha256').update(JSON.stringify(copiedRows)).digest('hex')
        !== realRepositorySourceClosureIdentity.files_sha256) {
      throw new Error('real-repository copied source closure identity drifted');
    }
  }
  if (npxAuthority) {
    for (const [relative, authority] of [
      [npxAuthority.config_relative, npxAuthority.config],
      ['package.json', npxAuthority.package_manifest],
    ]) {
      const copied = entries.find((entry) => entry.label === `repository:${relative}`);
      if (!copied || copied.type !== 'file' || copied.digest !== authority.digest) {
        throw new Error('copied npx command authority does not match its dependency policy');
      }
    }
  }
  const copiedDestinations = new Set(entries.map((entry) => entry.path));
  for (const argument of command.slice(1)) {
    const source = path.resolve(cwd, String(argument));
    const relative = path.relative(repository, source);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    let stat;
    try { stat = fs.lstatSync(source, { bigint: true }); } catch { continue; }
    if (!stat.isFile()) continue;
    const destination = path.join(snapshotRepository, relative);
    if (copiedDestinations.has(destination)) continue;
    const copied = copyPhysicalFile(source, destination, (stat.mode & 0o111n) !== 0n);
    totalBytes += copied.size;
    entries.push({ label: `argv:${relative}`, path: destination, type: 'file', ...copied });
    copiedDestinations.add(destination);
    if (entries.length > MAX_FILES || totalBytes > MAX_BYTES) {
      throw new Error('execution argv snapshot exceeds its bounded budget');
    }
  }
  let runtimeBaseline = null;
  if (auditedEntrypoint === RUNTIME_BASELINE_ENTRYPOINT) {
    if (command.length !== 7 || command[2] !== 'run'
      || !['small', 'medium', 'large'].includes(command[3])
      || !RUNTIME_BASELINE_SCENARIOS.has(command[4])) {
      throw new Error('runtime baseline execution command changed after preflight');
    }
    const manifestFile = path.join(repository, 'benchmarks/runtime-baseline-v1/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const fixture = manifest?.fixtures?.find((item) => item?.id === command[3]);
    const expectedInputs = [
      { index: 5, label: 'model', expected: manifest?.runtime_assets?.model, executable: false },
      {
        index: 6, label: 'worker', expected: manifest?.runtime_assets?.worker_linux_x64,
        executable: true,
      },
    ];
    if (manifest?.schema !== 'lamina.runtime-baseline-manifest/v1'
      || manifest?.version !== 1 || !fixture) {
      throw new Error('runtime baseline manifest changed after preflight');
    }
    const sealedInputs = {};
    for (const input of expectedInputs) {
      const source = path.resolve(cwd, command[input.index]);
      const relative = path.relative(repository, source).replaceAll('\\', '/');
      if (!relative || relative.startsWith('../') || path.isAbsolute(relative)
        || !Number.isSafeInteger(input.expected?.bytes)
        || !/^[a-f0-9]{64}$/.test(input.expected?.sha256 || '')) {
        throw new Error(`runtime baseline ${input.label} authority is invalid`);
      }
      const copied = entries.find((entry) => entry.path === path.join(snapshotRepository, relative));
      const sourceStat = fs.lstatSync(source, { bigint: true });
      if (!copied || copied.type !== 'file' || copied.size !== input.expected.bytes
        || copied.digest !== input.expected.sha256
        || copied.source_dev !== String(sourceStat.dev)
        || copied.source_ino !== String(sourceStat.ino)
        || copied.source_uid !== Number(sourceStat.uid)
        || copied.source_nlink !== Number(sourceStat.nlink)
        || copied.source_mode !== Number(sourceStat.mode & 0o777n)
        || (input.executable && (sourceStat.mode & 0o111n) === 0n)) {
        throw new Error(`runtime baseline ${input.label} does not match its sealed manifest authority`);
      }
      sealedInputs[input.label] = {
        source, relative, snapshot: copied.path, digest: copied.digest, size: copied.size,
      };
    }
    const workerOverlay = path.join(
      snapshotRepository, 'packages/cli/observation-runtime/cocoindex-worker',
    );
    if (workerOverlay !== sealedInputs.worker.snapshot) {
      const existing = entries.find((entry) => entry.path === workerOverlay);
      if (existing) {
        if (existing.type !== 'file' || existing.digest !== sealedInputs.worker.digest
          || existing.size !== sealedInputs.worker.size) {
          throw new Error('runtime baseline worker overlay collides with different sealed bytes');
        }
        fs.chmodSync(workerOverlay, 0o500);
      } else {
        const copied = copyPhysicalFile(sealedInputs.worker.snapshot, workerOverlay, true);
        totalBytes += copied.size;
        entries.push({
          label: 'runtime-baseline:worker-overlay', path: workerOverlay, type: 'file', ...copied,
        });
        copiedDestinations.add(workerOverlay);
      }
    }
    runtimeBaseline = {
      fixture: command[3], scenario: command[4], inputs: sealedInputs,
      worker_overlay: path.join(repository, 'packages/cli/observation-runtime/cocoindex-worker'),
      private_root: path.join(temporaryDirectory, 'payload-tmp', 'runtime-baseline-v1'),
    };
    if (entries.length > MAX_FILES || totalBytes > MAX_BYTES) {
      throw new Error('runtime baseline sealed inputs exceed the execution snapshot budget');
    }
  }
  _testBeforeRetrievalCopyValidation?.(retrievalAuthority);
  for (const input of expectedRetrievalAuthority
    ? [retrievalAuthority.worker, retrievalAuthority.model, retrievalAuthority.tokenizer] : []) {
    const copied = entries.find((entry) => entry.label === `argv:${input.relative}`
      || entry.label === `repository:${input.relative}`);
    const expected = expectedRetrievalAuthority[input.flag.slice(2)];
    if (!copied || copied.type !== 'file' || copied.digest !== expected.digest
      || copied.size !== expected.size || copied.source_dev !== expected.dev
      || copied.source_ino !== expected.ino || copied.source_uid !== expected.uid
      || copied.source_nlink !== expected.nlink || copied.source_mode !== expected.mode) {
      throw new Error(`copied retrieval ${input.flag} authority does not match its physical input`);
    }
  }
  if (expectedRetrievalAuthority) {
    const manifest = entries.find((entry) =>
      entry.label === `repository:${expectedRetrievalAuthority.manifest.relative}`);
    if (!manifest || manifest.type !== 'file'
      || manifest.digest !== expectedRetrievalAuthority.manifest.digest
      || manifest.size !== expectedRetrievalAuthority.manifest.size
      || manifest.source_dev !== expectedRetrievalAuthority.manifest.dev
      || manifest.source_ino !== expectedRetrievalAuthority.manifest.ino
      || manifest.source_uid !== expectedRetrievalAuthority.manifest.uid
      || manifest.source_nlink !== expectedRetrievalAuthority.manifest.nlink
      || manifest.source_mode !== expectedRetrievalAuthority.manifest.mode) {
      throw new Error('copied retrieval model manifest authority does not match canonical bytes');
    }
  }
  const entrypointForInputs = command.slice(1).map((argument) =>
    path.relative(repository, path.resolve(cwd, String(argument))).replaceAll('\\', '/'))
    .find((relative) => EXPLICIT_ENTRYPOINT_ENV_FILE_INPUTS.has(relative));
  for (const name of EXPLICIT_ENTRYPOINT_ENV_FILE_INPUTS.get(entrypointForInputs) || []) {
    if (!environment[name]) continue;
    const source = path.resolve(cwd, String(environment[name]));
    const relative = path.relative(repository, source);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`declared environment file input escapes the repository: ${name}`);
    }
    const stat = fs.lstatSync(source, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`declared environment input is not a physical file: ${name}`);
    }
    const destination = path.join(snapshotRepository, relative);
    environmentOverrides[name] = source;
    if (copiedDestinations.has(destination)) continue;
    const copied = copyPhysicalFile(source, destination, (stat.mode & 0o111n) !== 0n);
    totalBytes += copied.size;
    entries.push({ label: `env:${name}:${relative}`, path: destination, type: 'file', ...copied });
    copiedDestinations.add(destination);
    if (entries.length > MAX_FILES || totalBytes > MAX_BYTES) {
      throw new Error('execution environment snapshot exceeds its bounded budget');
    }
  }
  const gitCommonSnapshot = sourceGit.linked
    ? path.join(root, 'git-authority', 'common') : path.join(snapshotRepository, '.git');
  const gitWorktreeSnapshot = sourceGit.linked
    ? path.join(gitCommonSnapshot, 'worktrees', path.basename(sourceGit.gitDirectory))
    : gitCommonSnapshot;
  fs.mkdirSync(gitCommonSnapshot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(gitWorktreeSnapshot, { recursive: true, mode: 0o700 });
  const assertGitBudget = () => {
    if (entries.length > MAX_FILES || totalBytes > MAX_BYTES) {
      throw new Error('execution Git metadata snapshot exceeds its bounded budget');
    }
  };
  const recordGeneratedFile = (file, label) => {
    const stat = fs.lstatSync(file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`generated Git authority is not physical: ${label}`);
    const bytes = fs.readFileSync(file);
    fs.chmodSync(file, 0o400);
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    totalBytes += bytes.length;
    entries.push({
      label: `git:${label}`, path: file, type: 'file', size: bytes.length,
      digest: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
    assertGitBudget();
  };
  const copyGitFile = (source, destination, label, optional = false) => {
    let stat;
    try { stat = fs.lstatSync(source); } catch (error) {
      if (optional && error.code === 'ENOENT') return;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`execution Git metadata must be a physical file: ${label}`);
    }
    const copied = copyPhysicalFile(source, destination, false);
    totalBytes += copied.size;
    entries.push({ label: `git:${label}`, path: destination, type: 'file', ...copied });
    assertGitBudget();
  };
  const writeGitFile = (destination, value, label) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const descriptor = fs.openSync(destination, fs.constants.O_CREAT | fs.constants.O_EXCL
      | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o400);
    try {
      fs.writeFileSync(descriptor, value);
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    recordGeneratedFile(destination, label);
  };
  if (sourceGit.linked) {
    copyGitFile(path.join(repository, '.git'), path.join(snapshotRepository, '.git'), 'worktree-marker');
    const sealedMarker = fs.readFileSync(path.join(snapshotRepository, '.git'), 'utf8').trim();
    const markerMatch = sealedMarker.match(/^gitdir:\s*(.+)$/i);
    if (!markerMatch
      || fs.realpathSync.native(path.resolve(repository, markerMatch[1])) !== sourceGit.gitDirectory) {
      throw new Error('descriptor-copied worktree marker changed Git authority');
    }
    copyGitFile(path.join(sourceGit.gitDirectory, 'commondir'),
      path.join(gitWorktreeSnapshot, 'commondir'), 'worktree/commondir');
    const sealedCommon = fs.readFileSync(path.join(gitWorktreeSnapshot, 'commondir'), 'utf8').trim();
    if (fs.realpathSync.native(path.resolve(sourceGit.gitDirectory, sealedCommon)) !== sourceGit.common) {
      throw new Error('descriptor-copied commondir escapes Git common authority');
    }
  }
  const objectFormat = gitOutput(repository, ['rev-parse', '--show-object-format']);
  writeGitFile(path.join(gitCommonSnapshot, 'config'),
    inertRepositoryConfig({ objectFormat }), 'common/config');
  copyGitFile(path.join(sourceGit.common, 'shallow'), path.join(gitCommonSnapshot, 'shallow'),
    'common/shallow', true);
  copyGitFile(path.join(sourceGit.common, 'info', 'exclude'),
    path.join(gitCommonSnapshot, 'info', 'exclude'), 'common/info/exclude', true);
  for (const name of fs.readdirSync(sourceGit.gitDirectory)) {
    if (!name.startsWith('sharedindex.')) continue;
    copyGitFile(path.join(sourceGit.gitDirectory, name), path.join(gitWorktreeSnapshot, name),
      `worktree/${name}`);
  }
  for (const name of ['HEAD', 'index', 'MERGE_HEAD', 'CHERRY_PICK_HEAD',
    'REVERT_HEAD', 'BISECT_LOG', 'AUTO_MERGE']) {
    copyGitFile(path.join(sourceGit.gitDirectory, name), path.join(gitWorktreeSnapshot, name),
      `worktree/${name}`, name !== 'HEAD');
  }
  copyGitFile(path.join(sourceGit.gitDirectory, 'info', 'sparse-checkout'),
    path.join(gitWorktreeSnapshot, 'info', 'sparse-checkout'), 'worktree/info/sparse-checkout', true);
  const head = optionalGitOutput(repository, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const symbolicHead = optionalGitOutput(repository, ['symbolic-ref', '--quiet', 'HEAD']);
  if (symbolicHead) {
    if (!/^refs\/heads\/[A-Za-z0-9._\/-]+$/.test(symbolicHead)
      || symbolicHead.split('/').includes('..')) throw new Error('Git HEAD ref escapes sealed authority');
    writeGitFile(path.join(gitCommonSnapshot, symbolicHead), `${head || ''}\n`, `common/${symbolicHead}`);
  }
  const objectIds = new Set();
  if (head) {
    // The runtime baseline and real-repository inventory admission use the
    // Lamina checkout only as immutable executable
    // source and reads its HEAD identifier; all repository lifecycle work occurs
    // in separately cloned pinned fixtures. Seal that identifier without copying
    // unrelated Lamina history beside the large pinned runtime inputs.
    const headOnlyGitClosure = [
      RUNTIME_BASELINE_ENTRYPOINT, REAL_REPOSITORY_ORACLE_ENTRYPOINT,
    ].includes(auditedEntrypoint);
    const reachable = headOnlyGitClosure
      ? head
      : gitOutput(repository, ['rev-list', '--objects', 'HEAD']);
    for (const item of reachable.split('\n').filter(Boolean)) {
      const oid = item.match(/^([a-f0-9]{40,64})(?:\s|$)/)?.[1];
      if (!oid) throw new Error('cannot parse reachable Git object closure');
      objectIds.add(oid);
    }
  }
  if (![RUNTIME_BASELINE_ENTRYPOINT, REAL_REPOSITORY_ORACLE_ENTRYPOINT].includes(auditedEntrypoint)) {
    const staged = gitOutput(repository, ['ls-files', '--stage', '-z']);
    for (const item of staged.split('\0').filter(Boolean)) {
      const oid = item.match(/^[0-7]{6}\s+([a-f0-9]{40,64})\s+[0-3]\t/)?.[1];
      if (!oid) throw new Error('cannot parse Git index object closure');
      objectIds.add(oid);
    }
  }
  if (objectIds.size > 0) {
    const objectInput = `${[...objectIds].join('\n')}\n`;
    const checks = gitOutput(repository, ['cat-file', '--batch-check'], { input: objectInput });
    let uncompressedBytes = 0;
    for (const line of checks.split('\n').filter(Boolean)) {
      const match = line.match(/^[a-f0-9]{40,64}\s+\S+\s+(\d+)$/);
      if (!match) throw new Error('Git object closure contains a missing or invalid object');
      uncompressedBytes += Number(match[1]);
    }
    assertGitObjectClosureBudget(objectIds.size, uncompressedBytes, totalBytes);
    const packDirectory = path.join(gitCommonSnapshot, 'objects', 'pack');
    fs.mkdirSync(packDirectory, { recursive: true, mode: 0o700 });
    const pack = gitBuffer(repository, ['pack-objects', '--stdout', '--window=0'], {
      input: objectInput, maxBuffer: Math.min(MAX_BYTES, MAX_BYTES - totalBytes + 1024 * 1024),
    });
    if (totalBytes + pack.length > MAX_BYTES) {
      throw new Error('execution Git pack exceeds its bounded budget');
    }
    gitBuffer(repository, ['index-pack', '--stdin'], {
      input: pack, maxBuffer: 64 * 1024,
      objectDirectory: path.join(gitCommonSnapshot, 'objects'),
    });
    for (const name of fs.readdirSync(packDirectory).sort()) {
      recordGeneratedFile(path.join(packDirectory, name), `common/objects/pack/${name}`);
    }
  }
  const gitReadonlyBindings = sourceGit.linked ? [
    { source: gitCommonSnapshot, target: sourceGit.common, kind: 'git-common' },
    { source: gitWorktreeSnapshot, target: sourceGit.gitDirectory, kind: 'git-worktree' },
  ] : [];
  // Dependencies are executable source too, but an installation can contain
  // hundreds of thousands of unrelated files. Resolve only package roots in
  // the audited entrypoint's static import closure, then recurse through those
  // packages' declared runtime dependencies.
  const requiredPackages = dependencyNames(repository, command, cwd, npxAuthority);
  if (requiredPackages.length > 0) {
    const sealedPackages = new Map();
    const sealedPackagePolicies = new Map();
    const logicalLinks = new Map();
    const sealedStore = path.join(snapshotRepository, 'node_modules', '.lamina-sealed');
    const ensureDependencyDirectory = (directory) => {
      const absolute = path.resolve(directory);
      if (absolute !== snapshotRepository
        && !absolute.startsWith(`${snapshotRepository}${path.sep}`)) {
        throw new Error('execution dependency directory escapes sealed authority');
      }
      const missing = [];
      let current = absolute;
      while (current !== snapshotRepository) {
        try {
          const stat = fs.lstatSync(current);
          if (!stat.isDirectory() || stat.isSymbolicLink()) {
            throw new Error(`execution dependency ancestor is not physical: ${current}`);
          }
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          missing.push(current);
          current = path.dirname(current);
        }
      }
      for (const target of missing.reverse()) {
        assertExecutionDependencyInodeBudget(entries.length, dependencyCreatedDirectories + 1);
        fs.mkdirSync(target, { mode: 0o700 });
        dependencyCreatedDirectories += 1;
      }
    };
    const visit = (sourceDirectory, destinationDirectory, logicalDirectory,
      packageBoundary, sealedBoundary, depth = 0) => {
      if (depth > MAX_PACKAGE_TREE_DEPTH) {
        throw new Error('execution dependency package tree exceeds its bounded depth');
      }
      ensureDependencyDirectory(destinationDirectory);
      const handle = fs.opendirSync(sourceDirectory);
      try {
        for (let item = handle.readSync(); item; item = handle.readSync()) {
          if (item.name === 'node_modules') continue;
          const source = path.join(sourceDirectory, item.name);
          const destination = path.join(destinationDirectory, item.name);
          const logical = path.join(logicalDirectory, item.name).replaceAll('\\', '/');
          const stat = fs.lstatSync(source);
          if (stat.isSymbolicLink()) {
            assertExecutionDependencyInodeBudget(entries.length + 1,
              dependencyCreatedDirectories);
            const physical = fs.realpathSync.native(source);
            const relative = path.relative(packageBoundary, physical);
            if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
              || relative === 'node_modules' || relative.startsWith(`node_modules${path.sep}`)) {
              throw new Error(`execution dependency symlink escapes node_modules: ${logical}`);
            }
            const target = path.relative(path.dirname(destination), path.join(sealedBoundary, relative));
            fs.symlinkSync(target, destination);
            entries.push({
              label: `dependency:${logical}`, path: destination, type: 'symlink', target,
            });
          } else if (stat.isDirectory()) {
            visit(source, destination, logical, packageBoundary, sealedBoundary, depth + 1);
          } else if (stat.isFile()) {
            assertExecutionDependencyInodeBudget(entries.length + 1,
              dependencyCreatedDirectories);
            const copied = copyPhysicalFile(source, destination,
              (stat.mode & 0o111) !== 0);
            totalBytes += copied.size;
            entries.push({
              label: `dependency:${logical}`, path: destination, type: 'file', ...copied,
            });
          } else {
            throw new Error(`execution dependency package tree contains a special file: ${logical}`);
          }
          assertExecutionDependencyInodeBudget(entries.length, dependencyCreatedDirectories);
          if (totalBytes > MAX_BYTES) {
            throw new Error('execution dependency snapshot exceeds its bounded budget');
          }
        }
      } finally {
        handle.closeSync();
      }
    };

    const linkPackage = (link, target, label) => {
      const absoluteLink = path.resolve(link);
      const absoluteTarget = path.resolve(target);
      if (!absoluteLink.startsWith(`${snapshotRepository}${path.sep}`)
        || !absoluteTarget.startsWith(`${sealedStore}${path.sep}`)) {
        throw new Error(`execution dependency link escapes sealed authority: ${label}`);
      }
      const prior = logicalLinks.get(absoluteLink);
      if (prior && prior !== absoluteTarget) {
        throw new Error(`execution dependency logical path resolves to incompatible roots: ${label}`);
      }
      if (prior) return;
      ensureDependencyDirectory(path.dirname(absoluteLink));
      try {
        fs.lstatSync(absoluteLink);
        throw new Error(`execution dependency logical path collides with sealed source: ${label}`);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const relativeTarget = path.relative(path.dirname(absoluteLink), absoluteTarget);
      assertExecutionDependencyInodeBudget(entries.length + 1, dependencyCreatedDirectories);
      fs.symlinkSync(relativeTarget, absoluteLink, 'dir');
      entries.push({
        label: `dependency-link:${label}`, path: absoluteLink, type: 'symlink',
        target: relativeTarget,
      });
      logicalLinks.set(absoluteLink, absoluteTarget);
      assertExecutionDependencyInodeBudget(entries.length, dependencyCreatedDirectories);
    };

    const stagePackage = (dependency, policy = {}) => {
      const physicalRoot = fs.realpathSync.native(dependency.root);
      const existing = sealedPackages.get(physicalRoot);
      const policyKey = policy.omit_dependency_edges === true ? 'leaf'
        : policy.omit_direct_optional_dependencies === true ? 'omit-optional' : 'full';
      if (existing) {
        if (sealedPackagePolicies.get(physicalRoot) !== policyKey) {
          throw new Error('execution dependency root was selected with incompatible policies');
        }
        return existing;
      }
      const sourceRelative = path.relative(repository, physicalRoot).replaceAll('\\', '/');
      if (!sourceRelative || sourceRelative.startsWith('../')
        || !sourceRelative.split('/').includes('node_modules')) {
        throw new Error(`execution dependency physical root escapes repository node_modules: ${dependency.manifest.name}`);
      }
      const id = crypto.createHash('sha256').update(sourceRelative).digest('hex');
      const sealedRoot = path.join(sealedStore, id);
      sealedPackages.set(physicalRoot, sealedRoot);
      sealedPackagePolicies.set(physicalRoot, policyKey);
      visit(physicalRoot, sealedRoot, `node_modules/.lamina-sealed/${id}`, physicalRoot,
        sealedRoot);

      const edges = policy.omit_dependency_edges === true ? [] : packageEdges(dependency.manifest, {
        omitOptionalDependencies: policy.omit_direct_optional_dependencies === true,
      }).values();
      for (const edge of edges) {
        const child = resolveInstalledPackage(
          repository, dependency.manifest_path, edge.logical_name, edge.optional,
          edge.manifest_name,
        );
        if (!child) continue;
        const childRoot = stagePackage(child);
        linkPackage(path.join(sealedRoot, 'node_modules', ...edge.logical_name.split('/')), childRoot,
          `${dependency.manifest.name}:${edge.logical_name}->${edge.manifest_name}:${edge.kinds.join('+')}`);
      }
      return sealedRoot;
    };

    for (const record of requiredPackages) {
      const resolverFile = path.resolve(repository, record.resolver);
      const dependency = resolveInstalledPackage(repository, resolverFile, record.name);
      const sealedRoot = stagePackage(dependency, record);
      linkPackage(path.join(snapshotRepository, record.destination, ...record.name.split('/')),
        sealedRoot, `${record.destination}/${record.name}`);
    }
  }
  const stagedInfrastructure = { identities: {} };
  if (infrastructure) {
    const binarySources = { node: infrastructure.node };
    for (const [role, source] of Object.entries(binarySources)) {
      const destination = path.join(root, 'infrastructure', role);
      const copied = copyPhysicalFile(fs.realpathSync.native(source), destination, true);
      const stat = fs.lstatSync(destination, { bigint: true });
      totalBytes += copied.size;
      entries.push({ label: `infrastructure:${role}`, path: destination, type: 'file', ...copied });
      stagedInfrastructure[role] = destination;
      stagedInfrastructure.identities[role] = {
        path: destination, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
        mode: Number(stat.mode & 0o7777n), size: String(stat.size), digest: copied.digest,
      };
    }
    if (requiresSystemBwrapPath(infrastructure)) {
      // AppArmor and other path-based LSMs attach their bwrap exception to the
      // distribution executable (for example /usr/bin/bwrap on Ubuntu). A copy
      // has identical bytes but a different security identity and can lose the
      // capabilities needed to finish constructing the network namespace.
      // Keep only an immutable root-owned system path; user-owned and explicitly
      // pinned helpers continue through the descriptor-copy authority below.
      assertTrustedBinaryIdentity(infrastructure.identities.bwrap);
      const identity = trustedRootBinaryIdentity(infrastructure.bwrap, {
        expectedDigest: infrastructure.identities.bwrap.digest,
      });
      const size = Number(identity.size);
      totalBytes += size;
      entries.push({
        label: 'infrastructure:bwrap-system-path', path: identity.path, type: 'host-file',
        size, digest: identity.digest,
        source_dev: identity.dev, source_ino: identity.ino, source_uid: identity.uid,
        source_mode: identity.mode, source_nlink: identity.nlink,
        source_file_capabilities: identity.file_capabilities,
      });
      stagedInfrastructure.bwrap = identity.path;
      stagedInfrastructure.identities.bwrap = identity;
    } else {
      const source = infrastructure.bwrap;
      const destination = path.join(root, 'infrastructure', 'bwrap');
      const copied = copyPhysicalFile(fs.realpathSync.native(source), destination, true);
      const stat = fs.lstatSync(destination, { bigint: true });
      totalBytes += copied.size;
      entries.push({ label: 'infrastructure:bwrap', path: destination, type: 'file', ...copied });
      stagedInfrastructure.bwrap = destination;
      stagedInfrastructure.identities.bwrap = {
        path: destination, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
        mode: Number(stat.mode & 0o7777n), size: String(stat.size), digest: copied.digest,
      };
    }
    const infrastructureSources = [
      'gate.sh', 'quota-gate.sh', 'sandbox.mjs', 'infrastructure.mjs',
    ];
    if (oracleHostProbe) infrastructureSources.push('oracle-host-launcher.mjs');
    for (const name of infrastructureSources) {
      const source = path.join(HERE, name);
      const destination = path.join(root, 'infrastructure', name);
      const copied = copyPhysicalFile(source, destination, name.endsWith('.sh'));
      totalBytes += copied.size;
      entries.push({ label: `infrastructure:${name}`, path: destination, type: 'file', ...copied });
      stagedInfrastructure[name.replaceAll(/[-.]/g, '_')] = destination;
    }
    if (oracleHostProbe) {
      const oracleEnvSource = trustedRootHostBinary('env');
      const oracleEnv = path.join(root, 'infrastructure', 'oracle-env');
      const copied = copyPhysicalFile(oracleEnvSource.path, oracleEnv, true);
      const stat = fs.lstatSync(oracleEnv, { bigint: true });
      totalBytes += copied.size;
      entries.push({ label: 'infrastructure:oracle-env', path: oracleEnv, type: 'file', ...copied });
      stagedInfrastructure.oracle_host_env = oracleEnv;
      stagedInfrastructure.identities.oracle_host_env = {
        path: oracleEnv, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
        mode: Number(stat.mode & 0o7777n), size: String(stat.size), digest: copied.digest,
      };
    }
    if (auditedEntrypoint === 'scripts/build-standalone-cli.mjs') {
      const uvSource = resolveProgram(environment.LAMINA_UV_BINARY
        || (process.platform === 'win32' ? 'uv.exe' : 'uv'), cwd, environment);
      const stagedUv = path.join(root, 'infrastructure', process.platform === 'win32' ? 'uv.exe' : 'uv');
      const copied = copyPhysicalFile(uvSource, stagedUv, true);
      totalBytes += copied.size;
      entries.push({ label: 'infrastructure:uv', path: stagedUv, type: 'file', ...copied });
      stagedInfrastructure.uv = stagedUv;
      environmentOverrides.LAMINA_UV_BINARY = stagedUv;
      environmentOverrides.LAMINA_NODE_BINARY = stagedInfrastructure.node;
    }
  }
  const physicalExecutable = fs.realpathSync.native(command[0]);
  const npxPackage = npxAuthority?.package_name || null;
  let npxEntrypoint = null;
  if (npxPackage) {
    if (!infrastructure) throw new Error('audited npx execution requires staged Node authority');
    const dependency = auditedNpxPackage(repository, npxPackage);
    npxEntrypoint = path.join(
      snapshotRepository, 'node_modules', npxPackage, dependency.bin_relative,
    );
    if (!fs.existsSync(npxEntrypoint)) throw new Error(`audited npx package bin was not snapshotted: ${npxPackage}`);
  }
  const executable = npxPackage || (infrastructure
    && physicalExecutable === fs.realpathSync.native(infrastructure.node))
    ? stagedInfrastructure.node : path.join(root, 'executable');
  if (!npxPackage && executable !== stagedInfrastructure.node) {
    const executableCopy = copyPhysicalFile(physicalExecutable, executable, true);
    totalBytes += executableCopy.size;
    entries.push({ label: 'executable', path: executable, type: 'file', ...executableCopy });
  }
  if (entries.length + dependencyCreatedDirectories > MAX_FILES || totalBytes > MAX_BYTES) {
    throw new Error(`execution snapshot exceeds ${MAX_FILES} files or ${MAX_BYTES} bytes`);
  }
  const launchCommand = npxPackage
    ? [stagedInfrastructure.node, npxEntrypoint, ...command.slice(2)]
    : [executable, ...command.slice(1)];
  let oracleHostLaunchCommand = null;
  let oracleHostLaunchCwd = null;
  let oracleHostProfile = null;
  let oracleHostLaunchBinding = null;
  if (oracleHostProbe) {
    const oracleHost = path.join(
      snapshotRepository, 'benchmarks/real-repository-oracle-v1/oracle-host.mjs',
    );
    const oracleLauncher = stagedInfrastructure.oracle_host_launcher_mjs;
    const copiedHost = entries.find((entry) => entry.path === oracleHost);
    const copiedLauncher = entries.find((entry) => entry.path === oracleLauncher);
    if (!copiedHost || copiedHost.type !== 'file' || !stagedInfrastructure.node
      || !stagedInfrastructure.identities.node || !stagedInfrastructure.bwrap
      || !stagedInfrastructure.identities.bwrap || !copiedLauncher) {
      throw new Error('oracle-host launch profile lacks exact sealed infrastructure');
    }
    const hostStat = fs.lstatSync(oracleHost, { bigint: true });
    const launcherStat = fs.lstatSync(oracleLauncher, { bigint: true });
    assertTrustedBinaryIdentity(stagedInfrastructure.identities.bwrap);
    const help = spawnSync(stagedInfrastructure.bwrap, ['--help'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 2_000,
      maxBuffer: 256 * 1024, env: sanitizedEnvironment({ LANG: 'C', LC_ALL: 'C' }),
    });
    assertTrustedBinaryIdentity(stagedInfrastructure.identities.bwrap);
    if (help.error || help.status !== 0 || help.signal || help.stderr.trim()) {
      throw new Error('oracle quota keeper bwrap capability probe failed');
    }
    const capabilities = attestOracleKeeperBwrapHelp(help.stdout);
    oracleHostLaunchCommand = Object.freeze([stagedInfrastructure.node, oracleHost]);
    oracleHostLaunchCwd = snapshotRepository;
    oracleHostProfile = Object.freeze({
      schema: 'lamina.safe-runner-oracle-host-launch-profile/v1',
      id: ORACLE_HOST_LAUNCH_PROFILE,
      bwrap: stagedInfrastructure.bwrap,
      bwrap_identity: Object.freeze({ ...stagedInfrastructure.identities.bwrap }),
      bwrap_capabilities: capabilities,
      launcher: oracleLauncher,
      launcher_identity: Object.freeze({
        path: oracleLauncher, dev: String(launcherStat.dev), ino: String(launcherStat.ino),
        uid: Number(launcherStat.uid), mode: Number(launcherStat.mode & 0o7777n),
        size: String(launcherStat.size), digest: copiedLauncher.digest,
      }),
      bootstrap_environment: Object.freeze({
        path: stagedInfrastructure.oracle_host_env,
        identity: Object.freeze({ ...stagedInfrastructure.identities.oracle_host_env }),
        values: Object.freeze({ LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' }),
      }),
      host: oracleHost,
      host_identity: Object.freeze({
        path: oracleHost, dev: String(hostStat.dev), ino: String(hostStat.ino),
        uid: Number(hostStat.uid), mode: Number(hostStat.mode & 0o7777n),
        size: String(hostStat.size), digest: copiedHost.digest,
      }),
      non_gradeable: true,
    });
    oracleHostLaunchBinding = Object.freeze({
      profile: ORACLE_HOST_LAUNCH_PROFILE,
      command: ['infrastructure:node',
        'repository:benchmarks/real-repository-oracle-v1/oracle-host.mjs'],
      cwd: 'repository',
      node_sha256: stagedInfrastructure.identities.node.digest,
      launcher_sha256: copiedLauncher.digest,
      bootstrap_env_sha256: stagedInfrastructure.identities.oracle_host_env.digest,
      host_sha256: copiedHost.digest,
      bwrap_sha256: stagedInfrastructure.identities.bwrap.digest,
      bwrap_help_sha256: capabilities.help_sha256,
      non_gradeable: true,
    });
  }
  const graphdLaunchAuthority = [];
  const gitExecutableIdentity = auditedEntrypoint === 'tests/fixtures/safe-runner-graphd-client.mjs'
    || auditedEntrypoint === RUNTIME_BASELINE_ENTRYPOINT
    || auditedEntrypoint === REAL_REPOSITORY_ORACLE_ENTRYPOINT
    ? trustedGitIdentity() : null;
  if (stagedInfrastructure.node
    && auditedEntrypoint === 'tests/fixtures/safe-runner-graphd-client.mjs') {
    const fixtureRepository = path.resolve(cwd, command[2]);
    const fixtureCommon = path.resolve(fixtureRepository,
      gitOutput(fixtureRepository, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    graphdLaunchAuthority.push({
      kind: 'exact',
      argv: [stagedInfrastructure.node,
        path.join(repository, 'tests/fixtures/graph-runtime/server.mjs'),
        fixtureRepository, command[3] || 'clean'],
      cwd: repository,
      runtime_directory: path.join(fs.realpathSync.native(fixtureCommon), 'lamina'),
      executable_identity: stagedInfrastructure.identities.node,
    });
  }
  if (stagedInfrastructure.node && runtimeBaseline) {
    for (let index = 0; index < 3; index += 1) {
      const nestedRepository = path.join(
        runtimeBaseline.private_root, 'runs', runtimeBaseline.fixture,
        runtimeBaseline.scenario, `sample-${index}`,
      );
      graphdLaunchAuthority.push({
        kind: 'exact',
        argv: [
          stagedInfrastructure.node,
          path.join(repository, 'packages/cli/lib/graph-runtime/server.mjs'),
          nestedRepository,
        ],
        cwd: nestedRepository,
        runtime_directory: path.join(nestedRepository, '.git', 'lamina'),
        private_tmp_root: runtimeBaseline.private_root,
        executable_identity: stagedInfrastructure.identities.node,
      });
    }
  }
  if (auditedEntrypoint === 'tests/cli_binary_smoke_test.mjs'
    && environmentOverrides.LAMINA_BINARY) {
    const standalone = environmentOverrides.LAMINA_BINARY;
    const relative = path.relative(repository, standalone);
    const sealedStandalone = path.join(snapshotRepository, relative);
    const stat = fs.lstatSync(sealedStandalone, { bigint: true });
    graphdLaunchAuthority.push({
      kind: 'standalone-cwd', executable: standalone,
      private_tmp_root: path.join(temporaryDirectory, 'payload-tmp'),
      executable_identity: { dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid) },
    });
  }
  const writableBindings = [];
  const entrypoint = auditedEntrypoint;
  for (const output of EXPLICIT_ENTRYPOINT_ARGV_OUTPUTS.get(entrypoint) || []) {
    if (!command[output.index]) continue;
    const candidate = path.resolve(cwd, command[output.index]);
    const root = output.kind === 'file' ? path.dirname(candidate) : candidate;
    const fixtureEntrypoint = ['tests/fixtures/safe-runner-graphd-client.mjs',
      'tests/fixtures/safe-runner-mutable.mjs'].includes(entrypoint);
    if (fixtureEntrypoint) {
      const runtimeWork = path.join(sourceGit.common, 'lamina', 'work');
      if (root !== runtimeWork && !root.startsWith(`${runtimeWork}${path.sep}`)) {
        throw new Error('safe-runner fixture output must remain beneath exact Git common lamina/work scratch authority');
      }
      try { physicalOwnedDirectory(root, 'safe-runner fixture scratch'); }
      catch { throw new Error('safe-runner fixture scratch must be an existing canonical physical directory'); }
      if (entrypoint === 'tests/fixtures/safe-runner-graphd-client.mjs') {
        let physical;
        try { physical = physicalOwnedDirectory(root, 'safe-runner graph fixture repository'); }
        catch { throw new Error('safe-runner graph fixture output must be an existing physical nested Git repository'); }
        if (repositoryRoot(physical) !== physical) {
          throw new Error('safe-runner graph fixture output must be an existing physical nested Git repository');
        }
      }
      continue;
    }
    throw new Error('unreviewed execution snapshot argv output authority');
  }
  if (EXPLICIT_ENTRYPOINT_ARGV_OUTPUTS.has(entrypoint)) {
    const runtimeSource = path.join(sourceGit.common, 'lamina', 'work');
    ensureContainedWritableDirectory(sourceGit.common, runtimeSource, 'Git common Lamina work scratch');
    const runtimeStat = fs.lstatSync(runtimeSource, { bigint: true });
    if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()
      || fs.realpathSync.native(runtimeSource) !== runtimeSource
      || (typeof process.getuid === 'function' && Number(runtimeStat.uid) !== process.getuid())) {
      throw new Error('Git common Lamina work scratch must be a canonical same-user physical directory');
    }
    const snapshotTarget = path.join(gitCommonSnapshot, 'lamina', 'work');
    fs.mkdirSync(snapshotTarget, { recursive: true, mode: 0o700 });
    physicalOwnedDirectory(snapshotTarget, 'sealed Git common Lamina work mount point');
    const snapshotTargetStat = fs.lstatSync(snapshotTarget, { bigint: true });
    writableBindings.push({
      source: runtimeSource, target: runtimeSource,
      snapshot_target: snapshotTarget,
      kind: 'git-common-work-scratch', source_identity: {
        dev: String(runtimeStat.dev), ino: String(runtimeStat.ino), uid: Number(runtimeStat.uid),
      },
      snapshot_target_identity: {
        dev: String(snapshotTargetStat.dev), ino: String(snapshotTargetStat.ino),
        uid: Number(snapshotTargetStat.uid),
      },
    });
  }
  const snapshotEntries = entries.map(({ path: _path, ...entry }) => entry);
  const snapshotDigestInput = oracleHostProbe ? {
    entries: snapshotEntries,
    oracle_host_launch: oracleHostLaunchBinding,
  } : landlockCandidateProbe ? {
    entries: snapshotEntries,
    launch_profile: LANDLOCK_CANDIDATE_PROBE_LAUNCH_PROFILE,
  } : candidateSmoke ? {
    entries: snapshotEntries,
    launch_profile: CANDIDATE_SMOKE_LAUNCH_PROFILE,
  } : snapshotEntries;
  return {
    root, repository, snapshot_repository: snapshotRepository,
    audited_entrypoint: auditedEntrypoint,
    launch_command: launchCommand, entries, writable_bindings: writableBindings,
    launch_profile: oracleHostProbe ? ORACLE_HOST_LAUNCH_PROFILE
      : landlockCandidateProbe ? LANDLOCK_CANDIDATE_PROBE_LAUNCH_PROFILE
        : candidateSmoke ? CANDIDATE_SMOKE_LAUNCH_PROFILE : null,
    oracle_host_launch_command: oracleHostLaunchCommand,
    oracle_host_launch_cwd: oracleHostLaunchCwd,
    oracle_host_profile: oracleHostProfile,
    oracle_host_launch_binding: oracleHostLaunchBinding,
    git_readonly_bindings: gitReadonlyBindings,
    git_common: sourceGit.common,
    git_directory: sourceGit.gitDirectory,
    git_executable_identity: gitExecutableIdentity,
    environment_overrides: environmentOverrides,
    graphd_launch_authority: graphdLaunchAuthority,
    runtime_baseline: runtimeBaseline,
    infrastructure: stagedInfrastructure,
    source_closure_identity: realRepositorySourceClosureIdentity,
    file_count: entries.length, total_bytes: totalBytes,
    digest: crypto.createHash('sha256').update(JSON.stringify(snapshotDigestInput)).digest('hex'),
  };
}

export function assertExecutionSnapshot(snapshot) {
  for (const entry of snapshot?.entries || []) {
    if (entry.type === 'symlink') {
      if (fs.readlinkSync(entry.path) !== entry.target) throw new Error('execution snapshot symlink changed');
      continue;
    }
    if (entry.type === 'host-file') {
      const expected = snapshot?.infrastructure?.identities?.bwrap;
      const actual = trustedRootBinaryIdentity(entry.path, { expectedDigest: entry.digest });
      if (entry.label !== 'infrastructure:bwrap-system-path'
        || expected?.path !== entry.path || expected?.root_owned_path !== true
        || entry.source_dev !== actual.dev || entry.source_ino !== actual.ino
        || entry.source_uid !== actual.uid || entry.source_mode !== actual.mode
        || entry.source_nlink !== actual.nlink || entry.size !== Number(actual.size)
        || entry.source_file_capabilities !== actual.file_capabilities
        || entry.digest !== actual.digest
        || ['path', 'dev', 'ino', 'uid', 'mode', 'nlink', 'size', 'digest', 'file_capabilities']
          .some((field) => expected?.[field] !== actual[field])) {
        throw new Error('execution snapshot host infrastructure identity changed');
      }
      continue;
    }
    const stat = fs.lstatSync(entry.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size) {
      throw new Error('execution snapshot file identity changed');
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(entry.path)).digest('hex');
    if (digest !== entry.digest) throw new Error('execution snapshot bytes changed');
  }
  for (const binding of snapshot?.writable_bindings || []) {
    const stat = fs.lstatSync(binding.snapshot_target, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || fs.realpathSync.native(binding.snapshot_target) !== binding.snapshot_target
      || String(stat.dev) !== binding.snapshot_target_identity?.dev
      || String(stat.ino) !== binding.snapshot_target_identity?.ino
      || Number(stat.uid) !== binding.snapshot_target_identity?.uid) {
      throw new Error('execution snapshot writable mount point identity changed');
    }
  }
  if (snapshot?.launch_profile === ORACLE_HOST_LAUNCH_PROFILE) {
    const host = path.join(snapshot.snapshot_repository,
      'benchmarks/real-repository-oracle-v1/oracle-host.mjs');
    const profile = snapshot.oracle_host_profile;
    const command = snapshot.oracle_host_launch_command;
    const hostEntry = snapshot.entries.find((entry) => entry.path === host);
    if (profile?.schema !== 'lamina.safe-runner-oracle-host-launch-profile/v1'
      || profile.id !== ORACLE_HOST_LAUNCH_PROFILE || profile.non_gradeable !== true
      || snapshot.oracle_host_launch_cwd !== snapshot.snapshot_repository
      || !Array.isArray(command) || command.length !== 2
      || command[0] !== snapshot.infrastructure.node || command[1] !== host
      || !hostEntry || hostEntry.type !== 'file'
      || snapshot.oracle_host_launch_binding?.host_sha256 !== hostEntry.digest
      || snapshot.oracle_host_launch_binding?.launcher_sha256
        !== profile.launcher_identity?.digest
      || snapshot.oracle_host_launch_binding?.bootstrap_env_sha256
        !== profile.bootstrap_environment?.identity?.digest
      || snapshot.oracle_host_launch_binding?.node_sha256
        !== snapshot.infrastructure.identities.node.digest
      || snapshot.oracle_host_launch_binding?.bwrap_sha256 !== profile.bwrap_identity?.digest
      || profile.bwrap !== snapshot.infrastructure.bwrap
      || profile.launcher !== snapshot.infrastructure.oracle_host_launcher_mjs
      || profile.bootstrap_environment?.path !== snapshot.infrastructure.oracle_host_env
      || JSON.stringify(profile.bootstrap_environment?.values)
        !== JSON.stringify({ LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' })
      || profile.host !== host
      || profile.host_identity?.digest !== hostEntry.digest
      || JSON.stringify(profile.bwrap_identity)
        !== JSON.stringify(snapshot.infrastructure.identities.bwrap)) {
      throw new Error('oracle-host sealed launch translation changed');
    }
    assertTrustedBinaryIdentity(profile.bwrap_identity);
    const help = spawnSync(profile.bwrap, ['--help'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 2_000,
      maxBuffer: 256 * 1024, env: sanitizedEnvironment({ LANG: 'C', LC_ALL: 'C' }),
    });
    assertTrustedBinaryIdentity(profile.bwrap_identity);
    if (help.error || help.status !== 0 || help.signal || help.stderr.trim()
      || attestOracleKeeperBwrapHelp(help.stdout).help_sha256
        !== profile.bwrap_capabilities?.help_sha256) {
      throw new Error('oracle-host bwrap capability authority changed');
    }
  } else if (snapshot?.oracle_host_launch_command !== null
    || snapshot?.oracle_host_launch_cwd !== null || snapshot?.oracle_host_profile !== null
    || snapshot?.oracle_host_launch_binding !== null
    || snapshot?.infrastructure?.oracle_host_launcher_mjs !== undefined
    || snapshot?.infrastructure?.oracle_host_env !== undefined) {
    throw new Error('non-oracle execution snapshot contains oracle-host launch authority');
  }
  return true;
}
