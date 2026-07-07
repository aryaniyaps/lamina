#!/usr/bin/env node
/**
 * Lamina plugin structural checks for eval pre-flight.
 * Runs before agent-skill-eval suites; does NOT extend verify_lamina_bundle.mjs.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const errors = [];

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function checkAuditProfiles() {
  const yaml = read('skills/lamina-orchestrator/audit-profiles.yaml');
  const skills = [...yaml.matchAll(/^\s+-\s+(lamina-[a-z-]+)\s*$/gm)].map((m) => m[1]);
  for (const skill of skills) {
    if (!exists(`skills/${skill}/SKILL.md`)) {
      errors.push(`audit-profiles references missing skill: skills/${skill}/SKILL.md`);
    }
  }
}

function checkProblemRouterLinks() {
  const core = read('skills/lamina-core/SKILL.md');
  const links = [...core.matchAll(/\]\(\.\.\/(lamina-[a-z-]+)\/SKILL\.md\)/g)].map((m) => m[1]);
  for (const skill of links) {
    if (!exists(`skills/${skill}/SKILL.md`)) {
      errors.push(`Problem Router link missing: skills/${skill}/SKILL.md`);
    }
  }
}

function checkCommandSkills() {
  const commandNames = ['lamina', 'lamina-init', 'lamina-design', 'lamina-audit'];
  for (const name of commandNames) {
    const skillPath = `skills/${name}/SKILL.md`;
    if (!exists(skillPath)) {
      errors.push(`Missing command skill: ${skillPath}`);
      continue;
    }
    const skill = read(skillPath);
    if (!skill.includes('disable-model-invocation: true')) {
      errors.push(`Command skill missing disable-model-invocation: ${skillPath}`);
    }
  }
}

function checkCommandsSync() {
  const commandNames = ['lamina', 'lamina-init', 'lamina-design', 'lamina-audit'];
  for (const name of commandNames) {
    const commandPath = `commands/${name}.md`;
    const skillPath = `skills/${name}/SKILL.md`;
    if (!exists(commandPath)) {
      errors.push(`Missing command source: ${commandPath}`);
    }
    if (!exists(skillPath)) {
      errors.push(`Missing synced skill: ${skillPath} — run npm run sync:commands`);
    }
  }
}

function checkOutputContracts() {
  const contracts = {
    'skills/lamina-orchestrator/prompts/outputs/design-concept.md': [
      'User model',
      'Journey',
      'Information architecture',
      'Flows',
      'Screens',
      'Interactions',
      'Copy guidance',
      'Accessibility considerations',
      'Validation plan',
      'Persona simulation notes',
      'Open questions',
    ],
    'skills/lamina-orchestrator/prompts/outputs/design-feature.md': [
      'Problem definition',
      'Jobs to be done',
      'Assumptions',
      'User goals',
      'Flows',
      'Edge cases',
      'Risks',
      'Accessibility review',
      'Success metrics',
      'Implementation checklist',
      'Persona simulation notes',
      'Open questions',
    ],
    'skills/lamina-orchestrator/prompts/outputs/audit.md': [
      'Executive summary',
      'Findings by flow',
      'Prioritized improvements',
      'Quick wins',
      'Strategic bets',
      'Persona simulation notes',
      'Open questions',
    ],
    'skills/lamina-orchestrator/prompts/outputs/init-blocked.md': [
      'Status',
      "What's missing",
      'Next step',
      'Do not',
    ],
  };

  for (const [file, headings] of Object.entries(contracts)) {
    const content = read(file);
    for (const heading of headings) {
      if (!content.includes(heading)) {
        errors.push(`Output contract ${file} missing heading: ${heading}`);
      }
    }
  }
}

function checkMetadataAlignment() {
  const skillsDir = path.join(ROOT, 'skills');
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('lamina-')) continue;
    const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const content = fs.readFileSync(skillPath, 'utf8');
    if (!content.includes('metadata:') || !content.includes('lamina:')) continue;
    const idMatch = content.match(/^\s+id:\s*([a-z-]+)\s*$/m);
    if (!idMatch) continue;
    const expectedFolder = `lamina-${idMatch[1]}`;
    if (entry.name !== expectedFolder) {
      errors.push(`metadata.lamina.id mismatch: folder ${entry.name} has id ${idMatch[1]}`);
    }
  }
}

checkAuditProfiles();
checkProblemRouterLinks();
checkCommandSkills();
checkCommandsSync();
checkOutputContracts();
checkMetadataAlignment();

if (errors.length) {
  console.error('Lamina plugin validation FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('OK — Lamina plugin validation passed');
process.exit(0);
