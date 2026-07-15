/**
 * Install Lamina skills into a benchmark workspace (treatment arm).
 * Always copies from repo skills/ so treatment runs use the latest skill tree.
 *
 * Command skills (lamina-init / lamina-design / lamina-verify / lamina) keep
 * `disable-model-invocation: true` — harness sends `/lamina-*` slash messages.
 * Those SKILL.md files must explicitly require Reading supporting files; the
 * harness does not inject the Load graph.
 *
 * Supporting skills (lamina-orchestrator, lamina-dependencies, …) stay
 * Skill/Read-loadable so the agent can traverse the graph instead of inventing
 * artifact filenames. See lamina-orchestrator/load-protocol.md.
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

  const agentDirs = { codex: '.agents/skills' };
  const rel = agentDirs[agent] || '.agents/skills';
  const dest = path.join(workspace, rel);
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(SKILLS_SRC, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(SKILLS_SRC, entry.name);
    const target = path.join(dest, entry.name);
    try {
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      copySkillTree(src, target);
    } catch (err) {
      // Bind-mounted evals.json (or similar) can block full skill-dir replace.
      // Overlay source files in place so the trial still gets latest SKILL.md.
      if (err?.code === 'EBUSY' || err?.code === 'EROFS' || err?.errno === -4094 || err?.code === '') {
        overlayTree(src, target);
        continue;
      }
      throw err;
    }
  }
}

/** Like copyTree, but omit skill eval fixtures (unused in bench; often RO-mounted). */
function copySkillTree(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.symlinkSync(fs.readlinkSync(src), dest);
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (name === 'evals' || name === 'node_modules' || name === '.git') continue;
      copySkillTree(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function overlayTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // Bench agents do not need skill eval fixtures; skip to avoid RO bind-mount traps.
    if (entry.name === 'evals') continue;
    const sp = path.join(src, entry.name);
    const dp = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      overlayTree(sp, dp);
      continue;
    }
    try {
      fs.copyFileSync(sp, dp);
    } catch (err) {
      if (err?.code === 'EBUSY' || err?.code === 'EROFS' || err?.errno === -4094 || err?.code === 'EACCES') {
        continue;
      }
      throw err;
    }
  }
}
