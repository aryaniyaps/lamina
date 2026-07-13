/**
 * Install Lamina skills into a benchmark workspace (treatment arm).
 * Always copies from repo skills/ so treatment runs use the latest skill tree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { copyTree } from '../../evals/scripts/vendor-fixture-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILLS_SRC = path.join(ROOT, 'skills');

export function installLaminaSkills(workspace, agent) {
  if (!fs.existsSync(SKILLS_SRC)) {
    throw new Error(`Lamina skills source missing: ${SKILLS_SRC}`);
  }

  const agentDirs = {
    'claude-code': '.claude/skills',
    codex: '.codex/skills',
    opencode: '.opencode/skills',
  };
  const rel = agentDirs[agent] || '.claude/skills';
  const dest = path.join(workspace, rel);
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(SKILLS_SRC, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(SKILLS_SRC, entry.name);
    const target = path.join(dest, entry.name);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    copyTree(src, target);
  }

  // Benchmark treatment: allow Skill-tool invocation for command skills.
  // Production skills keep disable-model-invocation; bench copies are patched in-workspace only.
  for (const skillId of ['lamina-init', 'lamina-design', 'lamina-verify']) {
    const skillMd = path.join(dest, skillId, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    const text = fs.readFileSync(skillMd, 'utf8');
    const patched = text.replace(/^disable-model-invocation:\s*true\s*\n/m, '');
    if (patched !== text) fs.writeFileSync(skillMd, patched);
  }
}
