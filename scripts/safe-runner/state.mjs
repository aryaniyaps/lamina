import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ATTESTATION_SCHEMA,
  PROMOTION_SCHEMA,
  SELF_TEST_CASE_IDS,
  TIER_ORDER,
} from './constants.mjs';
import { systemdAbsenceProof } from './linux-systemd.mjs';
import { identityAlive, processIdentity } from './processes.mjs';
import { infrastructureBinaries, sanitizedEnvironment } from './infrastructure.mjs';
import { retrievalQualificationAuthority } from './retrieval-authority.mjs';
import { repositorySourceDigest, runnerBuildDigest } from './source-identity.mjs';
export { repositorySourceDigest, runnerBuildDigest } from './source-identity.mjs';

const MAX_STATE_JSON_BYTES = 1024 * 1024;

export function stateDirectory() {
  return path.resolve(
    process.env.LAMINA_SAFE_RUNNER_STATE_DIR
      || path.join(os.homedir(), '.local', 'state', 'lamina', 'safe-runner'),
  );
}

function json(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function fsyncParentDirectory(file) {
  // Windows does not support opening directory handles through fs.openSync.
  // The temporary file is still flushed before the atomic rename there.
  if (process.platform === 'win32') return;
  const parent = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${crypto.randomBytes(16).toString('hex')}`;
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  if (bytes.length > MAX_STATE_JSON_BYTES) {
    throw new Error(`safe-runner state JSON exceeds ${MAX_STATE_JSON_BYTES} bytes`);
  }
  let descriptor = null;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      0o600,
    );
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (written <= 0) throw new Error('safe-runner state JSON write was incomplete');
      offset += written;
    }
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, file);
    fsyncParentDirectory(file);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
}

function commandIdentity(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 2_000, maxBuffer: 32 * 1024,
    env: sanitizedEnvironment(process.env),
  });
  return {
    status: result.status,
    stdout: String(result.stdout || '').trim().slice(0, 8_000),
    stderr: String(result.stderr || '').trim().slice(0, 2_000),
  };
}

export function hostFingerprint(adapter) {
  let machineId = os.hostname();
  try { machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim(); } catch {}
  return crypto.createHash('sha256').update(JSON.stringify({
    machineId,
    platform: process.platform,
    arch: process.arch,
    adapter: adapter.id,
    controllers: adapter.controllers,
    boot_id: readText('/proc/sys/kernel/random/boot_id'),
    kernel_release: os.release(),
    root_controllers: readText('/sys/fs/cgroup/cgroup.controllers'),
    root_subtree_control: readText('/sys/fs/cgroup/cgroup.subtree_control'),
    systemd: commandIdentity(infrastructureBinaries().systemctl, ['--version']),
    user_manager: commandIdentity(infrastructureBinaries().systemctl, [
      '--user', 'show', '--property=Id', '--property=ControlGroup', '--property=ManagerTimestamp',
    ]),
    build: runnerBuildDigest(),
  })).digest('hex');
}

export function attestationPath() {
  return path.join(stateDirectory(), 'self-test.json');
}

export function unqualifiedAttestation(adapter) {
  return {
    valid: false,
    expected_fingerprint: null,
    value: null,
    qualification_available: false,
    qualified_for_production_tiers: false,
    adapter: adapter?.id || null,
    reason: 'production attestation is unavailable without aggregate production enforcement',
  };
}

export function readAttestation(adapter) {
  if (adapter?.production_enforcement !== true) return unqualifiedAttestation(adapter);
  const value = json(attestationPath());
  const expected = hostFingerprint(adapter);
  const caseIds = Array.isArray(value?.cases) ? value.cases.map((item) => item.id).sort() : [];
  const expectedIds = [...SELF_TEST_CASE_IDS].sort();
  const casesValid = JSON.stringify(caseIds) === JSON.stringify(expectedIds)
    && value.cases.every((item) => item.passed === true
      && item.cleanup_verified === true
      && typeof item.outcome === 'string'
      && /^[a-f0-9]{64}$/.test(item.report_digest));
  const valid = value?.schema === ATTESTATION_SCHEMA
    && value?.passed === true
    && value?.qualified_for_production_tiers === true
    && value?.host_fingerprint === expected
    && casesValid;
  return { valid, expected_fingerprint: expected, value };
}

export function writeAttestation(adapter, cases) {
  const caseIds = Array.isArray(cases) ? cases.map((item) => item.id).sort() : [];
  const expectedIds = [...SELF_TEST_CASE_IDS].sort();
  const casesValid = JSON.stringify(caseIds) === JSON.stringify(expectedIds)
    && cases.every((item) => item.passed === true
      && item.cleanup_verified === true
      && typeof item.outcome === 'string'
      && /^[a-f0-9]{64}$/.test(item.report_digest));
  const value = {
    schema: ATTESTATION_SCHEMA,
    passed: casesValid,
    qualified_for_production_tiers: adapter.production_enforcement === true
      && casesValid,
    tested_at: new Date().toISOString(),
    host_fingerprint: adapter.production_enforcement === true ? hostFingerprint(adapter) : null,
    adapter: adapter.id,
    cases,
  };
  atomicJson(attestationPath(), value);
  return value;
}

function repositoryKey(cwd) {
  let resolved = path.resolve(cwd);
  try { resolved = fs.realpathSync(resolved); } catch {}
  return crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 24);
}

export function workloadDigest(workloadId) {
  if (typeof workloadId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(workloadId)) return null;
  return crypto.createHash('sha256').update(workloadId).digest('hex');
}

export function workloadIdentity(cwd, command = []) {
  const files = [];
  let totalBytes = 0n;
  for (const argument of command) {
    const candidate = path.resolve(cwd, String(argument));
    try {
      const stat = fs.statSync(candidate, { bigint: true });
      if (!stat.isFile()) continue;
      const identity = {
        path: candidate,
        size: String(stat.size),
      };
      totalBytes += stat.size;
      if (files.length >= 4_096 || totalBytes > 64n * 1024n * 1024n) {
        const error = new Error('referenced workload inputs exceed the bounded identity budget');
        error.code = 'LAMINA_SAFE_SOURCE_IDENTITY';
        throw error;
      }
      const hash = crypto.createHash('sha256');
      const descriptor = fs.openSync(candidate, 'r');
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        let offset = 0;
        while (offset < Number(stat.size)) {
          const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
          if (bytes === 0) break;
          hash.update(buffer.subarray(0, bytes));
          offset += bytes;
        }
      } finally { fs.closeSync(descriptor); }
      identity.digest = hash.digest('hex');
      files.push(identity);
    } catch (error) {
      if (error?.code === 'LAMINA_SAFE_SOURCE_IDENTITY') throw error;
    }
  }
  return files;
}

export function sealedManifestFileIdentity(file, expected, role = 'input') {
  let descriptor = null;
  try {
    if (!Number.isSafeInteger(expected?.bytes)
      || !/^[a-f0-9]{64}$/.test(expected?.sha256 || '')) {
      throw new Error('invalid manifest input');
    }
    const named = fs.lstatSync(file, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink()
      || named.size !== BigInt(expected.bytes)
      || fs.realpathSync.native(file) !== file) throw new Error('input is not physical');
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (opened.dev !== named.dev || opened.ino !== named.ino || opened.size !== named.size
      || opened.uid !== named.uid || opened.mode !== named.mode || opened.nlink !== named.nlink) {
      throw new Error('input changed while opening');
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (offset < Number(opened.size)) {
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
      offset += bytes;
    }
    const final = fs.fstatSync(descriptor, { bigint: true });
    const digest = hash.digest('hex');
    if (offset !== expected.bytes || digest !== expected.sha256
      || final.dev !== opened.dev || final.ino !== opened.ino || final.size !== opened.size
      || final.uid !== opened.uid || final.mode !== opened.mode || final.nlink !== opened.nlink) {
      throw new Error('input bytes changed or contradict the manifest');
    }
    return {
      role, digest, size: String(opened.size), dev: String(opened.dev),
      ino: String(opened.ino), uid: Number(opened.uid),
      mode: Number(opened.mode & 0o777n), nlink: Number(opened.nlink),
    };
  } catch {
    const error = new Error(`runtime baseline ${role} input failed sealed manifest identity`);
    error.code = 'LAMINA_SAFE_SOURCE_IDENTITY';
    throw error;
  } finally { if (descriptor !== null) fs.closeSync(descriptor); }
}

function runtimeBaselineInputIdentity(cwd, command) {
  const entrypoint = path.resolve(cwd, String(command[1] || ''));
  if (!entrypoint.replaceAll('\\', '/').endsWith('/benchmarks/runtime-baseline-v1/workload.mjs')) {
    return null;
  }
  if (command.length !== 7 || command[2] !== 'run') {
    const error = new Error('runtime baseline identity requires its exact audited command');
    error.code = 'LAMINA_SAFE_SOURCE_IDENTITY';
    throw error;
  }
  const repository = path.resolve(path.dirname(entrypoint), '../..');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(
      path.join(repository, 'benchmarks/runtime-baseline-v1/manifest.json'), 'utf8',
    ));
  } catch {
    const error = new Error('runtime baseline manifest identity is unavailable');
    error.code = 'LAMINA_SAFE_SOURCE_IDENTITY';
    throw error;
  }
  const definitions = [
    { index: 5, role: 'model', expected: manifest?.runtime_assets?.model },
    { index: 6, role: 'worker', expected: manifest?.runtime_assets?.worker_linux_x64 },
  ];
  const inputs = [];
  for (const definition of definitions) {
    const file = path.resolve(cwd, String(command[definition.index] || ''));
    const relative = path.relative(repository, file).replaceAll('\\', '/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
      const error = new Error(`runtime baseline ${definition.role} input failed sealed manifest identity`);
      error.code = 'LAMINA_SAFE_SOURCE_IDENTITY';
      throw error;
    }
    inputs.push({
      ...sealedManifestFileIdentity(file, definition.expected, definition.role), relative,
    });
  }
  return inputs;
}

function executableIdentity(candidate, maximumBytes = 256 * 1024 * 1024) {
  let descriptor = null;
  try {
    const physical = fs.realpathSync.native(candidate);
    const named = fs.lstatSync(physical, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || (named.mode & 0o111n) === 0n
      || named.size > BigInt(maximumBytes)) throw new Error('executable is not a bounded physical file');
    descriptor = fs.openSync(physical, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (opened.dev !== named.dev || opened.ino !== named.ino || opened.uid !== named.uid
      || opened.size !== named.size) throw new Error('executable identity changed while opening');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (offset < Number(opened.size)) {
      const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
      offset += bytes;
    }
    const final = fs.fstatSync(descriptor, { bigint: true });
    if (offset !== Number(opened.size) || final.dev !== opened.dev || final.ino !== opened.ino
      || final.uid !== opened.uid || final.size !== opened.size) {
      throw new Error('executable identity changed while hashing');
    }
    return {
      path: physical, dev: String(opened.dev), ino: String(opened.ino), uid: Number(opened.uid),
      mode: Number(opened.mode & 0o777n), size: String(opened.size), digest: hash.digest('hex'),
    };
  } catch (cause) {
    const error = new Error(`cannot establish bounded executable identity: ${cause?.message || cause}`);
    error.code = 'LAMINA_SAFE_EXECUTABLE_IDENTITY';
    throw error;
  } finally { if (descriptor !== null) fs.closeSync(descriptor); }
}

function commandSourceDigest(cwd, command) {
  const candidates = [cwd, ...command.slice(1).map((argument) => path.dirname(path.resolve(cwd, String(argument))))];
  for (const candidate of candidates) {
    const digest = repositorySourceDigest(candidate);
    if (digest) return digest;
  }
  const error = new Error('cannot establish a complete Git source snapshot for the workload command');
  error.code = 'LAMINA_SAFE_SOURCE_IDENTITY';
  throw error;
}

export function frozenWorkloadIdentity(cwd, command) {
  const normalizedCwd = fs.realpathSync.native(cwd);
  const normalizedCommand = command.map((argument, index) => {
    const value = String(argument);
    if (index === 0) {
      if (value === 'node') return fs.realpathSync.native(process.execPath);
      try { return fs.realpathSync.native(value); } catch { return path.resolve(normalizedCwd, value); }
    }
    return value;
  });
  const retrievalAuthority = retrievalQualificationAuthority({
    repository: normalizedCwd, cwd: normalizedCwd, command: normalizedCommand,
  });
  const retrievalValueIndexes = new Set(retrievalAuthority?.argument_value_indexes || []);
  const runtimeBaselineInputs = runtimeBaselineInputIdentity(normalizedCwd, normalizedCommand);
  const runtimeBaselineValueIndexes = new Set(runtimeBaselineInputs ? [5, 6] : []);
  const genericWorkloadArguments = normalizedCommand.slice(1).filter(
    (_argument, index) => !retrievalValueIndexes.has(index + 1)
      && !runtimeBaselineValueIndexes.has(index + 1),
  );
  const value = {
    repository: normalizedCwd,
    command: normalizedCommand,
    executable: executableIdentity(normalizedCommand[0]),
    workload_inputs: workloadIdentity(normalizedCwd, genericWorkloadArguments),
    retrieval_authority: retrievalAuthority ? {
      mode: retrievalAuthority.mode,
      model_digest: retrievalAuthority.model_digest,
      manifest: retrievalAuthority.manifest,
      worker: retrievalAuthority.worker,
      model: retrievalAuthority.model,
      tokenizer: retrievalAuthority.tokenizer,
    } : null,
    runtime_baseline_inputs: runtimeBaselineInputs,
    repository_source: commandSourceDigest(normalizedCwd, normalizedCommand),
    runner_build: runnerBuildDigest(),
  };
  return {
    ...value,
    digest: crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  };
}

export function assertFrozenWorkloadIdentity(expected, cwd, command) {
  const actual = frozenWorkloadIdentity(cwd, command);
  if (!expected || actual.digest !== expected.digest) {
    const error = new Error('workload source or command identity changed before payload release');
    error.code = 'LAMINA_SAFE_SOURCE_IDENTITY_CHANGED';
    throw error;
  }
  return actual;
}

export function safetyRetrySignature(cwd, command, limits, frozen = null) {
  return (frozen || frozenWorkloadIdentity(cwd, command)).digest;
}

function safetyRetryPath(cwd) {
  return path.join(stateDirectory(), 'safety-limit-ledger', `${repositoryKey(cwd)}.json`);
}

export function checkSafetyRetry(cwd, command, limits, frozen = null) {
  const identity = frozen || frozenWorkloadIdentity(cwd, command);
  const signature = safetyRetrySignature(cwd, command, limits, identity);
  const value = json(safetyRetryPath(cwd));
  const previous = value?.entries?.[signature]
    || (value?.signature === signature ? value : null);
  return {
    ok: previous === null || previous === undefined,
    signature,
    previous, identity,
  };
}

export function recordSafetyLimit(cwd, command, limits, report, frozen = null) {
  const signature = frozen?.digest || safetyRetrySignature(cwd, command, limits);
  const current = json(safetyRetryPath(cwd));
  const record = {
    signature,
    recorded_at: new Date().toISOString(),
    run_id: report.run_id,
    limit: report.termination.limit,
  };
  const value = {
    schema: 'lamina.safe-runner-safety-limit-ledger/v2',
    entries: {
      ...(current?.entries || (current?.signature ? { [current.signature]: current } : {})),
      [signature]: record,
    },
  };
  atomicJson(safetyRetryPath(cwd), value);
  return record;
}

export function beginSafetyAttempt(cwd, frozen, report) {
  if (!frozen?.digest) throw new Error('active attempt requires a frozen workload identity');
  const file = safetyRetryPath(cwd);
  const current = json(file);
  const entries = current?.entries || (current?.signature ? { [current.signature]: current } : {});
  if (entries[frozen.digest]) {
    const error = new Error('workload identity already has an active or failed safety attempt');
    error.code = 'LAMINA_SAFE_RETRY_FENCE';
    throw error;
  }
  const record = {
    signature: frozen.digest,
    recorded_at: new Date().toISOString(),
    run_id: report.run_id,
    limit: 'active_attempt',
    state: 'active',
  };
  atomicJson(file, {
    schema: 'lamina.safe-runner-safety-limit-ledger/v3',
    entries: { ...entries, [frozen.digest]: record },
  });
  return { file, signature: frozen.digest, run_id: report.run_id };
}

export function clearSafetyAttempt(cwd, attempt) {
  if (!attempt?.signature || !attempt?.run_id) return false;
  const file = safetyRetryPath(cwd);
  const current = json(file);
  const entries = { ...(current?.entries || {}) };
  const record = entries[attempt.signature];
  if (record?.run_id !== attempt.run_id || record?.state !== 'active') {
    const error = new Error('refusing to clear a changed active-attempt fence');
    error.code = 'LAMINA_SAFE_RETRY_FENCE';
    throw error;
  }
  delete entries[attempt.signature];
  atomicJson(file, { schema: 'lamina.safe-runner-safety-limit-ledger/v3', entries });
  return true;
}

function promotionPath(cwd) {
  return path.join(stateDirectory(), 'promotions', `${repositoryKey(cwd)}.json`);
}

export function promotionCommandDigest(cwd, command = [], frozen = null) {
  return (frozen || frozenWorkloadIdentity(cwd, command)).digest;
}

export function bindExecutionSnapshotIdentity(frozen, executionSnapshotDigest) {
  if (!frozen?.digest || !/^[a-f0-9]{64}$/.test(executionSnapshotDigest || '')) {
    const error = new Error('promotion identity requires frozen source and execution snapshot digests');
    error.code = 'LAMINA_SAFE_PROMOTION_IDENTITY';
    throw error;
  }
  const value = {
    source_identity_digest: frozen.digest,
    execution_snapshot_digest: executionSnapshotDigest,
  };
  return {
    ...frozen,
    ...value,
    digest: crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  };
}

export function promotionStatus(cwd, workloadId = null, command = null, frozen = null) {
  const value = json(promotionPath(cwd));
  const digest = workloadDigest(workloadId);
  if (value?.build_digest !== runnerBuildDigest() || !digest) return { completed: [], value: null };
  const workload = value.workloads?.[digest];
  const commandDigest = Array.isArray(command) ? promotionCommandDigest(cwd, command, frozen) : null;
  const bound = !commandDigest || workload?.command_digest === commandDigest;
  const completed = bound ? workload?.completed : [];
  return {
    completed: Array.isArray(completed) ? completed : [],
    value,
    workload_digest: digest,
    command_digest: commandDigest,
    command_bound: bound,
  };
}

export function checkPromotion(cwd, tier, workloadId = null, command = null, frozen = null) {
  const index = TIER_ORDER.indexOf(tier);
  const required = index <= 0 ? [] : TIER_ORDER.slice(0, index);
  const status = promotionStatus(cwd, workloadId, command, frozen);
  const missing = required.filter((item) => !status.completed.includes(item));
  return { ok: missing.length === 0, required, missing, completed: status.completed };
}

export function recordPromotion(cwd, tier, evidence, workloadId, actualCommand = evidence?.command, frozen = null) {
  if (evidence?.outcome !== 'success'
    || evidence?.cleanup?.descendants_remaining?.length !== 0
    || evidence?.cleanup?.managed_paths_remaining?.length !== 0
    || evidence?.cleanup?.scope_removed !== true
    || evidence?.cleanup?.temporary_directory_removed !== true
    || evidence?.cleanup?.errors?.length !== 0
    || typeof evidence?.run_id !== 'string'
    || !Array.isArray(evidence?.command)
    || evidence.command.length === 0) {
    const error = new Error('tier promotion requires a successful report with complete verified cleanup');
    error.code = 'LAMINA_SAFE_PROMOTION_EVIDENCE';
    throw error;
  }
  const digest = workloadDigest(workloadId);
  if (!digest) {
    const error = new Error('tier promotion requires an explicit stable --workload identifier');
    error.code = 'LAMINA_SAFE_WORKLOAD_REQUIRED';
    throw error;
  }
  const commandDigest = promotionCommandDigest(cwd, actualCommand, frozen);
  const existing = json(promotionPath(cwd));
  const existingWorkload = existing?.build_digest === runnerBuildDigest()
    ? existing.workloads?.[digest] : null;
  if (existingWorkload?.command_digest && existingWorkload.command_digest !== commandDigest) {
    const error = new Error('workload identifier is already bound to a different command identity');
    error.code = 'LAMINA_SAFE_WORKLOAD_IDENTITY';
    throw error;
  }
  const status = promotionStatus(cwd, workloadId, actualCommand, frozen);
  const completed = TIER_ORDER.filter((item) => new Set([...status.completed, tier]).has(item));
  const value = {
    schema: PROMOTION_SCHEMA,
    repository: path.resolve(cwd),
    build_digest: runnerBuildDigest(),
    workloads: {
      ...(existing?.build_digest === runnerBuildDigest() ? existing.workloads : {}),
      [digest]: {
        workload_id: workloadId,
        command_digest: commandDigest,
        completed,
        evidence: {
          run_id: evidence.run_id,
          tier,
          adapter: evidence.adapter?.id || null,
          command_digest: crypto.createHash('sha256').update(JSON.stringify(evidence.command)).digest('hex'),
          finished_at: evidence.finished_at,
        },
      },
    },
    updated_at: new Date().toISOString(),
  };
  atomicJson(promotionPath(cwd), value);
  return value;
}

export function productionLockDirectory() {
  return process.platform === 'linux'
    ? '/tmp/lamina-safe-runner-production-locks'
    : path.join(os.tmpdir(), 'lamina-safe-runner-production-locks');
}

function lockDirectoryIdentity(directory, expected = null) {
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved, { bigint: true });
  const identity = {
    path: resolved, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
    mode: Number(stat.mode & 0o777n),
  };
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || fs.realpathSync.native(resolved) !== resolved
    || (typeof process.getuid === 'function' && identity.uid !== process.getuid())
    || identity.mode !== 0o700
    || (expected && (identity.dev !== expected.dev || identity.ino !== expected.ino
      || identity.uid !== expected.uid || identity.mode !== expected.mode))) {
    const error = new Error('production lock directory must be a physical same-user mode-0700 directory');
    error.code = 'LAMINA_SAFE_LOCK_DIRECTORY_AUTHORITY';
    throw error;
  }
  return identity;
}

function prepareLockDirectory(directory) {
  try { fs.mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error?.code !== 'EEXIST') throw error; }
  return lockDirectoryIdentity(directory);
}

function productionScopeAbsent(scope) {
  if (scope?.adapter !== 'linux-systemd-cgroup-v2'
    || typeof scope.unit !== 'string'
    || !/^lamina-safe-[A-Za-z0-9_-]+\.scope$/.test(scope.unit)) return false;
  const shown = spawnSync(infrastructureBinaries().systemctl, [
    '--user', 'show', scope.unit, '--property=LoadState', '--property=ControlGroup',
  ], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000, maxBuffer: 64 * 1024,
    env: sanitizedEnvironment(process.env),
  });
  const cachedCgroupExists = typeof scope.cgroup === 'string' && fs.existsSync(scope.cgroup);
  return systemdAbsenceProof(shown, cachedCgroupExists);
}

export function acquireConcurrencyLock({
  directory = productionLockDirectory(),
  scope = null,
  proveScopeAbsent = productionScopeAbsent,
} = {}) {
  const directoryIdentity = prepareLockDirectory(directory);
  const recheckDirectory = () => lockDirectoryIdentity(directory, directoryIdentity);
  const identity = processIdentity(process.pid);
  const nonce = crypto.randomBytes(16).toString('hex');
  const file = path.join(directory, `${identity.pid}-${identity.start_ticks}-${nonce}.json`);
  const claim = { ...identity, nonce, scope, created_at: new Date().toISOString() };
  recheckDirectory();
  fs.writeFileSync(file, `${JSON.stringify(claim)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  const fileIdentity = () => {
    const stat = fs.lstatSync(file, { bigint: true });
    return { dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid) };
  };
  let currentFileIdentity = fileIdentity();
  const removeCurrentClaim = () => {
    recheckDirectory();
    const owner = json(file);
    const actual = fileIdentity();
    if (owner?.nonce !== nonce || actual.dev !== currentFileIdentity.dev
      || actual.ino !== currentFileIdentity.ino || actual.uid !== currentFileIdentity.uid) {
      const error = new Error('refusing to remove a changed concurrency claim');
      error.code = 'LAMINA_SAFE_LOCK_IDENTITY';
      throw error;
    }
    fs.rmSync(file);
  };
  recheckDirectory();
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.json')) continue;
    const candidate = path.join(directory, name);
    if (candidate === file) continue;
    recheckDirectory();
    let candidateIdentity;
    try {
      const stat = fs.lstatSync(candidate, { bigint: true });
      candidateIdentity = { dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid) };
    } catch { continue; }
    const existing = json(candidate);
    if (identityAlive(existing)) {
      removeCurrentClaim();
      const conflict = new Error(`another medium/large safe-runner is active as PID ${existing.pid}`);
      conflict.code = 'LAMINA_SAFE_CONCURRENCY';
      throw conflict;
    }
    if (!proveScopeAbsent(existing?.scope)) {
      removeCurrentClaim();
      const conflict = new Error('stale production lock cannot be reclaimed until its associated scope is proven absent');
      conflict.code = 'LAMINA_SAFE_STALE_SCOPE_UNPROVEN';
      throw conflict;
    }
    let currentIdentity = null;
    try {
      const stat = fs.lstatSync(candidate, { bigint: true });
      currentIdentity = { dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid) };
    } catch {}
    const currentOwner = json(candidate);
    if (!currentIdentity || currentIdentity.dev !== candidateIdentity.dev
      || currentIdentity.ino !== candidateIdentity.ino || currentIdentity.uid !== candidateIdentity.uid
      || currentOwner?.nonce !== existing?.nonce
      || currentOwner?.pid !== existing?.pid
      || currentOwner?.start_ticks !== existing?.start_ticks) {
      removeCurrentClaim();
      const conflict = new Error('stale production lock identity changed during absence proof');
      conflict.code = 'LAMINA_SAFE_LOCK_IDENTITY';
      throw conflict;
    }
    // Claim names contain an unguessable nonce and are never reused. Removing
    // this exact stale claim cannot unlink a replacement live lock.
    recheckDirectory();
    fs.rmSync(candidate, { force: true });
  }
  let released = false;
  return {
    file,
    identity() {
      return {
        ...claim,
        file_identity: { ...currentFileIdentity },
        directory_identity: { ...directoryIdentity },
      };
    },
    updateScope(nextScope) {
      recheckDirectory();
      const owner = json(file);
      if (owner?.nonce !== nonce) {
        const error = new Error('refusing to update a concurrency claim whose owner changed');
        error.code = 'LAMINA_SAFE_LOCK_IDENTITY';
        throw error;
      }
      if (nextScope?.adapter !== claim.scope?.adapter || nextScope?.unit !== claim.scope?.unit) {
        const error = new Error('refusing to change the exact unit bound to a concurrency claim');
        error.code = 'LAMINA_SAFE_LOCK_IDENTITY';
        throw error;
      }
      // The exact unit is bound in the initial durable claim. Avoid replacing
      // the claim inode merely to cache a cgroup path; authoritative stale
      // recovery queries that unit and fails closed if absence is unproven.
      return true;
    },
    release() {
      if (!released) {
        recheckDirectory();
        const owner = json(file);
        if (owner?.nonce !== nonce) {
          const error = new Error('refusing to remove a concurrency claim whose owner changed');
          error.code = 'LAMINA_SAFE_LOCK_IDENTITY';
          throw error;
        }
        const actual = fileIdentity();
        if (actual.dev !== currentFileIdentity.dev || actual.ino !== currentFileIdentity.ino
          || actual.uid !== currentFileIdentity.uid) {
          const error = new Error('refusing to remove a concurrency claim whose file identity changed');
          error.code = 'LAMINA_SAFE_LOCK_IDENTITY';
          throw error;
        }
        removeCurrentClaim();
      }
      released = true;
      return true;
    },
  };
}

export function adoptConcurrencyLock(file, identity) {
  const resolved = path.resolve(file || '');
  if (!file || path.dirname(resolved) !== path.resolve(productionLockDirectory())
    || !identity?.nonce || !identity?.file_identity || !identity?.directory_identity) {
    const error = new Error('refusing to adopt an invalid concurrency claim');
    error.code = 'LAMINA_SAFE_LOCK_IDENTITY';
    throw error;
  }
  const expected = {
    dev: String(identity.file_identity.dev),
    ino: String(identity.file_identity.ino),
    uid: Number(identity.file_identity.uid),
  };
  const verify = () => {
    try { lockDirectoryIdentity(path.dirname(resolved), identity.directory_identity); } catch {
      const error = new Error('refusing to use a changed concurrency claim directory');
      error.code = 'LAMINA_SAFE_LOCK_IDENTITY';
      throw error;
    }
    const owner = json(resolved);
    let stat = null;
    try { stat = fs.lstatSync(resolved, { bigint: true }); } catch {}
    if (!owner || owner.nonce !== identity.nonce || owner.pid !== identity.pid
      || owner.start_ticks !== identity.start_ticks
      || String(stat?.dev) !== expected.dev || String(stat?.ino) !== expected.ino
      || Number(stat?.uid) !== expected.uid) {
      const error = new Error('refusing to use a changed concurrency claim');
      error.code = 'LAMINA_SAFE_LOCK_IDENTITY';
      throw error;
    }
    return owner;
  };
  verify();
  let released = false;
  return {
    file: resolved,
    identity() { return structuredClone(identity); },
    updateScope(nextScope) {
      const owner = verify();
      if (nextScope?.adapter !== owner.scope?.adapter || nextScope?.unit !== owner.scope?.unit) {
        const error = new Error('refusing to change the exact unit bound to a concurrency claim');
        error.code = 'LAMINA_SAFE_LOCK_IDENTITY';
        throw error;
      }
      return true;
    },
    release() {
      if (!released) {
        verify();
        fs.unlinkSync(resolved);
      }
      released = true;
      return !fs.existsSync(resolved);
    },
  };
}
