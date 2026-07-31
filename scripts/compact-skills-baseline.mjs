#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const outputRoot = path.join(root, 'docs/migrations/compact-skills');
const criteria = JSON.parse(fs.readFileSync(path.join(outputRoot, 'decision-criteria.json'), 'utf8'));
const sourceCommit = criteria.baseline.commit;
const writeMode = process.argv.includes('--write');
const checkMode = process.argv.includes('--check');

if (writeMode === checkMode) {
  console.error('usage: node scripts/compact-skills-baseline.mjs --write|--check');
  process.exit(2);
}

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: root, encoding, maxBuffer: 32 * 1024 * 1024 });
}

try {
  git(['cat-file', '-e', `${sourceCommit}^{commit}`]);
} catch {
  console.error(`baseline commit is unavailable: ${sourceCommit}`);
  process.exit(1);
}

const baselineFiles = git(['ls-tree', '-r', '--name-only', sourceCommit, 'skills'])
  .trim().split('\n').filter(Boolean).sort();
const skillFiles = baselineFiles.filter((file) => /^skills\/[^/]+\/SKILL\.md$/.test(file));

function baselineRead(file) {
  return git(['show', `${sourceCommit}:${file}`]);
}

function approximateTokens(text) {
  return Math.ceil(text.length / 4);
}

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const value = {};
  for (const line of match[1].split('\n')) {
    const item = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!item) continue;
    value[item[1]] = item[2].replace(/^['"]|['"]$/g, '');
  }
  return value;
}

function localLinks(text) {
  return [...text.matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1].split('#')[0])
    .filter((target) => target && !/^(?:https?:|mailto:|#)/.test(target))
    .sort();
}

function commands(text) {
  return [...new Set([...text.matchAll(/`(lamina(?:\s+[^`\n]+)?)`/g)]
    .map((match) => match[1].trim()))].sort();
}

function graphOperations(text) {
  const operations = new Set();
  for (const match of text.matchAll(/\b(?:lamina\s+)?(graph|session|mission|work)\s+([a-z][a-z-]*)\b/g)) {
    operations.add(`${match[1]} ${match[2]}`);
  }
  return [...operations].sort();
}

function profileMemberships() {
  const file = baselineRead('skills/lamina-orchestrator/audit-profiles.yaml');
  const memberships = new Map();
  let profile = null;
  for (const line of file.split('\n')) {
    const profileMatch = line.match(/^  ([a-z][a-z-]+):\s*$/);
    if (profileMatch) profile = profileMatch[1];
    const skillMatch = line.match(/^\s+-\s+(lamina(?:-[a-z-]+)?)\s*$/);
    if (!profile || !skillMatch) continue;
    const values = memberships.get(skillMatch[1]) || [];
    values.push(profile);
    memberships.set(skillMatch[1], values);
  }
  return memberships;
}

const profiles = profileMemberships();
const inventorySkills = skillFiles.map((file) => {
  const text = baselineRead(file);
  const metadata = frontmatter(text);
  const directory = path.posix.dirname(file);
  const ownedFiles = baselineFiles.filter((candidate) => candidate.startsWith(`${directory}/`));
  const bytes = Buffer.byteLength(text);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return {
    name: metadata.name || path.posix.basename(directory),
    path: file,
    description: metadata.description || '',
    bytes,
    words,
    approximateTokens: approximateTokens(text),
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    installedFiles: ownedFiles.length,
    installedBytes: ownedFiles.reduce((total, candidate) =>
      total + Buffer.byteLength(baselineRead(candidate)), 0),
    localAssets: ownedFiles.filter((candidate) => candidate !== file),
    localLinks: localLinks(text),
    auditProfiles: (profiles.get(metadata.name) || []).sort(),
    commands: commands(text),
    graphOperations: graphOperations(text),
  };
}).sort((left, right) => left.name.localeCompare(right.name));

const catalog = JSON.parse(git(['show', `${sourceCommit}:skills.sh.json`]));
const catalogDescriptions = catalog.groupings.flatMap((group) => [
  group.title,
  group.description,
  ...group.skills,
]).concat(inventorySkills.flatMap((skill) => [skill.name, skill.description])).join('\n');
const skillBodies = inventorySkills.map((skill) => skill.approximateTokens);
const inventory = {
  schema: 'lamina.skill-baseline-inventory/v1',
  sourceCommit,
  publicSkillCount: inventorySkills.length,
  publicCatalogMetadata: {
    bytes: Buffer.byteLength(catalogDescriptions),
    approximateTokens: approximateTokens(catalogDescriptions),
  },
  installed: {
    files: baselineFiles.length,
    bytes: baselineFiles.reduce((total, file) => total + Buffer.byteLength(baselineRead(file)), 0),
  },
  skillBodies: {
    totalBytes: inventorySkills.reduce((total, skill) => total + skill.bytes, 0),
    totalApproximateTokens: skillBodies.reduce((total, value) => total + value, 0),
    averageApproximateTokens: Math.round(skillBodies.reduce((total, value) => total + value, 0) / skillBodies.length),
    maximumApproximateTokens: Math.max(...skillBodies),
  },
  behavioralMeasurements: {
    status: 'not_collected',
    routingAccuracy: null,
    falsePassiveActivation: null,
    missedRequiredActivation: null,
    averageLoadedSkillBodies: null,
    averageInstructionTokensPerTask: null,
    benchmarkCompletionRate: null,
    providerInstallSuccess: null
  },
  skills: inventorySkills,
};

const packBySkill = new Map();
function assign(reference, names) {
  for (const name of names) packBySkill.set(`lamina-${name}`, reference);
}
assign('references/domain-integrity.md', [
  'system-structure', 'invariants', 'dependencies', 'modularity-boundaries',
  'evolutionary-rules', 'system-traps', 'leverage-points', 'feedback-loops',
]);
assign('references/actors-permissions-views.md', [
  'user-modeling', 'stakeholder-alignment', 'multi-view-integrity',
  'persuasion-and-groups', 'task-analysis',
]);
assign('references/workflows-state-side-effects.md', [
  'flow-design', 'side-effects', 'product-behavior',
]);
assign('references/time-concurrency-consistency.md', [
  'time-semantics', 'idempotency-concurrency', 'consistency-guarantees',
]);
assign('references/scenarios-errors-recovery.md', [
  'edge-cases', 'error-handling', 'empty-states', 'controls-and-menus', 'trust',
]);
assign('references/interaction-states-content.md', [
  'forms', 'feedback-and-status', 'content-design', 'discoverability',
]);
assign('references/navigation-learnability.md', [
  'information-architecture', 'navigation', 'onboarding',
  'progressive-disclosure', 'platform-posture',
]);
assign('references/evidence-simulation.md', [
  'research-scoping', 'research-planning', 'field-research', 'interview-design',
  'interview-documentation', 'usability-evaluation', 'research-synthesis',
  'research-communication', 'heuristic-review', 'quantitative-validation',
]);
assign('references/decisions-prioritization.md', [
  'problem-framing', 'feature-discovery', 'requirements-definition',
  'competitive-analysis', 'feature-prioritization', 'decision-making',
  'tradeoffs', 'design-process', 'business-context',
]);
assign('references/accessibility-trust.md', ['accessibility']);

function textBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let heading = '';
  let paragraph = [];
  let paragraphStart = 0;
  let fenced = false;
  const flush = (endLine) => {
    if (!paragraph.length) return;
    blocks.push({
      heading,
      lineStart: paragraphStart,
      lineEnd: endLine,
      text: paragraph.join(' ').replace(/\s+/g, ' ').trim(),
    });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index];
    if (line.startsWith('```')) {
      flush(lineNumber - 1);
      fenced = !fenced;
      continue;
    }
    if (fenced || lineNumber <= 4 && line === '---') continue;
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      flush(lineNumber - 1);
      heading = headingMatch[1].trim();
      continue;
    }
    if (!line.trim()) {
      flush(lineNumber - 1);
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line) || /^\s*\|/.test(line)) {
      flush(lineNumber - 1);
      blocks.push({
        heading,
        lineStart: lineNumber,
        lineEnd: lineNumber,
        text: line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim(),
      });
      continue;
    }
    if (!paragraph.length) paragraphStart = lineNumber;
    paragraph.push(line.trim());
  }
  flush(lines.length);
  return blocks.filter((block) => block.text && !/^\|?\s*:?-{3}/.test(block.text));
}

function classify(block) {
  const value = `${block.heading} ${block.text}`.toLowerCase();
  if (/example|template|sample/.test(block.heading.toLowerCase())) return 'example';
  if (/never|forbidden|must not|do not|cannot|reject|refuse|read-only|graph-only/.test(value)) return 'safety';
  if (/before|prerequisite|required first|only when|precondition/.test(value)) return 'prerequisite';
  if (/output|report|return|artifact|result must|include/.test(value)) return 'output';
  if (/route|workflow|mode|invoke|trigger|passive/.test(value)) return 'workflow';
  if (/must|required|should|ensure|use |run |load |read |follow |create |record |validate /.test(value)) return 'procedure';
  return 'capability';
}

function destination(skillName, block, classification) {
  const lower = block.text.toLowerCase();
  if (/workmap|implementationpacket|source edit|work prepare|work check|work verify|graph observe/.test(lower)) {
    return { publicSkill: 'lamina-work', reference: 'workflows/work.md', loadingCondition: 'ordinary_implementation' };
  }
  if (classification === 'safety' && /graph|source|cypher|approval|epistemic|persona|mission/.test(lower)) {
    return { publicSkill: 'lamina', reference: 'references/authority-and-safety.md', loadingCondition: 'every_lamina_workflow' };
  }
  if (skillName === 'lamina') return { publicSkill: 'lamina', reference: 'SKILL.md', loadingCondition: 'lamina_applicable' };
  if (skillName === 'lamina-init') return { publicSkill: 'lamina-init', reference: 'SKILL.md', loadingCondition: 'init' };
  if (skillName === 'lamina-design') return { publicSkill: 'lamina-design', reference: 'SKILL.md', loadingCondition: 'design' };
  if (skillName === 'lamina-verify') return { publicSkill: 'lamina-verify', reference: 'SKILL.md', loadingCondition: 'verify' };
  if (skillName === 'lamina-core') return { publicSkill: 'lamina-product', reference: 'SKILL.md', loadingCondition: 'focused_product_question' };
  if (skillName === 'lamina-orchestrator') {
    return { publicSkill: 'lamina', reference: 'references/authority-and-safety.md', loadingCondition: 'every_lamina_workflow' };
  }
  const reference = packBySkill.get(skillName) || 'references/decisions-prioritization.md';
  const owner = reference.includes('evidence') ? 'lamina-verify'
    : reference.includes('decisions') ? 'lamina-init'
      : reference.includes('interaction') || reference.includes('navigation') || reference.includes('accessibility')
        ? 'lamina-product' : 'lamina-design';
  return { publicSkill: owner, reference, loadingCondition: `signal:${path.posix.basename(reference, '.md')}` };
}

const ledgerRules = [];
const ruleIdOccurrences = new Map();
for (const file of skillFiles) {
  const skillName = path.posix.basename(path.posix.dirname(file));
  const text = baselineRead(file);
  for (const block of textBlocks(text)) {
    const classification = classify(block);
    const hash = crypto.createHash('sha256')
      .update(`${file}\n${block.text.toLowerCase()}`).digest('hex').slice(0, 12).toUpperCase();
    const baseId = `RULE-${classification.slice(0, 4).toUpperCase()}-${hash}`;
    const occurrence = (ruleIdOccurrences.get(baseId) || 0) + 1;
    ruleIdOccurrences.set(baseId, occurrence);
    const target = destination(skillName, block, classification);
    ledgerRules.push({
      id: occurrence === 1 ? baseId : `${baseId}-${occurrence}`,
      source: { file, lineStart: block.lineStart, lineEnd: block.lineEnd, heading: block.heading },
      text: block.text,
      classification,
      destination: target,
      disposition: 'retained',
      requiredTests: classification === 'safety'
        ? ['positive', 'negative', 'destination-presence']
        : ['destination-presence', 'routing'],
      reviewStatus: 'machine-classified',
    });
  }
}
ledgerRules.sort((left, right) => left.source.file.localeCompare(right.source.file) || left.source.lineStart - right.source.lineStart);
const ids = new Set(ledgerRules.map((rule) => rule.id));
if (ids.size !== ledgerRules.length) throw new Error('normative rule identifier collision');
for (const rule of ledgerRules) {
  if (!rule.destination.publicSkill || !rule.destination.reference || !rule.destination.loadingCondition) {
    throw new Error(`normative rule lacks a destination: ${rule.id}`);
  }
  if (!rule.requiredTests.includes('destination-presence')) {
    throw new Error(`normative rule lacks a destination-presence test: ${rule.id}`);
  }
  if (rule.classification === 'safety' &&
      (!rule.requiredTests.includes('positive') || !rule.requiredTests.includes('negative'))) {
    throw new Error(`safety rule lacks positive and negative tests: ${rule.id}`);
  }
}

const ledger = {
  schema: 'lamina.normative-instruction-ledger/v1',
  sourceCommit,
  extraction: {
    scope: 'every baseline public SKILL.md prose block outside fenced code',
    reviewStatus: 'machine-classified; manual semantic review required before Phase A exit',
  },
  classifications: [
    'universal', 'workflow', 'capability', 'safety', 'prerequisite', 'procedure',
    'output', 'example', 'duplicate', 'obsolete', 'conflicting',
  ],
  rules: ledgerRules,
};

const largest = [...inventorySkills].sort((left, right) => right.approximateTokens - left.approximateTokens).slice(0, 10);
const classificationCounts = Object.fromEntries([...new Set(ledgerRules.map((rule) => rule.classification))]
  .sort().map((classification) => [classification, ledgerRules.filter((rule) => rule.classification === classification).length]));
const report = `# Compact skills baseline report

- Source commit: \`${sourceCommit}\`
- Public skills: ${inventory.publicSkillCount}
- Installed files: ${inventory.installed.files}
- Installed bytes: ${inventory.installed.bytes}
- Public catalog metadata: approximately ${inventory.publicCatalogMetadata.approximateTokens} tokens
- Skill bodies: approximately ${inventory.skillBodies.totalApproximateTokens} tokens total
- Average skill body: approximately ${inventory.skillBodies.averageApproximateTokens} tokens
- Largest skill body: approximately ${inventory.skillBodies.maximumApproximateTokens} tokens
- Ledger entries: ${ledgerRules.length}

## Largest public skill bodies

| Skill | Bytes | Approximate tokens |
|---|---:|---:|
${largest.map((skill) => `| \`${skill.name}\` | ${skill.bytes} | ${skill.approximateTokens} |`).join('\n')}

## Machine classification

| Classification | Entries |
|---|---:|
${Object.entries(classificationCounts).map(([classification, count]) => `| ${classification} | ${count} |`).join('\n')}

## Behavioral measurements

Routing accuracy, passive activation, missed activation, loaded-body counts,
instruction tokens per task, benchmark completion, and provider install success
are intentionally recorded as \`null\` in the inventory until the comparative
evaluation harness runs. Structural measurements must not be presented as
behavioral evidence.

## Interpretation boundary

Token counts use a deterministic four-characters-per-token estimate and are for
relative architecture comparison, not model billing. The ledger intentionally
captures every prose block outside fenced examples to avoid silently dropping
short imperatives. Its destinations and classifications are machine-seeded and
must receive manual semantic review before the Phase A traceability exit gate.
`;

const outputs = new Map([
  ['baseline-inventory.json', `${JSON.stringify(inventory, null, 2)}\n`],
  ['baseline-report.md', report],
  ['normative-ledger.json', `${JSON.stringify(ledger, null, 2)}\n`],
]);

let failed = false;
for (const [name, content] of outputs) {
  const file = path.join(outputRoot, name);
  if (writeMode) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    continue;
  }
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current !== content) {
    console.error(`${name} is missing or stale; run npm run compact-skills:baseline`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`compact skills baseline: ok (${inventory.publicSkillCount} skills, ${ledgerRules.length} ledger entries)`);
