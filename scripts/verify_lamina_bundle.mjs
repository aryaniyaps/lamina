#!/usr/bin/env node
/**
 * Verify the public Lamina skill set and its routing graph.
 * Usage: node scripts/verify_lamina_bundle.mjs [--check structure|all]
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_ROOT = 'skills';
const EXPECTED_PUBLIC_SKILLS = [
  'lamina',
  'lamina-design',
  'lamina-evaluation',
  'lamina-init',
  'lamina-product-behavior',
  'lamina-product-discovery',
  'lamina-research',
  'lamina-systems',
  'lamina-ux',
  'lamina-verify',
].sort();
const CAPABILITY_SKILLS = [
  'lamina-research',
  'lamina-product-discovery',
  'lamina-ux',
  'lamina-product-behavior',
  'lamina-systems',
  'lamina-evaluation',
];
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
  if (publicSkills.length !== EXPECTED_PUBLIC_SKILLS.length ||
      publicSkills.some((name, index) => name !== EXPECTED_PUBLIC_SKILLS[index])) {
    errors.push(`skills/ must expose exactly: ${EXPECTED_PUBLIC_SKILLS.join(', ')}; found: ${publicSkills.join(', ')}`);
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
  if (exists('skills/lamina/orchestrator/lib') || exists('skills/lamina/orchestrator/bin')) {
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
  const yaml = read('skills/lamina/orchestrator/audit-profiles.yaml');
  const topics = [...yaml.matchAll(/^\s+(?:-\s+)?skill: (lamina(?:-[a-z-]+)?)\s*\n\s+reference: (skills\/[^\s]+)\s*$/gm)];
  if (!topics.length) errors.push('audit-profiles must route profiles to compact skills and exact topic references');
  for (const [, name, reference] of topics) {
    if (!EXPECTED_PUBLIC_SKILLS.includes(name)) errors.push(`audit-profiles references non-public skill: ${name}`);
    if (!exists(reference)) errors.push(`audit-profiles references missing topic: ${reference}`);
    if (exists(skillPath(name))) {
      const direct = extractMarkdownLinks(read(skillPath(name)), path.dirname(absolute(skillPath(name))))
        .map((entry) => entry.split(path.sep).join('/'));
      if (!direct.includes(reference)) {
        errors.push(`audit profile topic is not directly indexed by ${skillPath(name)}: ${reference}`);
      }
    }
  }
}

function checkProblemRouterLinks() {
  const router = read('skills/lamina/references/problem-router.md');
  if (!router.includes('Systems thinking') || !router.includes('UX and product expression')) {
    errors.push('compact Problem Router is missing routing sections');
  }
}

function checkMigrationMap() {
  const map = JSON.parse(read('skills/migration-map.json'));
  const former = map.migrations?.map((entry) => entry.from) || [];
  if (map.schema !== 'lamina.skill-migration/v1') errors.push('migration-map.json has an unsupported schema');
  if (former.length !== 59 || new Set(former).size !== 59) {
    errors.push('migration-map.json must map each of the 59 former public skills exactly once');
  }
  const formerDigest = crypto.createHash('sha256')
    .update(JSON.stringify([...former].sort()))
    .digest('hex');
  if (formerDigest !== 'faf1f1edfbcda37fe67e8686f2f2d288f8b802a058a5ca812ad7a50b286697a8' ||
      map.former_catalog_sha256 !== formerDigest) {
    errors.push('migration-map.json does not match the frozen 59-skill source catalog');
  }
  if (map.public_skills?.length !== EXPECTED_PUBLIC_SKILLS.length ||
      [...map.public_skills].sort().some((name, index) => name !== EXPECTED_PUBLIC_SKILLS[index])) {
    errors.push('migration-map.json public_skills must equal the canonical compact catalog');
  }
  for (const entry of map.migrations || []) {
    if (!EXPECTED_PUBLIC_SKILLS.includes(entry.to)) errors.push(`migration destination is not public: ${entry.to}`);
    const topic = `skills/${entry.to}/${entry.topic}`;
    if (!exists(topic)) errors.push(`migration topic is missing: ${topic}`);
    if (entry.from !== entry.to && entry.disposition !== 'retained' && exists(skillPath(entry.from))) {
      errors.push(`deprecated public skill still installable: ${skillPath(entry.from)}`);
    }
  }

  const installedLookup = read('skills/lamina/references/migration-map.md');
  for (const entry of map.migrations || []) {
    const row = `| \`${entry.from}\` | \`${entry.to}\` | \`${entry.topic}\` |`;
    if (!installedLookup.includes(row)) {
      errors.push(`installed migration lookup is missing exact mapping: ${entry.from}`);
    }
  }
}

function checkCapabilityReferenceTopology() {
  const map = JSON.parse(read('skills/migration-map.json'));
  for (const name of CAPABILITY_SKILLS) {
    const entrypoint = skillPath(name);
    const baseDir = path.dirname(absolute(entrypoint));
    const direct = extractMarkdownLinks(read(entrypoint), baseDir)
      .map((entry) => entry.split(path.sep).join('/'))
      .filter((entry) => entry.startsWith(`skills/${name}/references/`));
    const physical = fs.readdirSync(absolute(`skills/${name}/references`))
      .filter((file) => file.endsWith('.md'))
      .map((file) => `skills/${name}/references/${file}`)
      .sort();

    if (new Set(direct).size !== direct.length) {
      errors.push(`${entrypoint} must link each topic reference exactly once`);
    }
    const linked = [...new Set(direct)].sort();
    if (linked.length !== physical.length || linked.some((entry, index) => entry !== physical[index])) {
      errors.push(`${entrypoint} topic index must equal its physical references directory`);
    }

    const mapped = (map.migrations || [])
      .filter((entry) => entry.to === name && entry.topic.startsWith('references/'))
      .map((entry) => `skills/${name}/${entry.topic}`)
      .sort();
    if (mapped.length !== physical.length || mapped.some((entry, index) => entry !== physical[index])) {
      errors.push(`${entrypoint} topic index must equal its migration-map topics`);
    }
  }

  for (const file of walk(absolute(SKILLS_ROOT))) {
    if (!file.endsWith('.md')) continue;
    const rel = path.relative(ROOT, file);
    const content = read(rel);
    if (/^## Related capabilities\s*$/m.test(content)) {
      errors.push(`topic references must be terminal; move pairing guidance to the entrypoint: ${rel}`);
    }
    if (/^skills\/lamina(?:-[a-z-]+)?\/references\//.test(rel) &&
        content.split('\n').length > 100 && !/^## Contents\s*$/m.test(content)) {
      errors.push(`long reference requires a Contents section: ${rel}`);
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

function checkInstalledLinkBoundary() {
  for (const name of EXPECTED_PUBLIC_SKILLS) {
    const skillRoot = absolute(`skills/${name}`);
    for (const file of walk(skillRoot)) {
      if (!file.endsWith('.md')) continue;
      const rel = path.relative(ROOT, file);
      for (const target of extractMarkdownLinks(read(rel), path.dirname(file))) {
        const normalized = target.split(path.sep).join('/');
        if (!normalized.startsWith('skills/')) continue;
        const owner = EXPECTED_PUBLIC_SKILLS.find((candidate) =>
          normalized === `skills/${candidate}/SKILL.md` || normalized.startsWith(`skills/${candidate}/`)
        );
        if (!owner) {
          errors.push(`installed skill link escapes the copied public catalog in ${rel}: ${normalized}`);
        }
      }
    }
  }
}

function checkOutputContracts() {
  const contracts = {
    ['skills/lamina/orchestrator/prompts/outputs/design.md']: [
      'GraphVersion', 'Source revision', 'Contradictions', 'Validation',
    ],
    ['skills/lamina/orchestrator/prompts/outputs/verify.md']: [
      'GraphVersion', 'source revision', 'Runs', 'evidence', 'Verdict',
    ],
    ['skills/lamina/orchestrator/prompts/outputs/init.md']: [
      'Mode', 'Business context summary', 'Open questions', 'Artifacts',
      'Stale downstream artifacts', 'Passive product workflow', 'Skills applied',
    ],
    ['skills/lamina/orchestrator/prompts/outputs/init-blocked.md']: [
      'Status', "What's missing", 'Next step', 'Do not',
    ],
    ['skills/lamina/orchestrator/prompts/outputs/clarify.md']: [
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
    if (name === 'lamina-init' && !content.includes(`Use only when explicitly invoked as ${name}`)) {
      errors.push(`init skill does not declare one-time explicit invocation: ${file}`);
    }
    if (name !== 'lamina-init' &&
        (!content.includes('when explicitly invoked') || !content.match(/passive|ordinary implementation/))) {
      errors.push(`phase skill does not support both passive flow and explicit override: ${file}`);
    }
    if (!rootSkill.includes(`../${name}/SKILL.md`) && !rootSkill.includes(`skills/${name}/SKILL.md`)) {
      errors.push(`Lamina router does not route to public command skill: ${name}`);
    }
  }
  for (const signal of ['lamina work prepare', 'lamina work check', 'lamina work verify']) {
    if (!rootSkill.includes(signal)) errors.push(`Lamina router missing passive workflow signal: ${signal}`);
  }
  if (!rootSkill.includes('Do not tell the user to invoke') &&
      !rootSkill.includes('Never recommend')) {
    errors.push('Lamina router must prohibit explicit phase recommendations in normal flow');
  }
}

function checkRequiredPaths() {
  const required = [
    skillPath('lamina'),
    skillPath('lamina-init'),
    skillPath('lamina-design'),
    skillPath('lamina-verify'),
    skillPath('lamina-research'),
    skillPath('lamina-product-discovery'),
    skillPath('lamina-ux'),
    skillPath('lamina-product-behavior'),
    skillPath('lamina-systems'),
    skillPath('lamina-evaluation'),
    'skills/migration-map.json',
    'skills/lamina/references/migration-map.md',
    'skills/lamina/references/problem-router.md',
    'skills/lamina/orchestrator/audit-profiles.yaml',
    'skills/lamina/orchestrator/merge-rules.md',
    'skills/lamina/orchestrator/workflows/init.md',
    'skills/lamina/orchestrator/workflows/design.md',
    'skills/lamina/orchestrator/workflows/verify.md',
    'skills/lamina/orchestrator/prerequisites/cli-required.md',
    'skills/lamina/orchestrator/prerequisites/init-required.md',
    'skills/lamina/orchestrator/references/personas.schema.json',
    'skills/lamina/orchestrator/references/product-graph.md',
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
  checkMigrationMap();
  checkCapabilityReferenceTopology();
  checkOutputContracts();
  checkReferencedFiles();
  checkInstalledLinkBoundary();
}

if (errors.length) {
  console.error('Lamina bundle verification FAILED:\n');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`OK — ${EXPECTED_PUBLIC_SKILLS.length} public Lamina skills validated`);
