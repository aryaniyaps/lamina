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
const SKILLS = 'skills';

const errors = [];

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function modulePath(name, suffix = 'SKILL.md') {
  return `${SKILLS}/${name}/${suffix}`;
}

function checkAuditProfiles() {
  const yaml = read(modulePath('lamina-orchestrator', 'audit-profiles.yaml'));
  const skills = [...yaml.matchAll(/^\s+-\s+(lamina-[a-z-]+)\s*$/gm)].map((m) => m[1]);
  for (const skill of skills) {
    if (!exists(modulePath(skill))) {
      errors.push(`audit-profiles references missing public skill: ${modulePath(skill)}`);
    }
  }
}

function checkProblemRouterLinks() {
  const core = read(modulePath('lamina-core'));
  const links = [...core.matchAll(/\]\(\.\.\/(lamina-[a-z-]+)\/SKILL\.md\)/g)].map((m) => m[1]);
  for (const skill of links) {
    if (!exists(modulePath(skill))) {
      errors.push(`Problem Router link missing: ${modulePath(skill)}`);
    }
  }
}

function checkCommandSkills() {
  const rootSkill = read('skills/lamina/SKILL.md');
  for (const signal of ['/lamina-init', '/lamina-design', '/lamina-verify',
    'lamina work prepare', 'lamina work check', 'lamina work verify']) {
    if (!rootSkill.includes(signal)) errors.push(`public Lamina skill missing route: ${signal}`);
  }
  if (!/Never recommend/i.test(rootSkill)) {
    errors.push('public Lamina skill must prohibit explicit phase recommendations in normal flow');
  }
  for (const name of ['lamina-init', 'lamina-design', 'lamina-verify']) {
    const skillPath = modulePath(name);
    if (!exists(skillPath)) {
      errors.push(`Missing public command skill: ${skillPath}`);
      continue;
    }
    const skill = read(skillPath);
    if (name === 'lamina-init' && !skill.includes(`Use only when explicitly invoked as ${name}`)) {
      errors.push(`Init skill must declare explicit invocation: ${skillPath}`);
    }
    if (name !== 'lamina-init' &&
        (!skill.includes('when explicitly invoked') || !/passive|ordinary implementation/.test(skill))) {
      errors.push(`Phase skill must support passive use and explicit override: ${skillPath}`);
    }
    if (!/never edit|does not edit|do not edit/i.test(skill) || !/application source|product source/i.test(skill)) {
      errors.push(`Command skill missing source-edit refusal: ${skillPath}`);
    }
  }
}

function checkProductGraphTooling() {
  for (const rel of [
    'skills/lamina-orchestrator/prerequisites/cli-required.md',
    'skills/lamina-orchestrator/references/personas.schema.json',
    'skills/lamina-orchestrator/references/product-graph.md',
  ]) if (!exists(rel)) errors.push(`Missing transactional graph resource: ${rel}`);
}

function checkOutputContracts() {
  const contracts = {
    'skills/lamina-orchestrator/prompts/outputs/design.md': [
      'GraphVersion',
      'Source revision',
      'Contradictions',
      'Validation',
    ],
    'skills/lamina-orchestrator/prompts/outputs/verify.md': [
      'GraphVersion',
      'Source revision',
      'Runs',
      'Evidence',
      'Verdict',
    ],
    'skills/lamina-orchestrator/prompts/outputs/init-blocked.md': [
      'Status',
      "What's missing",
      'Next step',
      'Do not',
    ],
    'skills/lamina-orchestrator/prompts/outputs/clarify.md': [
      'Status',
      'Clarifying questions',
      'Why these block the artifact',
      'How to proceed',
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

function checkPromptManifest() {
  const manifest = read('skills/lamina-orchestrator/prompts/manifest.yaml');
  for (const id of ['outputs/clarify', 'outputs/design', 'outputs/implement', 'outputs/verify', 'outputs/fix', 'subagents/persona-panel-spawn']) {
    if (!manifest.includes(`${id}:`)) {
      errors.push(`Prompt manifest missing ${id}`);
    }
  }
}

function checkArtifactSubagents() {
  for (const rel of [
    'skills/lamina-orchestrator/patterns/persona-panel.md',
    'skills/lamina-orchestrator/prompts/subagents/persona-panel-spawn.md',
  ]) {
    if (!exists(rel)) errors.push(`Missing artifact subagent file: ${rel}`);
    else if (rel.includes('/agents/') && !read(rel).includes('readonly: true')) errors.push(`Artifact subagent must be readonly: ${rel}`);
  }
}

function checkMetadataAlignment() {
  const skillsDir = path.join(ROOT, SKILLS);
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
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
checkProductGraphTooling();
checkProblemRouterLinks();
checkCommandSkills();
checkOutputContracts();
checkPromptManifest();
checkArtifactSubagents();
checkMetadataAlignment();

if (errors.length) {
  console.error('Lamina plugin validation FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('OK — Lamina plugin validation passed');
process.exit(0);
