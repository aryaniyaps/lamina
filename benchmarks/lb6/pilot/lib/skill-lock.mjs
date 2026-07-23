import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LAMINA_BENCH_SKILLS } from './constants.mjs';

const DIGEST_PREFIX = 'sha256:';

function listFilesRecursive(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Harbor 0.18 compute_skill_digest semantics for a single skill directory. */
export function computeHarborSkillDigest(skillDir) {
  const hasher = createHash('sha256');
  for (const rel of listFilesRecursive(skillDir)) {
    const abs = path.join(skillDir, rel);
    const contentDigest = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    hasher.update(rel);
    hasher.update('\0');
    hasher.update(contentDigest);
    hasher.update('\0');
  }
  return `${DIGEST_PREFIX}${hasher.digest('hex')}`;
}

export function buildExpectedHarborSkillDigests(stagedRoot, skillNames = LAMINA_BENCH_SKILLS) {
  const digests = {};
  for (const skillName of [...skillNames].sort()) {
    digests[skillName] = computeHarborSkillDigest(path.join(stagedRoot, skillName));
  }
  return digests;
}

function normalizeLockEntry(item) {
  if (!item || typeof item !== 'object') return null;
  const name = typeof item.name === 'string' ? item.name : null;
  const sourceRaw = item.source ?? item.path ?? null;
  const source = typeof sourceRaw === 'string'
    ? sourceRaw.replace(/\\/g, '/')
    : null;
  const digest = typeof item.digest === 'string' ? item.digest : null;
  if (!name || !source || !digest) return null;
  return {
    name,
    source,
    digest,
    git_url: typeof item.git_url === 'string' ? item.git_url : null,
    git_commit_id: typeof item.git_commit_id === 'string' ? item.git_commit_id : null,
  };
}

/** Collect AgentSkillLock entries from Harbor 0.18 job or trial lock shapes. */
export function parseAgentSkillLocks(lock) {
  if (!lock || typeof lock !== 'object') return [];
  const entries = [];
  const push = (items) => {
    for (const item of items ?? []) {
      if (typeof item === 'string') {
        entries.push({ name: path.basename(item), source: item.replace(/\\/g, '/'), digest: null, legacy: true });
        continue;
      }
      const parsed = normalizeLockEntry(item);
      if (parsed) entries.push(parsed);
    }
  };

  if (Array.isArray(lock.trials)) {
    for (const trial of lock.trials) push(trial?.skills);
  }
  push(lock.skills);
  push(lock.agent?.skills);
  return entries;
}

export function validateAgentSkillLocks({
  locks,
  arm,
  expectedSkillNames = LAMINA_BENCH_SKILLS,
  expectedDigests = null,
}) {
  const expectedNames = [...expectedSkillNames].sort();
  if (arm !== 'lamina') {
    if (!locks.length) {
      return { passed: true, locks: [], reason: null, gate: 'baseline_skill_absent' };
    }
    const contaminated = locks.filter((entry) =>
      expectedNames.includes(entry.name)
      || /\/lamina(?:[-/]|$)/.test(entry.source)
      || /\/skills\/lamina/.test(entry.source),
    );
    if (contaminated.length) {
      return {
        passed: false,
        locks,
        gate: 'baseline_skill_contamination',
        reason: `${arm} arm lock must not inject Lamina skills`,
      };
    }
    return { passed: true, locks, reason: null, gate: 'baseline_skill_absent' };
  }

  if (!locks.length) {
    return {
      passed: false,
      locks,
      gate: 'skill_injection_missing',
      reason: 'Harbor lock recorded empty injected skill sources for lamina arm',
    };
  }

  const legacyOnly = locks.some((entry) => entry.legacy || !entry.digest);
  if (legacyOnly) {
    return {
      passed: false,
      locks,
      gate: 'skill_lock_schema_invalid',
      reason: 'lamina arm requires Harbor AgentSkillLock entries with name, source, and digest',
    };
  }

  const byName = new Map();
  for (const entry of locks) {
    if (byName.has(entry.name)) {
      return {
        passed: false,
        locks,
        gate: 'skill_lock_duplicate',
        reason: `duplicate skill lock name: ${entry.name}`,
      };
    }
    byName.set(entry.name, entry);
  }

  const actualNames = [...byName.keys()].sort();
  if (actualNames.length !== expectedNames.length) {
    const missing = expectedNames.filter((name) => !byName.has(name));
    const extra = actualNames.filter((name) => !expectedNames.includes(name));
    return {
      passed: false,
      locks,
      gate: missing.length ? 'skill_lock_missing' : 'skill_lock_extra',
      reason: missing.length
        ? `missing skill locks: ${missing.join(', ')}`
        : `unexpected skill locks: ${extra.join(', ')}`,
    };
  }

  for (const name of expectedNames) {
    if (!byName.has(name)) {
      return {
        passed: false,
        locks,
        gate: 'skill_lock_missing',
        reason: `missing skill lock: ${name}`,
      };
    }
  }

  if (expectedDigests) {
    for (const name of expectedNames) {
      const expected = expectedDigests[name];
      const actual = byName.get(name)?.digest;
      if (!expected || actual !== expected) {
        return {
          passed: false,
          locks,
          gate: 'skill_lock_digest_mismatch',
          reason: `digest mismatch for ${name}`,
          expected,
          actual,
        };
      }
    }
  }

  for (const entry of locks) {
    if (!entry.digest?.startsWith(DIGEST_PREFIX) || entry.digest.length !== DIGEST_PREFIX.length + 64) {
      return {
        passed: false,
        locks,
        gate: 'skill_lock_digest_invalid',
        reason: `invalid digest format for ${entry.name}`,
      };
    }
  }

  return { passed: true, locks, reason: null, gate: 'skill_lock_valid' };
}

export function extractLockSkillSources(lock) {
  return [...new Set(parseAgentSkillLocks(lock).map((entry) => entry.source).filter(Boolean))];
}
