#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { adapterProbe, assertAdapterShape, boundedProbeFailure } from '../scripts/safe-runner/adapter.mjs';
import {
  authorizeBrokerRequest, createProofBroker, exactGraphdLaunchAuthorized,
} from '../scripts/safe-runner/broker.mjs';
import { DEFAULTS, GIB, MIB, SELF_TEST_CASE_IDS } from '../scripts/safe-runner/constants.mjs';
import { safeRunnerContext } from '../scripts/safe-runner/context.mjs';
import {
  deriveLimits,
  parseHostPageSize,
  validateLimitOverrides,
} from '../scripts/safe-runner/envelope.mjs';
import { ownedDirectoryIdentity, removeOwnedDirectory } from '../scripts/safe-runner/filesystem.mjs';
import {
  assertSystemctlSuccess,
  cgroupResolutionState,
  encodeExecutionAuthority,
  LinuxSystemdAdapter,
  parseSystemdMajor,
  SYSTEMCTL_CONTROL_TIMEOUT_MS,
  SYSTEMCTL_READBACK_TIMEOUT_MS,
  systemdAbsenceProof,
  systemdKillArguments,
  systemdScopeProperties,
} from '../scripts/safe-runner/linux-systemd.mjs';
import {
  classifyRemainingDescendants,
  registeredManagedGraphd,
} from '../scripts/safe-runner/managed-descendants.mjs';
import {
  authorizeManagedObjects, bindManagedObjects, lstatPresence, removeManagedObjects, reserveManagedObjects,
  sealManagedObjects,
} from '../scripts/safe-runner/managed-paths.mjs';
import {
  assertTrustedBinaryIdentity, infrastructureBinaries, isExecutionHookEnvironment,
  SAFE_INFRASTRUCTURE_PATH, sanitizedEnvironment, sanitizedPayloadEnvironment,
  trustedBinaryIdentity, trustedHostBinary,
} from '../scripts/safe-runner/infrastructure.mjs';
import { commandOwnership, preflightRun, writableWorktreeProof } from '../scripts/safe-runner/preflight.mjs';
import {
  existingLaminaProcesses, isLaminaProcessCommand, MAX_PROCESS_ENVIRONMENT_BYTES,
  processEnvironmentAttestation,
} from '../scripts/safe-runner/processes.mjs';
import {
  assertExecutionDependencyInodeBudget, assertExecutionSnapshot,
  assertGitObjectClosureBudget, auditedNpxPackage, dependencyPackageTarget,
  measureAuditedNpxPackageClosure, measureInstalledPackageClosure,
  measurePhysicalPackageTree, packageName, prepareExecutionSnapshot,
  readBoundedPackageManifest,
} from '../scripts/safe-runner/execution-snapshot.mjs';
import { auditedNpxCommand } from '../scripts/safe-runner/npx-authority.mjs';
import { repositoryOutputRefusal } from '../scripts/safe-runner/output-policy.mjs';
import {
  assertRetrievalModelManifest, retrievalQualificationAuthority,
  RETRIEVAL_MANIFEST_MAX_BYTES, RETRIEVAL_MODEL_MAX_BYTES,
  RETRIEVAL_TOKENIZER_MAX_BYTES, RETRIEVAL_WORKER_MAX_BYTES,
} from '../scripts/safe-runner/retrieval-authority.mjs';
import { redactCommand, redactEvidence, redactText } from '../scripts/safe-runner/redaction.mjs';
import {
  graphdEnvironment, graphdEnvironmentFor, stopIncompatibleServer,
} from '../packages/cli/lib/graph-runtime/client.mjs';
import { runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';
import {
  baseReport,
  finishReport,
  prepareReportAuthority,
  validateReport,
  writeReport,
  writeReportWithFallback,
} from '../scripts/safe-runner/report.mjs';
import {
  boundedDiagnosticText, closeOutputStreams, outcomeForStop, payloadRuntimeTimedOut, releaseFifo,
  recordChildTermination, temporaryQuotaHandshakeFailure,
} from '../scripts/safe-runner/runner.mjs';
import {
  bubblewrapSandboxArguments,
  CONTROL_ENVIRONMENT_NAMES,
  controlSocketMasks,
  validateSandboxExecutionAuthority,
  validatedSealedEnvironmentNames,
} from '../scripts/safe-runner/sandbox.mjs';
import { boundedCaseError, runAdversarialSelfTests } from '../scripts/safe-runner/self-test.mjs';
import { sealedSandboxGitProbe } from './fixtures/safe-runner-sealed-git-probe.mjs';
import {
  acquireConcurrencyLock,
  adoptConcurrencyLock,
  beginSafetyAttempt,
  bindExecutionSnapshotIdentity,
  checkPromotion,
  checkSafetyRetry,
  clearSafetyAttempt,
  frozenWorkloadIdentity,
  readAttestation,
  recordPromotion,
  recordSafetyLimit,
  productionLockDirectory,
  promotionCommandDigest,
  repositorySourceDigest,
  writeAttestation,
} from '../scripts/safe-runner/state.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-unit-'));
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(root, 'state');

function mountOperationIndex(args, option, source, target) {
  for (let index = 0; index <= args.length - 3; index += 1) {
    if (args[index] === option && args[index + 1] === source && args[index + 2] === target) {
      return index;
    }
  }
  return -1;
}

try {
  assert.equal(payloadRuntimeTimedOut(null, 60_000, 1_000), false,
    'controller preparation time must not consume the workload timeout');
  assert.equal(payloadRuntimeTimedOut(50_000, 50_999, 1_000), false);
  assert.equal(payloadRuntimeTimedOut(50_000, 51_000, 1_000), true,
    'the workload timeout must fire once payload runtime reaches its limit');
  assert.equal(payloadRuntimeTimedOut(Number.NaN, 51_000, 1_000), true,
    'invalid runtime timing state must fail closed');
  const liveQuotaTimeout = temporaryQuotaHandshakeFailure(null);
  assert.equal(liveQuotaTimeout.limit, 'temporary_quota_handshake');
  assert.equal(liveQuotaTimeout.error.code, 'LAMINA_SAFE_TEMP_QUOTA_UNPROVEN',
    'a live sandbox that never proves its tmpfs retains the generic quota refusal');
  const exitedSandbox = temporaryQuotaHandshakeFailure(
    { code: 125, signal: null },
    `bwrap: cannot prepare /tmp/private/repository ${'x'.repeat(1_200)}`,
  );
  assert.equal(exitedSandbox.limit, 'sandbox_launch');
  assert.equal(exitedSandbox.error.code, 'LAMINA_SAFE_SANDBOX_LAUNCH',
    'an exited sandbox wrapper must be classified as infrastructure, not quota readiness');
  assert.match(exitedSandbox.error.message, /status 125/);
  assert.doesNotMatch(exitedSandbox.error.message, /\/tmp\/private/);
  assert.ok(exitedSandbox.error.message.length <= 1_100,
    'sandbox launch diagnostics must remain bounded');

  for (const [script, launchMarker] of [
    ['scripts/safe-runner/gate.sh', 'LAMINA_SAFE_QUOTA_GATE='],
    ['scripts/safe-runner/quota-gate.sh', 'exec "$@"'],
  ]) {
    const source = fs.readFileSync(script, 'utf8');
    const open = source.indexOf('exec 3<> "$release_file"');
    const ready = source.indexOf('> "$ready_file"', open);
    const read = source.indexOf('IFS= read -r _release <&3', ready);
    const close = source.indexOf('exec 3>&-', read);
    const launch = source.indexOf(launchMarker, close);
    assert.ok(open >= 0 && open < ready && ready < read && read < close && close < launch,
      `${script} must open a live release reader before READY, then read and close it before launch`);
  }

  const ownedTemporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-owned-'));
  const ownedIdentity = ownedDirectoryIdentity(ownedTemporary);
  assert.equal(removeOwnedDirectory(ownedTemporary, 'lamina-safe-runner-', ownedIdentity), true);
  const nonClosingChild = {
    resumed: false, destroyed: false,
    resume() { this.resumed = true; }, destroy() { this.destroyed = true; },
  };
  const nonClosingSink = {
    closed: false, destroyed: false,
    once() {}, on() {},
    end() {}, destroy() { this.destroyed = true; },
  };
  const outputCloseStarted = Date.now();
  assert.equal(await closeOutputStreams([nonClosingChild], [nonClosingSink], 25), false);
  assert.ok(Date.now() - outputCloseStarted < 500);
  assert.equal(nonClosingChild.resumed, true);
  assert.equal(nonClosingChild.destroyed, true);
  assert.equal(nonClosingSink.destroyed, true);
  const readerlessFifo = path.join(root, 'readerless.fifo');
  assert.equal(spawnSync('/usr/bin/mkfifo', ['-m', '600', readerlessFifo]).status, 0);
  const fifoStarted = Date.now();
  await assert.rejects(() => releaseFifo(readerlessFifo, 25), /no live reader/);
  assert.ok(Date.now() - fifoStarted < 500,
    'a dead wrapper must not leave the controller blocked opening its release FIFO');
  const replacedTemporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-replaced-'));
  const replacedIdentity = ownedDirectoryIdentity(replacedTemporary);
  fs.renameSync(replacedTemporary, `${replacedTemporary}-original`);
  fs.mkdirSync(replacedTemporary);
  assert.throws(
    () => removeOwnedDirectory(replacedTemporary, 'lamina-safe-runner-', replacedIdentity),
    /ownership identity changed/,
  );
  assert.equal(fs.existsSync(replacedTemporary), true);
  fs.rmSync(replacedTemporary, { recursive: true });
  fs.rmSync(`${replacedTemporary}-original`, { recursive: true });
  const eightGib = deriveLimits({}, { totalMemoryBytes: 8 * GIB });
  assert.equal(eightGib.memory_max_bytes, 2 * GIB);
  assert.equal(eightGib.memory_high_bytes, Math.floor(1.6 * GIB));
  assert.equal(eightGib.memory_page_bytes, null);
  assert.equal(eightGib.pids_max, 64);
  assert.equal(eightGib.concurrency, 1);
  assert.ok(eightGib.minimum_free_disk_bytes >= 5 * GIB);
  for (const invalid of [NaN, Infinity, 0, -1, 1.5]) {
    assert.throws(() => validateLimitOverrides({ pidsMax: invalid }), /finite positive integer/);
  }
  assert.throws(() => deriveLimits({ unknownLimit: 1 }), /unknown safe-runner limit override/);
  const aligned192Mib = deriveLimits({
    memoryMaxBytes: 192 * MIB,
    memoryHighBytes: 160 * MIB,
  }, {
    totalMemoryBytes: 8 * GIB,
    pageSizeBytes: 4_096,
  });
  assert.equal(aligned192Mib.memory_max_bytes, 201_326_592);
  assert.equal(aligned192Mib.memory_high_bytes, 161_058_816);
  assert.equal(aligned192Mib.memory_page_bytes, 4_096);
  assert.ok(aligned192Mib.memory_high_bytes < aligned192Mib.memory_max_bytes);
  assert.equal(parseHostPageSize('KernelPageSize:        4 kB\n', {
    productionEnforcement: true,
  }), 4_096);
  assert.equal(parseHostPageSize('unavailable', {
    productionEnforcement: false,
  }), null);
  assert.throws(() => parseHostPageSize('unavailable', {
    productionEnforcement: true,
  }), (error) => error.code === 'LAMINA_SAFE_PAGE_SIZE_UNPROVEN');
  assert.throws(() => deriveLimits({ memoryMaxBytes: 4_096 }, {
    totalMemoryBytes: 8 * GIB,
    pageSizeBytes: 4_096,
  }), /lower than memoryMaxBytes/);

  const portableProbe = {
    id: 'portable-process-group-small-only',
    platform: 'darwin',
    production_enforcement: false,
    aggregate_memory: false,
    aggregate_pids: false,
    complete_descendant_ownership: false,
    controllers: [],
    reasons: ['unsupported'],
  };
  assert.equal(writableWorktreeProof('/').ok, false);
  assert.equal(writableWorktreeProof('/tmp').ok, false);
  assert.equal(writableWorktreeProof(process.cwd(), [path.join(process.cwd(), '.runner-authority')]).ok, false);
  const worktreeSymlink = path.join(root, 'worktree-link');
  fs.symlinkSync(process.cwd(), worktreeSymlink);
  assert.equal(writableWorktreeProof(worktreeSymlink, []).ok, false);
  for (const unsafeCwd of ['/', '/tmp']) {
    const unsafeWritable = preflightRun({
      tier: 'small',
      command: [process.execPath, path.resolve('tests/fixtures/safe-runner-adversary.mjs'), 'success'],
      cwd: unsafeCwd,
      adapterInfo: { ...portableProbe, id: 'unit-production', production_enforcement: true },
      injectedExistingProcesses: [],
    });
    assert.equal(unsafeWritable.ok, false);
    assert.match(unsafeWritable.reasons.join('\n'), /host-sensitive root/);
  }
  const masks = controlSocketMasks({
    uid: 1234,
    env: {
      DOCKER_HOST: 'unix:///custom/docker.sock',
      DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=/custom/system-bus,guid=abc',
      DBUS_SESSION_BUS_ADDRESS: 'unix:abstract=/cannot-bind',
    },
    directoryExists: (candidate) => candidate === '/run/user/1234',
    socketExists: (candidate) => [
      '/run/systemd/private', '/custom/docker.sock', '/custom/system-bus',
    ].includes(candidate),
  });
  assert.deepEqual(masks.hiddenDirectories, ['/run/user/1234']);
  assert.deepEqual(masks.sockets, [
    '/run/systemd/private', '/custom/system-bus', '/custom/docker.sock',
  ]);
  const sandboxArgs = bubblewrapSandboxArguments({
    cwd: root,
    readyFile: path.join(root, 'quota.ready'),
    releaseFile: path.join(root, 'quota.release'),
    temporaryDirectory: path.join(root, 'payload-tmp'),
    command: ['node', 'tiny.mjs'],
    masks,
  });
  assert.ok(sandboxArgs.includes('/run/user/1234'));
  assert.ok(sandboxArgs.includes('/run/systemd/private'));
  assert.ok(sandboxArgs.includes('/custom/docker.sock'));
  assert.ok(sandboxArgs.includes('--unshare-pid'));
  assert.ok(sandboxArgs.includes('--unshare-net'));
  for (const name of CONTROL_ENVIRONMENT_NAMES) {
    const index = sandboxArgs.indexOf(name);
    assert.equal(sandboxArgs[index - 1], '--unsetenv');
  }
  const authorityArgs = bubblewrapSandboxArguments({
    cwd: root,
    readyFile: path.join(root, 'quota.ready'),
    releaseFile: path.join(root, 'quota.release'),
    temporaryDirectory: path.join(root, 'payload-tmp'),
    command: ['node', 'tiny.mjs'], masks: { hiddenDirectories: [], sockets: [] },
    executionAuthority: {
      repository: root,
      snapshot_repository: path.join(root, 'execution-authority', 'repository'),
      writable_bindings: [{
        source: path.join(root, 'dist'), target: path.join(root, 'dist'),
      }],
    },
  });
  const repositoryMount = authorityArgs.indexOf(path.join(root, 'execution-authority', 'repository'));
  assert.equal(authorityArgs[repositoryMount - 1], '--ro-bind');
  assert.ok(mountOperationIndex(authorityArgs, '--bind', path.join(root, 'dist'),
    path.join(root, 'dist')) > repositoryMount,
  'the exact writable source must bind directly only after the logical cwd is frozen');
  for (const name of [
    'BASH_FUNC_payload%%', 'LD_DEBUG_OUTPUT', 'NODE_V8_COVERAGE',
    'NODE_COMPILE_CACHE', 'NODE_REDIRECT_WARNINGS', 'DYLD_INSERT_LIBRARIES',
    'LAMINA_SAFE_GIT_IDENTITY',
    'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  ]) assert.equal(isExecutionHookEnvironment(name), true, name);
  const poison = sanitizedEnvironment({
    SAFE_VALUE: 'kept', LD_DEBUG_OUTPUT: '/tmp/ld', NODE_V8_COVERAGE: '/tmp/v8',
    NODE_COMPILE_CACHE: '/tmp/cache', NODE_REDIRECT_WARNINGS: '/tmp/warnings',
    GIT_DIR: '/tmp/live-git', GIT_CONFIG_NOSYSTEM: '0', GIT_CONFIG_GLOBAL: '/tmp/config',
    'BASH_FUNC_payload%%': '() { touch /tmp/pwned; }',
    LAMINA_SAFE_GIT_IDENTITY: 'forged',
  });
  assert.equal(poison.SAFE_VALUE, 'kept');
  for (const name of [
    'LD_DEBUG_OUTPUT', 'NODE_V8_COVERAGE', 'NODE_COMPILE_CACHE',
    'NODE_REDIRECT_WARNINGS', 'BASH_FUNC_payload%%',
    'LAMINA_SAFE_GIT_IDENTITY',
  ]) assert.equal(poison[name], undefined, name);
  assert.equal(poison.GIT_DIR, undefined);
  assert.equal(poison.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(poison.GIT_CONFIG_GLOBAL, process.platform === 'win32' ? 'NUL' : '/dev/null');
  assert.equal(sanitizedEnvironment(poison).GIT_CONFIG_NOSYSTEM, '1',
    'repeated sanitizer layers must restore safe Git config overrides');
  const semanticPoison = {
    LAMINA_TEST_RETRIEVAL_EMBEDDER: 'deterministic',
    LAMINA_TEST_ARBITRARY_BYPASS: '1',
    LAMINA_RETRIEVAL_MODEL_PATH: '/host/model',
    LAMINA_RETRIEVAL_TOKENIZER_PATH: '/host/tokenizer',
    LAMINA_UV_BINARY: '/host/uv',
    LAMINA_STANDALONE: '/host/standalone',
    LAMINA_WORKER: '/host/worker',
    LAMINA_MODEL: '/host/model',
    LAMINA_BINARY: '/host/binary',
  };
  const retrievalPayloadEnvironment = sanitizedPayloadEnvironment({
    sources: [semanticPoison], mode: 'run',
    auditedEntrypoint: 'benchmarks/retrieval-v1/benchmark.mjs',
  });
  for (const name of Object.keys(semanticPoison)) {
    assert.equal(retrievalPayloadEnvironment[name], undefined,
      `retrieval payload must strip inherited semantic override ${name}`);
  }
  const selfTestPayloadEnvironment = sanitizedPayloadEnvironment({
    sources: [semanticPoison], mode: 'self-test',
    auditedEntrypoint: 'tests/fixtures/safe-runner-adversary.mjs',
  });
  assert.equal(selfTestPayloadEnvironment.LAMINA_TEST_ARBITRARY_BYPASS, '1',
    'deliberately tiny self-tests must retain their fixture controls');
  const sealedNativeEnvironment = sanitizedPayloadEnvironment({
    sources: [semanticPoison], mode: 'run',
    auditedEntrypoint: 'tests/retrieval_native_index_test.mjs',
    sealedOverrides: {
      LAMINA_RETRIEVAL_TOKENIZER_PATH: '/sealed/tokenizer',
      LAMINA_RETRIEVAL_FTS_EXTENSION_PATH: '/sealed/fts',
      LAMINA_RETRIEVAL_VECTOR_EXTENSION_PATH: '/sealed/vector',
    },
  });
  assert.equal(sealedNativeEnvironment.LAMINA_RETRIEVAL_TOKENIZER_PATH, '/sealed/tokenizer');
  assert.equal(sealedNativeEnvironment.LAMINA_RETRIEVAL_FTS_EXTENSION_PATH, '/sealed/fts');
  assert.equal(sealedNativeEnvironment.LAMINA_RETRIEVAL_VECTOR_EXTENSION_PATH, '/sealed/vector');
  assert.equal(sealedNativeEnvironment.LAMINA_MODEL, undefined,
    'native-index payload must not recover unsealed model shorthand');
  const sealedSmokeEnvironment = sanitizedPayloadEnvironment({
    sources: [semanticPoison], mode: 'run',
    auditedEntrypoint: 'tests/cli_binary_smoke_test.mjs',
    sealedOverrides: {
      LAMINA_BINARY: '/sealed/binary',
      LAMINA_WORKER: '/sealed/worker',
      LAMINA_MODEL: '/sealed/model',
    },
  });
  assert.deepEqual([
    sealedSmokeEnvironment.LAMINA_BINARY,
    sealedSmokeEnvironment.LAMINA_WORKER,
    sealedSmokeEnvironment.LAMINA_MODEL,
  ], ['/sealed/binary', '/sealed/worker', '/sealed/model']);
  assert.equal(sealedSmokeEnvironment.LAMINA_RETRIEVAL_MODEL_PATH, undefined);
  const canonicalModelManifest = JSON.parse(fs.readFileSync(
    'packages/cli/retrieval-model-manifest.json', 'utf8',
  ));
  assert.ok(canonicalModelManifest.bytes > 64 * MIB,
    'canonical retrieval model must exercise the dedicated identity path above the generic cap');
  assert.equal(assertRetrievalModelManifest({
    model: { size: canonicalModelManifest.bytes, digest: canonicalModelManifest.sha256 },
    modelDigest: canonicalModelManifest.sha256,
    manifest: canonicalModelManifest,
  }), true, 'manifest identity validation must accept canonical large-model metadata without allocation');
  assert.throws(() => assertRetrievalModelManifest({
    model: { size: canonicalModelManifest.bytes - 1, digest: canonicalModelManifest.sha256 },
    modelDigest: canonicalModelManifest.sha256,
    manifest: canonicalModelManifest,
  }), /model size does not match/);
  assert.throws(() => assertRetrievalModelManifest({
    model: { size: canonicalModelManifest.bytes, digest: '0'.repeat(64) },
    modelDigest: canonicalModelManifest.sha256,
    manifest: canonicalModelManifest,
  }), /does not match the physical --model bytes/);
  const previousGraphdNodeOptions = process.env.NODE_OPTIONS;
  const previousGraphdSafeValue = process.env.LAMINA_GRAPH_ENV_TEST;
  process.env.NODE_OPTIONS = '--require=/tmp/hostile-graphd-loader.cjs';
  process.env.LAMINA_GRAPH_ENV_TEST = 'kept';
  try {
    const graphdEnv = graphdEnvironment();
    assert.equal(graphdEnv.NODE_OPTIONS, undefined);
    assert.equal(graphdEnv.LAMINA_GRAPH_ENV_TEST, 'kept');
  } finally {
    if (previousGraphdNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousGraphdNodeOptions;
    if (previousGraphdSafeValue === undefined) delete process.env.LAMINA_GRAPH_ENV_TEST;
    else process.env.LAMINA_GRAPH_ENV_TEST = previousGraphdSafeValue;
  }
  const supervisedGraphdEnv = graphdEnvironmentFor({
    PATH: '/usr/bin',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    LAMINA_SAFE_GIT_IDENTITY: 'forged-sealed-identity',
    LAMINA_SAFE_RUNNER_BROKER: '/run/lamina-safe/broker.sock',
    LAMINA_SAFE_GRAPHD_RESERVATION: 'sealed-reservation',
  }, { platform: 'linux' });
  assert.equal(supervisedGraphdEnv.GIT_CONFIG_NOSYSTEM, undefined);
  assert.equal(supervisedGraphdEnv.GIT_CONFIG_GLOBAL, undefined);
  assert.equal(supervisedGraphdEnv.LAMINA_SAFE_GIT_IDENTITY, undefined);
  assert.equal(supervisedGraphdEnv.LAMINA_SAFE_RUNNER_BROKER,
    '/run/lamina-safe/broker.sock');
  assert.equal(supervisedGraphdEnv.LAMINA_SAFE_GRAPHD_RESERVATION, 'sealed-reservation');
  for (const inherited of [
    { Path: 'C:\\Program Files\\Git\\cmd;C:\\Windows\\System32' },
    { PATH: 'C:\\Program Files\\Git\\cmd;C:\\Windows\\System32' },
  ]) {
    const graphdEnv = graphdEnvironmentFor({
      ...inherited,
      node_options: '--require=C:\\hostile.cjs',
      gIt_Config_Global: 'C:\\hostile.gitconfig',
      LAMINA_GRAPH_ENV_TEST: 'kept',
    }, { platform: 'win32', extensionDirectory: 'C:\\Lamina\\extensions' });
    const pathEntries = Object.entries(graphdEnv)
      .filter(([name]) => name.toLowerCase() === 'path');
    assert.deepEqual(pathEntries, [[
      'Path',
      'C:\\Lamina\\extensions;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32',
    ]]);
    assert.equal(graphdEnv.node_options, undefined);
    assert.equal(graphdEnv.gIt_Config_Global, undefined);
    assert.equal(graphdEnv.LAMINA_GRAPH_ENV_TEST, 'kept');
  }
  const defaultWindowsGraphdEnv = graphdEnvironmentFor(
    { Path: 'C:\\Program Files\\Git\\cmd' }, { platform: 'win32' },
  );
  assert.equal(path.basename(defaultWindowsGraphdEnv.Path.split(';')[0]), 'extensions',
    'default Windows graphd PATH must prepend the retrieval extension directory itself');
  assert.equal(defaultWindowsGraphdEnv.Path.split(';').at(-1), 'C:\\Program Files\\Git\\cmd');
  const cleanProcessEnvironment = processEnvironmentAttestation(
    Buffer.from('PATH=/usr/bin\0LAMINA_SAFE_RUNNER=1\0'),
  );
  assert.deepEqual(cleanProcessEnvironment.execution_hooks, []);
  assert.deepEqual(processEnvironmentAttestation(
    Buffer.from('PATH=/usr/bin\0NODE_OPTIONS=--require=/tmp/loader.cjs\0'),
  ).execution_hooks, ['NODE_OPTIONS']);
  assert.deepEqual(processEnvironmentAttestation(
    Buffer.from('NODE_PATH=/tmp/modules\0NODE_LOADER=/tmp/loader.mjs\0'),
  ).execution_hooks, ['NODE_LOADER', 'NODE_PATH']);
  assert.equal(processEnvironmentAttestation(Buffer.from('PATH=/usr/bin')).malformed, true,
    'a non-terminated proc environment must fail closed as malformed');
  assert.equal(processEnvironmentAttestation(Buffer.alloc(
    MAX_PROCESS_ENVIRONMENT_BYTES + 1,
  )).bounded, false, 'an oversized proc environment must fail closed');

  const binaryCopy = path.join(root, 'trusted-bwrap-copy');
  fs.copyFileSync(infrastructureBinaries().bwrap, binaryCopy);
  fs.chmodSync(binaryCopy, 0o755);
  const binaryIdentity = trustedBinaryIdentity(binaryCopy);
  assert.equal(assertTrustedBinaryIdentity(binaryIdentity).path, binaryCopy);
  fs.appendFileSync(binaryCopy, 'changed');
  assert.throws(() => assertTrustedBinaryIdentity(binaryIdentity), /digest mismatch|identity changed/);
  assert.equal(adapterProbe('darwin').production_enforcement, false);
  assert.equal(adapterProbe('win32').id, 'portable-process-group-small-only');
  assert.equal(
    boundedProbeFailure({ status: 1, signal: null, stderr: `denied\n${'x'.repeat(1_000)}` }),
    `exit=1; output=${`denied ${'x'.repeat(1_000)}`.slice(0, 500)}`,
  );
  const ordinarySmall = preflightRun({
    tier: 'small', command: ['node', '-e', ''], cwd: root, adapterInfo: portableProbe,
  });
  assert.equal(ordinarySmall.ok, false);
  assert.match(ordinarySmall.reasons.join('\n'), /only the built-in deliberately tiny self-test/);
  const portableSelfTest = preflightRun({
    tier: 'small',
    command: [process.execPath, path.join(process.cwd(), 'tests/fixtures/safe-runner-adversary.mjs'), 'success'],
    cwd: root,
    adapterInfo: portableProbe,
    mode: 'self-test',
    selfTestCaseId: 'normal_cleanup',
    overrides: {
      memoryMaxBytes: 64 * MIB,
      timeoutMs: 1_000,
      pidsMax: 8,
      outputMaxBytes: 64 * 1024,
      tempMaxBytes: 1 * MIB,
    },
  });
  assert.equal(portableSelfTest.deliberately_tiny_self_test, true);
  assert.equal(portableSelfTest.portable_self_test_allowed, true);
  assert.doesNotMatch(portableSelfTest.reasons.join('\n'), /only the built-in deliberately tiny self-test/);
  const unsafePortable = preflightRun({
    tier: 'small',
    command: [process.execPath, path.join(process.cwd(), 'tests/fixtures/safe-runner-adversary.mjs'), 'detached-child'],
    cwd: root,
    adapterInfo: portableProbe,
    mode: 'self-test',
    selfTestCaseId: 'detached_descendant',
    overrides: {
      memoryMaxBytes: 64 * MIB, timeoutMs: 1_000, pidsMax: 8,
      outputMaxBytes: 64 * 1024, tempMaxBytes: 1 * MIB,
    },
  });
  assert.equal(unsafePortable.ok, false);
  assert.equal(unsafePortable.portable_self_test_allowed, false);
  const productionPortable = preflightRun({
    tier: 'medium', command: ['node', '-e', ''], cwd: root, adapterInfo: portableProbe,
  });
  assert.equal(productionPortable.ok, false);
  assert.match(productionPortable.reasons.join('\n'), /medium\/large execution requires Linux/);
  const portableQualification = await runAdversarialSelfTests({ cwd: root, probe: portableProbe });
  assert.equal(portableQualification.passed, false);
  assert.equal(portableQualification.qualified_for_production_tiers, false);
  assert.match(portableQualification.refusal.message, /requires Linux user-systemd cgroup-v2/);
  assert.equal(portableQualification.cases.length, SELF_TEST_CASE_IDS.length);
  assert.ok(portableQualification.cases.every((item) => item.skipped === true));
  assert.equal(commandOwnership(['harbor', 'run']).proven, false);
  assert.equal(commandOwnership(['/bin/sh', '-c', 'docker run image']).proven, false);
  assert.equal(commandOwnership(['npm', 'exec', '--', 'podman', 'run']).proven, false);
  const wrapper = path.join(root, 'wrapper.sh');
  fs.writeFileSync(wrapper, '#!/bin/sh\nexec harbor run "$@"\n');
  assert.equal(commandOwnership(['/bin/sh', wrapper], root).proven, false);
  assert.equal(commandOwnership(['node', 'benchmarks/lb6/pilot/scripts/run-three-arm.mjs']).proven, false);
  assert.equal(commandOwnership(['node', 'tests/tiny.mjs']).proven, false);
  const arbitraryWrapper = path.join(root, 'arbitrary-wrapper.mjs');
  fs.writeFileSync(arbitraryWrapper, 'import { spawn } from "node:child_process"; spawn("systemd-run", []);\n');
  assert.equal(commandOwnership([process.execPath, arbitraryWrapper], root).proven, false);
  assert.match(commandOwnership([process.execPath, arbitraryWrapper], root).reason, /explicitly audited/);
  assert.equal(commandOwnership([
    process.execPath, path.resolve('evals/scripts/vendor-plane-fixture.mjs'),
  ], root).proven, true);
  assert.equal(commandOwnership([
    process.execPath, path.resolve('evals/scripts/vendor-plane-fixture.mjs'),
  ], root).network_access, 'audited-required');
  assert.equal(commandOwnership([
    process.execPath, path.resolve('tests/fixtures/safe-runner-adversary.mjs'), 'success',
  ], root).network_access, 'isolated');
  const unsealedRetrievalRuntime = preflightRun({
    tier: 'small', cwd: process.cwd(), adapterInfo: portableProbe,
    command: [process.execPath, path.resolve('benchmarks/retrieval-v1/benchmark.mjs'), '--evaluate'],
  });
  assert.match(unsealedRetrievalRuntime.reasons.join('\n'),
    /retrieval qualification requires exactly one --worker <value>/);
  const retrievalEntrypoint = path.resolve('benchmarks/retrieval-v1/benchmark.mjs');
  const retrievalWorker = path.resolve('packages/cli/bin/lamina.mjs');
  const retrievalModel = path.resolve('package.json');
  const retrievalTokenizer = path.resolve('pnpm-lock.yaml');
  const canonicalModelDigest = canonicalModelManifest.sha256;
  const retrievalCommand = [
    process.execPath, retrievalEntrypoint, '--evaluate',
    '--worker', retrievalWorker,
    '--model', retrievalModel,
    '--tokenizer', retrievalTokenizer,
    '--model-digest', canonicalModelDigest,
  ];
  const assertRetrievalRefusal = (label, command, pattern, environment = {}) => {
    const result = preflightRun({
      tier: 'small', cwd: process.cwd(), adapterInfo: portableProbe,
      command, injectedExistingProcesses: [],
    });
    assert.match(result.reasons.join('\n'), pattern, `${label} preflight`);
    const temporaryDirectory = fs.mkdtempSync(path.join(root, 'retrieval-refusal-'));
    try {
      assert.throws(() => prepareExecutionSnapshot({
        cwd: process.cwd(), command, temporaryDirectory, environment,
      }), pattern, `${label} direct snapshot`);
      assert.equal(fs.existsSync(path.join(temporaryDirectory, 'execution-authority')), false,
        `${label} must refuse before snapshot authority creation`);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  };
  assertRetrievalRefusal('both qualification modes',
    [...retrievalCommand, '--calibrate'],
    /requires exactly one of --evaluate or --calibrate/);
  assertRetrievalRefusal('unknown qualification flag',
    [...retrievalCommand, '--unknown'],
    /unknown flag or positional token/);
  assertRetrievalRefusal('unknown qualification positional',
    [...retrievalCommand, 'positional-junk'],
    /unknown flag or positional token/);
  assertRetrievalRefusal('unknown-only benchmark argument', [
    process.execPath, retrievalEntrypoint, '--unknown',
  ], /requires exactly one of --evaluate or --calibrate/);
  assertRetrievalRefusal('qualification flags without a mode',
    retrievalCommand.filter((value) => value !== '--evaluate'),
    /requires exactly one of --evaluate or --calibrate/);
  for (const flag of ['--worker', '--model', '--tokenizer', '--model-digest']) {
    const index = retrievalCommand.indexOf(flag);
    assertRetrievalRefusal(`missing ${flag}`,
      retrievalCommand.filter((_value, item) => item !== index && item !== index + 1),
      new RegExp(`requires exactly one ${flag.replaceAll('-', '\\-')} <value>`));
    assertRetrievalRefusal(`duplicate ${flag}`,
      [...retrievalCommand, flag, retrievalCommand[index + 1]],
      new RegExp(`requires exactly one ${flag.replaceAll('-', '\\-')} <value>`));
  }
  assertRetrievalRefusal('equals-form flag', [
    ...retrievalCommand.slice(0, retrievalCommand.indexOf('--worker')),
    `--worker=${retrievalWorker}`,
    ...retrievalCommand.slice(retrievalCommand.indexOf('--worker') + 2),
  ], /requires exactly one --worker <value>/);
  assertRetrievalRefusal('flag-like missing value', [
    ...retrievalCommand.slice(0, retrievalCommand.indexOf('--worker') + 1),
    ...retrievalCommand.slice(retrievalCommand.indexOf('--worker') + 2),
  ], /requires exactly one --worker <value>/);
  const externalRetrievalInput = path.join(root, 'external-retrieval-input');
  fs.writeFileSync(externalRetrievalInput, 'external');
  for (const flag of ['--worker', '--model', '--tokenizer']) {
    const command = [...retrievalCommand];
    command[command.indexOf(flag) + 1] = externalRetrievalInput;
    assertRetrievalRefusal(`external ${flag}`, command,
      new RegExp(`retrieval ${flag.replaceAll('-', '\\-')} must name a physical file inside the repository`));
  }
  fs.mkdirSync(runtimePaths(process.cwd()).work, { recursive: true, mode: 0o700 });
  const invalidRetrievalRoot = fs.mkdtempSync(path.join(
    runtimePaths(process.cwd()).work, 'retrieval-authority-',
  ));
  try {
    const leafSymlink = path.join(invalidRetrievalRoot, 'leaf-symlink');
    fs.symlinkSync(retrievalTokenizer, leafSymlink);
    const symlinkTokenizerCommand = [...retrievalCommand];
    symlinkTokenizerCommand[symlinkTokenizerCommand.indexOf('--tokenizer') + 1] = leafSymlink;
    assertRetrievalRefusal('symlink leaf', symlinkTokenizerCommand,
      /retrieval --tokenizer must name a physical file inside the repository/);
    const physicalAncestor = path.join(invalidRetrievalRoot, 'physical-ancestor');
    fs.mkdirSync(physicalAncestor);
    fs.copyFileSync(retrievalTokenizer, path.join(physicalAncestor, 'tokenizer'));
    const ancestorSymlink = path.join(invalidRetrievalRoot, 'ancestor-symlink');
    fs.symlinkSync(physicalAncestor, ancestorSymlink, 'dir');
    const symlinkAncestorCommand = [...retrievalCommand];
    symlinkAncestorCommand[symlinkAncestorCommand.indexOf('--tokenizer') + 1]
      = path.join(ancestorSymlink, 'tokenizer');
    assertRetrievalRefusal('symlink ancestor', symlinkAncestorCommand,
      /retrieval --tokenizer must name a physical file inside the repository/);
    for (const [flag, source] of [
      ['--worker', retrievalWorker], ['--model', retrievalModel],
      ['--tokenizer', retrievalTokenizer],
    ]) {
      const hardlink = path.join(invalidRetrievalRoot, `hardlink-${flag.slice(2)}`);
      fs.linkSync(source, hardlink);
      try {
        const hardlinkCommand = [...retrievalCommand];
        hardlinkCommand[hardlinkCommand.indexOf(flag) + 1] = hardlink;
        assertRetrievalRefusal(`hardlinked ${flag}`, hardlinkCommand,
          new RegExp(`retrieval ${flag.replaceAll('-', '\\-')} must name a physical file inside the repository`));
      } finally {
        fs.unlinkSync(hardlink);
      }
    }
  } finally {
    fs.rmSync(invalidRetrievalRoot, { recursive: true, force: true });
  }
  const nonExecutableWorker = [...retrievalCommand];
  nonExecutableWorker[nonExecutableWorker.indexOf('--worker') + 1] = retrievalModel;
  assertRetrievalRefusal('non-executable worker', nonExecutableWorker,
    /retrieval --worker must name an executable physical file inside the repository/);
  const uppercaseDigest = [...retrievalCommand];
  uppercaseDigest[uppercaseDigest.indexOf('--model-digest') + 1] = canonicalModelDigest.toUpperCase();
  assertRetrievalRefusal('uppercase digest', uppercaseDigest,
    /normalized lowercase 64-hex SHA-256/);
  const wrongDigest = [...retrievalCommand];
  wrongDigest[wrongDigest.indexOf('--model-digest') + 1] = '0'.repeat(64);
  assertRetrievalRefusal('manifest digest mismatch', wrongDigest,
    /does not match the canonical model manifest/);
  assertRetrievalRefusal('manifest size mismatch', retrievalCommand,
    /model size does not match the canonical model manifest/);
  assertRetrievalRefusal('environment-only retrieval inputs', [
    process.execPath, retrievalEntrypoint, '--evaluate',
  ], /requires exactly one --worker <value>/, {
    LAMINA_WORKER: retrievalWorker,
    LAMINA_MODEL: retrievalModel,
    LAMINA_RETRIEVAL_TOKENIZER_PATH: retrievalTokenizer,
    LAMINA_RETRIEVAL_MODEL_DIGEST: canonicalModelDigest,
  });
  const fixtureTierReason = 'safe-runner scratch fixtures are deliberately tiny and require --tier small';
  const fixtureScratch = path.join(runtimePaths(process.cwd()).work, 'tier-contract');
  for (const [entrypoint, output] of [
    ['tests/fixtures/safe-runner-graphd-client.mjs', fixtureScratch],
    ['tests/fixtures/safe-runner-mutable.mjs', path.join(fixtureScratch, 'result.txt')],
  ]) {
    for (const tier of ['medium', 'large']) {
      const refusedFixtureTier = preflightRun({
        tier, cwd: process.cwd(), adapterInfo: portableProbe,
        command: [process.execPath, path.resolve(entrypoint), output],
        injectedExistingProcesses: [],
      });
      assert.ok(refusedFixtureTier.reasons.includes(fixtureTierReason),
        `${entrypoint} must refuse ${tier} before snapshot preparation`);
    }
    const smallFixtureTier = preflightRun({
      tier: 'small', cwd: process.cwd(), adapterInfo: portableProbe,
      command: [process.execPath, path.resolve(entrypoint), output],
      injectedExistingProcesses: [],
    });
    assert.equal(smallFixtureTier.reasons.includes(fixtureTierReason), false,
      `${entrypoint} must retain its deliberately tiny small-tier path`);
  }
  const unsealedEvalRuntime = preflightRun({
    tier: 'small', cwd: process.cwd(), adapterInfo: portableProbe,
    command: [process.execPath, path.resolve('evals/scripts/run-suite.mjs'), '--smoke'],
  });
  assert.ok(unsealedEvalRuntime.reasons.includes(
    repositoryOutputRefusal('evals/scripts/run-suite.mjs')),
  'eval-suite preflight must return the exact owning-leaf runtime/output refusal');
  const indirectUnsealedEvalRuntime = preflightRun({
    tier: 'small', cwd: process.cwd(), adapterInfo: portableProbe,
    command: [process.execPath, path.resolve('evals/scripts/run-reference-matrix.mjs')],
  });
  assert.ok(indirectUnsealedEvalRuntime.reasons.includes(
    repositoryOutputRefusal('evals/scripts/run-reference-matrix.mjs')),
  'reference-matrix preflight must return the exact owning-leaf runtime/output refusal');
  for (const entrypoint of [
    'scripts/build-standalone-cli.mjs', 'scripts/fetch-retrieval-model.mjs',
    'scripts/prepare-retrieval-assets.mjs', 'tests/retrieval_native_index_test.mjs',
    'tests/cli_binary_smoke_test.mjs',
  ]) {
    assert.equal(commandOwnership([process.execPath, path.resolve(entrypoint)], root).proven, true,
      `${entrypoint} must remain available through the canonical wrapper`);
  }
  assert.equal(commandOwnership([
    process.execPath, '--require', path.resolve('evals/scripts/vendor-plane-fixture.mjs'),
    '--eval', 'require("node:child_process").spawn("systemd-run", [])',
  ], root).proven, false);
  assert.equal(commandOwnership([
    'npx', '-p', 'promptfoo', 'node', arbitraryWrapper,
  ], root).proven, false);
  const promptfooArgv = [
    'npx', 'promptfoo', 'eval', '-c', 'evals/promptfoo/lamina-redteam.yaml',
    '--max-concurrency', '1',
  ];
  const agentSkillsArgv = [
    'npx', 'agent-skills-eval', '--config', 'evals/agent-skills-eval.yaml',
  ];
  assert.equal(commandOwnership(promptfooArgv, process.cwd()).proven, true,
    'only the exact Promptfoo package-script argv with its physical config is audited');
  assert.equal(commandOwnership(promptfooArgv, process.cwd()).npx_authority.launch_admitted,
    false, 'recognized Promptfoo metadata authority must remain distinct from launch admission');
  const refusedPromptfooPreflight = preflightRun({
    tier: 'small', command: promptfooArgv, cwd: process.cwd(), adapterInfo: portableProbe,
    injectedExistingProcesses: [],
  });
  assert.equal(refusedPromptfooPreflight.ownership.proven, true);
  assert.match(refusedPromptfooPreflight.reasons.join('\n'),
    /Promptfoo launch authority is budget-refused.*bounded command-specific dependency artifact/);
  assert.equal(commandOwnership(agentSkillsArgv, process.cwd()).proven, true,
    'only the exact agent-skills package-script argv with its physical config is audited');
  assert.equal(commandOwnership(agentSkillsArgv, process.cwd()).npx_authority.launch_admitted,
    false, 'recognized agent-skills metadata authority must remain distinct from launch admission');
  const refusedAgentSkillsPreflight = preflightRun({
    tier: 'small', command: agentSkillsArgv, cwd: process.cwd(), adapterInfo: portableProbe,
    injectedExistingProcesses: [],
  });
  assert.equal(refusedAgentSkillsPreflight.ownership.proven, true);
  assert.ok(refusedAgentSkillsPreflight.reasons.includes(
    commandOwnership(agentSkillsArgv, process.cwd()).npx_authority.launch_refusal),
  'agent-skills preflight must return its exact owning-leaf input/output refusal');
  for (const arbitraryNpx of [
    ['npx', 'promptfoo', '--version'],
    promptfooArgv.slice(0, -2),
    [...promptfooArgv, '--verbose'],
    ['npx', '--yes', ...promptfooArgv.slice(1)],
    ['npx', 'agent-skills-eval', '--config', 'evals/agent-skills-eval.yaml', '--verbose'],
  ]) assert.equal(commandOwnership(arbitraryNpx, process.cwd()).proven, false);
  const substitutedBin = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-bin-'));
  const substitutedNode = path.join(substitutedBin, 'node');
  const substitutedNpx = path.join(substitutedBin, 'npx');
  fs.symlinkSync('/bin/sh', substitutedNode);
  fs.symlinkSync(process.execPath, substitutedNpx);
  assert.equal(commandOwnership([
    substitutedNode, path.resolve('evals/scripts/vendor-plane-fixture.mjs'),
  ], root).proven, false);
  assert.equal(commandOwnership([
    substitutedNpx, 'promptfoo', 'eval', '-c', 'evals/promptfoo/lamina-redteam.yaml',
  ], root).proven, false);
  const allowedSymlink = path.join(root, 'vendor-plane-link.mjs');
  fs.symlinkSync(path.resolve('evals/scripts/vendor-plane-fixture.mjs'), allowedSymlink);
  assert.equal(commandOwnership([process.execPath, allowedSymlink], root).proven, false);
  assert.deepEqual(redactCommand(['tool', '--token', 'secret-value', '--api-key=abc']), [
    'tool', '--token', '[REDACTED]', '--api-key=[REDACTED]',
  ]);
  assert.equal(redactText('Authorization: Bearer abc.def'), 'Authorization: Bearer [REDACTED]');
  const recursivelyRedacted = redactEvidence({
    post_lock_existing_lamina_processes: [{
      command: 'tool --token process-secret',
      nested: { api_key: 'nested-secret' },
    }],
    detached_descendant_observation: {
      unmanaged: [{ command: 'Authorization: Bearer descendant-secret' }],
    },
  });
  assert.doesNotMatch(JSON.stringify(recursivelyRedacted), /process-secret|nested-secret|descendant-secret/);
  const externalSmall = preflightRun({
    tier: 'small', command: ['docker', 'run', 'tiny'], cwd: root,
  });
  assert.equal(externalSmall.ok, false);
  assert.match(externalSmall.reasons.join('\n'), /external daemon/);

  const report = finishReport(baseReport({
    tier: 'small', command: ['node', '-e', ''], cwd: root,
  }), Date.now());
  report.report_file = path.join(root, 'report.json');
  report.outcome = 'success';
  report.adapter = portableProbe;
  report.limits = eightGib;
  report.preflight = { ok: true };
  report.samples.push({
    elapsed_ms: 0,
    aggregate_rss_bytes: 0,
    cgroup_memory_bytes: 0,
    pids: 0,
    temporary_bytes: 0,
    temporary_inodes: 0,
  });
  report.termination.reason = 'completed';
  report.cleanup.attempted = true;
  report.cleanup.descendants_remaining = [];
  report.cleanup.scope_removed = true;
  report.cleanup.temporary_directory_removed = true;
  const reportValidation = validateReport(report);
  assert.equal(reportValidation.valid, true, reportValidation.errors.join('; '));
  for (const { childEnded, expected, reason, error } of [
    {
      childEnded: { code: 125, signal: null },
      expected: { child_exit_code: 125, child_signal: null },
      reason: 'internal_error',
      error: { code: 'LAMINA_SAFE_SANDBOX_LAUNCH', message: 'sandbox launcher exited' },
    },
    {
      childEnded: { code: null, signal: 'SIGKILL' },
      expected: { child_exit_code: null, child_signal: 'SIGKILL' },
      reason: 'internal_error',
      error: { code: 'LAMINA_SAFE_SANDBOX_LAUNCH', message: 'sandbox launcher was signaled' },
    },
    {
      childEnded: { error: new Error('spawn failed') },
      expected: { child_exit_code: null, child_signal: null },
      reason: 'spawn_failed',
      error: { code: 'LAMINA_SAFE_SPAWN', message: 'spawn failed' },
    },
  ]) {
    const childReport = structuredClone(report);
    childReport.outcome = 'internal_error';
    childReport.termination.reason = reason;
    childReport.termination.limit = reason === 'internal_error' ? 'sandbox_launch' : null;
    childReport.error = error;
    recordChildTermination(childReport.termination, childEnded);
    assert.deepEqual({
      child_exit_code: childReport.termination.child_exit_code,
      child_signal: childReport.termination.child_signal,
    }, expected);
    const childValidation = validateReport(childReport);
    assert.equal(childValidation.valid, true, childValidation.errors.join('; '));
  }
  writeReport(report.report_file, report);
  assert.equal(validateReport(JSON.parse(fs.readFileSync(report.report_file))).valid, true);
  const reportAuthority = path.join(root, 'report-authority.json');
  const provisional = { ...structuredClone(report), report_file: reportAuthority,
    outcome: 'internal_error', termination: { ...report.termination, reason: 'run_in_progress' },
    error: { code: 'LAMINA_SAFE_RUN_IN_PROGRESS', message: 'not complete' } };
  const preparedReportAuthority = prepareReportAuthority(reportAuthority, provisional);
  assert.equal(preparedReportAuthority.file, reportAuthority);
  const reportTarget = path.join(root, 'report-target.json');
  fs.writeFileSync(reportTarget, 'preserve');
  const reportSymlink = path.join(root, 'report-symlink.json');
  fs.symlinkSync(reportTarget, reportSymlink);
  const symlinkAuthority = prepareReportAuthority(reportSymlink,
    { ...provisional, report_file: reportSymlink });
  assert.equal(symlinkAuthority.file_identity.nlink, 1);
  assert.equal(fs.lstatSync(reportSymlink).isSymbolicLink(), false,
    'slot acquisition must atomically replace, never follow, a stale symlink');
  assert.equal(fs.readFileSync(reportTarget, 'utf8'), 'preserve');
  const hardlinkVictim = path.join(root, 'report-hardlink-victim.json');
  const hardlinkSlot = path.join(root, 'report-hardlink.json');
  fs.writeFileSync(hardlinkVictim, 'hardlink victim must survive');
  fs.linkSync(hardlinkVictim, hardlinkSlot);
  const hardlinkAuthority = prepareReportAuthority(hardlinkSlot,
    { ...provisional, report_file: hardlinkSlot });
  assert.equal(hardlinkAuthority.file_identity.nlink, 1);
  assert.equal(fs.readFileSync(hardlinkVictim, 'utf8'), 'hardlink victim must survive',
    'slot acquisition must never truncate through a hardlink');
  const copiedAuthority = prepareReportAuthority(path.join(root, 'copied-authority.json'),
    { ...provisional, report_file: path.join(root, 'copied-authority.json') });
  const copiedBytes = fs.readFileSync(copiedAuthority.file);
  const copiedAuthorityBackup = path.join(root, 'copied-authority-retained.json');
  fs.renameSync(copiedAuthority.file, copiedAuthorityBackup);
  const reportFileIdentity = (candidate) => {
    const stat = fs.lstatSync(candidate, { bigint: true });
    return {
      dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), nlink: Number(stat.nlink),
    };
  };
  assert.deepEqual(reportFileIdentity(copiedAuthorityBackup), copiedAuthority.file_identity,
    'the retained backup must preserve the prepared authority inode');
  fs.writeFileSync(copiedAuthority.file, copiedBytes, { mode: 0o600 });
  const replacementIdentity = reportFileIdentity(copiedAuthority.file);
  assert.notEqual(
    `${replacementIdentity.dev}:${replacementIdentity.ino}`,
    `${copiedAuthority.file_identity.dev}:${copiedAuthority.file_identity.ino}`,
    'retaining the prepared inode must force the replacement onto a distinct inode',
  );
  assert.throws(() => writeReport(copiedAuthority.file,
    { ...report, report_file: copiedAuthority.file }, copiedAuthority), /identity changed/,
  'copying the current run id into a replacement inode must not recover report authority');
  assert.equal(assertGitObjectClosureBudget(20_000, 128 * MIB), true,
    'a canonical 20k-object history must fit the separate packed-object enumeration cap');
  assert.throws(() => assertGitObjectClosureBudget(262_145, 1), /bounded budget/);
  assert.throws(() => assertGitObjectClosureBudget(1, 513 * MIB), /bounded budget/);
  const portableSnapshotImport = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `await import(${JSON.stringify(`file://${path.resolve('scripts/safe-runner/execution-snapshot.mjs')}`)})`], {
    cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, PATH: '/definitely-no-git-here', GIT_DIR: '/tmp/poison-git-dir' },
  });
  assert.equal(portableSnapshotImport.status, 0, portableSnapshotImport.stderr,
    'portable refusal/module import must not eagerly require a Unix Git executable');

  const snapshotRepository = path.join(root, 'snapshot-repository');
  fs.mkdirSync(snapshotRepository);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: snapshotRepository }).status, 0);
  fs.writeFileSync(path.join(snapshotRepository, '.gitignore'), 'node_modules/\ndist/\n');
  fs.writeFileSync(path.join(snapshotRepository, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:eval:portable': 'npm run safe:run -- --tier medium -- npx agent-skills-eval --config evals/agent-skills-eval.yaml',
      'test:eval:redteam': 'npm run safe:run -- --tier medium -- npx promptfoo eval -c evals/promptfoo/lamina-redteam.yaml --max-concurrency 1',
    },
  })}\n`);
  fs.writeFileSync(path.join(snapshotRepository, 'entry.mjs'),
    "import tiny from 'tiny-dep';\nimport { workspace } from './packages/cli/worker.mjs';\nexport async function run() { return tiny + workspace + (await import('./lazy.mjs')).value; }\n");
  fs.writeFileSync(path.join(snapshotRepository, 'lazy.mjs'), "export const value = 'sealed';\n");
  fs.mkdirSync(path.join(snapshotRepository, 'packages', 'cli', 'node_modules', 'workspace-dep'),
    { recursive: true });
  fs.writeFileSync(path.join(snapshotRepository, 'packages', 'cli', 'package.json'),
    '{"type":"module"}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'packages', 'cli', 'worker.mjs'),
    "import workspaceDep from 'workspace-dep';\nexport const workspace = workspaceDep;\n");
  fs.writeFileSync(path.join(snapshotRepository, 'packages', 'cli', 'node_modules',
    'workspace-dep', 'package.json'),
  '{"name":"workspace-dep","main":"index.js","optionalDependencies":{"workspace-platform":"1.0.0"}}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'packages', 'cli', 'node_modules',
    'workspace-dep', 'index.js'), "module.exports = 'workspace sealed ';\n");
  fs.mkdirSync(path.join(snapshotRepository, 'packages', 'cli', 'node_modules',
    'workspace-platform'));
  fs.writeFileSync(path.join(snapshotRepository, 'packages', 'cli', 'node_modules',
    'workspace-platform', 'package.json'),
  '{"name":"workspace-platform","main":"index.js"}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'packages', 'cli', 'node_modules',
    'workspace-platform', 'index.js'), "module.exports = 'platform sealed';\n");
  fs.mkdirSync(path.join(snapshotRepository, 'node_modules', 'unrelated'), { recursive: true });
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'unrelated', 'huge.bin'),
    Buffer.alloc(1024 * 1024));
  fs.mkdirSync(path.join(snapshotRepository, 'node_modules', 'tiny-dep'));
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'tiny-dep', 'package.json'),
    '{"name":"tiny-dep","main":"index.js"}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'tiny-dep', 'index.js'),
    "module.exports = 'dependency sealed ';\n");
  const writeSyntheticPackage = (relative, manifest, source) => {
    const directory = path.join(snapshotRepository, 'node_modules', relative);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({
      main: 'index.js', ...manifest,
    })}\n`);
    fs.writeFileSync(path.join(directory, 'index.js'), source);
    return directory;
  };
  const parentA = writeSyntheticPackage('parent-a', {
    name: 'parent-a', dependencies: {
      'shared-dep': '1.0.0', 'required-alias': 'npm:alias-target@1.0.0',
      'override-same': '1.0.0', 'override-different': 'npm:required-target@1.0.0',
    },
    optionalDependencies: {
      'platform-opt': '1.0.0', 'optional-scoped-alias': 'npm:@scope/platform-target@1.0.0',
      'missing-opt': '1.0.0', 'missing-alias': 'npm:absent-target@1.0.0',
      'override-same': '1.0.0', 'override-different': 'npm:optional-target@1.0.0',
    },
    peerDependencies: { 'peer-lib': '1.0.0' },
  }, "module.exports = `a:${require('shared-dep')}:${require('peer-lib')}:${require('platform-opt')}:${require('required-alias')}:${require('optional-scoped-alias')}:${require('override-different')}`;\n");
  const parentB = writeSyntheticPackage('parent-b', {
    name: 'parent-b', dependencies: { 'shared-dep': '2.0.0', '@scope/tool': '1.0.0' },
  }, "module.exports = `b:${require('shared-dep')}:${require('@scope/tool')}`;\n");
  fs.symlinkSync(path.join(parentA, 'index.js'), path.join(parentA, 'absolute-internal-link.js'));
  const writeNestedPackage = (parent, relative, manifest, source) => {
    const directory = path.join(parent, 'node_modules', ...relative.split('/'));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({
      main: 'index.js', ...manifest,
    })}\n`);
    fs.writeFileSync(path.join(directory, 'index.js'), source);
    return directory;
  };
  writeNestedPackage(parentA, 'shared-dep', { name: 'shared-dep', version: '1.0.0' },
    "module.exports = 'shared-v1';\n");
  writeNestedPackage(parentA, 'platform-opt', { name: 'platform-opt', version: '1.0.0' },
    "module.exports = 'platform';\n");
  writeNestedPackage(parentA, 'required-alias', { name: 'alias-target', version: '1.0.0' },
    "module.exports = 'required-alias';\n");
  writeNestedPackage(parentA, 'optional-scoped-alias', {
    name: '@scope/platform-target', version: '1.0.0',
  }, "module.exports = 'optional-alias';\n");
  writeNestedPackage(parentA, 'override-different', {
    name: 'optional-target', version: '1.0.0',
  }, "module.exports = 'optional-override';\n");
  writeNestedPackage(parentB, 'shared-dep', { name: 'shared-dep', version: '2.0.0' },
    "module.exports = 'shared-v2';\n");
  writeSyntheticPackage('peer-lib', { name: 'peer-lib', version: '1.0.0' },
    "module.exports = 'peer';\n");
  writeSyntheticPackage('@scope/tool', { name: '@scope/tool', version: '1.0.0' },
    "module.exports = 'scoped';\n");

  const pnpmStore = path.join(snapshotRepository, 'node_modules', '.pnpm');
  const pnpmParent = path.join(pnpmStore, 'pnpm-parent@1.0.0', 'node_modules', 'pnpm-parent');
  const pnpmDependency = path.join(pnpmStore, 'contained-dep@1.0.0', 'node_modules',
    'contained-dep');
  fs.mkdirSync(pnpmParent, { recursive: true });
  fs.mkdirSync(pnpmDependency, { recursive: true });
  fs.writeFileSync(path.join(pnpmParent, 'package.json'),
    '{"name":"pnpm-parent","main":"index.js","dependencies":{"contained-dep":"1.0.0"}}\n');
  fs.writeFileSync(path.join(pnpmParent, 'index.js'),
    "module.exports = `pnpm:${require('contained-dep')}`;\n");
  fs.writeFileSync(path.join(pnpmDependency, 'package.json'),
    '{"name":"contained-dep","main":"index.js","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(pnpmDependency, 'index.js'), "module.exports = 'contained';\n");
  fs.symlinkSync(path.relative(path.dirname(path.join(pnpmStore, 'pnpm-parent@1.0.0',
    'node_modules', 'contained-dep')), pnpmDependency), path.join(pnpmStore,
  'pnpm-parent@1.0.0', 'node_modules', 'contained-dep'), 'dir');
  fs.symlinkSync(path.relative(path.join(snapshotRepository, 'node_modules'), pnpmParent),
    path.join(snapshotRepository, 'node_modules', 'pnpm-parent'), 'dir');

  fs.writeFileSync(path.join(snapshotRepository, 'resolution.mjs'), [
    "import parentA from 'parent-a';",
    "import parentB from 'parent-b';",
    "import pnpmParent from 'pnpm-parent';",
    'export default `${parentA}|${parentB}|${pnpmParent}`;',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(snapshotRepository, 'dist'));
  const ignoredModel = path.join(snapshotRepository, 'dist', 'model.bin');
  fs.writeFileSync(ignoredModel, 'sealed model bytes');
  const snapshotOne = prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', path.join(snapshotRepository, 'entry.mjs'), ignoredModel],
    temporaryDirectory: path.join(root, 'snapshot-one'),
  });
  const snapshotTwo = prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', path.join(snapshotRepository, 'entry.mjs'), ignoredModel],
    temporaryDirectory: path.join(root, 'snapshot-two'),
  });
  assert.equal(snapshotOne.digest, snapshotTwo.digest,
    'execution snapshot digest must not depend on its random destination');
  const resolutionSnapshot = prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', path.join(snapshotRepository, 'resolution.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-package-resolution'),
  });
  const sealedResolution = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `const value = (await import(${JSON.stringify(`file://${path.join(
      resolutionSnapshot.snapshot_repository, 'resolution.mjs')}`)})).default; process.stdout.write(value);`], {
    cwd: resolutionSnapshot.snapshot_repository, encoding: 'utf8',
  });
  assert.equal(sealedResolution.status, 0, sealedResolution.stderr);
  assert.equal(sealedResolution.stdout,
    'a:shared-v1:peer:platform:required-alias:optional-alias:optional-override|b:shared-v2:scoped|pnpm:contained',
  'sealed package links must preserve aliases, incompatible nested versions, peers, optionals, scopes, and pnpm roots');
  for (const packageName of ['parent-a', 'parent-b', 'pnpm-parent']) {
    const logical = path.join(resolutionSnapshot.snapshot_repository, 'node_modules', packageName);
    assert.equal(fs.lstatSync(logical).isSymbolicLink(), true);
    assert.ok(fs.realpathSync.native(logical).startsWith(path.join(
      resolutionSnapshot.snapshot_repository, 'node_modules', '.lamina-sealed') + path.sep),
    'logical package links must terminate inside the sealed snapshot store');
  }
  const sealedParentA = fs.realpathSync.native(path.join(resolutionSnapshot.snapshot_repository,
    'node_modules', 'parent-a'));
  const sealedInternalLink = path.join(sealedParentA, 'absolute-internal-link.js');
  assert.equal(fs.lstatSync(sealedInternalLink).isSymbolicLink(), true);
  assert.ok(fs.realpathSync.native(sealedInternalLink).startsWith(`${sealedParentA}${path.sep}`),
    'copied package symlinks must be rewritten to sealed relative targets, never live absolute paths');
  assert.equal(fs.existsSync(path.join(sealedParentA, 'node_modules', 'missing-opt')), false,
    'an absent optional platform dependency must remain absent without failing the snapshot');
  fs.writeFileSync(path.join(parentA, 'node_modules', 'shared-dep', 'index.js'),
    "module.exports = 'live-mutated';\n");
  const isolatedResolution = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `const value = (await import(${JSON.stringify(`file://${path.join(
      resolutionSnapshot.snapshot_repository, 'resolution.mjs')}`)})).default; process.stdout.write(value);`], {
    cwd: resolutionSnapshot.snapshot_repository, encoding: 'utf8',
  });
  assert.equal(isolatedResolution.stdout,
    'a:shared-v1:peer:platform:required-alias:optional-alias:optional-override|b:shared-v2:scoped|pnpm:contained',
  'later mutation of a live nested dependency must not alter sealed logical resolution');

  assert.deepEqual(dependencyPackageTarget('logical-name', 'npm:physical-name@^1.2.3'), {
    logical_name: 'logical-name', manifest_name: 'physical-name',
  });
  assert.deepEqual(dependencyPackageTarget('platform-alias', 'npm:@scope/platform@1.0.0'), {
    logical_name: 'platform-alias', manifest_name: '@scope/platform',
  });
  for (const malformedAlias of ['npm:', 'npm:target', 'npm:@scope/target',
    'npm:target@', 'npm:@scope/target@', 'npm:../target@1.0.0']) {
    assert.throws(() => dependencyPackageTarget('logical-name', malformedAlias),
      /malformed npm alias/);
  }
  assert.throws(() => readBoundedPackageManifest(path.join(parentA, 'package.json'), 8),
    /physical byte bound/);
  fs.mkdirSync(path.join(parentA, 'assets', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(parentA, 'assets', 'nested', 'marker.txt'), 'bounded depth');
  const parentMeasurement = measurePhysicalPackageTree(parentA);
  assert.equal(parentMeasurement.inodes,
    parentMeasurement.files + parentMeasurement.directories + parentMeasurement.symlinks);
  assert.ok(parentMeasurement.directories > 1);
  assert.throws(() => measurePhysicalPackageTree(parentA, { maxDepth: 1 }),
    /bounded depth/);
  const parentBClosure = measureInstalledPackageClosure(snapshotRepository, 'parent-b');
  assert.equal(parentBClosure.logical_links, 3,
    'diagnostics must count the root link and both installed dependency links');
  assert.equal(parentBClosure.synthetic_directories, 4,
    'diagnostics must count store parents plus package-local node_modules and scope directories');
  assert.equal(parentBClosure.inodes, parentBClosure.content_inodes
    + parentBClosure.logical_links + parentBClosure.synthetic_directories);
  assert.equal(assertExecutionDependencyInodeBudget(
    DEFAULTS.executionAuthorityMaxFiles - 3, 3), true);
  assert.throws(() => assertExecutionDependencyInodeBudget(
    DEFAULTS.executionAuthorityMaxFiles - 3, 4), /bounded inode budget/);
  const overDepthPackage = writeSyntheticPackage('over-depth-package', {
    name: 'over-depth-package', version: '1.0.0',
  }, "module.exports = 'over-depth';\n");
  let overDepthDirectory = overDepthPackage;
  for (let depth = 0; depth < 65; depth += 1) {
    overDepthDirectory = path.join(overDepthDirectory, `d${depth}`);
    fs.mkdirSync(overDepthDirectory);
  }
  assert.throws(() => measureInstalledPackageClosure(snapshotRepository, 'over-depth-package'),
    /bounded depth/, 'metadata admission must use the copier depth-64 ceiling');
  fs.writeFileSync(path.join(snapshotRepository, 'over-depth.mjs'),
    "import value from 'over-depth-package'; export default value;\n");
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', path.join(snapshotRepository, 'over-depth.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-over-depth'),
  }), /bounded depth/, 'the copy walker must enforce the same depth-64 ceiling');

  const missingPeer = writeSyntheticPackage('missing-peer-parent', {
    name: 'missing-peer-parent', peerDependencies: { 'required-missing-peer': '1.0.0' },
  }, "module.exports = 'unreachable';\n");
  fs.writeFileSync(path.join(snapshotRepository, 'missing-peer.mjs'),
    "import value from 'missing-peer-parent'; export default value;\n");
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', path.join(snapshotRepository, 'missing-peer.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-missing-peer'),
  }), /cannot resolve installed execution dependency: required-missing-peer/,
  'a required peer must fail closed when it is not installed');
  assert.ok(fs.existsSync(missingPeer));
  const externalPackage = path.join(root, 'external-package');
  fs.mkdirSync(externalPackage);
  fs.writeFileSync(path.join(externalPackage, 'package.json'),
    '{"name":"external-package","main":"index.js"}\n');
  fs.writeFileSync(path.join(externalPackage, 'index.js'), "module.exports = 'external';\n");
  fs.symlinkSync(externalPackage, path.join(snapshotRepository, 'node_modules',
    'external-package'), 'dir');
  fs.writeFileSync(path.join(snapshotRepository, 'external-package.mjs'),
    "import value from 'external-package'; export default value;\n");
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', path.join(snapshotRepository, 'external-package.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-external-package'),
  }), /resolves outside repository node_modules/,
  'a live package symlink outside repository node_modules must fail closed');
  assert.equal(fs.existsSync(path.join(snapshotOne.snapshot_repository,
    'node_modules', 'unrelated')), false, 'unrelated dependency trees must not be copied');
  assert.equal(fs.readFileSync(path.join(snapshotOne.snapshot_repository, 'packages', 'cli',
    'node_modules', 'workspace-dep', 'index.js'), 'utf8'),
  "module.exports = 'workspace sealed ';\n",
  'bare imports in a nested workspace must resolve from that workspace package');
  const sealedWorkspacePackage = fs.realpathSync.native(path.join(snapshotOne.snapshot_repository,
    'packages', 'cli', 'node_modules', 'workspace-dep'));
  assert.equal(fs.readFileSync(path.join(sealedWorkspacePackage, 'node_modules',
    'workspace-platform', 'index.js'), 'utf8'),
  "module.exports = 'platform sealed';\n",
  'installed platform optional dependencies must remain in the package-local resolution closure');
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'tiny-dep', 'index.js'),
    "module.exports = 'replacement';\n");
  assert.match(fs.readFileSync(path.join(snapshotOne.snapshot_repository,
    'node_modules', 'tiny-dep', 'index.js'), 'utf8'), /dependency sealed/,
  'required package roots must be frozen while unrelated dependencies remain excluded');
  const ignoredModelAuthority = snapshotOne.entries.find((entry) =>
    entry.label === 'argv:dist/model.bin');
  assert.equal(fs.readFileSync(ignoredModelAuthority.path, 'utf8'), 'sealed model bytes',
    'ignored argv file inputs must be descriptor-copied into execution authority');
  fs.writeFileSync(path.join(snapshotRepository, 'lazy.mjs'), "export const value = 'replaced';\n");
  assert.match(fs.readFileSync(path.join(snapshotOne.snapshot_repository, 'lazy.mjs'), 'utf8'), /sealed/,
    'lazy local imports must use frozen bytes');
  assert.equal(assertExecutionSnapshot(snapshotOne), true);
  const fakeInfrastructure = path.join(snapshotRepository, '.git', 'fake-infrastructure');
  fs.mkdirSync(fakeInfrastructure, { recursive: true });
  const fakeNode = path.join(fakeInfrastructure, 'node');
  const fakeBwrap = path.join(fakeInfrastructure, 'bwrap');
  fs.writeFileSync(fakeNode, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  fs.writeFileSync(fakeBwrap, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const infrastructureSnapshot = prepareExecutionSnapshot({
    cwd: snapshotRepository, command: ['/bin/sh', path.join(snapshotRepository, 'entry.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-infrastructure'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  });
  fs.writeFileSync(fakeBwrap, '#!/bin/sh\necho replacement\n', { mode: 0o700 });
  assert.equal(fs.readFileSync(infrastructureSnapshot.infrastructure.bwrap, 'utf8'),
    '#!/bin/sh\nexit 0\n', 'bwrap launch must use descriptor-copied authority, not its checked path');
  assert.equal(assertExecutionSnapshot(infrastructureSnapshot), true);
  const fakeNpx = path.join(fakeInfrastructure, 'npx');
  fs.writeFileSync(fakeNpx, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
  fs.mkdirSync(path.join(snapshotRepository, 'node_modules', 'agent-skills-eval'));
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'agent-skills-eval', 'package.json'),
    '{"name":"agent-skills-eval","exports":{"./provider":"./provider.mjs"},"bin":{"agent-skills-eval":"cli.mjs"},"dependencies":{"tiny-dep":"1.0.0"}}\n');
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', 'agent-skills-eval', 'cli.mjs'),
    "#!/usr/bin/env node\nimport tiny from 'tiny-dep'; console.log(tiny);\n", { mode: 0o700 });
  assert.equal(auditedNpxPackage(snapshotRepository, 'agent-skills-eval').bin_relative, 'cli.mjs',
    'audited npx discovery must read the physical manifest without requiring a root export');
  fs.mkdirSync(path.join(snapshotRepository, 'node_modules', '@scope', 'sealed-cli'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', '@scope', 'sealed-cli',
    'package.json'), JSON.stringify({
    name: '@scope/sealed-cli', exports: { '.': './index.mjs' }, bin: 'bin/cli.mjs',
  }));
  fs.mkdirSync(path.join(snapshotRepository, 'node_modules', '@scope', 'sealed-cli', 'bin'));
  fs.writeFileSync(path.join(snapshotRepository, 'node_modules', '@scope', 'sealed-cli', 'bin',
    'cli.mjs'), '#!/usr/bin/env node\n', { mode: 0o700 });
  assert.equal(auditedNpxPackage(snapshotRepository, '@scope/sealed-cli').bin_relative,
    'bin/cli.mjs', 'scoped audited packages must resolve their physical manifest and string bin');
  assert.throws(() => auditedNpxPackage(snapshotRepository, '../escape'), /invalid execution dependency/);
  for (const builtin of ['events', 'node:events', 'fs', 'node:fs', 'fs/promises',
    'node:fs/promises']) assert.equal(packageName(builtin), null, `${builtin} is a Node builtin`);
  assert.equal(packageName('@scope/runtime/subpath'), '@scope/runtime');
  assert.equal(packageName('ordinary/subpath'), 'ordinary');
  const actualInstallRoot = process.env.LAMINA_ACTUAL_INSTALL_ROOT || process.cwd();
  if (fs.existsSync(path.join(actualInstallRoot, 'node_modules', 'agent-skills-eval',
    'package.json'))) {
    assert.equal(auditedNpxPackage(actualInstallRoot, 'agent-skills-eval').bin_relative,
      'dist/cli.js');
    assert.equal(auditedNpxPackage(actualInstallRoot, 'promptfoo').bin_relative,
      'dist/src/entrypoint.js');
    const promptfooClosure = measureInstalledPackageClosure(actualInstallRoot, 'promptfoo');
    assert.ok(promptfooClosure.packages >= 587,
      `actual Promptfoo closure unexpectedly reached only ${promptfooClosure.packages} packages`);
    assert.equal(promptfooClosure.fits_default_dependency_budget, false,
      'actual Promptfoo package closure must report refusal under the current default authority budget');
    assert.match(promptfooClosure.default_authority_refusal, /package closure exceeds/);
    assert.ok(promptfooClosure.inodes > DEFAULTS.executionAuthorityMaxFiles
      || promptfooClosure.bytes > DEFAULTS.executionAuthorityMaxBytes);
    const targetedPromptfooClosure = measureAuditedNpxPackageClosure(
      actualInstallRoot, promptfooArgv,
    );
    assert.equal(targetedPromptfooClosure.npx_authority.config.digest,
      '9033e19f151b29d8fbc5d6739d5941692ed7f923456c95906d67a00492e1b194');
    assert.ok(targetedPromptfooClosure.packages < promptfooClosure.packages,
      'the config-bound policy must omit Promptfoo direct optional provider/plugin packages');
    assert.equal(targetedPromptfooClosure.fits_default_dependency_budget, false,
      'targeted Promptfoo closure must still refuse unless it truthfully fits the global cap');
  } else if (process.env.LAMINA_ACTUAL_INSTALL_ROOT) {
    assert.fail('LAMINA_ACTUAL_INSTALL_ROOT must contain the actual audited npx packages');
  }
  fs.mkdirSync(path.join(snapshotRepository, 'evals'), { recursive: true });
  fs.copyFileSync(path.resolve('evals/agent-skills-eval.yaml'),
    path.join(snapshotRepository, 'evals', 'agent-skills-eval.yaml'));
  const syntheticAgentArgv = [
    fakeNpx, 'agent-skills-eval', '--config', 'evals/agent-skills-eval.yaml',
  ];
  assert.equal(auditedNpxCommand(snapshotRepository, syntheticAgentArgv).config.digest,
    'f9fbd91dcd907d555833a8379c76fe2741f87903114f6a4e922c7f855a904f5c');
  fs.appendFileSync(path.join(snapshotRepository, 'evals', 'agent-skills-eval.yaml'), '# changed\n');
  assert.throws(() => auditedNpxCommand(snapshotRepository, syntheticAgentArgv),
    /config digest changed/);
  fs.copyFileSync(path.resolve('evals/agent-skills-eval.yaml'),
    path.join(snapshotRepository, 'evals', 'agent-skills-eval.yaml'));
  const syntheticPackageManifest = path.join(snapshotRepository, 'package.json');
  const originalSyntheticManifest = fs.readFileSync(syntheticPackageManifest, 'utf8');
  const changedSyntheticManifest = JSON.parse(originalSyntheticManifest);
  changedSyntheticManifest.scripts['test:eval:portable'] += ' --verbose';
  fs.writeFileSync(syntheticPackageManifest, `${JSON.stringify(changedSyntheticManifest)}\n`);
  assert.throws(() => auditedNpxCommand(snapshotRepository, syntheticAgentArgv),
    /no longer matches package script/);
  fs.writeFileSync(syntheticPackageManifest, originalSyntheticManifest);
  const agentSkillsRefusal = auditedNpxCommand(
    snapshotRepository, syntheticAgentArgv,
  ).launch_refusal;
  const agentSkillsTemporaryDirectory = path.join(root, 'snapshot-npx-refusal');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: syntheticAgentArgv,
    temporaryDirectory: agentSkillsTemporaryDirectory,
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  }), (error) => error.message === agentSkillsRefusal,
  'recognized agent-skills argv must refuse before execution authority creation');
  assert.equal(fs.existsSync(path.join(agentSkillsTemporaryDirectory, 'execution-authority')), false,
    'agent-skills refusal must not create snapshot authority');
  const syntheticAgentConfig = path.join(snapshotRepository, 'evals', 'agent-skills-eval.yaml');
  const redirectedAgentConfig = path.join(snapshotRepository, 'evals', 'agent-skills-real.yaml');
  fs.renameSync(syntheticAgentConfig, redirectedAgentConfig);
  fs.symlinkSync('agent-skills-real.yaml', syntheticAgentConfig);
  assert.throws(() => auditedNpxCommand(snapshotRepository, syntheticAgentArgv),
    /bounded physical repository file/);
  fs.unlinkSync(syntheticAgentConfig);
  fs.renameSync(redirectedAgentConfig, syntheticAgentConfig);
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: [fakeNpx, 'agent-skills-eval', '--config', 'evals/agent-skills-eval.yaml', '--verbose'],
    temporaryDirectory: path.join(root, 'snapshot-arbitrary-npx'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  }), /exact repository package-script argv/,
  'arbitrary arguments to an otherwise audited npx package must refuse before snapshotting');
  const syntheticPromptfooConfig = path.join(snapshotRepository,
    'evals', 'promptfoo', 'lamina-redteam.yaml');
  fs.mkdirSync(path.dirname(syntheticPromptfooConfig), { recursive: true });
  fs.copyFileSync(path.resolve('evals/promptfoo/lamina-redteam.yaml'), syntheticPromptfooConfig);
  const syntheticPromptfooArgv = [
    fakeNpx, 'promptfoo', 'eval', '-c', 'evals/promptfoo/lamina-redteam.yaml',
    '--max-concurrency', '1',
  ];
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository, command: syntheticPromptfooArgv,
    temporaryDirectory: path.join(root, 'snapshot-promptfoo-budget-refusal'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  }), /Promptfoo launch authority is budget-refused.*bounded command-specific dependency artifact/,
  'direct snapshot callers must receive the same unconditional Promptfoo launch refusal');
  writeSyntheticPackage('promptfoo', {
    name: 'promptfoo', bin: { promptfoo: 'index.js' },
    dependencies: { 'promptfoo-required': '1.0.0' },
    optionalDependencies: { 'omitted-provider': '1.0.0' },
  }, "module.exports = require('promptfoo-required');\n");
  const promptfooRequired = writeSyntheticPackage('promptfoo-required', {
    name: 'promptfoo-required', optionalDependencies: { 'downstream-platform': '1.0.0' },
  }, "module.exports = require('downstream-platform');\n");
  writeNestedPackage(promptfooRequired, 'downstream-platform', {
    name: 'downstream-platform', version: '1.0.0',
  }, "module.exports = 'downstream-platform';\n");
  writeSyntheticPackage('omitted-provider', { name: 'omitted-provider', version: '1.0.0' },
    "module.exports = 'must-not-be-sealed';\n");
  const fullSyntheticPromptfoo = measureInstalledPackageClosure(snapshotRepository, 'promptfoo');
  const targetedSyntheticPromptfoo = measureAuditedNpxPackageClosure(
    snapshotRepository, syntheticPromptfooArgv,
  );
  assert.equal(fullSyntheticPromptfoo.packages, 4);
  assert.equal(targetedSyntheticPromptfoo.packages, 3,
    'metadata policy must omit only the direct optional provider');
  assert.equal(targetedSyntheticPromptfoo.logical_edges, 2,
    'required packages must retain their installed downstream optional/platform edge');
  assert.equal(targetedSyntheticPromptfoo.npx_authority.launch_admitted, false);
  fs.appendFileSync(syntheticPromptfooConfig, '# changed\n');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository, command: syntheticPromptfooArgv,
    temporaryDirectory: path.join(root, 'snapshot-changed-promptfoo-config'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  }), /config digest changed/,
  'a changed Promptfoo config must not retain the direct-optional omission policy');
  fs.copyFileSync(path.resolve('evals/promptfoo/lamina-redteam.yaml'), syntheticPromptfooConfig);
  const buildEntrypoint = path.join(snapshotRepository, 'scripts', 'build-standalone-cli.mjs');
  fs.mkdirSync(path.dirname(buildEntrypoint), { recursive: true });
  fs.writeFileSync(buildEntrypoint, "export const build = true;\n");
  const syntheticTrackedStatus = () => spawnSync(
    'git', ['status', '--short', '--untracked-files=no'], {
      cwd: snapshotRepository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).stdout;
  const buildTrackedBefore = syntheticTrackedStatus();
  const buildDistBefore = fs.readdirSync(path.join(snapshotRepository, 'dist')).sort();
  const buildTemporaryDirectory = path.join(root, 'snapshot-build-refusal');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository, command: ['/bin/sh', buildEntrypoint],
    temporaryDirectory: buildTemporaryDirectory,
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  }), (error) => error.message === repositoryOutputRefusal('scripts/build-standalone-cli.mjs'),
  'standalone build must return its exact same-filesystem hard-quota refusal');
  assert.equal(fs.existsSync(path.join(buildTemporaryDirectory, 'execution-authority')), false,
    'standalone build must refuse before snapshot authority creation');
  assert.deepEqual(fs.readdirSync(path.join(snapshotRepository, 'dist')).sort(), buildDistBefore,
    'standalone build refusal must not create or replace a dist target');
  assert.equal(syntheticTrackedStatus(), buildTrackedBefore,
    'standalone build refusal must not change tracked files');
  fs.mkdirSync(path.join(snapshotRepository, 'tests'), { recursive: true });
  const envEntrypoint = path.join(snapshotRepository, 'tests', 'cli_binary_smoke_test.mjs');
  fs.writeFileSync(envEntrypoint, "import fs from 'node:fs';\n");
  const envOnlyModel = path.join(snapshotRepository, 'dist', 'env-only-model.bin');
  fs.writeFileSync(envOnlyModel, 'env-only sealed bytes');
  const environmentSnapshot = prepareExecutionSnapshot({
    cwd: snapshotRepository, command: ['/bin/sh', envEntrypoint],
    temporaryDirectory: path.join(root, 'snapshot-environment'),
    environment: { LAMINA_MODEL: envOnlyModel },
  });
  const environmentAuthority = environmentSnapshot.entries.find((entry) =>
    entry.label === 'env:LAMINA_MODEL:dist/env-only-model.bin');
  assert.deepEqual(environmentSnapshot.writable_bindings, [],
    'CLI smoke snapshot must not receive source Git-common write authority');
  fs.writeFileSync(envOnlyModel, 'replacement');
  assert.equal(fs.readFileSync(environmentAuthority.path, 'utf8'), 'env-only sealed bytes');
  const standaloneBinary = path.join(snapshotRepository, 'dist', 'standalone-binary');
  const standaloneWorker = path.join(snapshotRepository, 'dist', 'standalone-worker');
  fs.writeFileSync(standaloneBinary, 'standalone bytes', { mode: 0o700 });
  fs.writeFileSync(standaloneWorker, 'worker bytes', { mode: 0o700 });
  const standaloneSnapshotTemporary = path.join(root, 'snapshot-standalone-smoke');
  const standaloneSnapshot = prepareExecutionSnapshot({
    cwd: snapshotRepository, command: ['/bin/sh', envEntrypoint],
    temporaryDirectory: standaloneSnapshotTemporary,
    environment: {
      LAMINA_BINARY: standaloneBinary,
      LAMINA_WORKER: standaloneWorker,
      LAMINA_MODEL: envOnlyModel,
    },
  });
  assert.deepEqual(standaloneSnapshot.writable_bindings, [],
    'standalone smoke must not bind the source repository Git-common runtime');
  assert.equal(standaloneSnapshot.graphd_launch_authority.length, 1);
  assert.equal(standaloneSnapshot.graphd_launch_authority[0].kind, 'standalone-cwd');
  const composedSmokeEnvironment = sanitizedPayloadEnvironment({
    sources: [semanticPoison, { LAMINA_SAFE_RUNNER: '1' }], mode: 'run',
    auditedEntrypoint: standaloneSnapshot.audited_entrypoint,
    sealedOverrides: standaloneSnapshot.environment_overrides,
  });
  const encodedSmokeAuthority = JSON.parse(Buffer.from(
    encodeExecutionAuthority(standaloneSnapshot), 'base64url',
  ).toString('utf8'));
  assert.deepEqual(encodedSmokeAuthority.environment_overrides,
    standaloneSnapshot.environment_overrides,
    'systemd handoff must encode the exact snapshot-sealed smoke environment values');
  const smokePreservedNames = validatedSealedEnvironmentNames({
    executionAuthority: encodedSmokeAuthority,
    environment: composedSmokeEnvironment,
  });
  assert.deepEqual(smokePreservedNames.sort(), [
    'LAMINA_BINARY', 'LAMINA_MODEL', 'LAMINA_WORKER',
  ], 'only snapshot-sealed native smoke inputs may survive sandbox unsets');
  const smokeSandboxContract = validateSandboxExecutionAuthority({
    executionAuthority: encodedSmokeAuthority,
    authorityRoot: standaloneSnapshot.root,
    cwd: snapshotRepository,
    environment: composedSmokeEnvironment,
  });
  const smokeSandboxArgs = bubblewrapSandboxArguments({
    cwd: snapshotRepository,
    readyFile: path.join(root, 'smoke.ready'),
    releaseFile: path.join(root, 'smoke.release'),
    temporaryDirectory: path.join(root, 'smoke-payload-tmp'),
    command: standaloneSnapshot.launch_command,
    executionAuthority: encodedSmokeAuthority,
    preservedEnvironmentNames: smokeSandboxContract.preservedEnvironmentNames,
    environment: composedSmokeEnvironment,
    masks: { hiddenDirectories: [], sockets: [] },
  });
  for (const name of smokePreservedNames) {
    assert.equal(smokeSandboxArgs.some((value, index) => value === name
      && smokeSandboxArgs[index - 1] === '--unsetenv'), false,
    `${name} must reach native qualification instead of the smoke early-exit path`);
    assert.equal(composedSmokeEnvironment[name], standaloneSnapshot.environment_overrides[name]);
  }
  assert.equal(composedSmokeEnvironment.LAMINA_RETRIEVAL_MODEL_PATH, undefined,
    'an inherited semantic alias must remain stripped in the composed payload environment');
  assert.throws(() => validatedSealedEnvironmentNames({
    executionAuthority: {
      ...encodedSmokeAuthority,
      environment_overrides: {
        ...encodedSmokeAuthority.environment_overrides,
        LAMINA_RETRIEVAL_ARBITRARY: standaloneBinary,
      },
    },
    environment: {
      ...composedSmokeEnvironment,
      LAMINA_RETRIEVAL_ARBITRARY: standaloneBinary,
    },
  }), /unsealed environment override/,
  'sandbox must not preserve an arbitrary re-added retrieval environment name');
  const standaloneCwd = path.join(standaloneSnapshotTemporary, 'payload-tmp',
    'private-lamina-smoke', 'fixture');
  const standaloneChild = {
    argv: [standaloneBinary, '--graphd', standaloneCwd], cwd: standaloneCwd,
    executable_identity: standaloneSnapshot.graphd_launch_authority[0].executable_identity,
    environment_attestation: processEnvironmentAttestation(Buffer.from('PATH=/usr/bin\0')),
  };
  const standaloneRuntime = path.join(standaloneCwd, '.git', 'lamina');
  assert.equal(exactGraphdLaunchAuthorized(standaloneChild, {
    socket: path.join(standaloneRuntime, 'graphd.sock'),
    lock: path.join(standaloneRuntime, 'graphd.lock'),
  }, standaloneSnapshot.graphd_launch_authority), true,
  'standalone smoke graphd must bind only its attested child-cwd private runtime');
  assert.equal(exactGraphdLaunchAuthorized(standaloneChild, {
    socket: path.join(snapshotRepository, '.git', 'lamina', 'graphd.sock'),
    lock: path.join(snapshotRepository, '.git', 'lamina', 'graphd.lock'),
  }, standaloneSnapshot.graphd_launch_authority), false,
  'standalone smoke graphd must not reserve source Git-common paths');
  const retrievalRepository = path.join(root, 'retrieval-authority-repository');
  fs.mkdirSync(retrievalRepository);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: retrievalRepository }).status, 0);
  fs.mkdirSync(path.join(retrievalRepository, 'benchmarks', 'retrieval-v1'), { recursive: true });
  fs.mkdirSync(path.join(retrievalRepository, 'packages', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(retrievalRepository, '.gitignore'), 'assets/\n');
  fs.writeFileSync(path.join(retrievalRepository, 'package.json'), '{"type":"module"}\n');
  fs.writeFileSync(path.join(retrievalRepository, 'benchmarks', 'retrieval-v1', 'benchmark.mjs'),
    'export const retrievalBenchmark = true;\n');
  const retrievalAssets = path.join(retrievalRepository, 'assets');
  fs.mkdirSync(retrievalAssets);
  const sealedWorker = path.join(retrievalAssets, 'worker');
  const sealedModel = path.join(retrievalAssets, 'model.onnx');
  const sealedTokenizer = path.join(retrievalAssets, 'tokenizer.json');
  fs.writeFileSync(sealedWorker, 'worker-v1', { mode: 0o700 });
  fs.writeFileSync(sealedModel, 'model-v1');
  fs.writeFileSync(sealedTokenizer, 'tokenizer-v1');
  const sealedModelDigest = crypto.createHash('sha256')
    .update(fs.readFileSync(sealedModel)).digest('hex');
  fs.writeFileSync(path.join(retrievalRepository, 'packages', 'cli',
    'retrieval-model-manifest.json'), `${JSON.stringify({
    schema: 'lamina.retrieval-model/v1', sha256: sealedModelDigest,
    bytes: fs.statSync(sealedModel).size,
  })}\n`);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: retrievalRepository }).status, 0);
  assert.equal(spawnSync('git', [
    '-c', 'user.name=Safe Runner Test', '-c', 'user.email=safe-runner@example.invalid',
    'commit', '--quiet', '-m', 'retrieval fixture',
  ], { cwd: retrievalRepository }).status, 0);
  const sealedRetrievalCommand = [
    process.execPath,
    path.join(retrievalRepository, 'benchmarks', 'retrieval-v1', 'benchmark.mjs'),
    '--evaluate', '--worker', sealedWorker, '--model', sealedModel,
    '--tokenizer', sealedTokenizer, '--model-digest', sealedModelDigest,
  ];
  const sealedRetrievalAuthority = retrievalQualificationAuthority({
    repository: retrievalRepository, command: sealedRetrievalCommand,
  });
  const prepareSealedRetrievalSnapshot = (command, temporaryDirectory, options = {}) =>
    prepareExecutionSnapshot({
      cwd: retrievalRepository, command, temporaryDirectory,
      expectedRetrievalAuthority: retrievalQualificationAuthority({
        repository: retrievalRepository, command,
      }),
      ...options,
    });
  assert.equal(sealedRetrievalAuthority.model.digest, sealedModelDigest);
  assert.match(sealedRetrievalAuthority.manifest.digest, /^[a-f0-9]{64}$/);
  const frozenRetrievalOne = frozenWorkloadIdentity(
    retrievalRepository, sealedRetrievalCommand,
  );
  assert.equal(frozenRetrievalOne.retrieval_authority.model.digest, sealedModelDigest);
  assert.equal(frozenRetrievalOne.workload_inputs.some((item) => item.path === sealedModel), false,
    'dedicated retrieval identity must exclude the model from the generic 64MiB argv budget');
  const sealedRetrievalSnapshotOne = prepareSealedRetrievalSnapshot(
    sealedRetrievalCommand, path.join(root, 'snapshot-retrieval-one'),
  );
  assert.deepEqual(sealedRetrievalSnapshotOne.writable_bindings, [],
    'retrieval qualification must not receive source Git-common write authority');
  assert.deepEqual(sealedRetrievalSnapshotOne.graphd_launch_authority, []);
  for (const [relative, expectedDigest] of [
    ['assets/worker', crypto.createHash('sha256').update('worker-v1').digest('hex')],
    ['assets/model.onnx', sealedModelDigest],
    ['assets/tokenizer.json', crypto.createHash('sha256').update('tokenizer-v1').digest('hex')],
  ]) {
    assert.equal(sealedRetrievalSnapshotOne.entries.find((entry) =>
      entry.label === `argv:${relative}`)?.digest, expectedDigest,
    `ignored retrieval input ${relative} must be descriptor-copied into snapshot identity`);
  }
  const originalModelBytes = fs.readFileSync(sealedModel);
  assert.throws(() => prepareExecutionSnapshot({
    cwd: retrievalRepository, command: sealedRetrievalCommand,
    temporaryDirectory: path.join(root, 'snapshot-retrieval-swap-copy-restore'),
    expectedRetrievalAuthority: sealedRetrievalAuthority,
    _testAfterRetrievalAuthorityValidated() {
      fs.writeFileSync(sealedModel, 'swapped!');
    },
    _testBeforeRetrievalCopyValidation() {
      fs.writeFileSync(sealedModel, originalModelBytes);
    },
  }), /copied retrieval --model authority does not match/,
  'snapshot must reject swapped bytes copied after preflight even when the source is restored');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(sealedModel)).digest('hex'),
    sealedModelDigest, 'the deterministic race seam must restore the preflight source bytes');
  const swappedModelBackup = path.join(retrievalAssets, 'model-preflight-inode');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: retrievalRepository, command: sealedRetrievalCommand,
    temporaryDirectory: path.join(root, 'snapshot-retrieval-same-bytes-inode-swap'),
    expectedRetrievalAuthority: sealedRetrievalAuthority,
    _testAfterRetrievalAuthorityValidated() {
      fs.renameSync(sealedModel, swappedModelBackup);
      fs.writeFileSync(sealedModel, originalModelBytes);
    },
    _testBeforeRetrievalCopyValidation() {
      fs.unlinkSync(sealedModel);
      fs.renameSync(swappedModelBackup, sealedModel);
    },
  }), /copied retrieval --model authority does not match/,
  'same bytes from a substituted inode must not satisfy the original preflight authority');

  const oversizeWorker = path.join(retrievalAssets, 'worker-oversize');
  const oversizeModel = path.join(retrievalAssets, 'model-oversize.onnx');
  const oversizeTokenizer = path.join(retrievalAssets, 'tokenizer-oversize.json');
  for (const [file, bytes, mode] of [
    [oversizeWorker, RETRIEVAL_WORKER_MAX_BYTES + 1, 0o700],
    [oversizeModel, RETRIEVAL_MODEL_MAX_BYTES + 1, 0o600],
    [oversizeTokenizer, RETRIEVAL_TOKENIZER_MAX_BYTES + 1, 0o600],
  ]) {
    fs.writeFileSync(file, '', { mode });
    fs.truncateSync(file, bytes);
  }
  for (const [flag, file, pattern] of [
    ['--worker', oversizeWorker, /--worker exceeds its pre-hash size cap/],
    ['--model', oversizeModel, /--model exceeds its pre-hash size cap/],
    ['--tokenizer', oversizeTokenizer, /--tokenizer exceeds its pre-hash size cap/],
  ]) {
    const command = [...sealedRetrievalCommand];
    command[command.indexOf(flag) + 1] = file;
    assert.throws(() => retrievalQualificationAuthority({
      repository: retrievalRepository, command,
    }), pattern, `${flag} sparse oversize input must refuse before hashing its bytes`);
  }
  const manifestPath = path.join(retrievalRepository, 'packages', 'cli',
    'retrieval-model-manifest.json');
  const originalManifestBytes = fs.readFileSync(manifestPath);
  try {
    fs.truncateSync(manifestPath, RETRIEVAL_MANIFEST_MAX_BYTES + 1);
    assert.throws(() => retrievalQualificationAuthority({
      repository: retrievalRepository, command: sealedRetrievalCommand,
    }), /manifest exceeds its 1 MiB pre-read size cap/,
    'sparse oversize manifest must refuse before hashing or parsing its bytes');
  } finally {
    fs.writeFileSync(manifestPath, originalManifestBytes);
  }
  const swappedManifestBackup = `${manifestPath}.preflight-authority`;
  try {
    assert.throws(() => retrievalQualificationAuthority({
      repository: retrievalRepository, command: sealedRetrievalCommand,
      _testAfterManifestDescriptorRead() {
        fs.renameSync(manifestPath, swappedManifestBackup);
        fs.writeFileSync(manifestPath, '');
        fs.truncateSync(manifestPath, RETRIEVAL_MANIFEST_MAX_BYTES + 1);
      },
    }), /manifest changed while reading/,
    'an oversized path replacement after the bounded descriptor read must refuse by identity');
  } finally {
    fs.rmSync(manifestPath, { force: true });
    if (fs.existsSync(swappedManifestBackup)) {
      fs.renameSync(swappedManifestBackup, manifestPath);
    }
  }
  assert.deepEqual(fs.readFileSync(manifestPath), originalManifestBytes,
    'the manifest swap seam must restore the original descriptor-read authority');
  fs.writeFileSync(sealedTokenizer, 'tokenizer-v2');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: retrievalRepository, command: sealedRetrievalCommand,
    temporaryDirectory: path.join(root, 'snapshot-retrieval-preflight-mismatch'),
    expectedRetrievalAuthority: sealedRetrievalAuthority,
  }), /retrieval qualification authority changed after preflight/,
  'snapshot must reject a semantic input changed after the original preflight');
  const frozenRetrievalTwo = frozenWorkloadIdentity(
    retrievalRepository, sealedRetrievalCommand,
  );
  const sealedRetrievalSnapshotTwo = prepareSealedRetrievalSnapshot(
    sealedRetrievalCommand, path.join(root, 'snapshot-retrieval-two'),
  );
  assert.notEqual(frozenRetrievalTwo.digest, frozenRetrievalOne.digest,
    'tokenizer byte changes must alter frozen retrieval semantics');
  assert.notEqual(sealedRetrievalSnapshotTwo.digest, sealedRetrievalSnapshotOne.digest,
    'tokenizer byte changes must alter sealed snapshot identity');
  fs.writeFileSync(sealedWorker, 'worker-v2', { mode: 0o700 });
  const sealedRetrievalSnapshotThree = prepareSealedRetrievalSnapshot(
    sealedRetrievalCommand, path.join(root, 'snapshot-retrieval-three'),
  );
  assert.notEqual(sealedRetrievalSnapshotThree.digest, sealedRetrievalSnapshotTwo.digest,
    'worker byte changes must alter sealed snapshot identity');
  fs.writeFileSync(sealedModel, 'model-v2');
  const sealedModelDigestTwo = crypto.createHash('sha256')
    .update(fs.readFileSync(sealedModel)).digest('hex');
  fs.writeFileSync(path.join(retrievalRepository, 'packages', 'cli',
    'retrieval-model-manifest.json'), `${JSON.stringify({
    schema: 'lamina.retrieval-model/v1', sha256: sealedModelDigestTwo,
    bytes: fs.statSync(sealedModel).size,
  })}\n`);
  const sealedRetrievalCommandTwo = [...sealedRetrievalCommand];
  sealedRetrievalCommandTwo[sealedRetrievalCommandTwo.indexOf('--model-digest') + 1]
    = sealedModelDigestTwo;
  const sealedRetrievalSnapshotFour = prepareSealedRetrievalSnapshot(
    sealedRetrievalCommandTwo, path.join(root, 'snapshot-retrieval-four'),
  );
  assert.notEqual(sealedRetrievalSnapshotFour.digest, sealedRetrievalSnapshotThree.digest,
    'model and canonical manifest byte changes must alter sealed snapshot identity');
  const mutableEntrypoint = path.join(snapshotRepository, 'tests', 'fixtures',
    'safe-runner-mutable.mjs');
  fs.mkdirSync(path.dirname(mutableEntrypoint), { recursive: true });
  fs.writeFileSync(mutableEntrypoint, "import fs from 'node:fs';\n");
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', mutableEntrypoint, path.join(snapshotRepository, 'root-output.txt')],
    temporaryDirectory: path.join(root, 'snapshot-root-output'),
  }), /exact Git common lamina\/work scratch authority/,
  'an argv output must never rebind the repository root over sealed source');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', mutableEntrypoint,
      path.join(snapshotRepository, 'packages', 'cli', 'result.txt')],
    temporaryDirectory: path.join(root, 'snapshot-source-output'),
  }), /exact Git common lamina\/work scratch authority/,
  'a fixture argv output must never admit an arbitrary top-level subtree');
  const maliciousScratch = path.join(snapshotRepository, '.safe-runner-malicious');
  fs.mkdirSync(maliciousScratch);
  fs.writeFileSync(path.join(maliciousScratch, 'source.mjs'), 'export const malicious = true;\n');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', mutableEntrypoint, path.join(maliciousScratch, 'result.txt')],
    temporaryDirectory: path.join(root, 'snapshot-malicious-scratch'),
  }), /exact Git common lamina\/work scratch authority/,
  'a pre-existing source-bearing .safe-runner-* path must not disappear from sealing');
  const fixtureWork = path.join(snapshotRepository, '.git', 'lamina', 'work');
  fs.mkdirSync(fixtureWork, { recursive: true });
  const validMutableDirectory = path.join(fixtureWork, 'mutable-valid');
  fs.mkdirSync(validMutableDirectory);
  const validMutableSnapshot = prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', mutableEntrypoint, path.join(validMutableDirectory, 'result.txt')],
    temporaryDirectory: path.join(root, 'snapshot-mutable-valid'),
  });
  assert.equal(validMutableSnapshot.writable_bindings.length, 1);
  assert.equal(validMutableSnapshot.writable_bindings[0].source,
    fixtureWork, 'mutable fixture writable source must be the exact lamina/work scratch');
  assert.equal(validMutableSnapshot.writable_bindings[0].target,
    fixtureWork, 'mutable fixture writable target must be the exact lamina/work scratch');
  assert.equal(validMutableSnapshot.writable_bindings[0].kind, 'git-common-work-scratch');
  const mutableSnapshotTarget = path.join(
    validMutableSnapshot.snapshot_repository, '.git', 'lamina', 'work',
  );
  assert.equal(validMutableSnapshot.writable_bindings[0].snapshot_target,
    mutableSnapshotTarget);
  assert.equal(fs.lstatSync(mutableSnapshotTarget).isDirectory(), true,
    'sealed writable bind target must physically exist before sandbox mount construction');
  assert.equal(fs.realpathSync.native(mutableSnapshotTarget), mutableSnapshotTarget);
  assert.equal(assertExecutionSnapshot(validMutableSnapshot), true);
  const encodedMutableAuthority = JSON.parse(Buffer.from(
    encodeExecutionAuthority(validMutableSnapshot), 'base64url',
  ).toString('utf8'));
  const mutableSandboxContract = validateSandboxExecutionAuthority({
    executionAuthority: encodedMutableAuthority,
    authorityRoot: validMutableSnapshot.root,
    cwd: snapshotRepository,
    environment: {},
  });
  const mutableSandboxArgs = bubblewrapSandboxArguments({
    cwd: snapshotRepository,
    readyFile: path.join(root, 'mutable.ready'),
    releaseFile: path.join(root, 'mutable.release'),
    temporaryDirectory: path.join(root, 'mutable-payload-tmp'),
    command: validMutableSnapshot.launch_command,
    executionAuthority: encodedMutableAuthority,
    preservedEnvironmentNames: mutableSandboxContract.preservedEnvironmentNames,
    environment: {}, masks: { hiddenDirectories: [], sockets: [] },
  });
  const mutableBinding = encodedMutableAuthority.writable_bindings[0];
  const mutableRepositoryMount = mountOperationIndex(mutableSandboxArgs, '--ro-bind',
    encodedMutableAuthority.snapshot_repository, encodedMutableAuthority.repository);
  const mutableSourceTargetMount = mountOperationIndex(mutableSandboxArgs, '--bind',
    mutableBinding.source, mutableBinding.target);
  assert.equal(Object.hasOwn(mutableBinding, 'alias'), false);
  assert.ok(mutableRepositoryMount >= 0 && mutableRepositoryMount < mutableSourceTargetMount,
  'bwrap must seal the repository before directly binding the exact writable source to its target');
  assert.throws(() => validateSandboxExecutionAuthority({
    executionAuthority: {
      ...encodedMutableAuthority,
      writable_bindings: encodedMutableAuthority.writable_bindings.map((binding) => ({
        ...binding, kind: 'git-common-runtime',
      })),
    },
    authorityRoot: validMutableSnapshot.root,
    cwd: snapshotRepository,
    environment: {},
  }), /invalid execution authority/,
  'the former parent-runtime kind must fail at the sandbox authority boundary');
  assert.throws(() => validateSandboxExecutionAuthority({
    executionAuthority: {
      ...encodedMutableAuthority,
      writable_bindings: encodedMutableAuthority.writable_bindings.map((binding) => ({
        ...binding, alias: path.join(validMutableSnapshot.root, 'empty-alias'),
      })),
    },
    authorityRoot: validMutableSnapshot.root,
    cwd: snapshotRepository,
    environment: {},
  }), /invalid execution authority/,
  'legacy writable alias chaining must fail at the sandbox authority boundary');
  assert.throws(() => validateSandboxExecutionAuthority({
    executionAuthority: {
      ...encodedMutableAuthority,
      git_executable_identity: trustedHostBinary('git'),
    },
    authorityRoot: validMutableSnapshot.root,
    cwd: snapshotRepository,
    environment: {},
  }), /invalid execution authority/,
  'non-graph authority must reject an injected sealed Git identity');
  const originalMutableSnapshotTarget = `${mutableSnapshotTarget}-original`;
  fs.renameSync(mutableSnapshotTarget, originalMutableSnapshotTarget);
  assert.throws(() => validateSandboxExecutionAuthority({
    executionAuthority: encodedMutableAuthority,
    authorityRoot: validMutableSnapshot.root,
    cwd: snapshotRepository,
    environment: {},
  }), /invalid execution authority/,
  'a missing sealed bind target must fail sandbox authority validation');
  fs.symlinkSync(originalMutableSnapshotTarget, mutableSnapshotTarget);
  assert.throws(() => validateSandboxExecutionAuthority({
    executionAuthority: encodedMutableAuthority,
    authorityRoot: validMutableSnapshot.root,
    cwd: snapshotRepository,
    environment: {},
  }), /invalid execution authority/,
  'a symlinked sealed bind target must fail sandbox authority validation');
  fs.unlinkSync(mutableSnapshotTarget);
  fs.mkdirSync(mutableSnapshotTarget, { mode: 0o700 });
  assert.throws(() => assertExecutionSnapshot(validMutableSnapshot),
    /writable mount point identity changed/,
    'same-path replacement of the sealed bind target must fail snapshot continuity');
  assert.throws(() => validateSandboxExecutionAuthority({
    executionAuthority: encodedMutableAuthority,
    authorityRoot: validMutableSnapshot.root,
    cwd: snapshotRepository,
    environment: {},
  }), /invalid execution authority/,
  'same-path replacement of the sealed bind target must fail sandbox authority validation');
  fs.rmSync(mutableSnapshotTarget, { recursive: true, force: true });
  fs.renameSync(originalMutableSnapshotTarget, mutableSnapshotTarget);
  const outsideSnapshotTarget = path.join(validMutableSnapshot.root, 'outside-snapshot-target');
  fs.mkdirSync(outsideSnapshotTarget, { mode: 0o700 });
  const outsideSnapshotTargetStat = fs.lstatSync(outsideSnapshotTarget, { bigint: true });
  assert.throws(() => validateSandboxExecutionAuthority({
    executionAuthority: {
      ...encodedMutableAuthority,
      writable_bindings: encodedMutableAuthority.writable_bindings.map((binding) => ({
        ...binding,
        snapshot_target: outsideSnapshotTarget,
        snapshot_target_identity: {
          dev: String(outsideSnapshotTargetStat.dev),
          ino: String(outsideSnapshotTargetStat.ino),
          uid: Number(outsideSnapshotTargetStat.uid),
        },
      })),
    },
    authorityRoot: validMutableSnapshot.root,
    cwd: snapshotRepository,
    environment: {},
  }), /invalid execution authority/,
  'an out-of-authority sealed bind target must fail sandbox authority validation');
  assert.deepEqual(validMutableSnapshot.graphd_launch_authority, [],
    'mutable scratch fixture must not receive graphd launch authority');
  const graphdEntrypoint = path.join(snapshotRepository, 'tests', 'fixtures',
    'safe-runner-graphd-client.mjs');
  const graphdServer = path.join(snapshotRepository, 'tests', 'fixtures',
    'graph-runtime', 'server.mjs');
  fs.mkdirSync(path.dirname(graphdServer), { recursive: true });
  fs.writeFileSync(graphdEntrypoint, 'export const graphdFixture = true;\n');
  fs.writeFileSync(graphdServer, 'export const graphdServer = true;\n');
  const graphdRepository = path.join(fixtureWork, 'graphd-valid');
  fs.mkdirSync(graphdRepository);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: graphdRepository }).status, 0);
  const validGraphdSnapshot = prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: [fakeNode, graphdEntrypoint, graphdRepository],
    temporaryDirectory: path.join(root, 'snapshot-graphd-valid'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  });
  assert.equal(validGraphdSnapshot.writable_bindings.length, 1);
  assert.equal(validGraphdSnapshot.writable_bindings[0].source,
    fixtureWork, 'graphd fixture writable source must be the exact lamina/work scratch');
  assert.equal(validGraphdSnapshot.writable_bindings[0].target,
    fixtureWork, 'graphd fixture writable target must be the exact lamina/work scratch');
  assert.equal(validGraphdSnapshot.writable_bindings[0].kind, 'git-common-work-scratch');
  assert.equal(validGraphdSnapshot.writable_bindings[0].snapshot_target,
    path.join(validGraphdSnapshot.snapshot_repository, '.git', 'lamina', 'work'));
  assert.equal(fs.lstatSync(validGraphdSnapshot.writable_bindings[0].snapshot_target).isDirectory(),
    true, 'graphd writable bind target must be scaffolded in the sealed snapshot');
  assert.equal(assertExecutionSnapshot(validGraphdSnapshot), true);
  assert.deepEqual(validGraphdSnapshot.git_executable_identity, trustedHostBinary('git'),
    'graphd snapshot authority must capture trusted Git before entering the user namespace');
  const encodedGraphdAuthority = JSON.parse(Buffer.from(
    encodeExecutionAuthority(validGraphdSnapshot), 'base64url',
  ).toString('utf8'));
  const graphdSandboxContract = validateSandboxExecutionAuthority({
    executionAuthority: encodedGraphdAuthority,
    authorityRoot: validGraphdSnapshot.root,
    cwd: snapshotRepository,
    environment: {},
  });
  assert.match(graphdSandboxContract.sealedGitIdentity, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(JSON.parse(Buffer.from(
    graphdSandboxContract.sealedGitIdentity, 'base64url',
  ).toString('utf8')), validGraphdSnapshot.git_executable_identity);
  assert.throws(() => validateSandboxExecutionAuthority({
    executionAuthority: {
      ...encodedGraphdAuthority,
      git_executable_identity: {
        ...encodedGraphdAuthority.git_executable_identity,
        digest: '0'.repeat(64),
      },
    },
    authorityRoot: validGraphdSnapshot.root,
    cwd: snapshotRepository,
    environment: {},
  }), /invalid execution authority/,
  'sandbox host validation must reject a forged controller Git identity');
  assert.throws(() => validateSandboxExecutionAuthority({
    executionAuthority: { ...encodedGraphdAuthority, git_executable_identity: null },
    authorityRoot: validGraphdSnapshot.root,
    cwd: snapshotRepository,
    environment: {},
  }), /invalid execution authority/,
  'graphd authority must reject a missing controller-sealed Git identity');
  const graphdSandboxArgs = bubblewrapSandboxArguments({
    cwd: snapshotRepository,
    readyFile: path.join(root, 'graphd.ready'),
    releaseFile: path.join(root, 'graphd.release'),
    temporaryDirectory: path.join(root, 'graphd-payload-tmp'),
    command: validGraphdSnapshot.launch_command,
    executionAuthority: encodedGraphdAuthority,
    sealedGitIdentity: graphdSandboxContract.sealedGitIdentity,
    preservedEnvironmentNames: graphdSandboxContract.preservedEnvironmentNames,
    environment: { LAMINA_SAFE_GIT_IDENTITY: 'forged-inherited-value' },
    masks: { hiddenDirectories: [], sockets: [] },
  });
  const unsetGitIdentity = graphdSandboxArgs.findIndex((value, index) =>
    value === '--unsetenv' && graphdSandboxArgs[index + 1] === 'LAMINA_SAFE_GIT_IDENTITY');
  const setGitIdentity = graphdSandboxArgs.findIndex((value, index) =>
    value === '--setenv' && graphdSandboxArgs[index + 1] === 'LAMINA_SAFE_GIT_IDENTITY'
      && graphdSandboxArgs[index + 2] === graphdSandboxContract.sealedGitIdentity);
  assert.ok(unsetGitIdentity >= 0 && unsetGitIdentity < setGitIdentity,
    'bwrap must erase inherited Git identity data before setting host-validated sealed authority');
  const previousProbePath = process.env.PATH;
  const previousProbeIdentity = process.env.LAMINA_SAFE_GIT_IDENTITY;
  try {
    process.env.PATH = SAFE_INFRASTRUCTURE_PATH;
    process.env.LAMINA_SAFE_GIT_IDENTITY = graphdSandboxContract.sealedGitIdentity;
    const probeEvidence = sealedSandboxGitProbe(graphdRepository);
    assert.equal(process.env.LAMINA_SAFE_GIT_IDENTITY, undefined,
      'sealed Git identity must be consumed before the probe continues');
    assert.equal(probeEvidence.git.requested_path,
      validGraphdSnapshot.git_executable_identity.path);
    assert.equal(probeEvidence.git.digest, validGraphdSnapshot.git_executable_identity.digest);
    assert.equal(probeEvidence.git.controller_uid,
      validGraphdSnapshot.git_executable_identity.uid);
    assert.equal(Number.isInteger(probeEvidence.git.namespace_uid), true);
    assert.equal(probeEvidence.named_git_root, graphdRepository);
    const tamperedIdentity = {
      ...validGraphdSnapshot.git_executable_identity, digest: 'f'.repeat(64),
    };
    process.env.LAMINA_SAFE_GIT_IDENTITY = Buffer.from(
      JSON.stringify(tamperedIdentity),
    ).toString('base64url');
    assert.throws(() => sealedSandboxGitProbe(graphdRepository), /immutable identity changed/,
      'namespace probe must reject tampered sealed Git identity data');
    assert.equal(process.env.LAMINA_SAFE_GIT_IDENTITY, undefined,
      'rejected sealed Git identity must be consumed before validation');
    process.env.LAMINA_SAFE_GIT_IDENTITY = 'not-base64!';
    assert.throws(() => sealedSandboxGitProbe(graphdRepository), /missing or malformed/);
    assert.equal(process.env.LAMINA_SAFE_GIT_IDENTITY, undefined,
      'malformed sealed Git identity must be consumed before parsing');
  } finally {
    if (previousProbePath === undefined) delete process.env.PATH;
    else process.env.PATH = previousProbePath;
    if (previousProbeIdentity === undefined) delete process.env.LAMINA_SAFE_GIT_IDENTITY;
    else process.env.LAMINA_SAFE_GIT_IDENTITY = previousProbeIdentity;
  }
  assert.ok(graphdSandboxArgs.some((value, index) => value === fixtureWork
    && graphdSandboxArgs[index - 1] === '--bind'),
  'graphd fixture exact scratch must survive sandbox validation into bwrap mounts');
  assert.equal(validGraphdSnapshot.graphd_launch_authority.length, 1,
    'graphd-client scratch fixture must receive only its exact fixture graphd authority');
  assert.equal(validGraphdSnapshot.graphd_launch_authority[0].runtime_directory,
    path.join(graphdRepository, '.git', 'lamina'));
  const fixtureGraphdAuthority = validGraphdSnapshot.graphd_launch_authority[0];
  const fixtureGraphdChild = {
    argv: fixtureGraphdAuthority.argv,
    executable_identity: fixtureGraphdAuthority.executable_identity,
    environment_attestation: processEnvironmentAttestation(
      Buffer.from('PATH=/usr/bin\0LAMINA_SAFE_GRAPHD_RESERVATION=sealed\0'),
    ),
  };
  assert.equal(exactGraphdLaunchAuthorized(fixtureGraphdChild, {
    socket: path.join(fixtureGraphdAuthority.runtime_directory, 'graphd.sock'),
    lock: path.join(fixtureGraphdAuthority.runtime_directory, 'graphd.lock'),
  }, validGraphdSnapshot.graphd_launch_authority), true);
  const gitHookGraphdChild = {
    ...fixtureGraphdChild,
    environment_attestation: processEnvironmentAttestation(Buffer.from(
      'PATH=/usr/bin\0GIT_CONFIG_NOSYSTEM=1\0GIT_CONFIG_GLOBAL=/dev/null\0'
      + 'LAMINA_SAFE_GRAPHD_RESERVATION=sealed\0',
    )),
  };
  assert.deepEqual(gitHookGraphdChild.environment_attestation.execution_hooks,
    ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']);
  assert.equal(exactGraphdLaunchAuthorized(gitHookGraphdChild, {
    socket: path.join(fixtureGraphdAuthority.runtime_directory, 'graphd.sock'),
    lock: path.join(fixtureGraphdAuthority.runtime_directory, 'graphd.lock'),
  }, validGraphdSnapshot.graphd_launch_authority), false,
  'safe Git config overrides must still be removed before managed graphd launch');
  assert.equal(exactGraphdLaunchAuthorized(fixtureGraphdChild, {
    socket: path.join(snapshotRepository, '.git', 'lamina', 'graphd.sock'),
    lock: path.join(snapshotRepository, '.git', 'lamina', 'graphd.lock'),
  }, validGraphdSnapshot.graphd_launch_authority), false,
  'graphd-client fixture authority must remain bound to its nested scratch repository');
  const fixtureAlias = path.join(fixtureWork, 'alias');
  fs.symlinkSync(path.join(snapshotRepository, 'dist'), fixtureAlias);
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', mutableEntrypoint,
      path.join(fixtureAlias, 'result.txt')],
    temporaryDirectory: path.join(root, 'snapshot-output-alias'),
  }), /existing canonical physical directory/,
  'an ignored symlink alias must not redirect a writable binding');
  const prepareEntrypoint = path.join(snapshotRepository, 'scripts', 'prepare-retrieval-assets.mjs');
  fs.mkdirSync(path.dirname(prepareEntrypoint), { recursive: true });
  fs.writeFileSync(prepareEntrypoint, "export const prepare = true;\n");
  const requestedPrepareTarget = path.join(snapshotRepository, 'dist', 'must-not-exist', 'nested');
  const prepareTrackedBefore = syntheticTrackedStatus();
  const prepareDistBefore = fs.readdirSync(path.join(snapshotRepository, 'dist')).sort();
  const prepareTemporaryDirectory = path.join(root, 'snapshot-prepare-refusal');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository,
    command: ['/bin/sh', prepareEntrypoint, requestedPrepareTarget],
    temporaryDirectory: prepareTemporaryDirectory,
  }), (error) => error.message
    === repositoryOutputRefusal('scripts/prepare-retrieval-assets.mjs'),
  'retrieval-asset preparation must return its exact same-filesystem hard-quota refusal');
  assert.equal(fs.existsSync(path.join(prepareTemporaryDirectory, 'execution-authority')), false,
    'retrieval-asset preparation must refuse before snapshot authority creation');
  assert.equal(fs.existsSync(requestedPrepareTarget), false,
    'retrieval-asset refusal must not create its requested target');
  assert.deepEqual(fs.readdirSync(path.join(snapshotRepository, 'dist')).sort(), prepareDistBefore,
    'retrieval-asset refusal must preserve the existing dist tree');
  assert.equal(syntheticTrackedStatus(), prepareTrackedBefore,
    'retrieval-asset refusal must not change tracked files');
  const runtimeAuthority = path.join(snapshotRepository, '.git', 'lamina');
  const savedRuntimeAuthority = `${runtimeAuthority}.saved`;
  fs.renameSync(runtimeAuthority, savedRuntimeAuthority);
  fs.symlinkSync(path.join(snapshotRepository, 'dist'), runtimeAuthority);
  try {
    const ordinaryRuntimeSnapshot = prepareExecutionSnapshot({
      cwd: snapshotRepository, command: ['/bin/sh', path.join(snapshotRepository, 'entry.mjs')],
      temporaryDirectory: path.join(root, 'snapshot-runtime-symlink'),
    });
    assert.deepEqual(ordinaryRuntimeSnapshot.writable_bindings, [],
      'ordinary workloads must not inspect or bind a source Git-common runtime');
    assert.deepEqual(ordinaryRuntimeSnapshot.graphd_launch_authority, []);
  } finally {
    fs.unlinkSync(runtimeAuthority);
    fs.renameSync(savedRuntimeAuthority, runtimeAuthority);
  }

  if (process.platform === 'linux') {
  const linkedBase = path.join(root, 'linked-authority');
  const linkedPrimary = path.join(linkedBase, 'primary');
  const linkedWorktree = path.join(linkedBase, 'feature');
  fs.mkdirSync(linkedPrimary, { recursive: true });
  const linkedGit = (cwd, args) => {
    const result = spawnSync('/usr/bin/git', args, {
      cwd, encoding: 'utf8', env: {
        PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'C', LC_ALL: 'C',
      },
    });
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  linkedGit(linkedPrimary, ['init', '-b', 'main']);
  linkedGit(linkedPrimary, ['config', 'user.email', 'snapshot@lamina.invalid']);
  linkedGit(linkedPrimary, ['config', 'user.name', 'Snapshot Test']);
  fs.writeFileSync(path.join(linkedPrimary, 'entry.mjs'), "export const version = 'one';\n");
  const linkedMutableRelative = path.join('tests', 'fixtures', 'safe-runner-mutable.mjs');
  fs.mkdirSync(path.join(linkedPrimary, 'tests', 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(linkedPrimary, linkedMutableRelative),
    'export const mutableFixture = true;\n');
  linkedGit(linkedPrimary, ['add', 'entry.mjs', linkedMutableRelative]);
  linkedGit(linkedPrimary, ['commit', '-m', 'first']);
  fs.writeFileSync(path.join(linkedPrimary, 'history.txt'), 'second commit\n');
  linkedGit(linkedPrimary, ['add', 'history.txt']);
  linkedGit(linkedPrimary, ['commit', '-m', 'second']);
  linkedGit(linkedPrimary, ['worktree', 'add', '-b', 'feature', linkedWorktree]);
  fs.writeFileSync(path.join(linkedWorktree, 'entry.mjs'), "export const version = 'staged';\n");
  linkedGit(linkedWorktree, ['add', 'entry.mjs']);
  const linkedHeadBefore = linkedGit(linkedWorktree, ['rev-parse', 'HEAD']);
  const linkedHistoryBefore = linkedGit(linkedWorktree, ['rev-list', 'HEAD']);
  const fsmonitorSentinel = path.join(linkedBase, 'fsmonitor-executed');
  const hostileFsmonitor = path.join(linkedBase, 'hostile-fsmonitor.sh');
  fs.writeFileSync(hostileFsmonitor,
    `#!/bin/sh\ntouch ${JSON.stringify(fsmonitorSentinel)}\nexit 1\n`, { mode: 0o700 });
  linkedGit(linkedWorktree, ['config', 'core.fsmonitor', hostileFsmonitor]);
  linkedGit(linkedWorktree, ['config', 'core.hooksPath', path.join(linkedBase, 'hostile-hooks')]);
  linkedGit(linkedWorktree, ['config', 'credential.helper', '!false']);
  fs.rmSync(fsmonitorSentinel, { force: true });
  assert.throws(() => prepareExecutionSnapshot({
    cwd: linkedWorktree, command: ['/bin/sh', path.join(linkedWorktree, 'entry.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-linked-hostile-config'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  }), /executable Git (?:setting|section)/,
  'repository-local executable config must refuse before any Git subprocess runs');
  assert.equal(fs.existsSync(fsmonitorSentinel), false);
  linkedGit(linkedWorktree, ['config', '--unset-all', 'core.fsmonitor']);
  linkedGit(linkedWorktree, ['config', '--unset-all', 'core.hooksPath']);
  linkedGit(linkedWorktree, ['config', '--unset-all', 'credential.helper']);
  fs.rmSync(fsmonitorSentinel, { force: true });
  const linkedSnapshot = prepareExecutionSnapshot({
    cwd: linkedWorktree, command: ['/bin/sh', path.join(linkedWorktree, 'entry.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-linked'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  });
  assert.equal(fs.lstatSync(path.join(linkedSnapshot.snapshot_repository, '.git')).isFile(), true,
    'a linked snapshot must retain its descriptor-copied .git pointer');
  assert.equal(linkedSnapshot.git_readonly_bindings.length, 2);
  const linkedCommonBinding = linkedSnapshot.git_readonly_bindings.find((item) =>
    item.kind === 'git-common');
  const linkedWorktreeBinding = linkedSnapshot.git_readonly_bindings.find((item) =>
    item.kind === 'git-worktree');
  assert.equal(linkedCommonBinding.target, runtimePaths(linkedWorktree).common);
  assert.ok(linkedWorktreeBinding.source.startsWith(`${linkedCommonBinding.source}${path.sep}`));
  const sealedConfig = fs.readFileSync(path.join(linkedCommonBinding.source, 'config'), 'utf8');
  assert.match(sealedConfig, /^\s*fsmonitor = false$/m);
  assert.doesNotMatch(sealedConfig, /hostile|credential|include|sshcommand/i,
    'sealed Git authority must synthesize inert structural config, never copy executable config');
  assert.equal(fs.existsSync(fsmonitorSentinel), false,
    'execution snapshot Git reads must never execute repository-local fsmonitor');
  const sealedGit = (args) => linkedGit(linkedSnapshot.snapshot_repository, [
    `--git-dir=${linkedWorktreeBinding.source}`,
    `--work-tree=${linkedSnapshot.snapshot_repository}`,
    ...args,
  ]);
  assert.equal(sealedGit(['rev-parse', 'HEAD']), linkedHeadBefore);
  assert.equal(sealedGit(['rev-list', 'HEAD']), linkedHistoryBefore,
    'the packed authority must preserve bounded reachable ancestry');
  assert.match(sealedGit(['status', '--porcelain=v1']), /^M  entry\.mjs$/m,
    'the linked worktree index must preserve staged semantics');
  assert.equal(fs.existsSync(path.join(linkedCommonBinding.source,
    'objects', 'info', 'alternates')), false,
  'sealed objects must never retain a live external alternates dependency');
  linkedGit(linkedWorktree, ['commit', '-m', 'mutate live worktree']);
  fs.writeFileSync(path.join(linkedWorktree, 'entry.mjs'), "export const version = 'live replacement';\n");
  assert.equal(sealedGit(['rev-parse', 'HEAD']), linkedHeadBefore,
    'later live ref/index mutation must not alter sealed Git authority');
  assert.match(fs.readFileSync(path.join(linkedSnapshot.snapshot_repository, 'entry.mjs'), 'utf8'),
    /version = 'staged'/, 'later live source mutation must not alter sealed bytes');
  assert.deepEqual(linkedSnapshot.writable_bindings, [],
    'ordinary linked-worktree workloads must not receive Git-common write authority');
  assert.deepEqual(linkedSnapshot.graphd_launch_authority, [],
    'ordinary linked-worktree workloads must not receive managed graphd authority');
  const linkedSandboxArgs = bubblewrapSandboxArguments({
    cwd: linkedWorktree, readyFile: path.join(root, 'linked.ready'),
    releaseFile: path.join(root, 'linked.release'), temporaryDirectory: path.join(root, 'linked-tmp'),
    command: linkedSnapshot.launch_command, masks: { hiddenDirectories: [], sockets: [] },
    executionAuthority: linkedSnapshot,
  });
  assert.ok(linkedSandboxArgs.indexOf(linkedCommonBinding.source)
    < linkedSandboxArgs.indexOf(linkedWorktreeBinding.source),
  'sealed Git common authority must mount before nested worktree metadata');
  const linkedFixtureWork = path.join(runtimePaths(linkedWorktree).common, 'lamina', 'work');
  const linkedMutableDirectory = path.join(linkedFixtureWork, 'mutable-valid');
  fs.mkdirSync(linkedMutableDirectory, { recursive: true });
  const linkedMutableSnapshot = prepareExecutionSnapshot({
    cwd: linkedWorktree,
    command: ['/bin/sh', path.join(linkedWorktree, linkedMutableRelative),
      path.join(linkedMutableDirectory, 'result.txt')],
    temporaryDirectory: path.join(root, 'snapshot-linked-mutable'),
    infrastructure: { node: fakeNode, bwrap: fakeBwrap },
  });
  assert.equal(linkedMutableSnapshot.writable_bindings.length, 1);
  const linkedMutableBinding = linkedMutableSnapshot.writable_bindings[0];
  const linkedMutableCommon = linkedMutableSnapshot.git_readonly_bindings.find((item) =>
    item.kind === 'git-common');
  const linkedMutableWorktree = linkedMutableSnapshot.git_readonly_bindings.find((item) =>
    item.kind === 'git-worktree');
  assert.equal(linkedMutableBinding.source, linkedFixtureWork);
  assert.equal(linkedMutableBinding.snapshot_target,
    path.join(linkedMutableSnapshot.root, 'git-authority', 'common', 'lamina', 'work'),
    'linked fixture target must be scaffolded at the exact sealed Git-common backing');
  assert.equal(linkedMutableBinding.snapshot_target,
    path.join(linkedMutableCommon.source, 'lamina', 'work'));
  assert.equal(fs.lstatSync(linkedMutableBinding.snapshot_target).isDirectory(), true,
    'linked fixture bind target must exist in sealed Git-common authority before bwrap');
  assert.equal(fs.realpathSync.native(linkedMutableBinding.snapshot_target),
    linkedMutableBinding.snapshot_target);
  assert.equal(assertExecutionSnapshot(linkedMutableSnapshot), true);
  const encodedLinkedMutableAuthority = JSON.parse(Buffer.from(
    encodeExecutionAuthority(linkedMutableSnapshot), 'base64url',
  ).toString('utf8'));
  const linkedMutableContract = validateSandboxExecutionAuthority({
    executionAuthority: encodedLinkedMutableAuthority,
    authorityRoot: linkedMutableSnapshot.root,
    cwd: linkedWorktree,
    environment: {},
  });
  const linkedMutableArgs = bubblewrapSandboxArguments({
    cwd: linkedWorktree,
    readyFile: path.join(root, 'linked-mutable.ready'),
    releaseFile: path.join(root, 'linked-mutable.release'),
    temporaryDirectory: path.join(root, 'linked-mutable-tmp'),
    command: linkedMutableSnapshot.launch_command,
    masks: { hiddenDirectories: [], sockets: [] },
    executionAuthority: encodedLinkedMutableAuthority,
    preservedEnvironmentNames: linkedMutableContract.preservedEnvironmentNames,
    environment: {},
  });
  const linkedRepositoryMount = mountOperationIndex(linkedMutableArgs, '--ro-bind',
    linkedMutableSnapshot.snapshot_repository, linkedMutableSnapshot.repository);
  const linkedCommonMount = mountOperationIndex(linkedMutableArgs, '--ro-bind',
    linkedMutableCommon.source, linkedMutableCommon.target);
  const linkedWorktreeMount = mountOperationIndex(linkedMutableArgs, '--ro-bind',
    linkedMutableWorktree.source, linkedMutableWorktree.target);
  const linkedSourceTargetMount = mountOperationIndex(linkedMutableArgs, '--bind',
    linkedMutableBinding.source, linkedMutableBinding.target);
  assert.equal(Object.hasOwn(linkedMutableBinding, 'alias'), false);
  assert.ok(linkedRepositoryMount >= 0
    && linkedRepositoryMount < linkedCommonMount
    && linkedCommonMount < linkedWorktreeMount
    && linkedWorktreeMount < linkedSourceTargetMount,
  'linked bwrap mounts must seal repository and Git authorities before the exact direct scratch bind');
  fs.appendFileSync(path.join(linkedPrimary, '.git', 'config'),
    '\n[include]\n\tpath = /etc/gitconfig\n');
  assert.throws(() => prepareExecutionSnapshot({
    cwd: linkedWorktree, command: ['/bin/sh', path.join(linkedWorktree, 'entry.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-linked-include'),
  }), /executable Git section include/);
  const physicalGitdirWorktree = path.join(linkedBase, 'physical-gitdir-worktree');
  const physicalGitdir = path.join(physicalGitdirWorktree, '.git');
  fs.mkdirSync(physicalGitdir, { recursive: true });
  fs.writeFileSync(path.join(physicalGitdir, 'HEAD'), `ref: refs/heads/feature\n`);
  fs.writeFileSync(path.join(physicalGitdir, 'commondir'), `${path.join(linkedPrimary, '.git')}\n`);
  assert.equal(path.resolve(physicalGitdirWorktree,
    linkedGit(physicalGitdirWorktree, ['rev-parse', '--git-common-dir'])),
  path.join(linkedPrimary, '.git'),
  'the adversary must be a Git-recognized physical .git/commondir layout');
  const physicalGitdirProof = writableWorktreeProof(physicalGitdirWorktree, []);
  assert.equal(physicalGitdirProof.ok, false);
  assert.match(physicalGitdirProof.reason, /physical \.git directories with external commondir/,
    'filesystem discovery must refuse physical .git/commondir before any trusted Git spawn');
  }

  fs.symlinkSync('/etc/passwd', path.join(snapshotRepository, 'escape.mjs'));
  assert.throws(() => prepareExecutionSnapshot({
    cwd: snapshotRepository, command: ['/bin/sh', path.join(snapshotRepository, 'entry.mjs')],
    temporaryDirectory: path.join(root, 'snapshot-escape'),
  }), /escapes the repository/);
  assert.equal(validateReport({ ...report, unexpected: true }).valid, false);
  assert.equal(validateReport({
    ...report,
    cleanup: { ...report.cleanup, scope_removed: 'yes' },
  }).valid, false);
  assert.equal(validateReport({ ...report, samples: [] }).valid, false);
  assert.equal(validateReport({
    ...report,
    outcome: 'safety_limit_exceeded',
    termination: { ...report.termination, reason: 'safety_limit_exceeded', limit: null },
  }).valid, false);
  for (const [limit, code] of [
    ['enforcement_handshake', 'LAMINA_SAFE_ENFORCEMENT_UNPROVEN'],
    ['temporary_quota_handshake', 'LAMINA_SAFE_TEMP_QUOTA_UNPROVEN'],
    ['sandbox_launch', 'LAMINA_SAFE_SANDBOX_LAUNCH'],
  ]) {
    const handshakeFailure = structuredClone(report);
    handshakeFailure.outcome = outcomeForStop('internal_error');
    handshakeFailure.samples = [];
    handshakeFailure.termination.reason = 'internal_error';
    handshakeFailure.termination.limit = limit;
    handshakeFailure.error = {
      code,
      message: 'proof unavailable before payload release',
    };
    const validation = validateReport(handshakeFailure);
    assert.equal(validation.valid, true, validation.errors.join('; '));
  }
  assert.equal(outcomeForStop('safety_limit_exceeded'), 'safety_limit_exceeded');
  assert.equal(outcomeForStop('interrupted'), 'interrupted');
  assert.ok(SYSTEMCTL_READBACK_TIMEOUT_MS < DEFAULTS.scopeHandshakeMs,
    'one transient readback must not consume the complete handshake window');
  assert.ok(SYSTEMCTL_CONTROL_TIMEOUT_MS >= DEFAULTS.scopeHandshakeMs,
    'destructive systemd control operations retain their complete timeout');
  const timedOutReadback = new Error('spawnSync systemctl ETIMEDOUT at /tmp/private');
  timedOutReadback.code = 'ETIMEDOUT';
  const timedOutState = cgroupResolutionState({
    status: null,
    signal: 'SIGTERM',
    error: timedOutReadback,
    stderr: 'Authorization: Bearer diagnostic-secret',
  });
  assert.deepEqual({
    ok: timedOutState.ok,
    status: timedOutState.status,
    signal: timedOutState.signal,
    error_code: timedOutState.error_code,
  }, { ok: false, status: null, signal: 'SIGTERM', error_code: 'ETIMEDOUT' });
  assert.match(timedOutState.error_message, /ETIMEDOUT/);
  assert.match(timedOutState.stderr, /diagnostic-secret/,
    'the adapter retains raw in-memory evidence for the report sanitizer');
  assert.equal(systemdAbsenceProof({
    status: 0,
    stdout: 'LoadState=not-found\nControlGroup=\n',
  }, false), true);
  assert.equal(systemdAbsenceProof({
    status: 0,
    stdout: 'LoadState=loaded\nControlGroup=/user.slice/unit.scope\n',
  }, false), false);
  assert.equal(systemdAbsenceProof({
    status: 0,
    stdout: 'LoadState=not-found\nControlGroup=\n',
  }, true), false, 'a cached cgroup that still exists must prevent idempotent success');
  assert.equal(systemdAbsenceProof({
    status: null,
    error: new Error('D-Bus unavailable'),
    stdout: '',
  }, false), false, 'an unproven systemd lookup must fail closed');
  const unavailableAdapter = Object.assign(Object.create(LinuxSystemdAdapter.prototype), {
    limits: eightGib,
    resolveCgroup: () => null,
  });
  assert.deepEqual(unavailableAdapter.enforcementProof(), {
    ok: false,
    reason: 'cgroup path is unavailable',
    actual: null,
    expected: {
      memory_max_bytes: eightGib.memory_max_bytes,
      memory_high_bytes: eightGib.memory_high_bytes,
      pids_max: eightGib.pids_max,
    },
  });
  const diagnostic = boundedDiagnosticText(
    `Authorization: Bearer diagnostic-secret failed at /tmp/private/scope.ready ${'x'.repeat(1_200)}`,
  );
  assert.doesNotMatch(diagnostic, /diagnostic-secret|\/tmp\/private/);
  assert.match(diagnostic, /\[REDACTED\]|\[REDACTED_PATH\]/);
  assert.ok(diagnostic.length <= 1_000);
  const summarizedError = boundedCaseError({
    code: `LAMINA_${'X'.repeat(200)}`,
    message: 'Authorization: Bearer secret-token',
  });
  assert.equal(summarizedError.code.length, 128);
  assert.doesNotMatch(JSON.stringify(summarizedError), /secret-token/);
  assert.equal(boundedCaseError({ code: 'TEST', message: 'y'.repeat(600) }).message.length, 500);
  const unwritableParent = path.join(root, 'not-a-directory');
  fs.writeFileSync(unwritableParent, 'file');
  const fallbackReport = structuredClone(report);
  const fallback = writeReportWithFallback(path.join(unwritableParent, 'report.json'), fallbackReport);
  assert.equal(fallback.fallback, true);
  assert.equal(validateReport(JSON.parse(fs.readFileSync(fallback.path))).valid, true);
  fs.rmSync(fallback.path, { force: true });

  const priorBroker = process.env.LAMINA_SAFE_RUNNER_BROKER;
  const priorContext = process.env.LAMINA_SAFE_RUNNER_CONTEXT;
  const priorToken = process.env.LAMINA_SAFE_RUNNER_TOKEN;
  process.env.LAMINA_SAFE_RUNNER_CONTEXT = JSON.stringify({
    schema: 'lamina.safe-runner-context/v1', tier: 'large', adapter: 'linux-systemd-cgroup-v2',
  });
  process.env.LAMINA_SAFE_RUNNER_TOKEN = 'caller-forged';
  process.env.LAMINA_SAFE_RUNNER_BROKER = path.join(root, 'caller-forged.sock');
  assert.equal(safeRunnerContext(), null, 'caller-authored environment must never authorize work');
  if (priorBroker === undefined) delete process.env.LAMINA_SAFE_RUNNER_BROKER;
  else process.env.LAMINA_SAFE_RUNNER_BROKER = priorBroker;
  if (priorContext === undefined) delete process.env.LAMINA_SAFE_RUNNER_CONTEXT;
  else process.env.LAMINA_SAFE_RUNNER_CONTEXT = priorContext;
  if (priorToken === undefined) delete process.env.LAMINA_SAFE_RUNNER_TOKEN;
  else process.env.LAMINA_SAFE_RUNNER_TOKEN = priorToken;

  const requester = { pid: 41000, ppid: 1, start_ticks: '99', command: 'node guarded.mjs' };
  const authorityRecords = [requester];
  const brokerRegistrations = [];
  const brokerReservations = [];
  const authority = {
    runId: 'unit', tier: 'small', adapter: 'linux-systemd-cgroup-v2',
    unit: 'lamina-safe-unit.scope', cgroup: '/unit',
    enforcement: { memory_max_bytes: 1, memory_high_bytes: 1, pids_max: 1 },
    registrations: brokerRegistrations,
    reservations: brokerReservations,
    records: () => authorityRecords,
    reserve: (record) => { brokerReservations.push(record); return record; },
    bind: (record) => {
      brokerRegistrations.push(record);
      const reserved = brokerReservations.find((item) => item.token === record.reservation);
      if (reserved) reserved.bound = {
        pid: record.pid, namespace_pid: record.namespace_pid, start_ticks: record.start_ticks,
      };
      return true;
    },
    release: (record) => {
      const reserved = brokerReservations.find((item) => item.token === record.reservation);
      if (reserved) reserved.released = true;
      return Boolean(reserved);
    },
    lockReady: () => true,
    seal: () => [{ state: 'sealed' }],
    graphdLaunchAuthorized: (child) => Array.isArray(child.argv)
      && child.argv[0] === process.execPath
      && child.argv[1] === '/repo/packages/cli/lib/graph-runtime/server.mjs'
      && child.argv[2] === '/repo'
      && child.executable_identity?.dev === 'sealed-node-dev'
      && child.executable_identity?.ino === 'sealed-node-ino',
  };
  assert.equal(authorizeBrokerRequest({
    operation: 'context', requester, minimum_tier: 'small',
  }, authority).ok, true);
  assert.equal(authorizeBrokerRequest({
    operation: 'context', requester, minimum_tier: 'medium',
  }, authority).ok, false, 'a child cannot escalate its tier');
  assert.equal(authorizeBrokerRequest({
    operation: 'context', requester: { ...requester, start_ticks: 'tampered' }, minimum_tier: 'small',
  }, authority).ok, false, 'PID identity tampering must fail');
  assert.equal(authorizeBrokerRequest({
    operation: 'context', requester, minimum_tier: 'small',
  }, { ...authority, unit: '' }).ok, false, 'an empty unit must fail closed');
  for (const [label, argv] of [
    ['spoof argv', [process.execPath, '/tmp/spoof.mjs', '--graphd', '/repo']],
    ['spoof script', [process.execPath, '/tmp/graph-runtime/server.mjs', '/repo']],
    ['spoof executable', ['/tmp/node', '/repo/packages/cli/lib/graph-runtime/server.mjs', '/repo']],
    ['spoof process title', [process.execPath, '/repo/packages/cli/lib/graph-runtime/server.mjs', '/repo']],
  ]) {
    const spoof = {
      pid: 42000 + authorityRecords.length, ppid: requester.pid,
      start_ticks: `spoof-${authorityRecords.length}`, argv, command: argv.join(' '), cwd: '/repo',
      executable_identity: label === 'spoof process title'
        ? { dev: 'bin-sh-dev', ino: 'bin-sh-ino', uid: 0 }
        : { dev: 'sealed-node-dev', ino: 'sealed-node-ino', uid: 0 },
    };
    authorityRecords.push(spoof);
    const spoofReservation = authorizeBrokerRequest({
      operation: 'reserve_graphd', requester,
      socket: `/repo/.git/${label.replaceAll(' ', '-')}/graphd.sock`,
      lock: `/repo/.git/${label.replaceAll(' ', '-')}/graphd.lock`,
    }, authority);
    assert.equal(spoofReservation.ok, true);
    assert.equal(authorizeBrokerRequest({
      operation: 'bind_graphd', requester, reservation: spoofReservation.reservation,
      child: { pid: spoof.pid, start_ticks: spoof.start_ticks },
    }, authority).ok, false, `${label} must not gain the managed-daemon exception`);
  }
  const brokerDirectory = path.join(root, 'broker-close');
  fs.mkdirSync(brokerDirectory);
  const liveBroker = await createProofBroker(brokerDirectory, authority);
  const halfOpenClient = net.createConnection(liveBroker.socketPath);
  await once(halfOpenClient, 'connect');
  const brokerCloseStarted = Date.now();
  await liveBroker.close();
  assert.ok(Date.now() - brokerCloseStarted < 1_000,
    'broker cleanup must be bounded when a requester dies before sending a complete request');

  const limitedBrokerDirectory = path.join(root, 'broker-limits');
  fs.mkdirSync(limitedBrokerDirectory);
  const limitedBroker = await createProofBroker(limitedBrokerDirectory, authority, {
    maxConnections: 1, idleTimeoutMs: 75, maxRequestsPerWindow: 1, requestWindowMs: 1_000,
  });
  const saturated = net.createConnection(limitedBroker.socketPath);
  await once(saturated, 'connect');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const refusedAtCap = net.createConnection(limitedBroker.socketPath);
  refusedAtCap.on('error', () => {});
  await Promise.race([
    once(refusedAtCap, 'close'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('broker cap did not close')), 500)),
  ]);
  await Promise.race([
    once(saturated, 'close'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('idle broker request did not expire')), 500)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const brokerRpc = (broker, frames) => new Promise((resolve, reject) => {
    const socket = net.createConnection(broker.socketPath);
    let response = '';
    const deadline = setTimeout(() => { socket.destroy(); reject(new Error('broker rpc timeout')); }, 500);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(frames));
    socket.on('data', (chunk) => { response += chunk; });
    socket.once('error', reject);
    socket.once('close', () => {
      clearTimeout(deadline);
      try { resolve(JSON.parse(response.trim())); } catch (error) { reject(error); }
    });
  });
  const contextFrame = `${JSON.stringify({
    operation: 'context', requester, minimum_tier: 'small',
  })}\n`;
  assert.equal((await brokerRpc(limitedBroker, contextFrame)).ok, true,
    'a valid request must succeed after the saturated idle connection expires');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match((await brokerRpc(limitedBroker, contextFrame)).error, /rate exceeded/,
    'sequential reconnects must remain under a bounded aggregate request rate');
  await limitedBroker.close();

  const oneRequestDirectory = path.join(root, 'broker-one-request');
  fs.mkdirSync(oneRequestDirectory);
  const oneRequestBroker = await createProofBroker(oneRequestDirectory, authority);
  const pipelined = await brokerRpc(oneRequestBroker, `${contextFrame}${contextFrame}`);
  assert.equal(pipelined.ok, false);
  assert.match(pipelined.error, /exactly one request/);
  await oneRequestBroker.close();

  const responseDeadlineDirectory = path.join(root, 'broker-response-deadline');
  fs.mkdirSync(responseDeadlineDirectory);
  const responseDeadlineBroker = await createProofBroker(responseDeadlineDirectory, authority, {
    maxConnections: 16, idleTimeoutMs: 60, maxRequestsPerWindow: 64, requestWindowMs: 1_000,
  });
  const validHalfOpenClients = await Promise.all(Array.from({ length: 16 }, () =>
    new Promise((resolve, reject) => {
      const socket = net.createConnection({ path: responseDeadlineBroker.socketPath, allowHalfOpen: true });
      const deadline = setTimeout(() => { socket.destroy(); reject(new Error('half-open response timeout')); }, 500);
      socket.setEncoding('utf8');
      socket.once('connect', () => socket.write(contextFrame));
      socket.once('data', (value) => {
        clearTimeout(deadline);
        assert.equal(JSON.parse(value.trim()).ok, true);
        resolve(socket);
      });
      socket.once('error', reject);
    })));
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal((await brokerRpc(responseDeadlineBroker, contextFrame)).ok, true,
    'valid clients withholding FIN must be reclaimed by the post-response deadline');
  for (const socket of validHalfOpenClients) socket.destroy();
  await responseDeadlineBroker.close();

  const authorizedGraphd = {
    pid: 41001, ppid: requester.pid, start_ticks: '100',
    command: `${process.execPath} /repo/packages/cli/lib/graph-runtime/server.mjs /repo`,
    argv: [process.execPath, '/repo/packages/cli/lib/graph-runtime/server.mjs', '/repo'],
    cwd: '/repo',
    executable_identity: { dev: 'sealed-node-dev', ino: 'sealed-node-ino', uid: 0 },
  };
  for (const command of [
    `${process.execPath} /repo/packages/cli/lib/graph-runtime/server.mjs /repo`,
    `${process.execPath} /tmp/lamina/runtime/app/lib/graph-runtime/server.mjs /repo`,
    '/usr/local/bin/lamina-linux-x64 --graphd /repo',
    '/opt/lamina/runtime/cocoindex-worker retrieval serve',
    '/tmp/lamina-cocoindex-worker-linux-x64 observe',
    `${process.execPath} /repo/packages/cli/retrieval_worker.py serve`,
  ]) assert.equal(isLaminaProcessCommand(command), true, command);
  for (const command of [
    `${process.execPath} tests/tiny.mjs`,
    'gh run view 123 --repo aryaniyaps/lamina',
    `${process.execPath} tests/tiny.mjs /repo/lamina`,
    'tool --graphd /repo',
    'sh -c /usr/local/bin/lamina',
  ]) assert.equal(isLaminaProcessCommand(command), false, command);
  assert.throws(
    () => assertSystemctlSuccess({ status: 1, stderr: 'access denied' }, 'systemctl stop unit'),
    /systemctl stop unit failed: access denied/,
  );
  assert.equal(parseSystemdMajor('systemd 249 (249.11-0ubuntu3.17)'), 249);
  assert.equal(parseSystemdMajor('systemd 259 (259.5-0ubuntu3)'), 259);
  assert.deepEqual(systemdKillArguments('SIGKILL', 'lamina-safe-unit.scope', 249), [
    'kill', '--kill-who=all', '--signal=SIGKILL', 'lamina-safe-unit.scope',
  ]);
  assert.deepEqual(systemdKillArguments('SIGTERM', 'lamina-safe-unit.scope', 252), [
    'kill', '--kill-whom=all', '--signal=SIGTERM', 'lamina-safe-unit.scope',
  ]);
  assert.throws(() => parseSystemdMajor('not systemd'), /unsupported or unparsable/);
  assert.throws(() => systemdKillArguments('SIGTERM', 'unit.scope', 248), /unsupported/);
  const scopeProperties = systemdScopeProperties({
    memory_max_bytes: 100,
    memory_high_bytes: 80,
    pids_max: 8,
    timeout_ms: 1_000,
    graceful_stop_ms: 100,
  }).join(' ');
  for (const required of [
    'MemoryAccounting=yes', 'MemoryMax=100', 'MemoryHigh=80',
    'TasksAccounting=yes', 'TasksMax=8', 'KillMode=control-group',
    'SendSIGKILL=yes', 'RuntimeMaxSec=7s',
  ]) assert.match(scopeProperties, new RegExp(required));
  assert.doesNotMatch(scopeProperties, /OOMPolicy/);
  assert.equal(await stopIncompatibleServer({
    root,
    lock: path.join(root, 'missing-graphd.lock'),
    token: path.join(root, 'missing-graphd.token'),
  }), undefined, 'stopping an absent graphd must complete without a stray response reference');
  if (process.platform === 'linux') {
    const sourceGraphd = spawn(process.execPath, [
      '-e', 'setInterval(() => {}, 1_000)', '/repo/packages/cli/lib/graph-runtime/server.mjs',
    ], { stdio: 'ignore' });
    try {
      let found = [];
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        found = existingLaminaProcesses();
        if (found.some((record) => record.pid === sourceGraphd.pid)) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(found.some((record) => record.pid === sourceGraphd.pid),
        'a pre-existing source graphd must be detected outside a new scope');
      const refused = preflightRun({
        tier: 'small', command: [process.execPath, 'tests/tiny.mjs'], cwd: root,
        adapterInfo: portableProbe, injectedExistingProcesses: found,
      });
      assert.equal(refused.ok, false);
      assert.match(refused.reasons.join('\n'), new RegExp(`existing Lamina processes.*${sourceGraphd.pid}`));
    } finally {
      sourceGraphd.kill('SIGTERM');
      if (sourceGraphd.exitCode === null) await once(sourceGraphd, 'exit');
    }
  }

  const managedRegistrations = [{
    pid: 41001,
    start_ticks: '100',
    role: 'graphd',
    socket: '/repo/.git/lamina/graphd.sock',
    lock: '/repo/.git/lamina/graphd.lock',
  }];
  const graphdRecord = { ...authorizedGraphd, ppid: 1 };
  const graphdWorker = {
    pid: 41002, ppid: graphdRecord.pid, start_ticks: '101', command: 'retrieval_worker.py',
  };
  assert.deepEqual(registeredManagedGraphd(managedRegistrations, [graphdRecord]), [{
    ...graphdRecord,
    managed_socket: managedRegistrations[0].socket,
    managed_lock: managedRegistrations[0].lock,
  }]);
  authorityRecords.push(graphdRecord);
  const reservation = authorizeBrokerRequest({
    operation: 'reserve_graphd', requester,
    socket: managedRegistrations[0].socket,
    lock: managedRegistrations[0].lock,
  }, authority);
  assert.equal(reservation.ok, true);
  assert.equal(authorizeBrokerRequest({
    operation: 'bind_graphd', reservation: reservation.reservation,
    requester,
    child: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
  }, authority).ok, true);
  assert.equal(brokerRegistrations.length, 1);
  assert.equal(authorizeBrokerRequest({
    operation: 'start_graphd', reservation: reservation.reservation,
    requester: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
  }, authority).ok, true);
  assert.equal(authorizeBrokerRequest({
    operation: 'graphd_lock_ready', reservation: reservation.reservation,
    requester: { pid: graphdRecord.pid, start_ticks: graphdRecord.start_ticks },
  }, authority).ok, true);
  assert.equal(authorizeBrokerRequest({
    operation: 'seal_graphd', reservation: reservation.reservation, requester,
  }, authority).ok, true);
  assert.equal(authorizeBrokerRequest({
    operation: 'bind_graphd', requester, reservation: reservation.reservation,
    child: { pid: graphdRecord.pid, start_ticks: 'forged' },
  }, authority).ok, false, 'payload cannot self-assert a graphd identity');
  assert.equal(authorizeBrokerRequest({
    operation: 'reserve_graphd',
    requester,
    socket: 'relative.sock',
    lock: 'relative.lock',
  }, authority).ok, false);
  assert.equal(
    classifyRemainingDescendants(managedRegistrations, [graphdRecord, graphdWorker]).kind,
    'managed_graphd',
  );
  assert.equal(classifyRemainingDescendants([], [{
    pid: 77, start_ticks: 'new', state: 'S', command: 'reused-pid',
  }], [{ pid: 77, start_ticks: 'old' }]).kind, 'unmanaged',
  'a reused infrastructure PID must not be ignored without its exact start identity');
  assert.equal(
    classifyRemainingDescendants(managedRegistrations, [graphdRecord, {
      pid: 41004, ppid: 1, start_ticks: '103', state: 'Z', command: '',
    }]).kind,
    'managed_graphd',
  );
  assert.equal(
    classifyRemainingDescendants(managedRegistrations, [graphdRecord, graphdWorker, {
      pid: 41003, ppid: 1, start_ticks: '102', command: 'unregistered-daemon',
    }]).kind,
    'unmanaged',
  );
  assert.deepEqual(registeredManagedGraphd([
    { pid: 41001, start_ticks: 'wrong', role: 'graphd' },
  ], [graphdRecord]), []);

  const leaveExactRepository = path.join(root, 'leave-exact-graph-repository');
  fs.mkdirSync(leaveExactRepository);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: leaveExactRepository }).status, 0);
  const leaveExactPaths = runtimePaths(leaveExactRepository);
  const leaveExactEnvironment = graphdEnvironment();
  delete leaveExactEnvironment.LAMINA_SAFE_RUNNER_BROKER;
  delete leaveExactEnvironment.LAMINA_SAFE_GRAPHD_RESERVATION;
  const leaveExactChild = spawn(process.execPath, [
    path.resolve('tests/fixtures/graph-runtime/server.mjs'), leaveExactRepository, 'leave-exact',
  ], { stdio: 'ignore', env: leaveExactEnvironment });
  const leaveExactExit = once(leaveExactChild, 'exit');
  const leaveExactIdentity = (file) => {
    const stat = fs.lstatSync(file, { bigint: true });
    return { dev: String(stat.dev), ino: String(stat.ino), type: stat.isSocket() ? 'socket' : 'file' };
  };
  try {
    const leaveExactDeadline = Date.now() + 2_000;
    while (Date.now() < leaveExactDeadline
      && (!lstatPresence(leaveExactPaths.socket).exists
        || !lstatPresence(leaveExactPaths.lock).exists)) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(lstatPresence(leaveExactPaths.socket).stat?.isSocket(), true);
    assert.equal(lstatPresence(leaveExactPaths.lock).stat?.isFile(), true);
    const leaveExactSocketIdentity = leaveExactIdentity(leaveExactPaths.socket);
    const leaveExactLockIdentity = leaveExactIdentity(leaveExactPaths.lock);
    leaveExactChild.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(leaveExactChild.exitCode, null,
      'leave-exact graphd must remain alive until the supervisor sends SIGKILL');
    assert.deepEqual(leaveExactIdentity(leaveExactPaths.socket), leaveExactSocketIdentity);
    assert.deepEqual(leaveExactIdentity(leaveExactPaths.lock), leaveExactLockIdentity);
    leaveExactChild.kill('SIGKILL');
    await leaveExactExit;
    assert.deepEqual(leaveExactIdentity(leaveExactPaths.socket), leaveExactSocketIdentity,
      'abrupt graphd termination must leave the exact sealed socket for supervisor cleanup');
    assert.deepEqual(leaveExactIdentity(leaveExactPaths.lock), leaveExactLockIdentity,
      'abrupt graphd termination must leave the exact sealed lock for supervisor cleanup');
  } finally {
    if (leaveExactChild.exitCode === null && leaveExactChild.signalCode === null) {
      leaveExactChild.kill('SIGKILL');
      await Promise.race([
        leaveExactExit,
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
    fs.rmSync(leaveExactPaths.socket, { force: true });
    fs.rmSync(leaveExactPaths.lock, { force: true });
  }

  const managedRoot = path.join(root, 'managed-objects');
  fs.mkdirSync(managedRoot);
  const managedSocket = path.join(managedRoot, 'graphd.sock');
  const managedLock = path.join(managedRoot, 'graphd.lock');
  const reservationToken = 'a'.repeat(64);
  const reservedObjects = reserveManagedObjects(managedSocket, managedLock, reservationToken);
  assert.equal(reservedObjects.every((item) => item.state === 'reserved'), true);
  const boundObjects = bindManagedObjects(reservedObjects, [process.pid, 2]);
  assert.equal(boundObjects.every((item) => item.state === 'bound'), true);
  assert.deepEqual(removeManagedObjects(boundObjects), [], 'absent bound objects are already clean');
  const authorizedObjects = authorizeManagedObjects(boundObjects);
  assert.equal(authorizedObjects.every((item) => item.state === 'authorized'), true);
  const lockOnlyRoot = path.join(root, 'managed-lock-only');
  fs.mkdirSync(lockOnlyRoot);
  const lockOnlySocket = path.join(lockOnlyRoot, 'graphd.sock');
  const lockOnlyLock = path.join(lockOnlyRoot, 'graphd.lock');
  const lockOnlyReserved = reserveManagedObjects(lockOnlySocket, lockOnlyLock, reservationToken);
  const lockOnlyAuthorized = authorizeManagedObjects(
    bindManagedObjects(lockOnlyReserved, [process.pid]),
  );
  fs.writeFileSync(lockOnlyLock, `${JSON.stringify({
    pid: process.pid, safe_runner_reservation: reservationToken,
  })}\n`);
  assert.deepEqual(removeManagedObjects(lockOnlyAuthorized), [],
    'an authorized exact lock may be cleaned before its socket is created');
  const replacementReserved = reserveManagedObjects(lockOnlySocket, lockOnlyLock, reservationToken);
  const replacementAuthorized = authorizeManagedObjects(
    bindManagedObjects(replacementReserved, [process.pid]),
  );
  fs.writeFileSync(lockOnlyLock, `${JSON.stringify({
    pid: process.pid, safe_runner_reservation: 'b'.repeat(64),
  })}\n`);
  assert.deepEqual(removeManagedObjects(replacementAuthorized), [lockOnlyLock],
    'a wrong-token reservation replacement must survive cleanup');
  fs.unlinkSync(lockOnlyLock);
  fs.writeFileSync(managedLock, `${JSON.stringify({
    pid: process.pid, safe_runner_reservation: reservationToken,
  })}\n`);
  const managedServer = net.createServer(() => {});
  await new Promise((resolve, reject) => managedServer.listen(managedSocket, resolve).once('error', reject));
  const sealedObjects = sealManagedObjects(authorizedObjects);
  assert.equal(sealedObjects.every((item) => item.state === 'sealed'), true);
  const lockRecord = sealedObjects.find((item) => item.type === 'lock');
  const originalLock = `${managedLock}.original`;
  const refusedToctou = removeManagedObjects(sealedObjects, {
    beforeUnlink(record) {
      if (record.type !== 'lock') return;
      fs.renameSync(managedLock, originalLock);
      fs.writeFileSync(managedLock, 'foreign same-uid replacement\n');
    },
  });
  assert.deepEqual(refusedToctou, [managedLock]);
  assert.equal(fs.readFileSync(managedLock, 'utf8'), 'foreign same-uid replacement\n');
  assert.equal(lstatPresence(managedSocket).exists, false);
  fs.rmSync(managedLock);
  fs.rmSync(originalLock);
  await new Promise((resolve) => managedServer.close(resolve));
  fs.symlinkSync(path.join(managedRoot, 'absent-target'), managedSocket);
  assert.equal(lstatPresence(managedSocket).exists, true, 'dangling symlink is present by lstat');
  assert.equal(reserveManagedObjects(managedSocket, managedLock, reservationToken), null);
  fs.unlinkSync(managedSocket);
  fs.symlinkSync(path.join(managedRoot, 'absent-lock-target'), managedLock);
  assert.equal(lstatPresence(managedLock).exists, true, 'dangling lock symlink is present by lstat');
  assert.equal(reserveManagedObjects(managedSocket, managedLock, reservationToken), null);
  fs.unlinkSync(managedLock);
  const unsealedObjects = bindManagedObjects(
    reserveManagedObjects(managedSocket, managedLock, reservationToken), [process.pid, 2],
  );
  fs.writeFileSync(managedLock, `${JSON.stringify({
    pid: process.pid, safe_runner_reservation: 'b'.repeat(64),
  })}\n`);
  const foreignServer = net.createServer(() => {});
  await new Promise((resolve, reject) => foreignServer.listen(managedSocket, resolve).once('error', reject));
  assert.deepEqual(removeManagedObjects(unsealedObjects), [managedSocket, managedLock],
    'unsealed objects without the reservation-bound lock proof must remain incomplete');
  fs.unlinkSync(managedSocket);
  fs.unlinkSync(managedLock);
  await new Promise((resolve) => foreignServer.close(resolve));
  assert.ok(reserveManagedObjects(managedSocket, managedLock, reservationToken),
    'a subsequent run can reserve after exact path recovery');
  assert.equal(lockRecord.object_identity.lock_pid, process.pid);

  if (process.platform === 'linux') {
    const claims = path.join(root, 'production-locks');
    fs.mkdirSync(claims, { recursive: true, mode: 0o755 });
    assert.throws(() => acquireConcurrencyLock({ directory: claims }),
      /physical same-user mode-0700/);
    fs.chmodSync(claims, 0o700);
    fs.writeFileSync(path.join(claims, 'stale.json'), JSON.stringify({
      pid: process.pid, start_ticks: 'stale', nonce: 'never-reused',
      scope: { adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-stale.scope', cgroup: null },
    }));
    const lock = acquireConcurrencyLock({ directory: claims, proveScopeAbsent: () => true,
      scope: { adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-current.scope', cgroup: null } });
    assert.throws(() => acquireConcurrencyLock({ directory: claims }), /another medium\/large safe-runner/);
    assert.equal(lock.release(), true);
    assert.deepEqual(fs.readdirSync(claims), []);
    const replacementLock = acquireConcurrencyLock({
      directory: claims,
      scope: { adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-replacement.scope', cgroup: null },
      proveScopeAbsent: () => true,
    });
    const copiedClaim = fs.readFileSync(replacementLock.file, 'utf8');
    const originalClaim = `${replacementLock.file}.original`;
    fs.renameSync(replacementLock.file, originalClaim);
    fs.writeFileSync(replacementLock.file, copiedClaim, { mode: 0o600 });
    assert.throws(() => replacementLock.release(), /file identity changed/);
    assert.equal(fs.existsSync(replacementLock.file), true,
      'same-content replacement claim must not be unlinked');
    fs.rmSync(replacementLock.file);
    fs.rmSync(originalClaim);
    const staleRace = path.join(claims, 'stale-race.json');
    const staleRaceValue = JSON.stringify({
      pid: process.pid, start_ticks: 'stale-race', nonce: 'copied-nonce',
      scope: { adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-stale-race.scope', cgroup: null },
    });
    fs.writeFileSync(staleRace, staleRaceValue);
    assert.throws(() => acquireConcurrencyLock({
      directory: claims,
      scope: { adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-new-race.scope', cgroup: null },
      proveScopeAbsent() {
        fs.renameSync(staleRace, `${staleRace}.original`);
        fs.writeFileSync(staleRace, staleRaceValue);
        return true;
      },
    }), /identity changed during absence proof/);
    assert.equal(fs.existsSync(staleRace), true);
    fs.rmSync(staleRace);
    fs.rmSync(`${staleRace}.original`);
    const childOwned = acquireConcurrencyLock({
      scope: { adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-adopted.scope', cgroup: null },
      proveScopeAbsent: () => true,
    });
    const adopted = adoptConcurrencyLock(childOwned.file, childOwned.identity());
    assert.equal(adopted.updateScope({
      adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-adopted.scope', cgroup: '/ignored',
    }), true);
    assert.throws(() => adopted.updateScope({
      adapter: 'linux-systemd-cgroup-v2', unit: 'lamina-safe-replaced.scope', cgroup: null,
    }), /refusing to change the exact unit/);
    assert.equal(adopted.release(), true, 'controller proxy must release the exact child-owned claim');
  }
  const globalLock = productionLockDirectory();
  process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(root, 'different-state');
  assert.equal(productionLockDirectory(), globalLock, 'state override must not split the host-global lock');

  assert.throws(() => recordPromotion(root, 'small', { outcome: 'success' }), /verified cleanup/);
  assert.throws(() => recordPromotion(root, 'small', report), /--workload/);
  const auditedEvidence = {
    ...report,
    command: [process.execPath, path.resolve('tests/fixtures/safe-runner-adversary.mjs'), 'success'],
  };
  recordPromotion(root, 'small', auditedEvidence, 'unit-workload', auditedEvidence.command);
  assert.equal(checkPromotion(root, 'medium', 'unit-workload', auditedEvidence.command).ok, true);
  assert.equal(checkPromotion(root, 'medium', 'unit-workload', [
    ...auditedEvidence.command, '--different-workload-semantics',
  ]).ok, false, 'promotion must bind the complete normalized argv');
  const unrelatedCommand = ['node', path.join(root, 'unrelated.mjs')];
  fs.writeFileSync(unrelatedCommand[1], 'export {};\n');
  assert.equal(checkPromotion(root, 'medium', 'unit-workload', [
    process.execPath, path.resolve('tests/fixtures/safe-runner-graphd-client.mjs'),
  ]).ok, false);
  const sealedIdentityA = bindExecutionSnapshotIdentity({ digest: 'a'.repeat(64) }, 'b'.repeat(64));
  const sealedIdentityB = bindExecutionSnapshotIdentity({ digest: 'a'.repeat(64) }, 'c'.repeat(64));
  recordPromotion(root, 'small', auditedEvidence, 'sealed-unit-workload',
    auditedEvidence.command, sealedIdentityA);
  assert.equal(checkPromotion(root, 'medium', 'sealed-unit-workload', auditedEvidence.command,
    sealedIdentityA).ok, true);
  assert.equal(checkPromotion(root, 'medium', 'sealed-unit-workload', auditedEvidence.command,
    sealedIdentityB).ok, false,
  'small-to-medium promotion must bind dependency/tool bytes through the execution snapshot digest');
  assert.throws(
    () => promotionCommandDigest(root, unrelatedCommand),
    (error) => error.code === 'LAMINA_SAFE_SOURCE_IDENTITY',
  );
  const sourceRepository = path.join(root, 'source-identity-repository');
  fs.mkdirSync(sourceRepository);
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: sourceRepository }).status, 0);
  const sourceEntrypoint = path.join(sourceRepository, 'entry.mjs');
  const importedSource = path.join(sourceRepository, 'imported.mjs');
  fs.writeFileSync(sourceEntrypoint, 'import "./imported.mjs";\n');
  fs.writeFileSync(importedSource, 'export const value = 1;\n');
  assert.equal(spawnSync('git', ['add', '.'], { cwd: sourceRepository }).status, 0);
  assert.equal(spawnSync('git', [
    '-c', 'user.name=Safe Runner Test', '-c', 'user.email=safe-runner@example.invalid',
    'commit', '--quiet', '-m', 'fixture',
  ], { cwd: sourceRepository }).status, 0);
  if (process.platform === 'linux') {
    const hostilePath = path.join(sourceRepository, 'hostile-path');
    const pathGitSentinel = path.join(sourceRepository, 'path-git-executed');
    const localFsmonitorSentinel = path.join(sourceRepository, 'local-fsmonitor-executed');
    const localFsmonitor = path.join(sourceRepository, 'local-fsmonitor.sh');
    fs.mkdirSync(hostilePath);
    fs.writeFileSync(path.join(hostilePath, 'git'),
      `#!/bin/sh\ntouch ${JSON.stringify(pathGitSentinel)}\nexit 99\n`, { mode: 0o700 });
    fs.writeFileSync(localFsmonitor,
      `#!/bin/sh\ntouch ${JSON.stringify(localFsmonitorSentinel)}\nexit 1\n`, { mode: 0o700 });
    assert.equal(spawnSync('/usr/bin/git', ['config', 'core.fsmonitor', localFsmonitor], {
      cwd: sourceRepository,
    }).status, 0);
    const originalPath = process.env.PATH;
    process.env.PATH = hostilePath;
    try {
      const unsafeGitProof = writableWorktreeProof(sourceRepository, []);
      assert.equal(unsafeGitProof.ok, false);
      assert.match(unsafeGitProof.reason, /unsafe Git authority.*core\.fsmonitor/);
      assert.throws(() => repositorySourceDigest(sourceRepository), /core\.fsmonitor/);
      assert.equal(fs.existsSync(pathGitSentinel), false);
      assert.equal(fs.existsSync(localFsmonitorSentinel), false);
      spawnSync('/usr/bin/git', ['config', '--unset-all', 'core.fsmonitor'], {
        cwd: sourceRepository,
      });
      assert.equal(writableWorktreeProof(sourceRepository, []).ok, true);
      assert.match(repositorySourceDigest(sourceRepository), /^[a-f0-9]{64}$/);
    } finally {
      process.env.PATH = originalPath;
    }
    assert.equal(fs.existsSync(pathGitSentinel), false,
      'controller Git must never resolve through inherited PATH');
    assert.equal(fs.existsSync(localFsmonitorSentinel), false,
      'controller Git must force repository-local fsmonitor execution off');
    fs.rmSync(pathGitSentinel, { force: true });
    fs.rmSync(localFsmonitorSentinel, { force: true });
    fs.rmSync(localFsmonitor, { force: true });
    fs.rmSync(hostilePath, { recursive: true, force: true });
  }
  const sourceBefore = repositorySourceDigest(sourceRepository);
  const frozenA = frozenWorkloadIdentity(sourceRepository, [process.execPath, 'entry.mjs']);
  assert.equal(frozenA.executable.path, fs.realpathSync.native(process.execPath));
  assert.match(frozenA.executable.digest, /^[a-f0-9]{64}$/);
  assert.ok(Number(frozenA.executable.size) > 0);
  const promotionBefore = promotionCommandDigest(sourceRepository, [process.execPath, sourceEntrypoint]);
  fs.writeFileSync(importedSource, 'export const value = 2;\n');
  assert.notEqual(repositorySourceDigest(sourceRepository), sourceBefore);
  assert.notEqual(
    promotionCommandDigest(sourceRepository, [process.execPath, sourceEntrypoint]),
    promotionBefore,
    'an imported source change must invalidate workload promotion identity',
  );
  const mutationEvidence = { ...structuredClone(report), command: [process.execPath, 'entry.mjs'] };
  recordPromotion(sourceRepository, 'small', mutationEvidence, 'self-mutation',
    mutationEvidence.command, frozenA);
  assert.equal(checkPromotion(sourceRepository, 'medium', 'self-mutation',
    mutationEvidence.command).ok, false,
  'payload mutation must not promote the post-release source as tested evidence');
  const frozenB = frozenWorkloadIdentity(sourceRepository, mutationEvidence.command);
  const activeAttempt = beginSafetyAttempt(sourceRepository, frozenB, mutationEvidence);
  assert.equal(checkSafetyRetry(sourceRepository, mutationEvidence.command, report.limits).ok, false,
    'a controller-crash-capable active attempt must durably fence unchanged work');
  assert.equal(clearSafetyAttempt(sourceRepository, activeAttempt), true);
  assert.equal(checkSafetyRetry(sourceRepository, mutationEvidence.command, report.limits).ok, true);
  const sourceRetryCommand = [process.execPath, sourceEntrypoint];
  const sourceRetryReport = structuredClone(report);
  sourceRetryReport.command = sourceRetryCommand;
  sourceRetryReport.termination.limit = 'timeout';
  recordSafetyLimit(sourceRepository, sourceRetryCommand, report.limits, sourceRetryReport);
  assert.equal(checkSafetyRetry(sourceRepository, sourceRetryCommand, {
    ...report.limits, timeout_ms: report.limits.timeout_ms - 10,
  }).ok, false);
  fs.writeFileSync(importedSource, 'export const value = 3;\n');
  assert.equal(checkSafetyRetry(sourceRepository, sourceRetryCommand, report.limits).ok, true,
    'changing imported source must establish a new retry identity');
  fs.writeFileSync(path.join(sourceRepository, 'oversized-untracked.bin'), '1234');
  assert.throws(
    () => repositorySourceDigest(sourceRepository, { maxUntrackedBytes: 3 }),
    (error) => error.code === 'LAMINA_SAFE_SOURCE_IDENTITY',
  );
  fs.rmSync(path.join(sourceRepository, 'oversized-untracked.bin'));
  assert.equal(checkPromotion(root, 'medium', 'unrelated-workload', auditedEvidence.command).ok, false);
  const limitedReport = structuredClone(report);
  limitedReport.termination.limit = 'timeout';
  limitedReport.command = auditedEvidence.command;
  recordSafetyLimit(root, limitedReport.command, report.limits, limitedReport);
  assert.equal(checkSafetyRetry(root, limitedReport.command, report.limits).ok, false);
  assert.equal(checkSafetyRetry(root, [...limitedReport.command, '--changed'], report.limits).ok, true);
  assert.equal(checkSafetyRetry(root, limitedReport.command, {
    ...report.limits, timeout_ms: report.limits.timeout_ms - 1,
  }).ok, false, 'limit-only changes must not bypass the retry fence');
  const otherLimitedReport = structuredClone(limitedReport);
  otherLimitedReport.command = [...limitedReport.command, '--other'];
  recordSafetyLimit(root, otherLimitedReport.command, report.limits, otherLimitedReport);
  assert.equal(checkSafetyRetry(root, limitedReport.command, report.limits).ok, false,
    'recording a different failure must retain the original fence');

  const productionProbe = { ...portableProbe, id: 'unit-production', production_enforcement: true };
  writeAttestation(productionProbe, Array.from({ length: 11 }, (_, index) => ({
    id: `wrong-${index}`,
    passed: true,
    cleanup_verified: true,
    outcome: 'success',
    report_digest: 'a'.repeat(64),
  })));
  assert.equal(readAttestation(productionProbe).valid, false);
  const validCases = SELF_TEST_CASE_IDS.map((id) => ({
    id,
    passed: true,
    cleanup_verified: true,
    outcome: 'success',
    report_digest: 'b'.repeat(64),
  }));
  writeAttestation(productionProbe, validCases);
  assert.equal(readAttestation(productionProbe).valid, true);
  const promotionRoot = path.join(root, 'unpromoted-repository');
  fs.mkdirSync(promotionRoot);
  const unpromoted = preflightRun({
    tier: 'medium', command: auditedEvidence.command, cwd: promotionRoot,
    adapterInfo: productionProbe, injectedExistingProcesses: [],
  });
  assert.equal(unpromoted.ok, false);
  assert.equal(unpromoted.promotion.deferred_to_execution_snapshot, true);
  assert.doesNotMatch(unpromoted.reasons.join('\n'), /tier promotion requires successful cleanup/,
    'production promotion is decided only after dependency/tool launch bytes are sealed');

  assertAdapterShape({
    id: 'unit', launch() {}, sample() {}, signal() {}, cleanup() {},
  });
  assert.throws(() => assertAdapterShape({ id: 'broken' }), /launch/);

  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(packageJson.scripts['safe:run'], /safe-runner\/cli\.mjs run/);
  assert.match(packageJson.scripts['safe:self-test'], /safe-runner\/cli\.mjs self-test/);
  assert.match(packageJson.scripts['test:safe-runner'], /safe_runner_integration_test/);
  const readme = fs.readFileSync('README.md', 'utf8');
  const guide = fs.readFileSync('docs/content/advanced/safe-runner.mdx', 'utf8');
  const adr = fs.readFileSync('docs/decisions/014-crash-safe-resource-supervision.md', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/safe-runner.yml', 'utf8');
  const publishWorkflow = fs.readFileSync('.github/workflows/publish-cli.yml', 'utf8');
  assert.match(readme, /npm run safe:envelope/);
  assert.match(guide, /--tier small[\s\S]*--report[\s\S]*--promote/);
  assert.match(guide, /There is no unrestricted fallback/);
  assert.match(adr, /# ADR-014:[\s\S]*## Decision[\s\S]*systemd scope/);
  assert.match(workflow, /ubuntu-22\.04[\s\S]*bubblewrap_0\.8\.0-2\+deb12u1_amd64\.deb[\s\S]*3cc9134a3286ad01a323dcd924ba123eb634cefaeec82d774257e06308aeaadb[\s\S]*npm run safe:self-test/);
  assert.doesNotMatch(workflow, /\bsudo\b/);
  assert.match(publishWorkflow, /LAMINA_SAFE_RUNNER_STATE_DIR: \$\{\{ runner\.temp \}\}\/lamina-safe-runner-state/);
  assert.doesNotMatch(publishWorkflow, /LAMINA_SAFE_RUNNER_STATE_DIR:\s+\.lamina-safe-runner/);

  process.stdout.write('safe-runner unit contracts passed\n');
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
}
