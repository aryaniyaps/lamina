import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CONTRACT_VERSION = '1.0.0';
export const SUPPORTED_STATUSES = new Set(['running', 'published', 'withheld']);
export const TRUSTED_REPOSITORY = 'https://github.com/aryaniyaps/lamina';

export const STATE_FIELDS = {
  running: ['methodologyLockedAt'],
  published: ['publishedAt', 'coverage', 'results'],
  withheld: ['withheldAt', 'reasonCode'],
};

export const FORBIDDEN_RESULT_KEYS = [
  'results',
  'coverage',
  'scores',
  'aggregate',
  'perTask',
  'uncertainty',
  'trends',
];

const BASELINE_STEPS = [
  { step: 'shape_build', agentTimeoutSeconds: 2100, verifierTimeoutSeconds: 60 },
  { step: 'verify_fix', agentTimeoutSeconds: 2100, verifierTimeoutSeconds: 60 },
];

const LAMINA_STEPS = [
  { step: 'lamina_init', agentTimeoutSeconds: 600, verifierTimeoutSeconds: 60 },
  { step: 'lamina_design', agentTimeoutSeconds: 1100, verifierTimeoutSeconds: 60 },
  { step: 'implement', agentTimeoutSeconds: 800, verifierTimeoutSeconds: 60 },
  { step: 'lamina_verify', agentTimeoutSeconds: 1100, verifierTimeoutSeconds: 90 },
  { step: 'fix', agentTimeoutSeconds: 600, verifierTimeoutSeconds: 60 },
];

const ARM_DEFINITIONS = {
  direct: {
    label: 'Direct agent',
    description:
      'Normal coding agent without Lamina skills. Implements from the founder brief with no plan-first or checklist workflow.',
    workflowSteps: ['shape_build', 'verify_fix'],
  },
  plan: {
    label: 'Plan-first agent',
    description:
      'Normal coding agent using a plan-first workflow. Writes a short plan, then implements. No Lamina skills.',
    workflowSteps: ['shape_build', 'verify_fix'],
  },
  checklist: {
    label: 'Checklist agent',
    description:
      'Normal coding agent with a generic product checklist before building. No Lamina skills.',
    workflowSteps: ['shape_build', 'verify_fix'],
  },
  lamina: {
    label: 'Lamina agent',
    description:
      'Full Lamina loop: init, design with persona panel, implement, verify with UI walkthrough, and fix.',
    workflowSteps: ['lamina_init', 'lamina_design', 'implement', 'lamina_verify', 'fix'],
  },
};


export function resolveRepoRoot(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '../..');
}

export function gitCommand(root, args) {
  const gitDirs = ['.git', '.git.__ase_bak'];
  for (const gitDir of gitDirs) {
    const candidate = path.join(root, gitDir);
    if (!fs.existsSync(candidate)) continue;
    const result = spawnSync('git', args, {
      cwd: root,
      env: { ...process.env, GIT_DIR: candidate },
      encoding: 'utf8',
    });
    if (result.status === 0) return String(result.stdout).trim();
  }
  return null;
}

export function computeProtocolSha256(root, protocolPaths) {
  const digest = createHash('sha256');
  const files = [];

  for (const rel of [...protocolPaths].sort()) {
    const absolute = path.join(root, rel);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Protocol path missing: ${rel}`);
    }
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) {
      collectDirectoryFiles(absolute, rel, files);
    } else {
      files.push(rel);
    }
  }

  for (const rel of files.sort()) {
    const absolute = path.join(root, rel);
    digest.update(rel);
    digest.update('\0');
    digest.update(fs.readFileSync(absolute));
    digest.update('\0');
  }

  return { sha256: digest.digest('hex'), fileCount: files.length };
}

function collectDirectoryFiles(absoluteDir, relPrefix, files) {
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const rel = path.join(relPrefix, entry.name).replaceAll('\\', '/');
    const absolute = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      collectDirectoryFiles(absolute, rel, files);
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
}

export function githubBlobUrl(repository, commit, repoPath) {
  const normalized = normalizeRepoRelativePath(repoPath);
  return `${repository.replace(/\/$/, '')}/blob/${commit}/${normalized}`;
}

export function normalizeRepoRelativePath(repoPath) {
  return String(repoPath).replace(/^\/+/, '').replaceAll('\\', '/');
}

export function isSafeRepoRelativePath(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath.trim()) return false;
  if (path.isAbsolute(repoPath)) return false;
  const normalized = normalizeRepoRelativePath(repoPath);
  if (!normalized || normalized.startsWith('..') || normalized.split('/').includes('..')) {
    return false;
  }
  return /^[\w.-]+(?:\/[\w.-]+)*$/.test(normalized);
}

export function canonicalArtifactUrl(repository, commit, repoPath) {
  return githubBlobUrl(repository, commit, repoPath);
}

export function isPublicTaskBriefPath(taskId, briefPath) {
  if (!taskId || !isSafeRepoRelativePath(briefPath)) return false;
  return briefPath === `benchmarks/corpus/${taskId}/brief.md`;
}

export function isSortedById(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  for (let index = 1; index < items.length; index += 1) {
    if (items[index - 1].id.localeCompare(items[index].id) >= 0) return false;
  }
  return true;
}

export function isCanonicalArtifactUrl(url, repository, commit, repoPath) {
  if (!isTrustedRepository(repository)) return false;
  if (!isCommitPin(commit)) return false;
  return url === canonicalArtifactUrl(repository, commit, repoPath);
}

export function buildArmFacts(armIds, totalBudgetSecondsPerArm) {
  return armIds
    .map((id) => {
      const def = ARM_DEFINITIONS[id];
      if (!def) throw new Error(`Unknown arm id: ${id}`);
      const stepBudgets = id === 'lamina' ? LAMINA_STEPS : BASELINE_STEPS;
      const total = stepBudgets.reduce((sum, step) => sum + step.agentTimeoutSeconds, 0);
      if (total !== totalBudgetSecondsPerArm) {
        throw new Error(`${id} arm budget is ${total}s; expected ${totalBudgetSecondsPerArm}s`);
      }
      return {
        id,
        label: def.label,
        description: def.description,
        workflowSteps: def.workflowSteps,
        totalBudgetSeconds: totalBudgetSecondsPerArm,
        stepBudgets,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function buildTaskFacts(corpusTasks, root, commit) {
  const corpusPrefix = 'benchmarks/corpus/';
  return corpusTasks
    .map((task) => {
      if (!task.brief) {
        throw new Error(`Task ${task.id} is missing corpus brief reference`);
      }
      const briefPath = `${corpusPrefix}${task.brief}`;
      const expectedBriefPath = `${corpusPrefix}${task.id}/brief.md`;
      if (briefPath !== expectedBriefPath) {
        throw new Error(
          `Task ${task.id} brief must resolve to ${expectedBriefPath}, got ${briefPath}`
        );
      }
      if (!isSafeRepoRelativePath(briefPath)) {
        throw new Error(`Task ${task.id} brief path is unsafe: ${briefPath}`);
      }
      const briefContent = readPublicBriefContent(root, commit, briefPath);
      const { title, summary } = parseBriefMarkdown(briefContent);
      if (!title) {
        throw new Error(`Task ${task.id} brief has no Markdown H1 title: ${briefPath}`);
      }
      if (!summary) {
        throw new Error(`Task ${task.id} brief has no summary paragraph: ${briefPath}`);
      }
      return {
        id: task.id,
        kind: task.kind,
        stage: task.stage,
        briefPath,
        title,
        summary,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function parseBriefMarkdown(content) {
  const lines = String(content).replace(/\r\n/g, '\n').split('\n');
  let title = '';

  for (const line of lines) {
    const match = line.match(/^#\s+(.+?)\s*$/);
    if (match) {
      title = match[1].trim();
      break;
    }
  }

  const paragraphLines = [];
  let collecting = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (collecting && paragraphLines.length > 0) break;
      continue;
    }
    if (/^#+\s/.test(trimmed)) continue;
    collecting = true;
    paragraphLines.push(trimmed);
  }

  return {
    title,
    summary: paragraphLines.join(' ').trim(),
  };
}

export function buildControlFacts() {
  return [
    {
      id: 'behavior-only-oracle',
      label: 'Behavior-only scoring',
      description:
        'Final reward derives from behavior_pass_rate against golden sequences. Agents never receive graded expect substrings.',
    },
    {
      id: 'lamina-treatment-gates',
      label: 'Lamina treatment validity gates',
      description:
        'The lamina arm must invoke required slash commands, persona-panel subagents, and UI walkthrough capture or the trial is marked invalid_treatment.',
    },
    {
      id: 'matched-arm-budget',
      label: 'Matched agent budget',
      description: 'Each arm receives 4,200 seconds (70 minutes) of agent time across its workflow steps.',
    },
    {
      id: 'structural-selfcheck',
      label: 'Structural self-check',
      description:
        'Coding steps require a structural self-check that validates action mutability without revealing golden expects.',
    },
    {
      id: 'thin-slice-delivery',
      label: 'Thin-slice delivery posture',
      description:
        'Products ship as in-memory reducers with HTML UI — no external services — while still modeling authority, lifecycle, and actor-scoped projections.',
    },
  ].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildArtifactLinks(manifest, repository, commit) {
  return manifest.artifactRoles
    .map((role) => ({
      id: role.id,
      label: role.label,
      role: role.role,
      path: role.path,
      url: githubBlobUrl(repository, commit, role.path),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sortById(items) {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

export function assertUniqueIds(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate ${label} id: ${item.id}`);
    }
    seen.add(item.id);
  }
}

export function hasForbiddenResultShape(release) {
  for (const key of FORBIDDEN_RESULT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(release, key)) return key;
  }
  return null;
}

export function isCommitPin(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

export function isProtocolHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function urlUsesCommit(url, commit) {
  if (typeof url !== 'string') return false;
  if (/\/(main|master)(\/|$)/.test(url)) return false;
  return url.includes(`/blob/${commit}/`) || url.includes(`/tree/${commit}/`);
}

export function isIsoInstant(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === normalizeIsoInstant(value);
}

function normalizeIsoInstant(value) {
  return new Date(value).toISOString();
}

export function isTrustedRepository(url) {
  return typeof url === 'string' && url.replace(/\/$/, '') === TRUSTED_REPOSITORY;
}

export function isTrustedArtifactUrl(url, repository, commit, repoPath) {
  return isCanonicalArtifactUrl(url, repository, commit, repoPath);
}

export function assertExactIdSet(actualIds, expectedIds, label) {
  const actual = [...actualIds].sort();
  const expected = [...expectedIds].sort();
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    throw new Error(
      `${label} mismatch: expected [${expected.join(', ')}], got [${actual.join(', ')}]`
    );
  }
}

export function resolveGitDir(root) {
  for (const gitDir of ['.git', '.git.__ase_bak']) {
    const candidate = path.join(root, gitDir);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function hasGitMetadata(root) {
  return resolveGitDir(root) !== null;
}

export function gitShowFile(root, commit, repoPath) {
  const gitDir = resolveGitDir(root);
  if (!gitDir) return null;
  const normalized = normalizeRepoRelativePath(repoPath);
  const result = spawnSync('git', ['show', `${commit}:${normalized}`], {
    cwd: root,
    env: { ...process.env, GIT_DIR: gitDir },
    encoding: 'buffer',
  });
  if (result.status !== 0) return null;
  return result.stdout;
}

export function verifyWorkingTreeMatchesCommit(root, commit, repoPath) {
  const gitBytes = gitShowFile(root, commit, repoPath);
  if (gitBytes === null) return null;
  const absolute = path.join(root, repoPath);
  if (!fs.existsSync(absolute)) return false;
  return Buffer.compare(fs.readFileSync(absolute), gitBytes) === 0;
}

export function collectProtocolFiles(root, protocolPaths) {
  const files = [];
  for (const rel of [...protocolPaths].sort()) {
    const absolute = path.join(root, rel);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Protocol path missing: ${rel}`);
    }
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) {
      collectDirectoryFiles(absolute, rel, files);
    } else {
      files.push(rel);
    }
  }
  return files.sort();
}

export function publicBriefPaths(taskIds) {
  return taskIds.map((taskId) => `benchmarks/corpus/${taskId}/brief.md`).sort();
}

export function readPublicBriefContent(root, commit, briefPath) {
  if (hasGitMetadata(root)) {
    const bytes = gitShowFile(root, commit, briefPath);
    if (!bytes) {
      throw new Error(`Task brief missing at source commit ${commit}: ${briefPath}`);
    }
    return bytes.toString('utf8');
  }
  const absolute = path.join(root, briefPath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Task brief file missing: ${briefPath}`);
  }
  return fs.readFileSync(absolute, 'utf8');
}

export function assertPublicInputsMatchCommit(root, commit, manifest, corpusManifestPath) {
  if (!hasGitMetadata(root)) return;

  const paths = new Set([
    corpusManifestPath,
    ...manifest.protocol.paths,
    ...publicBriefPaths(manifest.expectedTasks),
  ]);

  for (const rel of [...paths].sort()) {
    const absolute = path.join(root, rel);
    if (fs.existsSync(absolute) && fs.lstatSync(absolute).isDirectory()) {
      for (const file of collectProtocolFiles(root, [rel])) {
        const matches = verifyWorkingTreeMatchesCommit(root, commit, file);
        if (matches === false) {
          throw new Error(`Working tree drift from source.commit for ${file}`);
        }
        if (matches === null && gitCatFileExists(root, commit, file) !== true) {
          throw new Error(`Public input missing at source.commit: ${file}`);
        }
      }
      continue;
    }

    const matches = verifyWorkingTreeMatchesCommit(root, commit, rel);
    if (matches === false) {
      throw new Error(`Working tree drift from source.commit for ${rel}`);
    }
    if (matches === null && gitCatFileExists(root, commit, rel) !== true) {
      throw new Error(`Public input missing at source.commit: ${rel}`);
    }
  }
}

export function loadCorpusManifest(root, commit, corpusManifestPath) {
  if (hasGitMetadata(root)) {
    const bytes = gitShowFile(root, commit, corpusManifestPath);
    if (!bytes) {
      throw new Error(`Corpus manifest missing at source commit ${commit}: ${corpusManifestPath}`);
    }
    return JSON.parse(bytes.toString('utf8'));
  }
  return JSON.parse(fs.readFileSync(path.join(root, corpusManifestPath), 'utf8'));
}

export function gitCatFileExists(root, commit, repoPath) {
  const gitDir = resolveGitDir(root);
  if (!gitDir) return null;
  const normalized = normalizeRepoRelativePath(repoPath);
  const result = spawnSync('git', ['cat-file', '-e', `${commit}:${normalized}`], {
    cwd: root,
    env: { ...process.env, GIT_DIR: gitDir },
    encoding: 'utf8',
  });
  return result.status === 0;
}

export function foreignStateFields(release) {
  const foreign = [];
  for (const [status, fields] of Object.entries(STATE_FIELDS)) {
    if (status === release.status) continue;
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(release, field)) {
        foreign.push(`${field} (${status})`);
      }
    }
  }
  return foreign;
}
