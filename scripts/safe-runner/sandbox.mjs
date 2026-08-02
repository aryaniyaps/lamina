#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  assertTrustedBinaryIdentity, EXECUTION_HOOK_ENVIRONMENT,
  SAFE_RUNNER_RETRIEVAL_SEMANTIC_ENVIRONMENT,
  SAFE_RUNNER_TEST_ONLY_RETRIEVAL_ENVIRONMENT, sanitizedEnvironment, trustedHostBinary,
} from './infrastructure.mjs';

export const CONTROL_ENVIRONMENT_NAMES = Object.freeze([
  'DBUS_SESSION_BUS_ADDRESS',
  'DBUS_SYSTEM_BUS_ADDRESS',
  'DBUS_STARTER_ADDRESS',
  'DBUS_STARTER_BUS_TYPE',
  'DOCKER_CONTEXT',
  'DOCKER_HOST',
  'CONTAINER_HOST',
  'CONTAINERD_ADDRESS',
  'PODMAN_HOST',
  'XDG_RUNTIME_DIR',
  'NOTIFY_SOCKET',
  'WATCHDOG_PID',
  'WATCHDOG_USEC',
  'LISTEN_FDS',
  'LISTEN_PID',
  'LISTEN_FDNAMES',
  'LAMINA_SAFE_RUNNER_ALLOW_NETWORK',
  'LAMINA_SAFE_REPORT_FILE',
  'LAMINA_SAFE_REPORT_PARENT',
  ...SAFE_RUNNER_RETRIEVAL_SEMANTIC_ENVIRONMENT,
  ...SAFE_RUNNER_TEST_ONLY_RETRIEVAL_ENVIRONMENT,
  ...EXECUTION_HOOK_ENVIRONMENT,
]);

const SEALED_ENVIRONMENT_NAMES_BY_ENTRYPOINT = new Map([
  ['tests/cli_binary_smoke_test.mjs', new Set([
    'LAMINA_BINARY', 'LAMINA_WORKER', 'LAMINA_MODEL',
    'LAMINA_RETRIEVAL_TOKENIZER_PATH', 'LAMINA_RETRIEVAL_FTS_EXTENSION_PATH',
    'LAMINA_RETRIEVAL_VECTOR_EXTENSION_PATH',
  ])],
  ['tests/retrieval_native_index_test.mjs', new Set([
    'LAMINA_RETRIEVAL_TOKENIZER_PATH', 'LAMINA_RETRIEVAL_FTS_EXTENSION_PATH',
    'LAMINA_RETRIEVAL_VECTOR_EXTENSION_PATH',
  ])],
]);
const RUNTIME_BASELINE_ENTRYPOINT = 'benchmarks/runtime-baseline-v1/workload.mjs';
const REAL_REPOSITORY_ORACLE_ENTRYPOINT = 'benchmarks/real-repository-oracle-v1/workload.mjs';

const STANDARD_CONTROL_SOCKETS = Object.freeze([
  '/run/dbus/system_bus_socket',
  '/run/systemd/private',
  '/run/docker.sock',
  '/var/run/docker.sock',
  '/run/podman/podman.sock',
  '/var/run/podman/podman.sock',
  '/run/containerd/containerd.sock',
  '/var/run/containerd/containerd.sock',
  '/run/crio/crio.sock',
  '/var/run/crio/crio.sock',
]);

function inheritedUnixSocket(value) {
  const text = String(value || '');
  const dbusPath = text.match(/(?:^|;)unix:path=([^,;]+)/)?.[1];
  if (dbusPath) return dbusPath;
  if (text.startsWith('unix://')) return text.slice('unix://'.length);
  if (text.startsWith('unix:')) return text.slice('unix:'.length);
  return path.isAbsolute(text) ? text : null;
}

export function controlSocketMasks({
  uid = typeof process.getuid === 'function' ? process.getuid() : null,
  env = process.env,
  socketExists = (candidate) => {
    try { return fs.lstatSync(candidate).isSocket(); } catch { return false; }
  },
  directoryExists = (candidate) => {
    try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
  },
} = {}) {
  const hiddenDirectories = [];
  const runtime = Number.isInteger(uid) ? `/run/user/${uid}` : null;
  if (runtime && directoryExists(runtime)) hiddenDirectories.push(runtime);
  const inherited = [
    'DBUS_SESSION_BUS_ADDRESS', 'DBUS_SYSTEM_BUS_ADDRESS', 'DBUS_STARTER_ADDRESS',
    'DOCKER_HOST', 'CONTAINER_HOST', 'CONTAINERD_ADDRESS', 'PODMAN_HOST',
  ]
    .map((name) => inheritedUnixSocket(env[name]))
    .filter(Boolean);
  const sockets = [];
  const identities = new Set();
  for (const candidate of [...STANDARD_CONTROL_SOCKETS, ...inherited]) {
    const resolved = path.resolve(candidate);
    if (runtime && (resolved === runtime || resolved.startsWith(`${runtime}${path.sep}`))) continue;
    if (!socketExists(resolved)) continue;
    let identity = resolved;
    try { identity = fs.realpathSync.native(resolved); } catch {}
    if (identities.has(identity)) continue;
    identities.add(identity);
    sockets.push(resolved);
  }
  return { hiddenDirectories, sockets };
}

export function bubblewrapSandboxArguments({
  cwd,
  readyFile,
  releaseFile,
  temporaryDirectory,
  command,
  executionAuthority = null,
  sealedGitIdentity = null,
  preservedEnvironmentNames = [],
  environment = process.env,
  allowNetwork = false,
  masks = controlSocketMasks(),
} = {}) {
  const args = [
    '--unshare-user', '--unshare-pid', '--uid', '0', '--gid', '0',
    '--ro-bind', '/', '/', '--dev-bind', '/dev', '/dev', '--proc', '/proc',
    '--bind', readyFile, readyFile,
  ];
  if (executionAuthority) {
    args.push('--ro-bind', executionAuthority.snapshot_repository, executionAuthority.repository);
    for (const binding of executionAuthority.git_readonly_bindings || []) {
      args.push('--ro-bind', binding.source, binding.target);
    }
    for (const binding of executionAuthority.writable_bindings) {
      args.push('--bind', binding.source, binding.target);
    }
  }
  if (!allowNetwork) args.splice(2, 0, '--unshare-net');
  for (const directory of masks.hiddenDirectories) args.push('--tmpfs', directory);
  for (const socket of masks.sockets) args.push('--bind', '/dev/null', socket);
  if (process.env.LAMINA_SAFE_REPORT_PARENT && fs.existsSync(process.env.LAMINA_SAFE_REPORT_PARENT)) {
    const parent = path.resolve(process.env.LAMINA_SAFE_REPORT_PARENT);
    args.push('--ro-bind', parent, parent);
  }
  const preserved = new Set(preservedEnvironmentNames);
  const controlEnvironment = new Set([
    ...CONTROL_ENVIRONMENT_NAMES,
    ...Object.keys(environment).filter((name) => name.startsWith('LAMINA_RETRIEVAL_')),
  ]);
  for (const name of controlEnvironment) {
    if (!preserved.has(name)) args.push('--unsetenv', name);
  }
  if (sealedGitIdentity) {
    args.push('--setenv', 'LAMINA_SAFE_GIT_IDENTITY', sealedGitIdentity);
  }
  args.push(
    '--size', String(process.env.LAMINA_SAFE_TEMP_MAX_BYTES),
    '--tmpfs', temporaryDirectory,
    '--chdir', cwd,
    '--', '/bin/sh', process.env.LAMINA_SAFE_QUOTA_GATE,
    readyFile, releaseFile, temporaryDirectory,
    ...command,
  );
  return args;
}

export function validatedSealedEnvironmentNames({
  executionAuthority, environment = process.env,
} = {}) {
  const overrides = executionAuthority?.environment_overrides;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return [];
  const allowed = SEALED_ENVIRONMENT_NAMES_BY_ENTRYPOINT.get(
    executionAuthority.audited_entrypoint,
  ) || new Set();
  const names = Object.keys(overrides);
  for (const name of names) {
    const source = overrides[name];
    const relative = typeof source === 'string'
      ? path.relative(executionAuthority.repository, source) : '..';
    const snapshot = path.join(executionAuthority.snapshot_repository, relative);
    if (!allowed.has(name) || environment[name] !== source
      || !path.isAbsolute(source) || !relative || relative.startsWith('..')
      || path.isAbsolute(relative)) {
      throw new Error('safe-runner sandbox received an unsealed environment override');
    }
    const stat = fs.lstatSync(snapshot);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync.native(snapshot) !== snapshot) {
      throw new Error('safe-runner sandbox environment override has no physical snapshot input');
    }
  }
  return names;
}

export function validatedSealedGitIdentity(executionAuthority) {
  const graphdFixture = [
    'tests/fixtures/safe-runner-graphd-client.mjs', RUNTIME_BASELINE_ENTRYPOINT,
    REAL_REPOSITORY_ORACLE_ENTRYPOINT,
  ].includes(executionAuthority?.audited_entrypoint);
  const expected = executionAuthority?.git_executable_identity;
  if (!graphdFixture) {
    if (expected !== null && expected !== undefined) {
      throw new Error('unexpected sealed Git identity authority');
    }
    return null;
  }
  const trusted = trustedHostBinary('git');
  for (const field of ['path', 'dev', 'ino', 'uid', 'mode', 'size', 'digest']) {
    if (expected?.[field] !== trusted[field]) {
      throw new Error('sealed Git identity authority changed before sandbox launch');
    }
  }
  return Buffer.from(JSON.stringify(trusted)).toString('base64url');
}

export function validateSandboxExecutionAuthority({
  executionAuthority, authorityRoot, cwd, environment = process.env,
} = {}) {
  const invalidBinding = (binding) => {
    try {
      if (!path.isAbsolute(binding?.source || '') || !path.isAbsolute(binding?.target || '')
        || Object.hasOwn(binding || {}, 'alias') || binding.source !== binding.target
        || !fs.lstatSync(binding.source).isDirectory()
        || fs.lstatSync(binding.source).isSymbolicLink()
        || fs.realpathSync.native(binding.source) !== binding.source) return true;
      if (binding.kind === 'git-common-work-scratch') {
        const stat = fs.lstatSync(binding.source, { bigint: true });
        const snapshotGitCommon = executionAuthority.git_directory !== executionAuthority.git_common
          ? path.join(authorityRoot, 'git-authority', 'common')
          : path.join(executionAuthority.snapshot_repository, '.git');
        const snapshotTargetStat = fs.lstatSync(binding.snapshot_target, { bigint: true });
        return binding.source !== path.join(executionAuthority.git_common, 'lamina', 'work')
          || binding.snapshot_target !== path.join(snapshotGitCommon, 'lamina', 'work')
          || !snapshotTargetStat.isDirectory() || snapshotTargetStat.isSymbolicLink()
          || fs.realpathSync.native(binding.snapshot_target) !== binding.snapshot_target
          || String(snapshotTargetStat.dev) !== binding.snapshot_target_identity?.dev
          || String(snapshotTargetStat.ino) !== binding.snapshot_target_identity?.ino
          || Number(snapshotTargetStat.uid) !== binding.snapshot_target_identity?.uid
          || String(stat.dev) !== binding.source_identity?.dev
          || String(stat.ino) !== binding.source_identity?.ino
          || Number(stat.uid) !== binding.source_identity?.uid;
      }
      return binding.kind !== undefined
        || !path.isAbsolute(binding?.snapshot_target || '')
        || !binding.source.startsWith(`${executionAuthority.repository}${path.sep}`)
        || binding.snapshot_target !== path.join(executionAuthority.snapshot_repository,
          path.relative(executionAuthority.repository, binding.target))
        || !fs.lstatSync(binding.snapshot_target).isDirectory();
    } catch { return true; }
  };
  const invalidGitBinding = (binding) => {
    try {
      const expectedTarget = binding?.kind === 'git-common' ? executionAuthority.git_common
        : binding?.kind === 'git-worktree' ? executionAuthority.git_directory : null;
      return !expectedTarget || binding.target !== expectedTarget
        || !path.isAbsolute(binding.source || '') || !path.isAbsolute(binding.target || '')
        || !binding.source.startsWith(`${path.join(authorityRoot, 'git-authority')}${path.sep}`)
        || !fs.lstatSync(binding.source).isDirectory()
        || fs.lstatSync(binding.source).isSymbolicLink()
        || fs.realpathSync.native(binding.source) !== binding.source
        || !fs.lstatSync(binding.target).isDirectory()
        || fs.lstatSync(binding.target).isSymbolicLink()
        || fs.realpathSync.native(binding.target) !== binding.target;
    } catch { return true; }
  };
  const runtimeBaselineInvalid = (() => {
    if (executionAuthority?.audited_entrypoint !== RUNTIME_BASELINE_ENTRYPOINT) return false;
    const workerOverlay = path.join(
      executionAuthority.snapshot_repository,
      'packages/cli/observation-runtime/cocoindex-worker',
    );
    try {
      const worker = fs.lstatSync(workerOverlay);
      return executionAuthority.writable_bindings.length !== 0
        || !worker.isFile() || worker.isSymbolicLink() || (worker.mode & 0o111) === 0;
    } catch { return true; }
  })();
  if (!path.isAbsolute(executionAuthority?.repository || '')
    || !path.isAbsolute(executionAuthority?.snapshot_repository || '')
    || !path.isAbsolute(executionAuthority?.git_common || '')
    || !path.isAbsolute(executionAuthority?.git_directory || '')
    || !(path.resolve(cwd || '') === executionAuthority.repository
      || path.resolve(cwd || '').startsWith(`${executionAuthority.repository}${path.sep}`))
    || executionAuthority.snapshot_repository !== path.join(authorityRoot, 'repository')
    || !Array.isArray(executionAuthority?.writable_bindings)
    || executionAuthority.writable_bindings.some(invalidBinding)
    || !Array.isArray(executionAuthority?.git_readonly_bindings)
    || executionAuthority.git_readonly_bindings.some(invalidGitBinding)
    || runtimeBaselineInvalid) {
    throw new Error('safe-runner sandbox received an invalid execution authority');
  }
  let sealedGitIdentity;
  try { sealedGitIdentity = validatedSealedGitIdentity(executionAuthority); }
  catch { throw new Error('safe-runner sandbox received an invalid execution authority'); }
  return {
    preservedEnvironmentNames: validatedSealedEnvironmentNames({
      executionAuthority, environment,
    }),
    sealedGitIdentity,
  };
}

async function main() {
  const [bwrapExecutable, encodedBwrapIdentity, encodedExecutionAuthority, cwd, readyFile, releaseFile,
    temporaryDirectory, ...command] = process.argv.slice(2);
  let expectedBwrap = null;
  let executionAuthority = null;
  try { expectedBwrap = JSON.parse(Buffer.from(encodedBwrapIdentity || '', 'base64url').toString('utf8')); }
  catch {}
  try {
    executionAuthority = JSON.parse(Buffer.from(encodedExecutionAuthority || '', 'base64url').toString('utf8'));
  } catch {}
  const authorityRoot = path.join(path.dirname(temporaryDirectory || ''), 'execution-authority');
  let sandboxContract = null;
  try {
    sandboxContract = validateSandboxExecutionAuthority({
      executionAuthority, authorityRoot, cwd, environment: process.env,
    });
  } catch {}
  if (!bwrapExecutable || !path.isAbsolute(bwrapExecutable)
    || expectedBwrap?.path !== bwrapExecutable
    || !sandboxContract
    || !cwd || !readyFile || !releaseFile || !temporaryDirectory || command.length === 0
    || !process.env.LAMINA_SAFE_QUOTA_GATE || !process.env.LAMINA_SAFE_TEMP_MAX_BYTES) {
    process.stderr.write('safe-runner sandbox launcher received an incomplete contract\n');
    process.exit(125);
  }
  try { assertTrustedBinaryIdentity(expectedBwrap); }
  catch (error) {
    process.stderr.write(`safe-runner bwrap identity changed: ${error.code || error.message}\n`);
    process.exit(125);
  }
  const bwrapArguments = bubblewrapSandboxArguments({
    cwd, readyFile, releaseFile, temporaryDirectory, command,
    executionAuthority,
    sealedGitIdentity: sandboxContract.sealedGitIdentity,
    preservedEnvironmentNames: sandboxContract.preservedEnvironmentNames,
    environment: process.env,
    allowNetwork: process.env.LAMINA_SAFE_RUNNER_ALLOW_NETWORK === '1',
  });
  const bwrapEnvironment = sanitizedEnvironment(process.env);
  if (typeof process.execve === 'function') {
    try {
      process.execve(bwrapExecutable, [bwrapExecutable, ...bwrapArguments], bwrapEnvironment);
    } catch (error) {
      process.stderr.write(`safe-runner sandbox exec failed: ${error.code || error.message}\n`);
      process.exit(125);
    }
  }
  const child = spawn(bwrapExecutable, bwrapArguments, {
    stdio: 'inherit', env: bwrapEnvironment,
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      try { child.kill(signal); } catch {}
    });
  }
  child.once('error', (error) => {
    process.stderr.write(`safe-runner sandbox launch failed: ${error.code || error.message}\n`);
    process.exit(125);
  });
  child.once('close', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 125);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
