import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTESTATION_SCHEMA,
  PROMOTION_SCHEMA,
  SELF_TEST_CASE_IDS,
  TIER_ORDER,
} from './constants.mjs';
import { identityAlive, processIdentity } from './processes.mjs';

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
      else if (/\.(?:mjs|json|sh)$/.test(entry.name)) hash.update(entry.name).update(fs.readFileSync(absolute));
    }
  };
  visit(HERE);
  const graphdClient = path.resolve(HERE, '../../packages/cli/lib/graph-runtime/client.mjs');
  hash.update('packages/cli/lib/graph-runtime/client.mjs').update(fs.readFileSync(graphdClient));
  return hash.digest('hex');
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

function promotionPath(cwd) {
  return path.join(stateDirectory(), 'promotions', `${repositoryKey(cwd)}.json`);
}

export function promotionStatus(cwd) {
  const value = json(promotionPath(cwd));
  if (value?.build_digest !== runnerBuildDigest()) return { completed: [], value: null };
  return { completed: Array.isArray(value.completed) ? value.completed : [], value };
}

export function checkPromotion(cwd, tier) {
  const index = TIER_ORDER.indexOf(tier);
  const required = index <= 0 ? [] : TIER_ORDER.slice(0, index);
  const status = promotionStatus(cwd);
  const missing = required.filter((item) => !status.completed.includes(item));
  return { ok: missing.length === 0, required, missing, completed: status.completed };
}

export function recordPromotion(cwd, tier, evidence) {
  if (evidence?.outcome !== 'success'
    || evidence?.cleanup?.descendants_remaining?.length !== 0
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
  const status = promotionStatus(cwd);
  const completed = TIER_ORDER.filter((item) => new Set([...status.completed, tier]).has(item));
  const value = {
    schema: PROMOTION_SCHEMA,
    repository: path.resolve(cwd),
    build_digest: runnerBuildDigest(),
    completed,
    evidence: {
      run_id: evidence.run_id,
      tier,
      adapter: evidence.adapter?.id || null,
      command_digest: crypto.createHash('sha256').update(JSON.stringify(evidence.command)).digest('hex'),
      finished_at: evidence.finished_at,
    },
    updated_at: new Date().toISOString(),
  };
  atomicJson(promotionPath(cwd), value);
  return value;
}

export function acquireConcurrencyLock() {
  const directory = path.join(stateDirectory(), 'production-locks');
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
