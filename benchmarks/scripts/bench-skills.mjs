/**
 * Install Lamina skills into a benchmark workspace (treatment arm).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { copyTree } from '../../evals/scripts/vendor-fixture-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILLS_SRC = path.join(ROOT, 'skills');
const SKILLS_CACHE = path.join(ROOT, 'benchmarks/tmp/skills-cache');

function ensureSkillsCache() {
  if (fs.existsSync(SKILLS_CACHE)) return;
  fs.mkdirSync(SKILLS_CACHE, { recursive: true });
  for (const entry of fs.readdirSync(SKILLS_SRC, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    copyTree(path.join(SKILLS_SRC, entry.name), path.join(SKILLS_CACHE, entry.name));
  }
}

export function installLaminaSkills(workspace, agent) {
  ensureSkillsCache();
  const agentDirs = {
    'claude-code': '.claude/skills',
    codex: '.codex/skills',
    opencode: '.opencode/skills',
  };
  const rel = agentDirs[agent] || '.claude/skills';
  const dest = path.join(workspace, rel);
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(SKILLS_CACHE, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(SKILLS_CACHE, entry.name);
    const target = path.join(dest, entry.name);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    copyTree(src, target);
  }
}
