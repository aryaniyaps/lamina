#!/usr/bin/env node
/**
 * Seed a ready_to_build run built from the brief (no example templates).
 * Usage:
 *   node ./scripts/seed-ready-run.mjs --slug password-reset --problem "..." --outcome "..."
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderImplementMarkdown } from '../../lamina-orchestrator/lib/graph.mjs';
import { validateRunFields } from '../../lamina-orchestrator/lib/run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

export const LEGACY_TEMPLATE_LEAK_TERMS = [
  'household shared budget',
  'household owner',
  'household member',
  'household projection',
  'household budget',
  'view-budget',
  'budget-home',
  'empty-budget',
  'link-and-view',
  'link-account',
  'account-link',
  'category limits',
  'shared spend',
  'consolidated balance',
  'oauth provider',
  'keep household budget accurate',
  'account appears in household budget',
  'budget periods are monthly',
  'entity.household',
  'invariant.household-scope',
  'operation.view-budget',
  'surface.budget-home',
  'workflow.link-and-view',
  'promise.shared-view',
  'scenario.empty-budget',
];

function flag(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

function meta(criticality = 'critical') {
  return {
    criticality,
    source: 'user',
    confidence: 'high',
    relevance_reason: 'Required for the current design slice',
  };
}

export function findTemplateLeaks(text, allowed = '') {
  const blob = `${text}`.toLowerCase();
  const allowedLower = allowed.toLowerCase();
  const leaks = [];
  for (const term of LEGACY_TEMPLATE_LEAK_TERMS) {
    const needle = term.toLowerCase();
    if (!containsLeakTerm(blob, needle)) continue;
    if (containsLeakTerm(allowedLower, needle)) continue;
    leaks.push(term);
  }
  return leaks;
}

function containsLeakTerm(haystack, needle) {
  if (/[-.]/.test(needle)) return haystack.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
}

export function createReadyRun({ slug, problem, outcome, users }) {
  const primaryUser = users[0] || 'primary-user';
  const secondaryUser = users[1] || 'secondary-user';
  const surfaceId = `${slug}-home`;
  const configureOp = 'configure-flow';
  const executeOp = 'execute-flow';
  const workflowId = 'primary-workflow';
  const entityId = 'feature-state';
  const promiseId = 'primary-outcome';
  const proofId = 'primary-outcome';

  return {
    contract_version: '2.0',
    id: slug,
    status: 'ready_to_build',
    stage: 'shape',
    hook: 'design',
    target: slug,
    intent: {
      problem,
      outcome,
      users,
      critical_promises: [
        {
          id: promiseId,
          promise: outcome,
          ...meta(),
        },
      ],
      success_signals: [outcome],
      constraints: ['Mobile-first'],
      scope: {
        in: [`${slug.replace(/-/g, ' ')} primary flow`],
        out: ['unrelated product areas'],
      },
    },
    decisions: {
      assumptions: [
        {
          id: 'mvp-slice',
          class: 'reversible_default',
          statement: `Deliver the smallest complete slice for: ${problem}`,
          ...meta('supporting'),
        },
      ],
      forks: [],
    },
    actors: [
      {
        id: primaryUser,
        name: primaryUser.replace(/-/g, ' '),
        role: 'primary actor',
        goal: problem,
        authority: 'configure and complete the primary flow',
        entry_path: 'product sign-in',
        ...meta(),
      },
      {
        id: secondaryUser,
        name: secondaryUser.replace(/-/g, ' '),
        role: 'secondary actor',
        goal: outcome,
        authority: 'view authorized outcomes',
        entry_path: 'shared access invite',
        ...meta('supporting'),
      },
    ],
    entities: [
      {
        id: entityId,
        name: 'Feature state',
        identity: `durable state for ${slug}`,
        attributes: [{ name: 'status', contract: 'pending|ready|error' }],
        relationships: [],
        lifecycle_consequences: ['archive hides active projections'],
        states: ['pending', 'ready', 'error', 'archived'],
        ...meta(),
      },
    ],
    operations: [
      {
        id: configureOp,
        name: 'Configure primary flow',
        actor_refs: [`actor.${primaryUser}`],
        enforces: ['invariant.owner-only-configure'],
        preconditions: ['Actor is authenticated primary user'],
        failures: ['Validation rejects input', 'Secondary actor attempts configure'],
        recovery: 'Remain pending and offer corrected input',
        transitions: [{ entity_ref: `entity.${entityId}`, from: 'pending', to: 'ready' }],
        outcome: `Configuration saved for ${slug}`,
        ...meta(),
      },
      {
        id: executeOp,
        name: 'Execute primary flow',
        actor_refs: [`actor.${primaryUser}`, `actor.${secondaryUser}`],
        enforces: ['invariant.scoped-access'],
        preconditions: ['Actor is authorized for this feature'],
        failures: ['Unauthenticated', 'Unauthorized actor'],
        recovery: 'Show sign-in or access denied with recovery path',
        effects: [`Render projection for ${slug}`],
        transitions: [],
        outcome,
        ...meta(),
      },
    ],
    workflows: [
      {
        id: workflowId,
        name: 'Primary workflow',
        actor_ref: `actor.${primaryUser}`,
        steps: [
          {
            operation_ref: `operation.${configureOp}`,
            actor_ref: `actor.${primaryUser}`,
            dependency_refs: ['dependency.auth'],
          },
          {
            operation_ref: `operation.${executeOp}`,
            actor_ref: `actor.${primaryUser}`,
            dependency_refs: [],
          },
        ],
        terminal_outcomes: [outcome, 'Configure failed with recovery'],
        ...meta(),
      },
    ],
    invariants: [
      {
        id: 'owner-only-configure',
        rule: 'Only the primary actor may configure the flow',
        ...meta(),
      },
      {
        id: 'scoped-access',
        rule: 'Actors only see projections they are authorized to access',
        ...meta(),
      },
    ],
    dependencies: [
      {
        id: 'auth',
        type: 'data',
        from: `operation.${configureOp}`,
        to: `entity.${entityId}`,
        unmet_behavior: 'Show recoverable error and keep state pending',
        ...meta('supporting'),
      },
    ],
    surfaces: [
      {
        id: surfaceId,
        name: `${slug} home`,
        purpose: `Inspect ${slug} status and complete the primary flow`,
        primary_actor_refs: [`actor.${primaryUser}`],
        workflow_refs: [`workflow.${workflowId}`],
        operation_refs: [`operation.${configureOp}`, `operation.${executeOp}`],
        contract: ['Show current status', 'Show recovery when blocked'],
        graph_refs: [`promise.${promiseId}`],
        ...meta(),
      },
    ],
    scenarios: [
      {
        id: 'empty-state',
        risk_key: 'empty_state',
        when: { operation_ref: `operation.${executeOp}` },
        given: ['No configuration exists yet'],
        then: ['Empty state explains the next configure step'],
        covers: [`operation.${executeOp}`, 'invariant.scoped-access'],
        ...meta(),
      },
      {
        id: 'failure-recovery',
        risk_key: 'provider_failure',
        when: { operation_ref: `operation.${configureOp}` },
        given: ['Upstream validation returns an error'],
        then: ['State remains pending', 'User sees recoverable error'],
        covers: [`operation.${configureOp}`, `workflow.${workflowId}`],
        ...meta(),
      },
      {
        id: 'permission-denied',
        risk_key: 'permission_denied',
        when: { operation_ref: `operation.${configureOp}` },
        given: [`Actor is ${secondaryUser} not ${primaryUser}`],
        then: ['Configure is denied without changing state'],
        covers: [`operation.${configureOp}`, 'invariant.owner-only-configure', `workflow.${workflowId}`],
        ...meta(),
      },
    ],
    proof_budget: {
      strategy: 'smallest_complete_slice',
      max_critical_promises: 3,
      max_active_operations: 10,
      max_active_workflows: 6,
      max_active_dependencies: 6,
      max_active_surfaces: 6,
      max_proofs: 12,
      rationale: `One ${slug} configure-and-execute slice.`,
    },
    proofs: [
      {
        id: proofId,
        promise_refs: [`promise.${promiseId}`],
        operation_refs: [`operation.${configureOp}`, `operation.${executeOp}`],
        workflow_ref: `workflow.${workflowId}`,
        invariant_refs: ['invariant.scoped-access', 'invariant.owner-only-configure'],
        dependency_refs: ['dependency.auth'],
        surface_refs: [`surface.${surfaceId}`],
        given: ['Primary actor configures then executes the flow'],
        then: [outcome],
        evidence_levels: ['boundary', 'journey'],
        test_requirements: ['restart_or_reload', 'responsive', 'accessibility'],
        action: `Primary actor completes configure then opens ${surfaceId}`,
        authoritative_state: `${entityId}.status=ready and projection refreshed`,
        visible_outcome: outcome,
        recovery: 'On validation failure, state stays pending with retry',
        ...meta(),
      },
    ],
    persona_findings: [],
    traceability: [
      {
        promise_ref: `promise.${promiseId}`,
        graph_refs: [
          `actor.${primaryUser}`,
          `entity.${entityId}`,
          `operation.${configureOp}`,
          `operation.${executeOp}`,
          `workflow.${workflowId}`,
          'invariant.scoped-access',
          `surface.${surfaceId}`,
          'scenario.failure-recovery',
        ],
      },
    ],
    findings: [],
    evidence: [],
  };
}

export function attachPersonaFindings(run, personaIds, users) {
  const refCandidates = [...personaIds, ...users];
  const refs = [];
  for (const id of refCandidates) {
    if (id && !refs.includes(id)) refs.push(id);
    if (refs.length >= 3) break;
  }
  while (refs.length < 2) {
    refs.push(refs.length === 0 ? users[0] || 'primary-user' : 'secondary-user');
  }
  run.persona_findings = refs.slice(0, Math.max(2, Math.min(3, refs.length))).map((id, i) => ({
    id: `pf-${id}`,
    persona_ref: id,
    classification: 'risk',
    finding:
      i === 0
        ? 'Needs confidence the primary flow matches their goals and recovery paths'
        : 'Needs a distinct secondary perspective on shared state, alerts, and recovery',
    source: 'persona_hypothesis',
    severity: i === 0 ? 'high' : 'medium',
  }));
  return run;
}

/** Resolve eval/product workspace even when the agent sets cwd to the skill dir. */
export function findWorkspaceRoot(start = process.cwd()) {
  const skillMarker = start.match(
    /^(.*)\/\.(?:opencode|claude|codex|agents|cursor)\/skills(?:\/|$)/,
  );
  if (skillMarker?.[1] && fs.existsSync(path.join(skillMarker[1], '.lamina'))) {
    return skillMarker[1];
  }
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.lamina', 'business-context.md'))) return dir;
    if (fs.existsSync(path.join(dir, '.lamina', 'personas.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain && (args.includes('--help') || args.includes('-h'))) {
  console.log(`Usage:
  node seed-ready-run.mjs --slug <kebab-slug> --problem "..." --outcome "..." [--users a,b]

Writes .lamina/runs/<slug>/{run.json,run.md,implement.md} under the product workspace.
Passing --help/-h prints this message and does not write any files.`);
  process.exit(0);
}

if (isMain) {
const WORKSPACE = findWorkspaceRoot();
const slug = flag('slug', '');
const problem = flag('problem', 'User needs a coherent product behavior for the requested feature');
const outcome = flag('outcome', 'Users complete the primary flow with clear recovery paths');
const users = flag('users', 'primary-user')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error(
    'Missing/invalid --slug <kebab-slug>. Example: node seed-ready-run.mjs --slug password-reset --problem "..." --outcome "..."',
  );
  process.exit(2);
}

const run = attachPersonaFindings(createReadyRun({ slug, problem, outcome, users }), [], users);
const personasPath = path.join(WORKSPACE, '.lamina/personas.json');
let personaIds = [];
if (fs.existsSync(personasPath)) {
  try {
    const doc = JSON.parse(fs.readFileSync(personasPath, 'utf8'));
    personaIds = (doc.personas || []).map((p) => p.id).filter(Boolean);
    attachPersonaFindings(run, personaIds, users);
  } catch {
    personaIds = [];
  }
}

const fieldErrors = validateRunFields(run, 'run.json', { requireProofPacket: true });
if (fieldErrors.length) {
  console.error(`Seed contract invalid:\n${fieldErrors.join('\n')}`);
  process.exit(4);
}

let implementMd;
try {
  implementMd = renderImplementMarkdown(run);
} catch (error) {
  console.error(`Cannot render implement.md: ${error.message}`);
  process.exit(4);
}

const allowedBrief = `${slug}\n${problem}\n${outcome}`;
const leaks = [
  ...findTemplateLeaks(JSON.stringify(run), allowedBrief),
  ...findTemplateLeaks(implementMd, allowedBrief),
];
if (leaks.length) {
  console.error(`TEMPLATE_LEAK: seed still contains legacy example-domain terms: ${[...new Set(leaks)].join(', ')}`);
  process.exit(5);
}

const outDir = path.join(WORKSPACE, '.lamina/runs', slug);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(run, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'implement.md'), implementMd);
const runMd = `# Run — ${slug}\n\n**Status:** ready_to_build\n\n## Problem\n${problem}\n\n## Outcome\n${outcome}\n\n## Scenarios\nSee \`run.json\` scenarios (empty / failure / permission / boundary).\n`;
fs.writeFileSync(path.join(outDir, 'run.md'), runMd);

console.log(`Seeded ${path.relative(WORKSPACE, outDir) || outDir} (status=${run.status}) workspace=${WORKSPACE}`);
const personaNote =
  personaIds.length > 0
    ? ` Mention persona id(s) from personas.json in your reply: ${personaIds.join(', ')}.`
    : '';
const codingSessionNote =
  ' If the user asked to implement app/source/code in this same turn: refuse app edits and include the exact phrase coding session (separate coding session from implement.md). Never write app.js/src/index.html.';
console.log(
  `Wrote run.json, run.md, implement.md (persona_findings=${run.persona_findings.length}). STOP: do not run graph-tool. Emit ### Domain and invariants, ### Actors and permissions, ### Workflows, ### Scenarios, ### Implement brief, ### Open questions. Mention lamina-edge-cases, flows, edge cases, empty/failure/permission. Also list every run.json checklist id and proof id in the reply (handoff maps).${personaNote}${codingSessionNote}`,
);
}
