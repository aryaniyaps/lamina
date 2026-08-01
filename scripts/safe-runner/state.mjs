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
  const graphdClient = path.resolve(HERE, '../../packages/cli/lib/graph-runtime/client.mjs');
  hash.update('packages/cli/lib/graph-runtime/client.mjs').update(fs.readFileSync(graphdClient));
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

function repositoryKey(cwd) {
  let resolved = path.resolve(cwd);
  try { resolved = fs.realpathSync(resolved); } catch {}
  return crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 24);
}

export function workloadDigest(workloadId) {
  if (typeof workloadId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{2,127}$/i.test(workloadId)) return null;
  return crypto.createHash('sha256').update(workloadId).digest('hex');
}

function workloadIdentity(cwd, command = [], selectedPaths = null) {
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
      if (stat.size <= 16n * 1024n * 1024n) {
        identity.digest = crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex');
      }
      files.push(identity);
    } catch {}
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
    repository: path.resolve(cwd),
    command_digest: metadata.command_digest,
    workload_digest: metadata.workload_digest,
    runner_build: metadata.runner_build,
    concurrency: 1,
  })).digest('hex');
}

function safetyRetryPath(cwd) {
  return path.join(stateDirectory(), 'safety-limit-ledger', `${repositoryKey(cwd)}.json`);
}

export function checkSafetyRetry(cwd, command, limits) {
  const signature = safetyRetrySignature(cwd, command, limits);
  const value = json(safetyRetryPath(cwd));
  const metadata = retryMetadata(cwd, command);
  const entries = Object.values(value?.entries || {});
  const previous = value?.entries?.[signature]
    || entries.find((entry) => entry.runner_build === metadata.runner_build
      && entry.command_digest === metadata.command_digest
      && entry.workload_digest === retryMetadata(cwd, command, entry.workload_paths).workload_digest)
    || (value?.signature === signature ? value : null);
  return {
    ok: !previous,
    signature,
    previous,
  };
}

function updateSafetyRetryEntries(cwd, mutate) {
  const file = safetyRetryPath(cwd);
  const existing = json(file);
  const entries = existing?.schema === 'lamina.safe-runner-safety-limit-ledger/v2'
    ? { ...existing.entries } : {};
  mutate(entries);
  const retained = Object.fromEntries(Object.entries(entries)
    .sort((left, right) => String(right[1].recorded_at).localeCompare(String(left[1].recorded_at)))
    .slice(0, 128));
  const value = {
    schema: 'lamina.safe-runner-safety-limit-ledger/v2',
    repository: path.resolve(cwd),
    entries: retained,
    updated_at: new Date().toISOString(),
  };
  atomicJson(file, value);
  return value;
}

export function recordRunAttempt(cwd, command, limits, report, signatureOverride = null) {
  const signature = signatureOverride || safetyRetrySignature(cwd, command, limits);
  const metadata = retryMetadata(cwd, command);
  return updateSafetyRetryEntries(cwd, (entries) => {
    entries[signature] = {
      ...metadata,
      signature,
      recorded_at: new Date().toISOString(),
      run_id: report.run_id,
      status: 'active',
      limit: 'controller_crash_or_unclassified',
    };
  });
}

export function clearRunAttempt(cwd, command, limits, runId, signatureOverride = null) {
  const signature = signatureOverride || safetyRetrySignature(cwd, command, limits);
  return updateSafetyRetryEntries(cwd, (entries) => {
    if (entries[signature]?.status === 'active' && entries[signature]?.run_id === runId) {
      delete entries[signature];
    }
  });
}

export function recordSafetyLimit(cwd, command, limits, report, signatureOverride = null) {
  const signature = signatureOverride || safetyRetrySignature(cwd, command, limits);
  return updateSafetyRetryEntries(cwd, (entries) => {
    const metadata = entries[signature] || retryMetadata(cwd, command);
    entries[signature] = {
      ...metadata,
      signature,
      recorded_at: new Date().toISOString(),
      run_id: report.run_id,
      status: 'safety_limit_exceeded',
      limit: report.termination.limit,
    };
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

export function promotionStatus(cwd, workloadId = null, command = null) {
  const value = json(promotionPath(cwd));
  const digest = workloadDigest(workloadId);
  if (value?.build_digest !== runnerBuildDigest() || !digest) return { completed: [], value: null };
  const workload = value.workloads?.[digest];
  const expectedCommand = promotionCommandDigest(command);
  if (expectedCommand && workload?.command_digest !== expectedCommand) {
    return {
      completed: [], value, workload_digest: digest, command_matches: false,
    };
  }
  const completed = workload?.completed;
  return {
    completed: Array.isArray(completed) ? completed : [],
    value,
    workload_digest: digest,
    command_matches: expectedCommand ? workload?.command_digest === expectedCommand : null,
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
  const status = promotionStatus(cwd, workloadId, evidence.command);
  const existingState = json(promotionPath(cwd));
  const existingWorkload = existingState?.build_digest === runnerBuildDigest()
    ? existingState.workloads?.[digest] : null;
  if (existingWorkload && existingWorkload.command_digest !== commandDigest) {
    const error = new Error('tier promotion workload identifier is already bound to a different command');
    error.code = 'LAMINA_SAFE_PROMOTION_COMMAND_MISMATCH';
    throw error;
  }
  const completed = TIER_ORDER.filter((item) => new Set([...status.completed, tier]).has(item));
  const existing = json(promotionPath(cwd));
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
          command_digest: commandDigest,
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
