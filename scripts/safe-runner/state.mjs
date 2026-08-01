import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ATTESTATION_SCHEMA,
  PROMOTION_SCHEMA,
  SELF_TEST_CASE_IDS,
  TIER_ORDER,
} from './constants.mjs';
import { identityAlive, processIdentity } from './processes.mjs';
import { redactCommand } from './redaction.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_IDENTITY_FILE_BYTES = 16n * 1024n * 1024n;
const MAX_PROMOTION_FILE_BYTES = 256n * 1024n * 1024n;
const MAX_RETRY_ENTRIES_PER_SHARD = 64;
const MAX_RETRY_SHARDS_PER_REPOSITORY = 256;
const MAX_RETRY_REPOSITORIES = 256;
const RETRY_LOCK_WAIT_MS = 15_000;
const pause = (milliseconds) => Atomics.wait(
  new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds,
);

export function stateDirectory() {
  return path.resolve(
    process.env.LAMINA_SAFE_RUNNER_STATE_DIR
      || path.join(os.homedir(), '.local', 'state', 'lamina', 'safe-runner'),
  );
}

function json(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function boundedFileDigest(file, size, requireDigest) {
  if (size <= MAX_IDENTITY_FILE_BYTES) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  if (!requireDigest) return null;
  if (size > MAX_PROMOTION_FILE_BYTES) {
    const error = new Error(`tier promotion refuses source files larger than ${MAX_PROMOTION_FILE_BYTES} bytes: ${file}`);
    error.code = 'LAMINA_SAFE_PROMOTION_SOURCE_UNPROVEN';
    throw error;
  }
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}

export function runnerBuildDigest() {
  const hash = crypto.createHash('sha256');
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:mjs|json|sh)$/.test(entry.name)) {
        hash.update(path.relative(HERE, absolute)).update(fs.readFileSync(absolute));
      }
    }
  };
  visit(HERE);
  for (const relative of [
    'packages/cli/lib/graph-runtime/client.mjs',
    'packages/cli/lib/graph-runtime/server.mjs',
    'packages/cli/lib/graph-runtime/util.mjs',
  ]) {
    const graphRuntime = path.resolve(HERE, '../..', relative);
    hash.update(relative).update(fs.readFileSync(graphRuntime));
  }
  for (const name of ['safe-runner-context.mjs', 'safe-runner-broker-client.mjs']) {
    const safeRunnerClient = path.resolve(HERE, '../../packages/cli/lib', name);
    hash.update(`packages/cli/lib/${name}`).update(fs.readFileSync(safeRunnerClient));
  }
  for (const relative of [
    'tests/fixtures/safe-runner-adversary.mjs',
    'tests/fixtures/safe-runner-controller.mjs',
    'tests/fixtures/safe-runner-graphd-client.mjs',
    'tests/fixtures/graph-runtime/server.mjs',
  ]) {
    const fixture = path.resolve(HERE, '../..', relative);
    hash.update(relative).update(fs.readFileSync(fixture));
  }
  return hash.digest('hex');
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
}

function commandIdentity(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 2_000, maxBuffer: 32 * 1024,
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
    systemd: commandIdentity('systemctl', ['--version']),
    user_manager: commandIdentity('systemctl', [
      '--user', 'show', '--property=Id', '--property=ControlGroup', '--property=ManagerTimestamp',
    ]),
    build: runnerBuildDigest(),
  })).digest('hex');
}

export function attestationPath() {
  return path.join(stateDirectory(), 'self-test.json');
}

export function readAttestation(adapter) {
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
    host_fingerprint: hostFingerprint(adapter),
    adapter: adapter.id,
    cases,
  };
  atomicJson(attestationPath(), value);
  return value;
}

function canonicalRepositoryPath(cwd) {
  try { return fs.realpathSync.native(path.resolve(cwd)); } catch {
    const error = new Error('safe-runner repository path cannot be resolved to a physical directory');
    error.code = 'LAMINA_SAFE_REPOSITORY_UNPROVEN';
    throw error;
  }
}

function repositoryKey(cwd) {
  return crypto.createHash('sha256')
    .update(canonicalRepositoryPath(cwd)).digest('hex').slice(0, 24);
}

export function workloadDigest(workloadId) {
  if (typeof workloadId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(workloadId)) return null;
  return crypto.createHash('sha256').update(workloadId).digest('hex');
}

function workloadIdentity(cwd, command = [], selectedPaths = null, { requireDigest = false } = {}) {
  const files = [];
  const candidates = selectedPaths || command.map((argument) => path.resolve(cwd, String(argument)));
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate, { bigint: true });
      if (!stat.isFile()) continue;
      const identity = {
        path: candidate,
        size: String(stat.size),
        mtime_ns: String(stat.mtimeNs),
      };
      const digest = boundedFileDigest(candidate, stat.size, requireDigest);
      if (digest) identity.digest = digest;
      files.push(identity);
    } catch (error) {
      if (error?.code === 'LAMINA_SAFE_PROMOTION_SOURCE_UNPROVEN') throw error;
      if (requireDigest && error?.code !== 'ENOENT') {
        const failure = new Error(`tier promotion could not identify implementation source: ${candidate}`);
        failure.code = 'LAMINA_SAFE_PROMOTION_SOURCE_UNPROVEN';
        throw failure;
      }
      if (requireDigest && error?.code === 'ENOENT') {
        files.push({ path: path.resolve(candidate), missing: true });
      }
    }
  }
  return files;
}

function retryMetadata(cwd, command, selectedPaths = null) {
  const workload = workloadIdentity(cwd, command, selectedPaths);
  return {
    runner_build: runnerBuildDigest(),
    command_digest: crypto.createHash('sha256').update(JSON.stringify(command)).digest('hex'),
    workload_paths: workload.map((item) => item.path),
    workload_digest: crypto.createHash('sha256').update(JSON.stringify(workload)).digest('hex'),
  };
}

export function safetyRetrySignature(cwd, command, limits) {
  const metadata = retryMetadata(cwd, command);
  return crypto.createHash('sha256').update(JSON.stringify({
    repository: canonicalRepositoryPath(cwd),
    command_digest: metadata.command_digest,
    workload_digest: metadata.workload_digest,
    runner_build: metadata.runner_build,
    concurrency: 1,
  })).digest('hex');
}

function legacySafetyRetryPath(cwd) {
  return path.join(stateDirectory(), 'safety-limit-ledger', `${repositoryKey(cwd)}.json`);
}

function safetyRetryCommandKey(cwd, command) {
  const metadata = retryMetadata(cwd, command);
  return crypto.createHash('sha256').update(JSON.stringify({
    repository: canonicalRepositoryPath(cwd),
    command_digest: metadata.command_digest,
    runner_build: metadata.runner_build,
  })).digest('hex');
}

function safetyRetryDirectory(cwd, commandKey = null) {
  const repository = path.join(stateDirectory(), 'safety-limit-ledger', repositoryKey(cwd));
  return commandKey ? path.join(repository, commandKey) : repository;
}

function safetyRetryLedgerDirectory() {
  return path.join(stateDirectory(), 'safety-limit-ledger');
}

function safetyRetryEntryPath(cwd, commandKey, runId) {
  const key = crypto.createHash('sha256').update(String(runId)).digest('hex');
  return path.join(safetyRetryDirectory(cwd, commandKey), `${key}.json`);
}

function retryLockOwnerActive(owner) {
  if (process.platform === 'linux') {
    if (!Number.isInteger(owner?.pid) || typeof owner?.start_ticks !== 'string') return false;
    try {
      const stat = fs.readFileSync(`/proc/${owner.pid}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      return stat.slice(close + 2).trim().split(/\s+/)[19] === owner.start_ticks;
    } catch { return false; }
  }
  if (!Number.isInteger(owner?.pid) || owner.pid <= 1) return false;
  try { process.kill(owner.pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function sameRetryLockOwner(left, right) {
  return Number(left?.pid) === Number(right?.pid)
    && String(left?.start_ticks || '') === String(right?.start_ticks || '')
    && typeof left?.nonce === 'string' && left.nonce === right?.nonce;
}

function sweepRetryLockArtifacts(directory, activeCandidate) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const artifact = path.join(directory, entry.name);
    if (/^\.mutation\.lock\.(?:stale|release)-[a-f0-9]+$/.test(entry.name)) {
      try { fs.rmSync(artifact, { recursive: true, force: true }); } catch {}
      continue;
    }
    if (!/^\.mutation-candidate-[1-9]\d*-[a-f0-9]{32}$/.test(entry.name)
      || artifact === activeCandidate) continue;
    const owner = json(path.join(artifact, 'owner.json'));
    if (!retryLockOwnerActive(owner)) {
      try { fs.rmSync(artifact, { recursive: true, force: true }); } catch {}
    }
  }
}

function acquireRetryShardLock(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const identity = processIdentity(process.pid) || { pid: process.pid, start_ticks: null };
  const nonce = crypto.randomBytes(16).toString('hex');
  const owner = { ...identity, nonce, created_at: new Date().toISOString() };
  const lock = path.join(directory, '.mutation.lock');
  const recovery = path.join(directory, '.mutation.recovery.lock');
  const candidate = path.join(directory, `.mutation-candidate-${process.pid}-${nonce}`);
  fs.mkdirSync(candidate, { mode: 0o700 });
  fs.writeFileSync(path.join(candidate, 'owner.json'), `${JSON.stringify(owner)}\n`, { mode: 0o600 });
  const deadline = Date.now() + RETRY_LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(recovery)) {
      pause(5);
      continue;
    }
    try {
      fs.renameSync(candidate, lock);
      if (fs.existsSync(recovery)) {
        const current = json(path.join(lock, 'owner.json'));
        if (!sameRetryLockOwner(current, owner)) {
          const error = new Error('retry-ledger lock changed during stale recovery');
          error.code = 'LAMINA_SAFE_RETRY_LEDGER_LOCK';
          throw error;
        }
        fs.renameSync(lock, candidate);
        pause(5);
        continue;
      }
      sweepRetryLockArtifacts(directory, lock);
      return {
        release() {
          const current = json(path.join(lock, 'owner.json'));
          if (current?.nonce !== nonce || Number(current.pid) !== Number(owner.pid)) {
            const error = new Error('retry-ledger mutation lock identity changed');
            error.code = 'LAMINA_SAFE_RETRY_LEDGER_LOCK';
            throw error;
          }
          const quarantine = `${lock}.release-${nonce}`;
          fs.renameSync(lock, quarantine);
          fs.rmSync(quarantine, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) {
        try { fs.rmSync(candidate, { recursive: true, force: true }); } catch {}
        throw error;
      }
    }
    const existing = json(path.join(lock, 'owner.json'));
    if (existing?.nonce && !retryLockOwnerActive(existing)) {
      try {
        fs.mkdirSync(recovery, { mode: 0o700 });
        try {
          const current = json(path.join(lock, 'owner.json'));
          if (sameRetryLockOwner(current, existing) && !retryLockOwnerActive(current)) {
            const quarantine = `${lock}.stale-${crypto.randomBytes(8).toString('hex')}`;
            fs.renameSync(lock, quarantine);
            fs.rmSync(quarantine, { recursive: true, force: true });
          }
        } finally { fs.rmSync(recovery, { recursive: true, force: true }); }
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'ENOENT'].includes(error.code)) throw error;
      }
    } else pause(5);
  }
  try { fs.rmSync(candidate, { recursive: true, force: true }); } catch {}
  const error = new Error('timed out acquiring retry-ledger mutation lock');
  error.code = 'LAMINA_SAFE_RETRY_LEDGER_LOCK';
  throw error;
}

function retryEntryFiles(directory) {
  try {
    return fs.readdirSync(directory)
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map((name) => path.join(directory, name));
  } catch { return []; }
}

function retrySaturation(reason) {
  return {
    schema: 'lamina.safe-runner-safety-limit-saturation/v1',
    status: 'safety_limit_exceeded',
    limit: 'retry_ledger_saturated',
    reason,
    recorded_at: new Date().toISOString(),
  };
}

function saturateRetryShard(directory, reason = 'capacity') {
  const file = path.join(directory, 'saturated.json');
  const value = retrySaturation(reason);
  atomicJson(file, value);
  for (const entry of retryEntryFiles(directory)) fs.rmSync(entry, { force: true });
  return value;
}

function retryDirectories(directory, pattern) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name));
  } catch { return []; }
}

function pruneEmptyRetryDirectory(directory) {
  if (json(path.join(directory, 'saturated.json')) || retryEntryFiles(directory).length > 0) return;
  try { fs.rmdirSync(directory); } catch {}
}

function withRetryLedgerState(cwd, commandKey, { reserve = false } = {}, callback) {
  const ledger = safetyRetryLedgerDirectory();
  const repository = safetyRetryDirectory(cwd);
  const commandDirectory = safetyRetryDirectory(cwd, commandKey);
  const ledgerLock = acquireRetryShardLock(ledger);
  let repositoryLock = null;
  let commandLock = null;
  try {
    if (!fs.existsSync(repository)) {
      const saturated = json(path.join(ledger, 'saturated.json'));
      if (saturated) return saturated;
      if (!reserve) return null;
      const repositories = retryDirectories(ledger, /^[a-f0-9]{24}$/);
      if (repositories.length >= MAX_RETRY_REPOSITORIES) {
        const value = retrySaturation('global_repository_capacity');
        atomicJson(path.join(ledger, 'saturated.json'), value);
        return value;
      }
      fs.mkdirSync(repository, { mode: 0o700 });
    }

    repositoryLock = acquireRetryShardLock(repository);
    const repositorySaturated = json(path.join(repository, 'saturated.json'));
    if (repositorySaturated) return repositorySaturated;
    if (!fs.existsSync(commandDirectory)) {
      if (!reserve) return null;
      const shards = retryDirectories(repository, /^[a-f0-9]{64}$/);
      if (shards.length >= MAX_RETRY_SHARDS_PER_REPOSITORY) {
        const value = retrySaturation('repository_capacity');
        atomicJson(path.join(repository, 'saturated.json'), value);
        return value;
      }
      fs.mkdirSync(commandDirectory, { mode: 0o700 });
    }

    commandLock = acquireRetryShardLock(commandDirectory);
    const result = callback(commandDirectory);
    commandLock.release();
    commandLock = null;
    pruneEmptyRetryDirectory(commandDirectory);
    return result;
  } finally {
    if (commandLock) commandLock.release();
    if (repositoryLock) repositoryLock.release();
    if (fs.existsSync(repository)
      && !json(path.join(repository, 'saturated.json'))
      && retryDirectories(repository, /^[a-f0-9]{64}$/).length === 0) {
      pruneEmptyRetryDirectory(repository);
    }
    ledgerLock.release();
  }
}

function boundedRetryShard(cwd, commandKey) {
  const result = withRetryLedgerState(cwd, commandKey, {}, (directory) => {
    const saturated = json(path.join(directory, 'saturated.json'));
    if (saturated) return { saturated, entries: [] };
    const files = retryEntryFiles(directory);
    if (files.length > MAX_RETRY_ENTRIES_PER_SHARD) {
      return { saturated: saturateRetryShard(directory, 'legacy_overflow'), entries: [] };
    }
    return { saturated: null, entries: files.map(json).filter(Boolean) };
  });
  if (result?.limit === 'retry_ledger_saturated') {
    return { saturated: result, entries: [] };
  }
  return result || { saturated: null, entries: [] };
}

export function checkSafetyRetry(cwd, command, limits) {
  const signature = safetyRetrySignature(cwd, command, limits);
  const commandKey = safetyRetryCommandKey(cwd, command);
  const metadata = retryMetadata(cwd, command);
  const shard = boundedRetryShard(cwd, commandKey);
  const entries = shard.entries;
  const legacy = json(legacySafetyRetryPath(cwd));
  const previous = shard.saturated || entries.find((entry) => entry.signature === signature
    || (entry.runner_build === metadata.runner_build
      && entry.command_digest === metadata.command_digest
      && entry.workload_digest === retryMetadata(cwd, command, entry.workload_paths).workload_digest))
    || legacy?.entries?.[signature]
    || (legacy?.signature === signature ? legacy : null);
  return {
    ok: !previous,
    signature,
    previous,
  };
}

export function recordRunAttempt(cwd, command, limits, report, signatureOverride = null) {
  const signature = signatureOverride || safetyRetrySignature(cwd, command, limits);
  const commandKey = safetyRetryCommandKey(cwd, command);
  const metadata = retryMetadata(cwd, command);
  const value = {
    schema: 'lamina.safe-runner-safety-limit-entry/v3',
    repository: canonicalRepositoryPath(cwd),
    ...metadata,
    signature,
    recorded_at: new Date().toISOString(),
    run_id: report.run_id,
    status: 'active',
    limit: 'controller_crash_or_unclassified',
  };
  return withRetryLedgerState(cwd, commandKey, { reserve: true }, (directory) => {
    const saturated = json(path.join(directory, 'saturated.json'));
    if (saturated) return saturated;
    const file = safetyRetryEntryPath(cwd, commandKey, report.run_id);
    const files = retryEntryFiles(directory);
    if (!files.includes(file) && files.length >= MAX_RETRY_ENTRIES_PER_SHARD) {
      return saturateRetryShard(directory);
    }
    atomicJson(file, value);
    return value;
  });
}

export function clearRunAttempt(cwd, command, limits, runId, signatureOverride = null) {
  void limits;
  void signatureOverride;
  const commandKey = safetyRetryCommandKey(cwd, command);
  return withRetryLedgerState(cwd, commandKey, {}, (directory) => {
    const saturated = json(path.join(directory, 'saturated.json'));
    if (saturated) return saturated;
    const file = safetyRetryEntryPath(cwd, commandKey, runId);
    const entry = json(file);
    if (entry?.status === 'active' && entry?.run_id === runId) fs.rmSync(file, { force: true });
    return entry;
  });
}

export function recordSafetyLimit(cwd, command, limits, report, signatureOverride = null) {
  const signature = signatureOverride || safetyRetrySignature(cwd, command, limits);
  const commandKey = safetyRetryCommandKey(cwd, command);
  return withRetryLedgerState(cwd, commandKey, { reserve: true }, (directory) => {
    const saturated = json(path.join(directory, 'saturated.json'));
    if (saturated) return saturated;
    const file = safetyRetryEntryPath(cwd, commandKey, report.run_id);
    const files = retryEntryFiles(directory);
    if (!files.includes(file) && files.length >= MAX_RETRY_ENTRIES_PER_SHARD) {
      return saturateRetryShard(directory);
    }
    const metadata = json(file) || retryMetadata(cwd, command);
    const value = {
      schema: 'lamina.safe-runner-safety-limit-entry/v3',
      repository: canonicalRepositoryPath(cwd),
      ...metadata,
      signature,
      recorded_at: new Date().toISOString(),
      run_id: report.run_id,
      status: 'safety_limit_exceeded',
      limit: report.termination.limit,
    };
    atomicJson(file, value);
    return value;
  });
}

function promotionPath(cwd) {
  return path.join(stateDirectory(), 'promotions', `${repositoryKey(cwd)}.json`);
}

export function promotionCommandDigest(command) {
  return Array.isArray(command) && command.length > 0
    ? crypto.createHash('sha256').update(JSON.stringify(redactCommand(command))).digest('hex')
    : null;
}

function promotionImplementationPaths(cwd, command) {
  const physicalCwd = canonicalRepositoryPath(cwd);
  const candidates = command.map((argument) => path.resolve(physicalCwd, String(argument)));
  const executable = path.basename(String(command[0] || '')).toLowerCase();
  if (/^(?:npm|npm\.cmd|npx|npx\.cmd)$/.test(executable)) {
    for (const manifest of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']) {
      candidates.push(path.join(physicalCwd, manifest));
    }
  }
  if (/^(?:npx|npx\.cmd)$/.test(executable) && typeof command[1] === 'string') {
    const localTool = path.join(physicalCwd, 'node_modules', '.bin', command[1]);
    candidates.push(localTool);
    try { candidates.push(fs.realpathSync.native(localTool)); } catch {}
  }
  return [...new Set(candidates)];
}

function gitSnapshotCommand(cwd, args, maxBuffer = 16 * 1024 * 1024) {
  return spawnSync('git', args, {
    cwd, encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000, maxBuffer,
  });
}

function gitRoot(candidate) {
  let directory = path.resolve(candidate);
  try {
    if (fs.statSync(directory).isFile()) directory = path.dirname(directory);
  } catch { return null; }
  const result = gitSnapshotCommand(directory, ['rev-parse', '--show-toplevel']);
  if (result.status !== 0 || result.error) return null;
  try { return fs.realpathSync.native(String(result.stdout).trim()); } catch { return null; }
}

function repositorySourceDigest(cwd, implementationPaths) {
  const roots = [...new Set([cwd, ...implementationPaths].map(gitRoot).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  if (roots.length === 0) {
    const error = new Error('tier promotion requires a bounded Git source snapshot for the audited implementation');
    error.code = 'LAMINA_SAFE_PROMOTION_SOURCE_UNPROVEN';
    throw error;
  }
  const combined = crypto.createHash('sha256');
  for (const root of roots) {
    const commands = [
      ['rev-parse', '--verify', 'HEAD'],
      ['ls-files', '-s', '-z'],
      ['diff', '--name-only', '-z'],
      ['ls-files', '--others', '--exclude-standard', '-z'],
    ];
    const results = commands.map((args) => gitSnapshotCommand(root, args));
    if (results.some((result) => result.status !== 0 || result.error)) {
      const error = new Error('tier promotion could not capture a bounded Git source snapshot');
      error.code = 'LAMINA_SAFE_PROMOTION_SOURCE_UNPROVEN';
      throw error;
    }
    const changed = Buffer.concat([results[2].stdout, results[3].stdout])
      .toString('utf8').split('\0').filter(Boolean).map((relative) => path.join(root, relative));
    const hash = crypto.createHash('sha256').update(root);
    for (const result of results) hash.update('\0').update(result.stdout);
    hash.update('\0').update(JSON.stringify(workloadIdentity(
      root, [], changed, { requireDigest: true },
    )));
    combined.update(root).update('\0').update(hash.digest());
  }
  return combined.digest('hex');
}

export function promotionImplementationDigest(cwd, command) {
  if (!Array.isArray(command) || command.length === 0) return null;
  const implementationPaths = promotionImplementationPaths(cwd, command);
  const workload = workloadIdentity(cwd, command, implementationPaths, { requireDigest: true });
  return crypto.createHash('sha256').update(JSON.stringify({
    workload,
    repository_source: repositorySourceDigest(cwd, implementationPaths),
  })).digest('hex');
}

export function promotionStatus(cwd, workloadId = null, command = null) {
  const value = json(promotionPath(cwd));
  const digest = workloadDigest(workloadId);
  if (value?.build_digest !== runnerBuildDigest() || !digest) return { completed: [], value: null };
  const workload = value.workloads?.[digest];
  const expectedCommand = promotionCommandDigest(command);
  const expectedImplementation = command ? promotionImplementationDigest(cwd, command) : null;
  if (expectedCommand && (workload?.command_digest !== expectedCommand
    || workload?.implementation_digest !== expectedImplementation)) {
    return {
      completed: [], value, workload_digest: digest,
      command_matches: workload?.command_digest === expectedCommand,
      implementation_matches: workload?.implementation_digest === expectedImplementation,
    };
  }
  const completed = workload?.completed;
  return {
    completed: Array.isArray(completed) ? completed : [],
    value,
    workload_digest: digest,
    command_matches: expectedCommand ? workload?.command_digest === expectedCommand : null,
    implementation_matches: expectedImplementation
      ? workload?.implementation_digest === expectedImplementation : null,
  };
}

export function checkPromotion(cwd, tier, workloadId = null, command = null) {
  const index = TIER_ORDER.indexOf(tier);
  const required = index <= 0 ? [] : TIER_ORDER.slice(0, index);
  const status = promotionStatus(cwd, workloadId, command);
  const missing = required.filter((item) => !status.completed.includes(item));
  return { ok: missing.length === 0, required, missing, completed: status.completed };
}

export function recordPromotion(cwd, tier, evidence, workloadId) {
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
  const commandDigest = promotionCommandDigest(evidence.command);
  const implementationDigest = promotionImplementationDigest(cwd, evidence.command);
  const status = promotionStatus(cwd, workloadId, evidence.command);
  const existingState = json(promotionPath(cwd));
  const existingWorkload = existingState?.build_digest === runnerBuildDigest()
    ? existingState.workloads?.[digest] : null;
  if (existingWorkload && (existingWorkload.command_digest !== commandDigest
    || existingWorkload.implementation_digest !== implementationDigest)) {
    const error = new Error('tier promotion workload identifier is already bound to a different command or implementation');
    error.code = 'LAMINA_SAFE_PROMOTION_COMMAND_MISMATCH';
    throw error;
  }
  const completed = TIER_ORDER.filter((item) => new Set([...status.completed, tier]).has(item));
  const existing = json(promotionPath(cwd));
  const value = {
    schema: PROMOTION_SCHEMA,
    repository: canonicalRepositoryPath(cwd),
    build_digest: runnerBuildDigest(),
    workloads: {
      ...(existing?.build_digest === runnerBuildDigest() ? existing.workloads : {}),
      [digest]: {
        workload_id: workloadId,
        command_digest: commandDigest,
        implementation_digest: implementationDigest,
        completed,
        evidence: {
          run_id: evidence.run_id,
          tier,
          adapter: evidence.adapter?.id || null,
          command_digest: commandDigest,
          implementation_digest: implementationDigest,
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

export function acquireConcurrencyLock({ directory = productionLockDirectory() } = {}) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const identity = processIdentity(process.pid);
  const nonce = crypto.randomBytes(16).toString('hex');
  const file = path.join(directory, `${identity.pid}-${identity.start_ticks}-${nonce}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ ...identity, nonce, created_at: new Date().toISOString() })}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.json')) continue;
    const candidate = path.join(directory, name);
    if (candidate === file) continue;
    const existing = json(candidate);
    if (identityAlive(existing)) {
      fs.rmSync(file, { force: true });
      const conflict = new Error(`another medium/large safe-runner is active as PID ${existing.pid}`);
      conflict.code = 'LAMINA_SAFE_CONCURRENCY';
      throw conflict;
    }
    // Claim names contain an unguessable nonce and are never reused. Removing
    // this exact stale claim cannot unlink a replacement live lock.
    fs.rmSync(candidate, { force: true });
  }
  let released = false;
  return {
    file,
    release() {
      if (!released) {
        const owner = json(file);
        if (owner?.nonce !== nonce) {
          const error = new Error('refusing to remove a concurrency claim whose owner changed');
          error.code = 'LAMINA_SAFE_LOCK_IDENTITY';
          throw error;
        }
        fs.rmSync(file, { force: true });
      }
      released = true;
      return true;
    },
  };
}
