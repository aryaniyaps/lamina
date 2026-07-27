#!/usr/bin/env node
/**
 * agentskills.io strict SKILL.md validation without LLM/API calls.
 * Uses agent-skills-eval loadSkill({ strict: true }).
 */
import fs from 'node:fs';
import path from 'node:path';
import { discoverSkills, loadSkill } from 'agent-skills-eval';

const ROOT = new URL('../../skills', import.meta.url).pathname;
const errors = [];

const publicSkills = discoverSkills(ROOT);
const modulesRoot = path.join(ROOT, 'lamina', 'skills');
const internalSkills = fs.readdirSync(modulesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(modulesRoot, entry.name, 'SKILL.md')))
  .map((entry) => ({ dir: path.join(modulesRoot, entry.name), relPath: `lamina/skills/${entry.name}` }));
const skills = [...publicSkills, ...internalSkills];

for (const ref of skills) {
  try {
    loadSkill(ref.dir, { strict: true });
  } catch (err) {
    errors.push(`${ref.relPath}: ${err.message}`);
  }
}

if (errors.length) {
  console.error('agent-skills-eval strict validation FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`OK — ${publicSkills.length} public skill and ${internalSkills.length} contained modules passed strict validation`);
