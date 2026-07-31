#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const migrationRoot = path.join(root, 'docs/migrations/compact-skills');
const fixtureRoot = path.join(root, 'evals/fixtures/skill-architectures');
const criteria = JSON.parse(fs.readFileSync(path.join(migrationRoot, 'decision-criteria.json'), 'utf8'));
const capabilityMap = JSON.parse(fs.readFileSync(path.join(migrationRoot, 'capability-map.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(migrationRoot, 'normative-ledger.json'), 'utf8'));
const sourceCommit = criteria.baseline.commit;
const writeMode = process.argv.includes('--write');
const checkMode = process.argv.includes('--check');

if (writeMode === checkMode) {
  console.error('usage: node scripts/build-compact-skill-fixtures.mjs --write|--check');
  process.exit(2);
}

function gitShow(file) {
  return execFileSync('git', ['show', `${sourceCommit}:${file}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function stripFrontmatter(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

function flattenLinks(text) {
  return text.replace(/\[([^\]]+)\]\((?!https?:|mailto:)[^)]+\)/g, '$1');
}

function sourceBody(skill) {
  const body = flattenLinks(stripFrontmatter(gitShow(`skills/${skill}/SKILL.md`))).trim();
  return `> Migrated intact from \`skills/${skill}/SKILL.md\` at \`${sourceCommit}\`.\n\n${body}\n`;
}

function slug(skill) {
  return skill.replace(/^lamina-/, '');
}

const workflowSources = {
  init: 'lamina-init',
  design: 'lamina-design',
  work: 'lamina',
  verify: 'lamina-verify',
  'product-question': 'lamina-core',
};

const workflowIntroductions = {
  init: '# Init workflow\n\nUse for explicit initialization and material business-context changes. Load authority and safety first, then select only the references signaled by missing context.\n',
  design: '# Design workflow\n\nThis workflow is graph-only. It may propose and publish graph state through sessions, but it must not edit application source. Load capability references only for the affected graph signals.\n',
  work: '# Work workflow\n\nUse for ordinary implementation. Source edits remain blocked until preparation produces an implementation packet and the mechanically derived WorkMap passes its check.\n',
  verify: '# Verify workflow\n\nThis workflow is source-read-only. Isolate Persona Missions, collect current runtime evidence, publish Runs, and report findings without editing application source.\n',
  'product-question': '# Product-question workflow\n\nAnswer a focused product, systems, or UX question with at most one primary capability leaf unless the question itself spans multiple concerns. Do not start implementation or Mission machinery.\n',
};

const authority = `# Authority and safety\n\nThis reference is required by every graph-backed Lamina workflow. Ladybug through graphd is canonical. Derived retrieval and source evidence select and ground graph roots but cannot override graph facts. Design and explicit verification never edit application source. Ordinary implementation observes the packet and checked WorkMap gates. Never expose raw Cypher or accept caller-supplied epistemic or approval status.\n\n${sourceBody('lamina-orchestrator')}`;

const graphSessions = `# Graph sessions\n\nAll design mutations use sessions: begin from the current GraphVersion, propose typed operations, validate, and publish. Rebase independent later sessions when required. Never write Ladybug directly or treat legacy run files as graph state.\n\n${flattenLinks(gitShow('skills/lamina-orchestrator/workflows/design.md')).trim()}\n`;

function packIndex(pack, skills) {
  const rows = skills.map((skill) => `| \`${slug(skill).replaceAll('-', '_')}\` | [${slug(skill)}](${pack}/${slug(skill)}.md) | ${frontmatterDescription(skill)} |`);
  return `# ${pack.replaceAll('-', ' ')}\n\nThis is a routing index. Select a leaf from the problem signal; do not load the pack wholesale.\n\n| Signal | Reference | Purpose |\n|---|---|---|\n${rows.join('\n')}\n`;
}

function frontmatterDescription(skill) {
  const text = gitShow(`skills/${skill}/SKILL.md`);
  const match = text.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  return (match?.[1] || `Guidance migrated from ${skill}`).replace(/\|/g, '\\|');
}

const sharedFiles = new Map([
  ['references/authority-and-safety.md', authority],
  ['references/graph-sessions.md', graphSessions],
]);

for (const [workflow, source] of Object.entries(workflowSources)) {
  sharedFiles.set(`workflows/${workflow}.md`, `${workflowIntroductions[workflow]}\n${sourceBody(source)}`);
}
for (const [pack, skills] of Object.entries(capabilityMap.packs)) {
  sharedFiles.set(`references/${pack}.md`, packIndex(pack, skills));
  for (const skill of skills) {
    sharedFiles.set(
      `references/${pack}/${slug(skill)}.md`,
      `# ${slug(skill).replaceAll('-', ' ')}\n\n${sourceBody(skill)}`,
    );
  }
}

const profiles = {
  init: {
    always: ['references/authority-and-safety.md', 'workflows/init.md'],
    conditional: {
      business_context: ['references/decisions-prioritization/business-context.md'],
      actor_population: ['references/actors-permissions-views/user-modeling.md'],
      evidence_gap: ['references/evidence-simulation/research-scoping.md'],
    },
  },
  design: {
    always: ['references/authority-and-safety.md', 'references/graph-sessions.md', 'workflows/design.md'],
    conditional: {
      domain_change: ['references/domain-integrity/system-structure.md', 'references/domain-integrity/invariants.md'],
      active_personas: ['references/actors-permissions-views/user-modeling.md', 'references/evidence-simulation/research-planning.md'],
      time_bearing_operation: ['references/time-concurrency-consistency/time-semantics.md', 'references/time-concurrency-consistency/idempotency-concurrency.md'],
      user_facing_form: ['references/interaction-states-content/forms.md', 'references/accessibility-trust/accessibility.md'],
      destructive_action: ['references/scenarios-errors-recovery/trust.md', 'references/scenarios-errors-recovery/error-handling.md'],
    },
  },
  work: {
    always: ['references/authority-and-safety.md', 'workflows/work.md'],
    conditional: {
      user_facing: ['references/interaction-states-content/feedback-and-status.md', 'references/accessibility-trust/accessibility.md'],
      graph_gap: ['references/graph-sessions.md', 'workflows/design.md'],
    },
  },
  verify: {
    always: ['references/authority-and-safety.md', 'workflows/verify.md'],
    conditional: {
      user_facing: ['references/accessibility-trust/accessibility.md', 'references/interaction-states-content/feedback-and-status.md'],
      shared_mutation: ['references/time-concurrency-consistency/idempotency-concurrency.md', 'references/domain-integrity/invariants.md'],
      findings: ['references/decisions-prioritization/decision-making.md'],
    },
  },
  'product-question': {
    always: ['workflows/product-question.md'],
    conditional: {
      empty_state: ['references/scenarios-errors-recovery/empty-states.md'],
      permission_denial: ['references/actors-permissions-views/multi-view-integrity.md'],
      navigation: ['references/navigation-learnability/navigation.md'],
      form_validation: ['references/interaction-states-content/forms.md'],
      accessibility: ['references/accessibility-trust/accessibility.md'],
      prioritization: ['references/decisions-prioritization/feature-prioritization.md'],
    },
  },
};

const publicSix = ['lamina', 'lamina-init', 'lamina-design', 'lamina-work', 'lamina-verify', 'lamina-product'];
const routeMap = {
  lamina: { publicSkill: 'lamina', workflow: null },
  'lamina-init': { publicSkill: 'lamina-init', workflow: 'init' },
  'lamina-design': { publicSkill: 'lamina-design', workflow: 'design' },
  'lamina-work': { publicSkill: 'lamina-work', workflow: 'work' },
  'lamina-verify': { publicSkill: 'lamina-verify', workflow: 'verify' },
  'lamina-product': { publicSkill: 'lamina-product', workflow: 'product-question' },
};

const descriptions = {
  lamina: 'Use passively to classify non-mechanical Lamina work, preserve universal graph and write boundaries, and route to exactly one workflow. Skip formatting, dependency, build, test-maintenance, typo, generated-file, and behavior-neutral rename tasks.',
  'lamina-init': 'Use explicitly for first initialization or a material product, domain, actor, or business-context change. May write graph state through sessions; does not implement application source.',
  'lamina-design': 'Use explicitly for graph-only design or internally for a graph gap found during work preparation. Never edits application source.',
  'lamina-work': 'Use passively for ordinary product implementation after initialization. May edit application source only after packet preparation and checked WorkMap validation, then observes and reconciles the graph.',
  'lamina-verify': 'Use explicitly for source-read-only Persona Mission verification, live grounding, evidence publication, findings, and reports. Never edits application source.',
  'lamina-product': 'Use for focused product, systems, and UX questions that do not require a full graph-backed design, implementation, or verification workflow.',
};

function skillDocument(name, oneSkill = false) {
  const description = oneSkill
    ? 'Use passively for non-mechanical Lamina product work and explicitly for init, design, verification, or focused product questions. Preserve graph authority and write boundaries while loading exactly one workflow and only signaled internal references.'
    : descriptions[name];
  const title = oneSkill ? '# Lamina router' : `# ${name}`;
  let body;
  if (name === 'lamina') {
    body = `Read [authority and safety](references/authority-and-safety.md) only after Lamina applies. Classify the request, then load exactly one workflow: [init](workflows/init.md), [design](workflows/design.md), [work](workflows/work.md), [verify](workflows/verify.md), or [product question](workflows/product-question.md). Load only capability leaves selected by that workflow's deterministic signal. Mechanical work loads no Lamina body. Never bulk-load workflows or capability packs.`;
  } else {
    const route = routeMap[name].workflow;
    body = `Read [authority and safety](../lamina/references/authority-and-safety.md), then follow the [${route} workflow](../lamina/workflows/${route}.md). Load only capability leaves selected by the workflow signal. Never load every reference.`;
  }
  return `---\nname: ${name}\ndescription: "${description}"\n---\n\n${title}\n\n${body}\n`;
}

const specialSourceRoutes = {
  'skills/lamina/SKILL.md': 'workflows/work.md',
  'skills/lamina-init/SKILL.md': 'workflows/init.md',
  'skills/lamina-design/SKILL.md': 'workflows/design.md',
  'skills/lamina-verify/SKILL.md': 'workflows/verify.md',
  'skills/lamina-core/SKILL.md': 'workflows/product-question.md',
  'skills/lamina-orchestrator/SKILL.md': 'references/authority-and-safety.md',
};

function traceabilityFor(variant) {
  return ledger.rules.map((rule) => {
    let reference = specialSourceRoutes[rule.source.file] || rule.destination.reference;
    if (reference === 'SKILL.md') reference = 'references/authority-and-safety.md';
    return {
      rule: rule.id,
      source: rule.source,
      classification: rule.classification,
      destination: `skills/lamina/${reference}`,
      variant,
    };
  });
}

function buildVariant(variant) {
  const publicSkills = variant === 'candidate-6' ? publicSix : ['lamina'];
  const files = new Map();
  for (const [relative, content] of sharedFiles) files.set(`skills/lamina/${relative}`, content);
  for (const skill of publicSkills) files.set(`skills/${skill}/SKILL.md`, skillDocument(skill, variant === 'candidate-1'));
  const legacyNames = {};
  for (const skill of JSON.parse(gitShow('skills.sh.json')).groupings.flatMap((group) => group.skills)) {
    const mappedPack = Object.entries(capabilityMap.packs).find(([, names]) => names.includes(skill));
    const route = routeMap[skill] || { publicSkill: 'lamina-product', workflow: 'product-question' };
    legacyNames[skill] = mappedPack
      ? { publicSkill: variant === 'candidate-1' ? 'lamina' : route.publicSkill, reference: `references/${mappedPack[0]}/${slug(skill)}.md` }
      : { publicSkill: variant === 'candidate-1' ? 'lamina' : (publicSkills.includes(skill) ? skill : route.publicSkill), reference: specialSourceRoutes[`skills/${skill}/SKILL.md`] || 'references/authority-and-safety.md' };
  }
  const traceability = {
    schema: 'lamina.normative-traceability/v1',
    variant,
    sourceCommit,
    rules: traceabilityFor(variant),
  };
  files.set('traceability.json', `${JSON.stringify(traceability, null, 2)}\n`);
  const architecture = {
    schema: 'lamina.skill-architecture/v1',
    variant,
    sourceCommit,
    public: publicSkills,
    bundleRoot: 'skills/lamina',
    workflows: Object.fromEntries(Object.keys(workflowSources).map((name) => [name, `skills/lamina/workflows/${name}.md`])),
    references: Object.fromEntries([...sharedFiles.keys()].filter((file) => file.startsWith('references/')).map((file) => [file, `skills/lamina/${file}`])),
    profiles,
    publicRouteMap: Object.fromEntries(Object.entries(routeMap).map(([name, route]) => [name, {
      publicSkill: variant === 'candidate-1' ? 'lamina' : route.publicSkill,
      workflow: route.workflow,
    }])),
    legacyNames,
    loadingInvariants: [
      'mechanical_task_loads_zero_skill_bodies',
      'one_workflow_loaded_initially',
      'focused_question_loads_at_most_one_primary_capability_leaf',
      'design_loads_source_write_prohibition',
      'verify_loads_source_read_only_boundary',
      'time_bearing_operation_loads_time_and_concurrency',
      'user_facing_form_loads_interaction_and_accessibility',
      'no_bulk_reference_loading',
    ],
    contextBudgets: criteria.contextBudgets,
    providerRequirements: {
      recursiveBundledReferenceCopy: true,
      relativeReferenceResolution: true,
      partialInstallRejected: variant === 'candidate-6',
    },
    expectedInstallInventory: [...files.keys(), 'architecture.json'].sort(),
  };
  files.set('architecture.json', `${JSON.stringify(architecture, null, 2)}\n`);
  return files;
}

const expectedFiles = new Map();
for (const [relative, content] of sharedFiles) expectedFiles.set(`_shared/${relative}`, content);
for (const variant of ['candidate-6', 'candidate-1']) {
  for (const [relative, content] of buildVariant(variant)) expectedFiles.set(`${variant}/${relative}`, content);
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

if (writeMode) {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  for (const file of walk(fixtureRoot)) {
    const relative = path.relative(fixtureRoot, file).replaceAll(path.sep, '/');
    if (!expectedFiles.has(relative)) fs.rmSync(file);
  }
  for (const [relative, content] of expectedFiles) {
    const file = path.join(fixtureRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
} else {
  let failed = false;
  for (const [relative, content] of expectedFiles) {
    const file = path.join(fixtureRoot, relative);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
      console.error(`compact fixture is missing or stale: ${relative}`);
      failed = true;
    }
  }
  const extras = walk(fixtureRoot).map((file) => path.relative(fixtureRoot, file).replaceAll(path.sep, '/'))
    .filter((file) => !expectedFiles.has(file));
  for (const file of extras) console.error(`unexpected compact fixture file: ${file}`);
  if (failed || extras.length) process.exit(1);
}

const digest = crypto.createHash('sha256');
for (const [relative, content] of [...expectedFiles].sort(([left], [right]) => left.localeCompare(right))) {
  digest.update(relative).update('\0').update(content).update('\0');
}
console.log(`compact skill fixtures: ok (${expectedFiles.size} files, ${digest.digest('hex').slice(0, 12)})`);
