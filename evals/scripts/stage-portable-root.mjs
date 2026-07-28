#!/usr/bin/env node
/**
 * Build evals/portable/<skill>/ for agent-skills-eval discovery:
 * - Symlink skill contents from skills/<skill>/ (skip evals/)
 * - Write evals/evals.json from evals/suites/<skill>/evals.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORTABLE = path.join(ROOT, 'evals/portable');
const SUITES = path.join(ROOT, 'evals/suites');
const SKILLS = path.join(ROOT, 'skills');

const SKILL_NAMES = [
  'lamina',
  'lamina-init',
  'lamina-design',
  'lamina-verify',
  'lamina-capabilities',
];

function symlinkOrCopy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  try {
    fs.symlinkSync(src, dest, 'dir');
  } catch {
    fs.cpSync(src, dest, { recursive: true });
  }
}

function linkFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  try {
    fs.symlinkSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
  }
}

function stageSkill(skillName) {
  const suitePath = path.join(SUITES, skillName, 'evals.json');
  const skillSrc = path.join(SKILLS, skillName);
  const skillDest = path.join(PORTABLE, skillName);

  if (!fs.existsSync(suitePath)) {
    throw new Error(`Missing suite: evals/suites/${skillName}/evals.json`);
  }

  if (fs.existsSync(skillDest)) fs.rmSync(skillDest, { recursive: true, force: true });
  fs.mkdirSync(skillDest, { recursive: true });

  const skillMdSrc = path.join(skillSrc, 'SKILL.md');
  if (fs.existsSync(skillMdSrc)) {
    for (const entry of fs.readdirSync(skillSrc, { withFileTypes: true })) {
      if (entry.name === 'evals') continue;
      const src = path.join(skillSrc, entry.name);
      const dest = path.join(skillDest, entry.name);
      if (entry.isDirectory()) symlinkOrCopy(src, dest);
      else linkFile(src, dest);
    }
  } else {
    fs.writeFileSync(
      path.join(skillDest, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: Lamina eval probes for ${skillName}\n---\n`,
    );
  }

  const evalsDir = path.join(skillDest, 'evals');
  fs.mkdirSync(evalsDir, { recursive: true });
  fs.copyFileSync(suitePath, path.join(evalsDir, 'evals.json'));
}

function main() {
  if (fs.existsSync(PORTABLE)) fs.rmSync(PORTABLE, { recursive: true, force: true });
  fs.mkdirSync(PORTABLE, { recursive: true });

  for (const name of SKILL_NAMES) {
    stageSkill(name);
  }

  console.log(`Staged ${SKILL_NAMES.length} skills → evals/portable/`);
}

main();
