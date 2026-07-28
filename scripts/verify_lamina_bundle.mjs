#!/usr/bin/env node
/**
 * Verify the public Lamina skill set and its routing graph.
 * Usage: node scripts/verify_lamina_bundle.mjs [--check structure|all]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_ROOT = 'skills';
const EXPECTED_PUBLIC_SKILLS = 59;
const errors = [];

const absolute = (rel) => path.join(ROOT, rel);
const exists = (rel) => fs.existsSync(absolute(rel));
const read = (rel) => fs.readFileSync(absolute(rel), 'utf8');
const skillPath = (name, suffix = 'SKILL.md') => `${SKILLS_ROOT}/${name}/${suffix}`;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function publicSkillNames() {
  if (!exists(SKILLS_ROOT)) return [];
  return fs.readdirSync(absolute(SKILLS_ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && exists(skillPath(entry.name)))
    .map((entry) => entry.name)
    .sort();
}

function checkPublicBoundary() {
  const publicSkills = publicSkillNames();
  if (publicSkills.length !== EXPECTED_PUBLIC_SKILLS) {
    errors.push(`skills/ must expose ${EXPECTED_PUBLIC_SKILLS} installable Lamina skills; found ${publicSkills.length}`);
  }
  if (!publicSkills.includes('lamina')) {
    errors.push('skills/ must expose the lamina command router');
  }
  for (const name of publicSkills) {
    if (name !== 'lamina' && !name.startsWith('lamina-')) {
      errors.push(`unexpected non-Lamina public skill: ${skillPath(name)}`);
    }
    const content = read(skillPath(name));
    if (!content.includes(`name: ${name}`)) {
      errors.push(`public skill frontmatter mismatch: ${skillPath(name)}`);
    }
  }

  if (exists('skills/lamina/skills')) {
    errors.push('public skills must be siblings under skills/, not nested under skills/lamina/skills');
  }
  if (exists('skills/lamina-orchestrator/lib') || exists('skills/lamina-orchestrator/bin')) {
    errors.push('skills must not embed executable graph runtime code');
  }
}

function checkPublicCatalog() {
  const catalog = JSON.parse(read('skills.sh.json'));
  const listed = (catalog.groupings || [])
    .flatMap((group) => group.skills || [])
    .sort();
  const publicSkills = publicSkillNames();
  if (new Set(listed).size !== listed.length) {
    errors.push('skills.sh.json lists a public skill more than once');
  }
  if (listed.length !== publicSkills.length ||
      listed.some((name, index) => name !== publicSkills[index])) {
    errors.push('skills.sh.json must list every public Lamina skill exactly once');
  }
}

function checkAuditProfiles() {
  const yaml = read(skillPath('lamina-orchestrator', 'audit-profiles.yaml'));
  const names = [...yaml.matchAll(/^\s+-\s+(lamina-[a-z-]+)\s*$/gm)].map((match) => match[1]);
  for (const name of names) {
    if (!exists(skillPath(name))) {
      errors.push(`audit-profiles references missing public skill: ${skillPath(name)}`);
    }
  }
}

function checkProblemRouterLinks() {
  const core = read(skillPath('lamina-core'));
  const names = [...core.matchAll(/\]\(\.\.\/(lamina-[a-z-]+)\/SKILL\.md\)/g)]
    .map((match) => match[1]);
  for (const name of names) {
    if (!exists(skillPath(name))) {
      errors.push(`Problem Router link references missing public skill: ${skillPath(name)}`);
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
  for (const file of walk(absolute(SKILLS_ROOT))) {
    if (!file.endsWith('.md') && !file.endsWith('.yaml')) continue;
    const rel = path.relative(ROOT, file);
    for (const link of extractMarkdownLinks(read(rel), path.dirname(file))) {
      if (!exists(link)) errors.push(`Broken link in ${rel}: ${link}`);
    }
  }
}

function checkOutputContracts() {
  const contracts = {
    [skillPath('lamina-orchestrator', 'prompts/outputs/design.md')]: [
      'GraphVersion', 'Source revision', 'Contradictions', 'Validation',
    ],
    [skillPath('lamina-orchestrator', 'prompts/outputs/verify.md')]: [
      'GraphVersion', 'source revision', 'Runs', 'evidence', 'Verdict',
    ],
    [skillPath('lamina-orchestrator', 'prompts/outputs/init.md')]: [
      'Mode', 'Business context summary', 'Open questions', 'Artifacts',
      'Stale downstream artifacts', 'Recommended next step', 'Skills applied',
    ],
    [skillPath('lamina-orchestrator', 'prompts/outputs/init-blocked.md')]: [
      'Status', "What's missing", 'Next step', 'Do not',
    ],
    [skillPath('lamina-orchestrator', 'prompts/outputs/clarify.md')]: [
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

function checkCommandSkills() {
  const rootSkill = read(skillPath('lamina'));
  for (const name of ['lamina-init', 'lamina-design', 'lamina-verify']) {
    const file = skillPath(name);
    if (!exists(file)) {
      errors.push(`missing public command skill: ${file}`);
      continue;
    }
    const content = read(file);
    if (!content.includes(`Use only when explicitly invoked as ${name}`)) {
      errors.push(`command skill does not declare explicit invocation: ${file}`);
    }
    if (!rootSkill.includes(`skills/${name}/SKILL.md`)) {
      errors.push(`Lamina router does not route to public command skill: ${name}`);
    }
  }
}

function checkRequiredPaths() {
  const required = [
    skillPath('lamina'),
    skillPath('lamina-core'),
    skillPath('lamina-init'),
    skillPath('lamina-design'),
    skillPath('lamina-verify'),
    skillPath('lamina-business-context'),
    skillPath('lamina-orchestrator'),
    skillPath('lamina-orchestrator', 'audit-profiles.yaml'),
    skillPath('lamina-orchestrator', 'merge-rules.md'),
    skillPath('lamina-orchestrator', 'workflows/init.md'),
    skillPath('lamina-orchestrator', 'workflows/design.md'),
    skillPath('lamina-orchestrator', 'workflows/verify.md'),
    skillPath('lamina-orchestrator', 'prerequisites/cli-required.md'),
    skillPath('lamina-orchestrator', 'prerequisites/init-required.md'),
    skillPath('lamina-orchestrator', 'references/personas.schema.json'),
    skillPath('lamina-orchestrator', 'references/product-graph.md'),
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
  checkPublicCatalog();
  checkCommandSkills();
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

console.log(`OK — ${EXPECTED_PUBLIC_SKILLS} public Lamina skills validated`);
