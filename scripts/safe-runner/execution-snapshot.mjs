import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from './constants.mjs';
import { inertRepositoryConfig, spawnTrustedGit } from './git.mjs';

const MAX_FILES = DEFAULTS.executionAuthorityMaxFiles;
const MAX_BYTES = DEFAULTS.executionAuthorityMaxBytes;
const MAX_GIT_OBJECTS = 262_144;
const HERE = path.dirname(fileURLToPath(import.meta.url));

export function assertGitObjectClosureBudget(objectCount, uncompressedBytes, currentBytes = 0) {
  if (!Number.isSafeInteger(objectCount) || objectCount < 0 || objectCount > MAX_GIT_OBJECTS
    || !Number.isSafeInteger(uncompressedBytes) || uncompressedBytes < 0
    || !Number.isSafeInteger(currentBytes) || currentBytes < 0
    || currentBytes + uncompressedBytes > MAX_BYTES) {
    throw new Error('execution Git object closure exceeds its bounded budget');
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
]);
const EXPLICIT_ENTRYPOINT_WRITABLE_ROOTS = new Map([
  ['scripts/build-standalone-cli.mjs', ['dist']],
  ['scripts/fetch-retrieval-model.mjs', ['dist']],
  ['scripts/prepare-retrieval-assets.mjs', ['dist']],
  ['evals/hooks/compatibility-matrix.sh', ['evals/reports']],
  ['evals/scripts/run-reference-matrix.mjs', [
    'eval-workspace', 'evals/workspace', 'evals/reports', 'evals/tmp',
  ]],
  ['evals/scripts/run-suite.mjs', [
    'eval-workspace', 'evals/workspace', 'evals/reports', 'evals/tmp',
  ]],
  ['evals/scripts/vendor-nextjs-fixture.mjs', ['evals/fixtures/_base/nextjs-commerce']],
  ['evals/scripts/vendor-outline-fixture.mjs', ['evals/fixtures/_base/outline']],
  ['evals/scripts/vendor-payload-fixture.mjs', ['evals/fixtures/_base/payload-website']],
  ['evals/scripts/vendor-plane-fixture.mjs', ['evals/fixtures/_base/plane']],
]);
const EXPLICIT_ENTRYPOINT_ARGV_OUTPUTS = new Map([
  ['scripts/prepare-retrieval-assets.mjs', [{ index: 2, kind: 'directory' }]],
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
    'LAMINA_BINARY', 'LAMINA_WORKER', 'LAMINA_MODEL',
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
    if (opened.dev !== named.dev || opened.ino !== named.ino || opened.size !== named.size) {
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
      || final.size !== opened.size) throw new Error(`snapshot source changed while copying: ${source}`);
    fs.fchmodSync(output, executable ? 0o500 : 0o400);
    fs.fsyncSync(output);
    return { size: offset, digest: hash.digest('hex') };
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
    if (!relative.startsWith('../') && (EXPLICIT_ENTRYPOINT_WRITABLE_ROOTS.has(relative)
      || EXPLICIT_ENTRYPOINT_ARGV_OUTPUTS.has(relative))) return relative;
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

export function resolveInstalledPackage(repository, resolverFile, expectedName, optional = false) {
  if (!validPackageName(expectedName) || BUILTIN_MODULES.has(expectedName)) {
    if (optional || BUILTIN_MODULES.has(expectedName)) return null;
    throw new Error(`invalid execution dependency package name: ${expectedName}`);
  }
  const physicalRepository = fs.realpathSync.native(repository);
  let current = fs.realpathSync.native(path.dirname(resolverFile));
  while (current === physicalRepository || current.startsWith(`${physicalRepository}${path.sep}`)) {
    const declared = path.join(current, 'node_modules', ...expectedName.split('/'), 'package.json');
    try {
      const physicalManifest = fs.realpathSync.native(declared);
      const relative = path.relative(physicalRepository, physicalManifest);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
        || !relative.split(path.sep).includes('node_modules')) {
        throw new Error(`execution dependency resolves outside repository node_modules: ${expectedName}`);
      }
      const stat = fs.lstatSync(physicalManifest);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`execution dependency manifest is not physical: ${expectedName}`);
      }
      const manifest = JSON.parse(fs.readFileSync(physicalManifest, 'utf8'));
      if (manifest.name !== expectedName) {
        throw new Error(`execution dependency manifest name mismatch: ${expectedName}`);
      }
      return { root: path.dirname(physicalManifest), manifest, manifest_path: physicalManifest };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (current === physicalRepository) break;
    current = path.dirname(current);
  }
  if (optional) return null;
  throw new Error(`cannot resolve installed execution dependency: ${expectedName}`);
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

function dependencyNames(repository, command, cwd) {
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
  const npxOffset = ['--yes', '-y'].includes(command[1]) ? 2 : 1;
  if (/^npx(?:\.cmd)?$/i.test(path.basename(command[0]))
    && ['agent-skills-eval', 'promptfoo'].includes(command[npxOffset])) {
    addPackage({ name: command[npxOffset], resolver: 'package.json', destination: 'node_modules' });
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
}) {
  const repository = repositoryRoot(cwd);
  const auditedEntrypoint = entrypointRelative(repository, command, cwd);
  const sourceGit = gitAuthority(repository);
  const root = path.join(temporaryDirectory, 'execution-authority');
  const snapshotRepository = path.join(root, 'repository');
  fs.mkdirSync(snapshotRepository, { recursive: true, mode: 0o700 });
  const entries = [];
  let totalBytes = 0;
  const sourceFiles = repositoryFiles(repository);
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
    const reachable = gitOutput(repository, ['rev-list', '--objects', 'HEAD']);
    for (const item of reachable.split('\n').filter(Boolean)) {
      const oid = item.match(/^([a-f0-9]{40,64})(?:\s|$)/)?.[1];
      if (!oid) throw new Error('cannot parse reachable Git object closure');
      objectIds.add(oid);
    }
  }
  const staged = gitOutput(repository, ['ls-files', '--stage', '-z']);
  for (const item of staged.split('\0').filter(Boolean)) {
    const oid = item.match(/^[0-7]{6}\s+([a-f0-9]{40,64})\s+[0-3]\t/)?.[1];
    if (!oid) throw new Error('cannot parse Git index object closure');
    objectIds.add(oid);
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
  const requiredPackages = dependencyNames(repository, command, cwd);
  if (requiredPackages.length > 0) {
    const sealedPackages = new Map();
    const logicalLinks = new Map();
    const sealedStore = path.join(snapshotRepository, 'node_modules', '.lamina-sealed');
    const visit = (sourceDirectory, destinationDirectory, logicalDirectory,
      packageBoundary, sealedBoundary) => {
      fs.mkdirSync(destinationDirectory, { recursive: true, mode: 0o700 });
      for (const item of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
        if (item.name === 'node_modules') continue;
        const source = path.join(sourceDirectory, item.name);
        const destination = path.join(destinationDirectory, item.name);
        const logical = path.join(logicalDirectory, item.name).replaceAll('\\', '/');
        if (item.isSymbolicLink()) {
          const physical = fs.realpathSync.native(source);
          const relative = path.relative(packageBoundary, physical);
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)
            || relative === 'node_modules' || relative.startsWith(`node_modules${path.sep}`)) {
            throw new Error(`execution dependency symlink escapes node_modules: ${logical}`);
          }
          const target = path.relative(path.dirname(destination), path.join(sealedBoundary, relative));
          fs.symlinkSync(target, destination);
          entries.push({ label: `dependency:${logical}`, path: destination, type: 'symlink', target });
        } else if (item.isDirectory()) {
          visit(source, destination, logical, packageBoundary, sealedBoundary);
        }
        else if (item.isFile()) {
          const copied = copyPhysicalFile(source, destination,
            (fs.lstatSync(source).mode & 0o111) !== 0);
          totalBytes += copied.size;
          entries.push({ label: `dependency:${logical}`, path: destination, type: 'file', ...copied });
        }
        if (entries.length > MAX_FILES || totalBytes > MAX_BYTES) {
          throw new Error('execution dependency snapshot exceeds its bounded budget');
        }
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
      fs.mkdirSync(path.dirname(absoluteLink), { recursive: true, mode: 0o700 });
      try {
        fs.lstatSync(absoluteLink);
        throw new Error(`execution dependency logical path collides with sealed source: ${label}`);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const relativeTarget = path.relative(path.dirname(absoluteLink), absoluteTarget);
      fs.symlinkSync(relativeTarget, absoluteLink, 'dir');
      entries.push({
        label: `dependency-link:${label}`, path: absoluteLink, type: 'symlink',
        target: relativeTarget,
      });
      logicalLinks.set(absoluteLink, absoluteTarget);
      if (entries.length > MAX_FILES) {
        throw new Error('execution dependency snapshot exceeds its bounded budget');
      }
    };

    const stagePackage = (dependency) => {
      const physicalRoot = fs.realpathSync.native(dependency.root);
      const existing = sealedPackages.get(physicalRoot);
      if (existing) return existing;
      const sourceRelative = path.relative(repository, physicalRoot).replaceAll('\\', '/');
      if (!sourceRelative || sourceRelative.startsWith('../')
        || !sourceRelative.split('/').includes('node_modules')) {
        throw new Error(`execution dependency physical root escapes repository node_modules: ${dependency.manifest.name}`);
      }
      const id = crypto.createHash('sha256').update(sourceRelative).digest('hex');
      const sealedRoot = path.join(sealedStore, id);
      sealedPackages.set(physicalRoot, sealedRoot);
      visit(physicalRoot, sealedRoot, `node_modules/.lamina-sealed/${id}`, physicalRoot,
        sealedRoot);

      const edges = new Map();
      const addEdges = (values, optional, kind) => {
        for (const name of Object.keys(values || {})) {
          if (BUILTIN_MODULES.has(name)) continue;
          const prior = edges.get(name);
          edges.set(name, {
            optional: prior ? prior.optional && optional : optional,
            kinds: [...new Set([...(prior?.kinds || []), kind])],
          });
        }
      };
      addEdges(dependency.manifest.dependencies, false, 'dependency');
      addEdges(dependency.manifest.optionalDependencies, true, 'optional');
      for (const [name] of Object.entries(dependency.manifest.peerDependencies || {})) {
        const optional = dependency.manifest.peerDependenciesMeta?.[name]?.optional === true;
        addEdges({ [name]: true }, optional, 'peer');
      }
      for (const [name, edge] of edges) {
        const child = resolveInstalledPackage(
          repository, dependency.manifest_path, name, edge.optional,
        );
        if (!child) continue;
        const childRoot = stagePackage(child);
        linkPackage(path.join(sealedRoot, 'node_modules', ...name.split('/')), childRoot,
          `${dependency.manifest.name}:${name}:${edge.kinds.join('+')}`);
      }
      return sealedRoot;
    };

    for (const record of requiredPackages) {
      const resolverFile = path.resolve(repository, record.resolver);
      const dependency = resolveInstalledPackage(repository, resolverFile, record.name);
      const sealedRoot = stagePackage(dependency);
      linkPackage(path.join(snapshotRepository, record.destination, ...record.name.split('/')),
        sealedRoot, `${record.destination}/${record.name}`);
    }
  }
  const stagedInfrastructure = { identities: {} };
  const environmentOverrides = {};
  if (infrastructure) {
    const binarySources = {
      node: infrastructure.node,
      bwrap: infrastructure.bwrap,
    };
    for (const [role, source] of Object.entries(binarySources)) {
      const destination = path.join(root, 'infrastructure', role);
      const copied = copyPhysicalFile(fs.realpathSync.native(source), destination, true);
      const stat = fs.lstatSync(destination, { bigint: true });
      totalBytes += copied.size;
      entries.push({ label: `infrastructure:${role}`, path: destination, type: 'file', ...copied });
      stagedInfrastructure[role] = destination;
      stagedInfrastructure.identities[role] = {
        path: destination, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
        mode: Number(stat.mode & 0o777n), size: String(stat.size), digest: copied.digest,
      };
    }
    for (const name of ['gate.sh', 'quota-gate.sh', 'sandbox.mjs', 'infrastructure.mjs']) {
      const source = path.join(HERE, name);
      const destination = path.join(root, 'infrastructure', name);
      const copied = copyPhysicalFile(source, destination, name.endsWith('.sh'));
      totalBytes += copied.size;
      entries.push({ label: `infrastructure:${name}`, path: destination, type: 'file', ...copied });
      stagedInfrastructure[name.replaceAll(/[-.]/g, '_')] = destination;
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
  const npxOffset = ['--yes', '-y'].includes(command[1]) ? 2 : 1;
  const npxPackage = /^npx(?:\.cmd)?$/i.test(path.basename(command[0]))
    && ['agent-skills-eval', 'promptfoo'].includes(command[npxOffset])
    ? command[npxOffset] : null;
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
  if (entries.length > MAX_FILES || totalBytes > MAX_BYTES) {
    throw new Error(`execution snapshot exceeds ${MAX_FILES} files or ${MAX_BYTES} bytes`);
  }
  const launchCommand = npxPackage
    ? [stagedInfrastructure.node, npxEntrypoint, ...command.slice(npxOffset + 1)]
    : [executable, ...command.slice(1)];
  const graphdLaunchAuthority = [];
  if (stagedInfrastructure.node) {
    graphdLaunchAuthority.push({
      kind: 'exact',
      argv: [stagedInfrastructure.node,
        path.join(repository, 'packages/cli/lib/graph-runtime/server.mjs'), repository],
      runtime_directory: path.join(sourceGit.common, 'lamina'),
      executable_identity: stagedInfrastructure.identities.node,
    });
    if (auditedEntrypoint === 'tests/fixtures/safe-runner-graphd-client.mjs') {
      const fixtureRepository = path.resolve(cwd, command[2]);
      const fixtureCommon = path.resolve(fixtureRepository,
        gitOutput(fixtureRepository, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
      graphdLaunchAuthority.push({
        kind: 'exact',
        argv: [stagedInfrastructure.node,
          path.join(repository, 'tests/fixtures/graph-runtime/server.mjs'),
          fixtureRepository, command[3] || 'clean'],
        runtime_directory: path.join(fs.realpathSync.native(fixtureCommon), 'lamina'),
        executable_identity: stagedInfrastructure.identities.node,
      });
    }
  }
  if (environment.LAMINA_BINARY) {
    const standalone = path.resolve(cwd, String(environment.LAMINA_BINARY));
    if (!standalone.startsWith(`${repository}${path.sep}`)) {
      throw new Error('standalone graphd host escapes sealed repository authority');
    }
    const relative = path.relative(repository, standalone);
    const sealedStandalone = path.join(snapshotRepository, relative);
    const stat = fs.lstatSync(sealedStandalone, { bigint: true });
    graphdLaunchAuthority.push({
      kind: 'standalone-cwd', executable: standalone,
      executable_identity: { dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid) },
    });
  }
  const writableBindings = [];
  const entrypoint = auditedEntrypoint;
  const declaredWritableRoots = new Map((EXPLICIT_ENTRYPOINT_WRITABLE_ROOTS.get(entrypoint) || [])
    .map((relative) => [relative, 'entrypoint']));
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
    const relative = path.relative(repository, root);
    if (!relative || relative === '.' || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`declared workload output escapes the writable repository contract: ${root}`);
    }
    if (entrypoint === 'scripts/prepare-retrieval-assets.mjs'
      && relative !== 'dist' && !relative.startsWith('dist/')) {
      throw new Error('retrieval asset output must remain beneath the declared dist subtree');
    }
    if (sourceFiles.some((file) => file === relative || file.startsWith(`${relative}/`))) {
      throw new Error(`declared workload output would re-expose sealed source: ${root}`);
    }
    declaredWritableRoots.set(relative, 'argv');
  }
  const writableRootNames = [...declaredWritableRoots.keys()];
  for (const relative of writableRootNames) {
    if (!relative || relative === '.' || relative.startsWith('../') || path.isAbsolute(relative)) {
      throw new Error(`writable root escapes the sealed repository: ${relative || '.'}`);
    }
    if (sourceFiles.some((file) => file === relative || file.startsWith(`${relative}/`))) {
      throw new Error(`writable root would re-expose sealed source: ${relative}`);
    }
  }
  const collapsedWritableRoots = writableRootNames.filter((candidate, _index, all) =>
    !all.some((parent) => parent !== candidate && (candidate === parent
      || candidate.startsWith(`${parent.replace(/\/$/, '')}/`))));
  for (const relative of collapsedWritableRoots) {
    const source = path.resolve(repository, relative);
    const target = path.resolve(snapshotRepository, relative);
    if (source === repository || !source.startsWith(`${repository}${path.sep}`)) {
      throw new Error(`writable root escapes the sealed repository: ${relative}`);
    }
    ensureContainedWritableDirectory(repository, source, 'writable root');
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    const sourceStat = fs.lstatSync(source);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()
      || fs.realpathSync.native(source) !== source) {
      throw new Error(`writable root must be a canonical physical directory: ${relative}`);
    }
    const alias = path.join(root, 'writable-aliases', String(writableBindings.length));
    fs.mkdirSync(alias, { recursive: true, mode: 0o700 });
    writableBindings.push({ source, target: source, alias, snapshot_target: target });
  }
  const runtimeSource = path.join(sourceGit.common, 'lamina');
  ensureContainedWritableDirectory(sourceGit.common, runtimeSource, 'Git common Lamina runtime');
  const runtimeStat = fs.lstatSync(runtimeSource, { bigint: true });
  if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink()
    || fs.realpathSync.native(runtimeSource) !== runtimeSource
    || (typeof process.getuid === 'function' && Number(runtimeStat.uid) !== process.getuid())) {
    throw new Error('Git common Lamina runtime must be a canonical same-user physical directory');
  }
  const runtimeAlias = path.join(root, 'writable-aliases', String(writableBindings.length));
  fs.mkdirSync(runtimeAlias, { recursive: true, mode: 0o700 });
  writableBindings.push({
    source: runtimeSource, target: runtimeSource, alias: runtimeAlias,
    kind: 'git-common-runtime', source_identity: {
      dev: String(runtimeStat.dev), ino: String(runtimeStat.ino), uid: Number(runtimeStat.uid),
    },
  });
  return {
    root, repository, snapshot_repository: snapshotRepository,
    launch_command: launchCommand, entries, writable_bindings: writableBindings,
    git_readonly_bindings: gitReadonlyBindings,
    git_common: sourceGit.common,
    git_directory: sourceGit.gitDirectory,
    environment_overrides: environmentOverrides,
    graphd_launch_authority: graphdLaunchAuthority,
    infrastructure: stagedInfrastructure,
    file_count: entries.length, total_bytes: totalBytes,
    digest: crypto.createHash('sha256').update(JSON.stringify(entries.map(({ path: _path, ...entry }) => entry))).digest('hex'),
  };
}

export function assertExecutionSnapshot(snapshot) {
  for (const entry of snapshot?.entries || []) {
    if (entry.type === 'symlink') {
      if (fs.readlinkSync(entry.path) !== entry.target) throw new Error('execution snapshot symlink changed');
      continue;
    }
    const stat = fs.lstatSync(entry.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size) {
      throw new Error('execution snapshot file identity changed');
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(entry.path)).digest('hex');
    if (digest !== entry.digest) throw new Error('execution snapshot bytes changed');
  }
  return true;
}
