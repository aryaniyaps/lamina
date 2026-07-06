#!/usr/bin/env node
/**
 * Minimal Lamina bundle structure checks.
 * Usage: node scripts/verify_lamina_bundle.mjs [--check structure|all]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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
    const skillPath = `skills/${skill}/SKILL.md`;
    if (!exists(skillPath)) {
      errors.push(`audit-profiles references missing skill: ${skillPath}`);
    }
  }
}

function checkProblemRouterLinks() {
  const core = read('skills/lamina-core/SKILL.md');
  const links = [...core.matchAll(/\]\(\.\.\/(lamina-[a-z-]+)\/SKILL\.md\)/g)].map((m) => m[1]);
  for (const skill of links) {
    const skillPath = `skills/${skill}/SKILL.md`;
    if (!exists(skillPath)) {
      errors.push(`Problem Router link missing: ${skillPath}`);
    }
  }
}

function extractMarkdownLinks(content, baseDir) {
  const links = [];
  for (const m of content.matchAll(/\]\(([^)]+)\)/g)) {
    let target = m[1];
    if (target.startsWith('http') || target.startsWith('#')) continue;
    target = target.split('#')[0];
    if (!target) continue;
    const resolved = path.normalize(path.join(baseDir, target));
    if (!resolved.startsWith(ROOT)) continue;
    links.push(path.relative(ROOT, resolved));
  }
  return links;
}

function checkReferencedFiles() {
  const dirs = ['agents', 'prompts', 'skills/lamina-orchestrator', 'commands'];
  for (const dir of dirs) {
    const absDir = path.join(ROOT, dir);
    if (!fs.existsSync(absDir)) continue;
    for (const file of walk(absDir)) {
      if (!file.endsWith('.md') && !file.endsWith('.yaml')) continue;
      const rel = path.relative(ROOT, file);
      const content = read(rel);
      for (const link of extractMarkdownLinks(content, path.dirname(file))) {
        if (!exists(link)) {
          errors.push(`Broken link in ${rel}: ${link}`);
        }
      }
    }
  }
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function checkOutputContracts() {
  const contracts = {
    'prompts/outputs/ideate.md': [
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
    'prompts/outputs/feature.md': [
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
    'prompts/outputs/optimize.md': [
      'Executive summary',
      'Findings by flow',
      'Prioritized improvements',
      'Quick wins',
      'Strategic bets',
      'Persona simulation notes',
      'Open questions',
    ],
    'prompts/outputs/init.md': [
      'Mode',
      'Business context summary',
      'Open questions',
      'Artifacts',
      'Stale downstream artifacts',
      'Recommended next step',
      'Skills applied',
    ],
  };

  for (const [file, headings] of Object.entries(contracts)) {
    const content = read(file);
    for (const heading of headings) {
      if (!content.includes(`### ${heading}`) && !content.includes(heading)) {
        errors.push(`Output contract ${file} missing heading: ${heading}`);
      }
    }
  }
}

function checkRequiredPaths() {
  const required = [
    'skills/lamina-core/SKILL.md',
    'skills/lamina-business-context/SKILL.md',
    'skills/lamina-orchestrator/SKILL.md',
    'skills/lamina-orchestrator/audit-profiles.yaml',
    'skills/lamina-orchestrator/merge-rules.md',
    'skills/lamina-blueprint/SKILL.md',
    'skills/lamina-orchestrator/workflows/init.md',
    'commands/lamina.md',
    'commands/lamina-init.md',
    'prompts/outputs/init.md',
    'prompts/checkpoints/blueprint-preview.md',
    'packages/lamina-blueprint/package.json',
    'agents/ux-lens-reviewer.md',
    'agents/research-synthesizer.md',
  ];
  for (const rel of required) {
    if (!exists(rel)) errors.push(`Missing required path: ${rel}`);
  }
}

const check = process.argv.includes('--check')
  ? process.argv[process.argv.indexOf('--check') + 1] || 'structure'
  : 'structure';

if (check === 'structure' || check === 'all') {
  checkRequiredPaths();
  checkAuditProfiles();
  checkProblemRouterLinks();
  checkOutputContracts();
  checkReferencedFiles();
}

if (errors.length) {
  console.error('Lamina bundle verification FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('OK');
