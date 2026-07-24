import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CURSOR_CLI_SHA256,
  CURSOR_CLI_VERSION,
  HARBOR_VERSION,
  LAMINA_BENCH_SKILLS,
  PINNED_SKILL_COMMIT,
  SKILL_RERUN_CAMPAIGN_ID,
} from './constants.mjs';
import { buildExpectedHarborSkillDigests } from './skill-lock.mjs';

export const SKILL_BUNDLE_REL = 'benchmarks/lb6/pilot/skill-bundle';
export const STAGED_SKILLS_DIR = 'staged';

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function sha256Canonical(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

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

function resolveGitRoot(startRoot) {
  let current = path.resolve(startRoot);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      const probe = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: current, encoding: 'utf8' });
      if (probe.status === 0) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveHarnessGitCommit(root) {
  const gitRoot = resolveGitRoot(root);
  if (!gitRoot) return null;
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: gitRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`failed to resolve harness git HEAD: ${result.stderr}`);
  }
  return result.stdout.trim();
}

export function resolveHarnessGitProvenance(root) {
  const gitRoot = resolveGitRoot(root);
  if (!gitRoot) {
    return {
      harness_git_commit: null,
      harness_git_clean: null,
      unavailable: true,
    };
  }
  const harnessGitCommit = resolveHarnessGitCommit(root);
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: gitRoot, encoding: 'utf8' });
  if (status.status !== 0) {
    throw new Error(`failed to inspect harness git status: ${status.stderr}`);
  }
  return {
    harness_git_commit: harnessGitCommit,
    harness_git_clean: !status.stdout.trim(),
    unavailable: false,
  };
}

function assertPinnedCommitExists(root, pinnedCommit) {
  const result = spawnSync('git', ['cat-file', '-e', `${pinnedCommit}^{commit}`], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`pinned skill source commit not found in repo: ${pinnedCommit}`);
  }
}

function extractSkillArchive(root, pinnedCommit, skillName, destDir) {
  const archivePath = `skills/${skillName}`;
  const result = spawnSync(
    'git',
    ['archive', '--format=tar', pinnedCommit, archivePath],
    { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0 || !result.stdout?.length) {
    throw new Error(`failed to archive skill ${skillName} at ${pinnedCommit}: ${result.stderr?.toString() || 'empty archive'}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  const tmpTar = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lb6-skill-tar-')), `${skillName}.tar`);
  fs.writeFileSync(tmpTar, result.stdout);
  const extract = spawnSync('tar', ['-xf', tmpTar, '-C', destDir, '--strip-components=2'], {
    encoding: 'utf8',
  });
  fs.rmSync(path.dirname(tmpTar), { recursive: true, force: true });
  if (extract.status !== 0) {
    throw new Error(`failed to extract archived skill ${skillName}: ${extract.stderr}`);
  }
  if (!fs.existsSync(path.join(destDir, 'SKILL.md'))) {
    throw new Error(`archived skill missing SKILL.md: ${skillName}`);
  }
}

function copySkillTree(sourceDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const src = path.join(sourceDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`refusing to stage symlink in skill bundle: ${src}`);
    }
    if (entry.isDirectory()) {
      copySkillTree(src, dest);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`refusing to stage non-regular file in skill bundle: ${src}`);
    }
    fs.copyFileSync(src, dest);
  }
}

export function skillBundlePaths(root) {
  const bundleRoot = path.join(root, SKILL_BUNDLE_REL);
  return {
    bundleRoot,
    stagedRoot: path.join(bundleRoot, STAGED_SKILLS_DIR),
    manifestPath: path.join(bundleRoot, 'manifest-v3.json'),
  };
}

export function buildSkillInventory(stagedRoot, skillNames = LAMINA_BENCH_SKILLS) {
  const files = [];
  for (const skillName of [...skillNames].sort()) {
    const skillRoot = path.join(stagedRoot, skillName);
    if (!fs.existsSync(path.join(skillRoot, 'SKILL.md'))) {
      throw new Error(`staged skill missing SKILL.md: ${skillName}`);
    }
    for (const rel of listFilesRecursive(skillRoot, skillRoot)) {
      const abs = path.join(skillRoot, rel);
      const stat = fs.lstatSync(abs);
      if (stat.isSymbolicLink()) {
        throw new Error(`refusing symlink in staged skill ${skillName}: ${rel}`);
      }
      files.push({
        skill: skillName,
        path: `${skillName}/${rel}`,
        sha256: sha256File(abs),
        size: stat.size,
      });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const aggregateDigest = sha256Canonical(files);
  return { files, aggregateDigest, skillCount: skillNames.length };
}

export function stageSkillBundle(root, {
  skillNames = LAMINA_BENCH_SKILLS,
  sourceSkillCommit = PINNED_SKILL_COMMIT,
  pinnedCommit = sourceSkillCommit,
  write = true,
  skipArchive = false,
} = {}) {
  assertPinnedCommitExists(root, pinnedCommit);
  const harness = resolveHarnessGitProvenance(root);
  const { bundleRoot, stagedRoot, manifestPath } = skillBundlePaths(root);

  if (write && !skipArchive) {
    fs.rmSync(stagedRoot, { recursive: true, force: true });
    fs.mkdirSync(bundleRoot, { recursive: true });
    fs.mkdirSync(stagedRoot, { recursive: true });
    for (const skillName of skillNames) {
      extractSkillArchive(root, pinnedCommit, skillName, path.join(stagedRoot, skillName));
    }
  } else if (write && skipArchive) {
    fs.mkdirSync(stagedRoot, { recursive: true });
  } else {
    for (const skillName of skillNames) {
      const skillRoot = path.join(stagedRoot, skillName);
      if (!fs.existsSync(path.join(skillRoot, 'SKILL.md'))) {
        throw new Error(`required staged skill missing: ${skillName}`);
      }
    }
  }

  const inventory = buildSkillInventory(stagedRoot, skillNames);
  const harborSkillDigests = buildExpectedHarborSkillDigests(stagedRoot, skillNames);
  const manifest = {
    kind: 'lb6-pilot-skill-bundle',
    campaign_id: SKILL_RERUN_CAMPAIGN_ID,
    source_skill_commit: pinnedCommit,
    pinned_commit: pinnedCommit,
    harness_git_commit: harness.harness_git_commit,
    harbor_version: HARBOR_VERSION,
    cursor_cli_version: CURSOR_CLI_VERSION,
    cursor_cli_sha256: CURSOR_CLI_SHA256,
    skills: [...skillNames].sort(),
    file_count: inventory.files.length,
    aggregate_digest: inventory.aggregateDigest,
    harbor_skill_digests: harborSkillDigests,
    files: inventory.files,
  };

  if (write) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return { manifest, manifestPath, stagedRoot, inventory, harness };
}

export function loadSkillBundleManifest(root) {
  const { manifestPath, stagedRoot } = skillBundlePaths(root);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`missing skill bundle manifest: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { manifest, manifestPath, stagedRoot };
}

export function resolveStagedSkillPaths(root, manifest = null) {
  const loaded = manifest ? { manifest, stagedRoot: skillBundlePaths(root).stagedRoot } : loadSkillBundleManifest(root);
  return loaded.manifest.skills.map((skillName) => path.join(loaded.stagedRoot, skillName));
}

export function verifyStagedSkillBundle(root, expectedManifest = null) {
  const { manifest, stagedRoot } = expectedManifest
    ? { manifest: expectedManifest, stagedRoot: skillBundlePaths(root).stagedRoot }
    : loadSkillBundleManifest(root);
  const inventory = buildSkillInventory(stagedRoot, manifest.skills);
  if (inventory.aggregateDigest !== manifest.aggregate_digest) {
    return {
      ok: false,
      reason: 'aggregate digest mismatch',
      expected: manifest.aggregate_digest,
      actual: inventory.aggregateDigest,
    };
  }
  const expectedByPath = new Map(manifest.files.map((entry) => [entry.path, entry.sha256]));
  for (const entry of inventory.files) {
    const expected = expectedByPath.get(entry.path);
    if (!expected) {
      return { ok: false, reason: `unexpected staged skill file: ${entry.path}` };
    }
    if (expected !== entry.sha256) {
      return {
        ok: false,
        reason: `digest mismatch for ${entry.path}`,
        expected,
        actual: entry.sha256,
      };
    }
  }
  if (expectedByPath.size !== inventory.files.length) {
    return { ok: false, reason: 'staged skill bundle missing required files' };
  }

  const expectedHarborDigests = manifest.harbor_skill_digests
    ?? buildExpectedHarborSkillDigests(stagedRoot, manifest.skills);
  for (const skillName of manifest.skills) {
    const expected = expectedHarborDigests[skillName];
    const actual = buildExpectedHarborSkillDigests(stagedRoot, [skillName])[skillName];
    if (expected !== actual) {
      return {
        ok: false,
        reason: `harbor skill digest mismatch for ${skillName}`,
        expected,
        actual,
      };
    }
  }

  return { ok: true, manifest, inventory };
}

/** Stage from working-tree skills/ only when bytes match the pinned source commit. */
export function stageSkillBundleFromWorkingTree(root, options = {}) {
  const sourceSkillCommit = options.sourceSkillCommit ?? PINNED_SKILL_COMMIT;
  assertPinnedCommitExists(root, sourceSkillCommit);
  const repoSkillsRoot = path.join(root, 'skills');
  for (const skillName of options.skillNames ?? LAMINA_BENCH_SKILLS) {
    for (const rel of listFilesRecursive(path.join(repoSkillsRoot, skillName), path.join(repoSkillsRoot, skillName))) {
      const workPath = path.join(repoSkillsRoot, skillName, rel);
      const workDigest = sha256File(workPath);
      const show = spawnSync(
        'git',
        ['show', `${sourceSkillCommit}:skills/${skillName}/${rel}`],
        { cwd: root, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
      );
      if (show.status !== 0) {
        throw new Error(`working-tree skill file missing at ${sourceSkillCommit}: ${skillName}/${rel}`);
      }
      const pinnedDigest = createHash('sha256').update(show.stdout).digest('hex');
      if (pinnedDigest !== workDigest) {
        throw new Error(`working-tree skill bytes differ from ${sourceSkillCommit}: ${skillName}/${rel}`);
      }
    }
  }

  const { bundleRoot, stagedRoot, manifestPath } = skillBundlePaths(root);
  if (options.write !== false) {
    fs.rmSync(bundleRoot, { recursive: true, force: true });
    fs.mkdirSync(stagedRoot, { recursive: true });
    for (const skillName of options.skillNames ?? LAMINA_BENCH_SKILLS) {
      copySkillTree(path.join(repoSkillsRoot, skillName), path.join(stagedRoot, skillName));
    }
  }
  return stageSkillBundle(root, {
    ...options,
    pinnedCommit: sourceSkillCommit,
    write: options.write !== false,
    skipArchive: true,
  });
}
