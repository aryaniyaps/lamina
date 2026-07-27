#!/usr/bin/env node
/**
 * install-all-skills.sh copies the full skills/ tree into agent workspace dirs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runtimePaths } from '../skills/lamina-orchestrator/lib/graph-runtime/util.mjs';

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

if (!fs.existsSync(path.join(codexSkills, 'lamina-orchestrator/lib/graph-runtime/engine.mjs'))) {
  console.error('transactional graph engine missing from workspace install');
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

if (!fs.existsSync(path.join(codexSkills, 'lamina-orchestrator/lib/graph-runtime/server.mjs'))) {
  console.error('graphd server missing from workspace install');
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

if (!fs.existsSync(path.join(codexSkills, 'lamina-orchestrator/bin/lamina.mjs'))) {
  console.error('lamina CLI missing from workspace install');
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

const ladybug = path.join(workspace, 'node_modules/@ladybugdb/core');
if (!fs.existsSync(ladybug)) {
  console.error('pinned Ladybug runtime dependency missing from workspace install');
  fs.rmSync(workspace, { recursive: true, force: true });
  process.exit(1);
}

try {
  const paths = runtimePaths(workspace);
  const pid = Number(fs.readFileSync(paths.lock, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 1) process.kill(pid, 'SIGTERM');
} catch {}
fs.rmSync(workspace, { recursive: true, force: true });
console.log(`eval_install_all_skills_test: ok (${EXPECTED} skills)`);
