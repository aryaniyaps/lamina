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
  const commandNames = ['lamina', 'lamina-init', 'lamina-design', 'lamina-verify'];
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
    if (!skill.includes('Writes: `.lamina/` only') || !skill.includes('Repo: read-only')) {
      errors.push(`Command skill missing write boundary guardrail: ${skillPath}`);
    }
    if (!/Do not create, edit, delete, format, or refactor/.test(skill)) {
      errors.push(`Command skill missing explicit source-edit refusal: ${skillPath}`);
    }
  }
}

function checkProductGraphTooling() {
  for (const rel of [
    'skills/lamina-orchestrator/lib/run.mjs',
    'skills/lamina-orchestrator/lib/graph.mjs',
    'skills/lamina-orchestrator/lib/graph-tool.mjs',
    'skills/lamina-orchestrator/references/run.schema.json',
    'skills/lamina-orchestrator/references/personas.schema.json',
    'skills/lamina-orchestrator/references/product-graph.md',
  ]) if (!exists(rel)) errors.push(`Missing Contract v2 resource: ${rel}`);
  if (exists('skills/lamina-orchestrator/references/run.schema.json')) {
    const schema = JSON.parse(read('skills/lamina-orchestrator/references/run.schema.json'));
    if (schema?.properties?.contract_version?.const !== '2.0') errors.push('run.schema.json must require Contract v2');
  }
}

function checkOutputContracts() {
  const contracts = {
    'skills/lamina-orchestrator/prompts/outputs/design.md': [
      'Product stage',
      'Graph validation',
      'run.json',
      'implement.md',
    ],
    'skills/lamina-orchestrator/prompts/outputs/verify.md': [
      'critical product findings',
      'contract drift',
      'report.md',
      'fix.md',
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
  const skillsDir = path.join(ROOT, 'skills');
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('lamina-')) continue;
    const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const content = fs.readFileSync(skillPath, 'utf8');
    if (!content.includes('metadata:') || !content.includes('lamina:')) continue;
    const idMatch = content.match(/^\s+id:\s*([a-z-]+)\s*$/m);
    if (!idMatch) continue;
    if (entry.name === 'lamina-studio' && idMatch[1] === 'blueprint') continue;
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
