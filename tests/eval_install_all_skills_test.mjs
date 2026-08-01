#!/usr/bin/env node
/**
 * install-all-skills.sh installs the complete public Lamina skill set.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  parseDaemonLock,
  runtimePaths,
} from '../packages/cli/lib/graph-runtime/util.mjs';
import { stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_SRC = path.join(ROOT, 'skills');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills.sh.json'), 'utf8'));
const EXPECTED_NAMES = [...new Set(catalog.groupings.flatMap((group) => group.skills))].sort();
const EXPECTED = EXPECTED_NAMES.length;
const migration = JSON.parse(fs.readFileSync(path.join(SKILLS_SRC, 'migration-map.json'), 'utf8'));

function installedNames(skillsRoot) {
  return fs.readdirSync(skillsRoot).filter((name) =>
    fs.existsSync(path.join(skillsRoot, name, 'SKILL.md')),
  ).sort();
}

function assertInstalledTree(workspacePath, relativeRoot, agent) {
  const skillsRoot = path.join(workspacePath, relativeRoot);
  const names = installedNames(skillsRoot);
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_NAMES)) {
    throw new Error(`${agent} ${relativeRoot} expected ${EXPECTED_NAMES.join(', ')}, got ${names.join(', ')}`);
  }
  for (const entry of migration.migrations) {
    const target = path.join(skillsRoot, entry.to, entry.topic);
    if (!fs.existsSync(target)) {
      throw new Error(`${agent} ${relativeRoot} missing migrated topic ${entry.to}/${entry.topic}`);
    }
  }
  const installedRouter = fs.readFileSync(path.join(skillsRoot, 'lamina/SKILL.md'), 'utf8');
  if (!installedRouter.includes('references/migration-map.md') ||
      !fs.existsSync(path.join(skillsRoot, 'lamina/references/migration-map.md'))) {
    throw new Error(`${agent} ${relativeRoot} does not contain the self-contained migration lookup`);
  }
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-eval-skills-'));
const result = spawnSync('bash', [path.join(ROOT, 'evals/hooks/install-all-skills.sh')], {
  cwd: ROOT,
  env: { ...process.env, ASE_WORKSPACE_PATH: workspace, ASE_AGENT: 'codex' },
  encoding: 'utf8',
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

const codexSkills = path.join(workspace, '.codex/skills');
const names = installedNames(codexSkills);

if (names.length !== EXPECTED) {
  console.error(`expected ${EXPECTED} skills, got ${names.length}`);
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}
if (EXPECTED !== 10 || JSON.stringify(names) !== JSON.stringify(EXPECTED_NAMES)) {
  console.error(`expected all 10 public Lamina skills; got ${names.length}: ${names.join(', ')}`);
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}
const sharedSkills = path.join(workspace, '.agents/skills');
const sharedNames = installedNames(sharedSkills);
if (sharedNames.length !== EXPECTED) {
  console.error(`expected all ${EXPECTED} skills in the shared discovery root, got ${sharedNames.length}`);
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}
assertInstalledTree(workspace, '.codex/skills', 'codex');
assertInstalledTree(workspace, '.agents/skills', 'codex');
const auditProfiles = fs.readFileSync(
  path.join(codexSkills, 'lamina/orchestrator/audit-profiles.yaml'),
  'utf8',
);
for (const match of auditProfiles.matchAll(/^\s+(?:-\s+)?skill: (lamina(?:-[a-z-]+)?)\s*\n\s+reference: (skills\/[^\s]+)\s*$/gm)) {
  if (!names.includes(match[1]) || !fs.existsSync(path.join(workspace, '.codex', match[2]))) {
    console.error(`cross-referenced compact topic was not installed for eval: ${match[1]} ${match[2]}`);
    fs.rmSync(workspace, { recursive: true, force: true });
    process.exit(1);
  }
}
if (fs.existsSync(path.join(codexSkills, 'lamina/orchestrator/lib')) ||
    fs.existsSync(path.join(codexSkills, 'lamina/orchestrator/bin'))) {
  console.error('skill install must not contain executable graph runtime code');
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

for (const [agent, roots] of [
  ['claude-code', ['.claude/skills']],
  ['opencode', ['.opencode/skills', '.agents/skills']],
]) {
  const providerWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), `lamina-eval-${agent}-`));
  const providerInstall = spawnSync('bash', [path.join(ROOT, 'evals/hooks/install-all-skills.sh')], {
    cwd: ROOT,
    env: { ...process.env, ASE_WORKSPACE_PATH: providerWorkspace, ASE_AGENT: agent },
    encoding: 'utf8',
  });
  if (providerInstall.status !== 0) {
    console.error(providerInstall.stderr || providerInstall.stdout);
    fs.rmSync(providerWorkspace, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
    process.exit(1);
  }
  try {
    for (const root of roots) assertInstalledTree(providerWorkspace, root, agent);
  } catch (error) {
    console.error(error.message);
    fs.rmSync(providerWorkspace, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
    process.exit(1);
  }
  fs.rmSync(providerWorkspace, { recursive: true, force: true });
}

const cli = path.join(workspace, '.lamina/runtime-cli/bin/lamina');
if (!fs.existsSync(cli)) {
  console.error('independent source CLI missing from workspace eval install');
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

const ladybug = path.join(ROOT, 'packages/cli/node_modules/@ladybugdb/core');
if (!fs.existsSync(ladybug)) {
  console.error('pinned Ladybug runtime dependency missing from source CLI');
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

const liveFixture = path.join(
  ROOT,
  'evals/fixtures/_layers/lamina-brownfield-audit/scripts/lamina-eval-live-ui.mjs',
);
const fixtureCheck = spawnSync(process.execPath, [liveFixture, '--check'], {
  cwd: workspace,
  encoding: 'utf8',
});
if (fixtureCheck.status !== 0 ||
    !fixtureCheck.stdout.includes('http://127.0.0.1:43111')) {
  console.error(fixtureCheck.stderr || 'live UI eval fixture self-check failed');
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

try {
  const paths = runtimePaths(workspace);
  const pid = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'))?.pid;
  if (Number.isInteger(pid) && pid > 1) await stopIncompatibleServer(paths, pid);
} catch {}
fs.rmSync(workspace, { recursive: true, force: true });
console.log(`eval_install_all_skills_test: ok (${EXPECTED} public skills)`);
