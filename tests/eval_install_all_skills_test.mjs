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
const EXPECTED = fs.readdirSync(SKILLS_SRC).filter((name) =>
  fs.existsSync(path.join(SKILLS_SRC, name, 'SKILL.md')),
).length;

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
const names = fs.readdirSync(codexSkills).filter((name) =>
  fs.existsSync(path.join(codexSkills, name, 'SKILL.md')),
);

if (names.length !== EXPECTED) {
  console.error(`expected ${EXPECTED} skills, got ${names.length}`);
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}
if (EXPECTED !== 59 || !names.includes('lamina')) {
  console.error(`expected all 59 public Lamina skills; got ${names.length}: ${names.join(', ')}`);
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}
const sharedSkills = path.join(workspace, '.agents/skills');
const sharedNames = fs.readdirSync(sharedSkills).filter((name) =>
  fs.existsSync(path.join(sharedSkills, name, 'SKILL.md')),
);
if (sharedNames.length !== EXPECTED) {
  console.error(`expected all ${EXPECTED} skills in the shared discovery root, got ${sharedNames.length}`);
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}
const auditProfiles = fs.readFileSync(
  path.join(codexSkills, 'lamina-orchestrator/audit-profiles.yaml'),
  'utf8',
);
for (const match of auditProfiles.matchAll(/^\s+-\s+(lamina-[a-z-]+)\s*$/gm)) {
  if (!names.includes(match[1])) {
    console.error(`cross-referenced skill was not installed for eval: ${match[1]}`);
    fs.rmSync(workspace, { recursive: true, force: true });
    process.exit(1);
  }
}
if (fs.existsSync(path.join(codexSkills, 'lamina-orchestrator/lib')) ||
    fs.existsSync(path.join(codexSkills, 'lamina-orchestrator/bin'))) {
  console.error('skill install must not contain executable graph runtime code');
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
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

try {
  const paths = runtimePaths(workspace);
  const pid = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'))?.pid;
  if (Number.isInteger(pid) && pid > 1) await stopIncompatibleServer(paths, pid);
} catch {}
fs.rmSync(workspace, { recursive: true, force: true });
console.log(`eval_install_all_skills_test: ok (${EXPECTED} public skills)`);
