import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from './constants.mjs';

const MAX_FILES = DEFAULTS.executionAuthorityMaxFiles;
const MAX_BYTES = DEFAULTS.executionAuthorityMaxBytes;
const HERE = path.dirname(fileURLToPath(import.meta.url));
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
  ['evals/scripts/vendor-nextjs-fixture.mjs', ['evals/fixtures']],
  ['evals/scripts/vendor-outline-fixture.mjs', ['evals/fixtures']],
  ['evals/scripts/vendor-payload-fixture.mjs', ['evals/fixtures']],
  ['evals/scripts/vendor-plane-fixture.mjs', ['evals/fixtures']],
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
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000,
    maxBuffer: 64 * 1024,
  });
  if (result.status !== 0) throw new Error('execution snapshot requires a Git worktree');
  return fs.realpathSync.native(String(result.stdout).trim());
}

function repositoryFiles(root) {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('cannot enumerate the bounded execution source snapshot');
  const files = String(result.stdout).split('\0').filter(Boolean).sort();
  if (files.length > MAX_FILES) throw new Error(`execution snapshot exceeds ${MAX_FILES} files`);
  return files;
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

function packageName(specifier) {
  if (specifier.startsWith('node:') || specifier.startsWith('.') || path.isAbsolute(specifier)) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function packageRoot(resolved, expectedName) {
  let current = path.dirname(resolved);
  while (path.dirname(current) !== current) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(current, 'package.json'), 'utf8'));
      if (value.name === expectedName) return { root: current, manifest: value };
    } catch {}
    current = path.dirname(current);
  }
  throw new Error(`cannot bind resolved dependency root for ${expectedName}`);
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
  const root = path.join(temporaryDirectory, 'execution-authority');
  const snapshotRepository = path.join(root, 'repository');
  fs.mkdirSync(snapshotRepository, { recursive: true, mode: 0o700 });
  const entries = [];
  let totalBytes = 0;
  for (const relative of repositoryFiles(repository)) {
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
  const gitSource = path.join(repository, '.git');
  const gitDestination = path.join(snapshotRepository, '.git');
  const copyGit = (sourceDirectory, destinationDirectory, logicalDirectory = '.git') => {
    fs.mkdirSync(destinationDirectory, { recursive: true, mode: 0o700 });
    for (const item of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      if (logicalDirectory === '.git' && item.name === 'lamina') continue;
      if (/\.lock$/.test(item.name)) continue;
      const source = path.join(sourceDirectory, item.name);
      const destination = path.join(destinationDirectory, item.name);
      const logical = path.join(logicalDirectory, item.name).replaceAll('\\', '/');
      if (item.isDirectory()) copyGit(source, destination, logical);
      else if (item.isSymbolicLink()) {
        const physical = fs.realpathSync.native(source);
        const relative = path.relative(gitSource, physical);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error(`execution Git metadata symlink escapes authority: ${logical}`);
        }
        const target = fs.readlinkSync(source);
        fs.symlinkSync(target, destination);
        entries.push({ label: `git:${logical}`, path: destination, type: 'symlink', target });
      } else if (item.isFile()) {
        const copied = copyPhysicalFile(source, destination, false);
        totalBytes += copied.size;
        entries.push({ label: `git:${logical}`, path: destination, type: 'file', ...copied });
      }
      if (entries.length > MAX_FILES || totalBytes > MAX_BYTES) {
        throw new Error('execution Git metadata snapshot exceeds its bounded budget');
      }
    }
  };
  copyGit(gitSource, gitDestination);
  // Dependencies are executable source too, but an installation can contain
  // hundreds of thousands of unrelated files. Resolve only package roots in
  // the audited entrypoint's static import closure, then recurse through those
  // packages' declared runtime dependencies.
  const requiredPackages = dependencyNames(repository, command, cwd);
  if (requiredPackages.length > 0) {
    const copiedPackages = new Set();
    const pendingPackages = requiredPackages.map((record) => ({ ...record, optional: false }));
    const visit = (sourceDirectory, destinationDirectory, logicalDirectory, packageBoundary) => {
      fs.mkdirSync(destinationDirectory, { recursive: true, mode: 0o700 });
      for (const item of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
        if (item.name === 'node_modules') continue;
        const source = path.join(sourceDirectory, item.name);
        const destination = path.join(destinationDirectory, item.name);
        const logical = path.join(logicalDirectory, item.name).replaceAll('\\', '/');
        if (item.isSymbolicLink()) {
          const physical = fs.realpathSync.native(source);
          const relative = path.relative(packageBoundary, physical);
          if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`execution dependency symlink escapes node_modules: ${logical}`);
          }
          const target = fs.readlinkSync(source);
          fs.symlinkSync(target, destination);
          entries.push({ label: `dependency:${logical}`, path: destination, type: 'symlink', target });
        } else if (item.isDirectory()) visit(source, destination, logical, packageBoundary);
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
    while (pendingPackages.length) {
      const record = pendingPackages.shift();
      const key = `${record.destination}\0${record.name}`;
      if (copiedPackages.has(key)) continue;
      const resolverFile = path.join(repository, record.resolver);
      const require = createRequire(resolverFile);
      let resolved;
      try { resolved = require.resolve(record.name); }
      catch (error) {
        try { resolved = require.resolve(`${record.name}/package.json`); }
        catch { if (record.optional) continue; throw error; }
      }
      const dependency = packageRoot(resolved, record.name);
      visit(dependency.root, path.join(snapshotRepository, record.destination, record.name),
        `${record.destination}/${record.name}`, dependency.root);
      copiedPackages.add(key);
      for (const transitive of Object.keys(dependency.manifest.dependencies || {})) {
        pendingPackages.push({
          name: transitive, resolver: path.relative(repository,
            path.join(dependency.root, 'package.json')),
          destination: record.destination, optional: false,
        });
      }
      for (const optional of Object.keys(dependency.manifest.optionalDependencies || {})) {
        pendingPackages.push({
          name: optional, resolver: path.relative(repository,
            path.join(dependency.root, 'package.json')),
          destination: record.destination, optional: true,
        });
      }
    }
  }
  const stagedInfrastructure = { identities: {} };
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
  }
  const physicalExecutable = fs.realpathSync.native(command[0]);
  const npxOffset = ['--yes', '-y'].includes(command[1]) ? 2 : 1;
  const npxPackage = /^npx(?:\.cmd)?$/i.test(path.basename(command[0]))
    && ['agent-skills-eval', 'promptfoo'].includes(command[npxOffset])
    ? command[npxOffset] : null;
  let npxEntrypoint = null;
  if (npxPackage) {
    if (!infrastructure) throw new Error('audited npx execution requires staged Node authority');
    const require = createRequire(path.join(repository, 'package.json'));
    let resolved;
    try { resolved = require.resolve(npxPackage); }
    catch { resolved = require.resolve(`${npxPackage}/package.json`); }
    const dependency = packageRoot(resolved, npxPackage);
    const bins = typeof dependency.manifest.bin === 'string'
      ? { [npxPackage.split('/').at(-1)]: dependency.manifest.bin }
      : dependency.manifest.bin || {};
    const binRelative = bins[npxPackage.split('/').at(-1)] || Object.values(bins)[0];
    if (typeof binRelative !== 'string') throw new Error(`audited npx package has no declared bin: ${npxPackage}`);
    npxEntrypoint = path.join(snapshotRepository, 'node_modules', npxPackage, binRelative);
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
  if (totalBytes > MAX_BYTES) throw new Error(`execution snapshot exceeds ${MAX_BYTES} bytes`);
  const launchCommand = npxPackage
    ? [stagedInfrastructure.node, npxEntrypoint, ...command.slice(npxOffset + 1)]
    : [executable, ...command.slice(1)];
  const writableBindings = [];
  const entrypoint = entrypointRelative(repository, command, cwd);
  const declaredWritableRoots = new Set([
    '.git/lamina',
    ...(EXPLICIT_ENTRYPOINT_WRITABLE_ROOTS.get(entrypoint) || []),
  ]);
  for (const output of EXPLICIT_ENTRYPOINT_ARGV_OUTPUTS.get(entrypoint) || []) {
    if (!command[output.index]) continue;
    const candidate = path.resolve(cwd, command[output.index]);
    const root = output.kind === 'file' ? path.dirname(candidate) : candidate;
    const relative = path.relative(repository, root);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`declared workload output escapes the writable repository contract: ${root}`);
    }
    declaredWritableRoots.add(relative || '.');
  }
  const collapsedWritableRoots = [...declaredWritableRoots].filter((candidate, _index, all) =>
    !all.some((parent) => parent !== candidate && (candidate === parent
      || candidate.startsWith(`${parent.replace(/\/$/, '')}/`))));
  for (const relative of collapsedWritableRoots) {
    const source = path.resolve(repository, relative);
    const target = path.resolve(snapshotRepository, relative);
    fs.mkdirSync(source, { recursive: true, mode: 0o700 });
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    const alias = path.join(root, 'writable-aliases', String(writableBindings.length));
    fs.mkdirSync(alias, { recursive: true, mode: 0o700 });
    writableBindings.push({ source, target: source, alias, snapshot_target: target });
  }
  return {
    root, repository, snapshot_repository: snapshotRepository,
    launch_command: launchCommand, entries, writable_bindings: writableBindings,
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
