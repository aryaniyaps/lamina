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
  const dirs = ['agents', 'skills/lamina-orchestrator', 'skills/lamina', 'skills/lamina-init'];
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
    'skills/lamina-orchestrator/prompts/outputs/design.md': [
      'Domain and invariants',
      'Actors and permissions',
      'Workflows',
      'Scenarios',
      'UX surfaces',
      'Implement brief',
      'Open questions',
      'Next step',
    ],
    'skills/lamina-orchestrator/prompts/outputs/verify.md': [
      'Executive summary',
      'Contract checked',
      'Actor walk results',
      'Findings',
      'Open questions',
    ],
    'skills/lamina-orchestrator/prompts/outputs/init.md': [
      'Mode',
      'Business context summary',
      'Open questions',
      'Artifacts',
      'Stale downstream artifacts',
      'Recommended next step',
      'Skills applied',
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
      if (!content.includes(`### ${heading}`) && !content.includes(heading)) {
        errors.push(`Output contract ${file} missing heading: ${heading}`);
      }
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
    if (!skill.includes(`name: ${name}`)) {
      errors.push(`Command skill name mismatch: ${skillPath}`);
    }
  }
}
function checkInitPrerequisiteLinks() {
  const gatedCommands = ['lamina-design', 'lamina-verify'];
  for (const name of gatedCommands) {
    const skillPath = `skills/${name}/SKILL.md`;
    const skill = read(skillPath);
    if (!skill.includes('init-required.md')) {
      errors.push(`Command skill missing init-required reference: ${skillPath}`);
    }
    if (!skill.includes('init-blocked.md')) {
      errors.push(`Command skill missing init-blocked reference: ${skillPath}`);
    }
  }

  const routerSkill = read('skills/lamina/SKILL.md');
  if (!routerSkill.includes('init-required.md')) {
    errors.push('Router command skill missing init-required reference: skills/lamina/SKILL.md');
  }
}

function checkAgentSkillPollution() {
  const forbidden = [
    '.agents',
    '.windsurf',
    '.claude',
    '.roo',
    '.pi',
    '.goose',
    '.cursor/skills',
    'skills-lock.json',
  ];
  for (const rel of forbidden) {
    if (exists(rel)) {
      errors.push(
        `skills CLI pollution at repo root: ${rel} — run evals/scripts/clean-root-pollution.sh and use evals/harness-sandbox for eval installs`
      );
    }
  }
}

function checkRequiredPaths() {
  const required = [
    '.claude-plugin/plugin.json',
    '.cursor-plugin/plugin.json',
    'skills/lamina-core/SKILL.md',
    'skills/lamina/SKILL.md',
    'skills/lamina-init/SKILL.md',
    'skills/lamina-design/SKILL.md',
    'skills/lamina-verify/SKILL.md',
    'skills/lamina-business-context/SKILL.md',
    'skills/lamina-orchestrator/SKILL.md',
    'skills/lamina-orchestrator/audit-profiles.yaml',
    'skills/lamina-orchestrator/merge-rules.md',
    'skills/lamina-orchestrator/workflows/init.md',
    'skills/lamina-orchestrator/prerequisites/init-required.md',
    'skills/lamina-orchestrator/prompts/outputs/init-blocked.md',
    'scripts/check_lamina_init.mjs',
    'skills/lamina-orchestrator/workflows/design.md',
    'skills/lamina-orchestrator/prompts/outputs/design.md',
    'skills/lamina-orchestrator/workflows/verify.md',
    'skills/lamina-orchestrator/prompts/outputs/verify.md',
    'skills/lamina-orchestrator/prompts/outputs/init.md',
    'skills/lamina-orchestrator/prompts/outputs/clarify.md',
    'skills/lamina-orchestrator/lib/validate-run.mjs',
    'skills/lamina-orchestrator/lib/run.mjs',
    'skills/lamina-orchestrator/lib/scenarios.mjs',
    'skills/lamina-orchestrator/lib/dependencies.mjs',
    'skills/lamina-orchestrator/lib/parse-contract-extras.mjs',
    'agents/ux-lens-reviewer.md',
    'agents/research-synthesizer.md',
    'skills/lamina-orchestrator/agents/ux-lens-reviewer.md',
    'skills/lamina-orchestrator/agents/research-synthesizer.md',
  ];
  for (const rel of required) {
    if (!exists(rel)) errors.push(`Missing required path: ${rel}`);
  }
}

const check = process.argv.includes('--check')
  ? process.argv[process.argv.indexOf('--check') + 1] || 'structure'
  : 'structure';

if (check === 'structure' || check === 'all') {
  checkAgentSkillPollution();
  checkRequiredPaths();
  checkCommandSkills();
  checkInitPrerequisiteLinks();
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
