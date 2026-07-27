#!/usr/bin/env node
/**
 * install-all-skills.sh installs one public skill with the full module bundle.
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
const INTERNAL_EXPECTED = fs.readdirSync(path.join(SKILLS_SRC, 'lamina/skills')).filter((name) =>
  fs.existsSync(path.join(SKILLS_SRC, 'lamina/skills', name, 'SKILL.md')),
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
if (EXPECTED !== 1 || names[0] !== 'lamina') {
  console.error(`expected the only public skill to be lamina; got ${names.join(', ')}`);
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

const installedModules = fs.readdirSync(path.join(codexSkills, 'lamina/skills')).filter((name) =>
  fs.existsSync(path.join(codexSkills, 'lamina/skills', name, 'SKILL.md')),
);
if (INTERNAL_EXPECTED !== 58 || installedModules.length !== INTERNAL_EXPECTED) {
  console.error(`expected all 58 contained modules, got ${installedModules.length}`);
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

if (fs.existsSync(path.join(codexSkills, 'lamina/skills/lamina-orchestrator/lib')) ||
    fs.existsSync(path.join(codexSkills, 'lamina/skills/lamina-orchestrator/bin'))) {
  console.error('skill install must not contain executable graph runtime code');
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

const cli = path.join(workspace, '.lamina/runtime-cli/node_modules/.bin/lamina');
if (!fs.existsSync(cli)) {
  console.error('independently packed CLI missing from workspace install');
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

const ladybug = path.join(workspace, '.lamina/runtime-cli/node_modules/@ladybugdb/core');
if (!fs.existsSync(ladybug)) {
  console.error('pinned Ladybug runtime dependency missing from workspace install');
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

try {
  const paths = runtimePaths(workspace);
  const pid = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'))?.pid;
  if (Number.isInteger(pid) && pid > 1) await stopIncompatibleServer(paths, pid);
} catch {}
fs.rmSync(workspace, { recursive: true, force: true });
console.log(`eval_install_all_skills_test: ok (${EXPECTED} public skill, ${INTERNAL_EXPECTED} modules)`);
