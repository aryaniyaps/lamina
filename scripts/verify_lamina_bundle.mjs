#!/usr/bin/env node
/**
 * Verify the single-skill Lamina bundle and its contained module graph.
 * Usage: node scripts/verify_lamina_bundle.mjs [--check structure|all]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = 'skills/lamina';
const MODULES = `${BUNDLE}/skills`;
const EXPECTED_INTERNAL_MODULES = 58;
const errors = [];

const absolute = (rel) => path.join(ROOT, rel);
const exists = (rel) => fs.existsSync(absolute(rel));
const read = (rel) => fs.readFileSync(absolute(rel), 'utf8');
const modulePath = (name, suffix = 'SKILL.md') => `${MODULES}/${name}/${suffix}`;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function internalModuleNames() {
  if (!exists(MODULES)) return [];
  return fs.readdirSync(absolute(MODULES), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && exists(modulePath(entry.name)))
    .map((entry) => entry.name)
    .sort();
}

function checkPublicBoundary() {
  const publicSkills = fs.readdirSync(absolute('skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && exists(`skills/${entry.name}/SKILL.md`))
    .map((entry) => entry.name);
  if (publicSkills.length !== 1 || publicSkills[0] !== 'lamina') {
    errors.push(`skills/ must expose exactly one installable skill named lamina; found: ${publicSkills.join(', ')}`);
  }

  const modules = internalModuleNames();
  if (modules.length !== EXPECTED_INTERNAL_MODULES) {
    errors.push(`expected ${EXPECTED_INTERNAL_MODULES} contained Lamina modules; found ${modules.length}`);
  }
  for (const name of modules) {
    const content = read(modulePath(name));
    if (!content.includes(`name: ${name}`)) {
      errors.push(`contained module frontmatter mismatch: ${modulePath(name)}`);
    }
  }

  if (exists(`${MODULES}/lamina-orchestrator/lib`) || exists(`${MODULES}/lamina-orchestrator/bin`)) {
    errors.push('the skill bundle must not embed executable graph runtime code');
  }
}

function checkAuditProfiles() {
  const yaml = read(modulePath('lamina-orchestrator', 'audit-profiles.yaml'));
  const names = [...yaml.matchAll(/^\s+-\s+(lamina-[a-z-]+)\s*$/gm)].map((match) => match[1]);
  for (const name of names) {
    if (!exists(modulePath(name))) {
      errors.push(`audit-profiles references missing contained module: ${modulePath(name)}`);
    }
  }
}

function checkProblemRouterLinks() {
  const core = read(modulePath('lamina-core'));
  const names = [...core.matchAll(/\]\(\.\.\/(lamina-[a-z-]+)\/SKILL\.md\)/g)]
    .map((match) => match[1]);
  for (const name of names) {
    if (!exists(modulePath(name))) {
      errors.push(`Problem Router link references missing contained module: ${modulePath(name)}`);
    }
  }
}

function extractMarkdownLinks(content, baseDir) {
  const links = [];
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    let target = match[1];
    if (target.startsWith('http') || target.startsWith('#')) continue;
    target = target.split('#')[0];
    if (!target) continue;
    const resolved = path.normalize(path.join(baseDir, target));
    if (resolved.startsWith(ROOT)) links.push(path.relative(ROOT, resolved));
  }
  return links;
}

function checkReferencedFiles() {
  for (const file of walk(absolute(BUNDLE))) {
    if (!file.endsWith('.md') && !file.endsWith('.yaml')) continue;
    const rel = path.relative(ROOT, file);
    for (const link of extractMarkdownLinks(read(rel), path.dirname(file))) {
      if (!exists(link)) errors.push(`Broken link in ${rel}: ${link}`);
    }
  }
}

function checkOutputContracts() {
  const contracts = {
    [modulePath('lamina-orchestrator', 'prompts/outputs/design.md')]: [
      'GraphVersion', 'Source revision', 'Contradictions', 'Validation',
    ],
    [modulePath('lamina-orchestrator', 'prompts/outputs/verify.md')]: [
      'GraphVersion', 'source revision', 'Runs', 'evidence', 'Verdict',
    ],
    [modulePath('lamina-orchestrator', 'prompts/outputs/init.md')]: [
      'Mode', 'Business context summary', 'Open questions', 'Artifacts',
      'Stale downstream artifacts', 'Recommended next step', 'Skills applied',
    ],
    [modulePath('lamina-orchestrator', 'prompts/outputs/init-blocked.md')]: [
      'Status', "What's missing", 'Next step', 'Do not',
    ],
    [modulePath('lamina-orchestrator', 'prompts/outputs/clarify.md')]: [
      'Status', 'Clarifying questions', 'Why these block the artifact', 'How to proceed', 'Do not',
    ],
  };
  for (const [file, headings] of Object.entries(contracts)) {
    const content = read(file);
    for (const heading of headings) {
      if (!content.includes(heading)) errors.push(`Output contract ${file} missing: ${heading}`);
    }
  }
}

function checkCommandModules() {
  const rootSkill = read(`${BUNDLE}/SKILL.md`);
  for (const name of ['lamina-init', 'lamina-design', 'lamina-verify']) {
    const file = modulePath(name);
    if (!exists(file)) {
      errors.push(`missing contained command module: ${file}`);
      continue;
    }
    const content = read(file);
    if (!content.includes(`Use only when explicitly invoked as ${name}`)) {
      errors.push(`command module does not declare explicit invocation: ${file}`);
    }
    if (!rootSkill.includes(`skills/${name}/SKILL.md`)) {
      errors.push(`public Lamina router does not route to contained command module: ${name}`);
    }
  }
}

function checkRequiredPaths() {
  const required = [
    `${BUNDLE}/SKILL.md`,
    modulePath('lamina-core'),
    modulePath('lamina-init'),
    modulePath('lamina-design'),
    modulePath('lamina-verify'),
    modulePath('lamina-business-context'),
    modulePath('lamina-orchestrator'),
    modulePath('lamina-orchestrator', 'audit-profiles.yaml'),
    modulePath('lamina-orchestrator', 'merge-rules.md'),
    modulePath('lamina-orchestrator', 'workflows/init.md'),
    modulePath('lamina-orchestrator', 'workflows/design.md'),
    modulePath('lamina-orchestrator', 'workflows/verify.md'),
    modulePath('lamina-orchestrator', 'prerequisites/cli-required.md'),
    modulePath('lamina-orchestrator', 'prerequisites/init-required.md'),
    modulePath('lamina-orchestrator', 'references/personas.schema.json'),
    modulePath('lamina-orchestrator', 'references/product-graph.md'),
    'packages/cli/bin/lamina.mjs',
    'packages/cli/lib/graph-runtime/engine.mjs',
    'packages/cli/lib/graph-runtime/server.mjs',
    'packages/cli/lib/graph-runtime/client.mjs',
  ];
  for (const rel of required) if (!exists(rel)) errors.push(`Missing required path: ${rel}`);
}

function checkAgentSkillPollution() {
  for (const rel of ['.agents', '.windsurf', '.claude', '.roo', '.pi', '.goose', '.cursor/skills', 'skills-lock.json']) {
    if (exists(rel)) errors.push(`skills CLI pollution at repository root: ${rel}`);
  }
}

const check = process.argv.includes('--check')
  ? process.argv[process.argv.indexOf('--check') + 1] || 'structure'
  : 'structure';

if (check === 'structure' || check === 'all') {
  checkAgentSkillPollution();
  checkRequiredPaths();
  checkPublicBoundary();
  checkCommandModules();
  checkAuditProfiles();
  checkProblemRouterLinks();
  checkOutputContracts();
  checkReferencedFiles();
}

if (errors.length) {
  console.error('Lamina bundle verification FAILED:\n');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`OK — one public Lamina skill contains ${EXPECTED_INTERNAL_MODULES} validated modules`);
