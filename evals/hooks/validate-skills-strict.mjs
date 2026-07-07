#!/usr/bin/env node
/**
 * agentskills.io strict SKILL.md validation without LLM/API calls.
 * Uses agent-skills-eval loadSkill({ strict: true }).
 */
import { discoverSkills, loadSkill } from 'agent-skills-eval';

const ROOT = new URL('../../skills', import.meta.url).pathname;
const errors = [];

const skills = discoverSkills(ROOT);

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

console.log(`OK — ${skills.length} skills passed agentskills.io strict validation`);
