import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  CURSOR_CLI_SHA256,
  CURSOR_CLI_VERSION,
  HARBOR_AGENT,
  HARBOR_MODEL,
  HARBOR_VERSION,
  LAMINA_BENCH_SKILLS,
} from './constants.mjs';
import {
  extractLockSkillSources,
  parseAgentSkillLocks,
  validateAgentSkillLocks,
} from './skill-lock.mjs';
import { verifyStagedSkillBundle } from './skill-bundle.mjs';

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export { extractLockSkillSources, parseAgentSkillLocks, validateAgentSkillLocks };

// Must remain byte-for-byte equivalent to lb6_skill_gate.py's
// manifest_aggregate_digest([]). Baseline arms are valid only when the
// runner-owned container inventory is provably empty.
export const EMPTY_INVENTORY_DIGEST = crypto
  .createHash('sha256')
  .update(JSON.stringify([]))
  .digest('hex');

export function collectHostLedgerEntries(ledgerPath) {
  if (!ledgerPath || !fs.existsSync(ledgerPath)) return [];
  return fs
    .readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .flatMap((entry) => (entry.details ? [{ ...entry.details, event: entry.event }] : [entry]));
}

function ledgerHasContainerEvidence(entry, manifest) {
  const isLamina = entry.arm === 'lamina';
  const expectedFileCount = isLamina ? manifest?.file_count : 0;
  const expectedAggregateDigest = isLamina
    ? manifest?.aggregate_digest
    : EMPTY_INVENTORY_DIGEST;

  return entry.event === 'pre_model_skill_gate'
    && entry.passed === true
    && typeof entry.container_path === 'string'
    && entry.container_file_count === expectedFileCount
    && entry.container_aggregate_digest === expectedAggregateDigest
    && entry.bundle_digest === manifest?.aggregate_digest
    && entry.lamina_skill_absent === !isLamina;
}

export function evaluatePreModelSkillGate({
  arm,
  taskId,
  phase = null,
  lock = null,
  ledgerEntries = [],
  stagedRoot = null,
  manifest = null,
  root = null,
  requireLedgerEvidence = false,
}) {
  const bundleCheck = root ? verifyStagedSkillBundle(root, manifest) : { ok: true, manifest };
  if (!bundleCheck.ok) {
    return {
      passed: false,
      treatmentValid: false,
      priorNoSkill: false,
      gate: 'skill_digest_mismatch',
      reason: bundleCheck.reason,
      bundleDigest: manifest?.aggregate_digest ?? null,
    };
  }

  const skillLocks = parseAgentSkillLocks(lock);
  const skillSources = extractLockSkillSources(lock);
  const lockCheck = validateAgentSkillLocks({
    locks: skillLocks,
    arm,
    expectedSkillNames: manifest?.skills ?? LAMINA_BENCH_SKILLS,
    expectedDigests: manifest?.harbor_skill_digests ?? null,
  });

  if (!lockCheck.passed) {
    return {
      passed: false,
      treatmentValid: false,
      priorNoSkill: lockCheck.gate === 'skill_injection_missing',
      gate: lockCheck.gate,
      reason: lockCheck.reason,
      skillSources,
      skillLocks: lockCheck.locks,
    };
  }

  if (arm === 'lamina' && stagedRoot) {
    for (const skillName of manifest?.skills ?? LAMINA_BENCH_SKILLS) {
      const expected = path.join(stagedRoot, skillName, 'SKILL.md');
      if (!fs.existsSync(expected)) {
        return {
          passed: false,
          treatmentValid: false,
          priorNoSkill: false,
          gate: 'skill_registration_missing',
          reason: `expected staged skill missing locally: ${skillName}`,
          skillSources,
          skillLocks,
        };
      }
    }
  }

  const ledgerEvent = {
    event: 'pre_model_skill_gate',
    arm,
    task_id: taskId,
    phase,
    harbor_version: HARBOR_VERSION,
    agent: HARBOR_AGENT,
    model: HARBOR_MODEL,
    cursor_cli_version: CURSOR_CLI_VERSION,
    cursor_cli_sha256: CURSOR_CLI_SHA256,
    source_skill_commit: manifest?.source_skill_commit ?? manifest?.pinned_commit ?? null,
    bundle_commit: manifest?.pinned_commit ?? null,
    bundle_digest: manifest?.aggregate_digest ?? null,
    skill_sources: skillSources,
    skill_locks: skillLocks.filter((entry) => entry.digest),
    lamina_skill_absent: arm !== 'lamina',
    passed: true,
  };

  const hasLedgerEvidence = ledgerEntries.some((entry) =>
    entry.event === 'pre_model_skill_gate'
    && entry.arm === arm
    && entry.task_id === taskId
    && ledgerHasContainerEvidence(entry, manifest),
  );

  if (requireLedgerEvidence && !hasLedgerEvidence) {
    return {
      passed: false,
      treatmentValid: false,
      priorNoSkill: false,
      gate: 'pre_model_skill_gate_missing',
      reason: 'missing or mismatched pre_model_skill_gate ledger evidence with container registration proof',
      skillSources,
      skillLocks,
      bundleDigest: manifest?.aggregate_digest ?? null,
      ledgerEvent,
      hasLedgerEvidence: false,
    };
  }

  return {
    passed: true,
    treatmentValid: arm !== 'lamina' || skillLocks.length > 0,
    priorNoSkill: arm === 'lamina' && skillLocks.length === 0,
    gate: 'pre_model_skill_gate_passed',
    reason: null,
    skillSources,
    skillLocks,
    bundleDigest: manifest?.aggregate_digest ?? null,
    ledgerEvent,
    hasLedgerEvidence,
  };
}

export function readTrialLock(jobPath, trialName = null) {
  const jobLock = readJson(path.join(jobPath, 'lock.json'));
  const trialLock = trialName ? readJson(path.join(jobPath, trialName, 'lock.json')) : null;
  if (trialLock?.skills?.length || trialLock?.trials?.length) return trialLock;
  return jobLock;
}

export function evaluateJobPreModelGate({
  root,
  jobsRoot,
  jobName,
  arm,
  taskId,
  manifest = null,
}) {
  const jobPath = path.join(jobsRoot, jobName);
  const trialNames = fs.existsSync(jobPath)
    ? fs.readdirSync(jobPath).filter((name) => name.includes('__'))
    : [];
  const trialName = trialNames[0] ?? null;
  const lock = readTrialLock(jobPath, trialName);
  const ledgerPath = trialName
    ? path.join(jobPath, trialName, 'protocol', 'transition-ledger.jsonl')
    : null;
  const { manifest: loadedManifest, stagedRoot } = manifest
    ? { manifest, stagedRoot: path.join(root, 'benchmarks/lb6/pilot/skill-bundle/staged') }
    : (() => {
        const manifestPath = path.join(root, 'benchmarks/lb6/pilot/skill-bundle/manifest-v3.json');
        const parsed = readJson(manifestPath);
        return {
          manifest: parsed,
          stagedRoot: path.join(root, 'benchmarks/lb6/pilot/skill-bundle/staged'),
        };
      })();

  return evaluatePreModelSkillGate({
    arm,
    taskId,
    lock,
    ledgerEntries: collectHostLedgerEntries(ledgerPath),
    stagedRoot,
    manifest: loadedManifest,
    root,
  });
}
