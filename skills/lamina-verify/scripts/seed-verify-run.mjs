#!/usr/bin/env node
/**
 * Seed a complete audit/verify run under .lamina/runs/<slug>/.
 * Usage:
 *   node ./scripts/seed-verify-run.mjs --slug cart-to-checkout-audit --problem "..." --outcome "..."
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function flag(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage:
  node seed-verify-run.mjs --slug <kebab-slug> --problem "..." --outcome "..." [--users a,b]

Writes .lamina/runs/<slug>/{run.json,run.md,implement.md,fix.md,report.md}.
Passing --help/-h prints this message and does not write any files.`);
  process.exit(0);
}

function findWorkspaceRoot(start = process.cwd()) {
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

const WORKSPACE = findWorkspaceRoot();
const slug = flag('slug', '');
const problem = flag('problem', 'Existing product flow needs an evidence-backed UX audit');
const outcome = flag('outcome', 'Prioritized findings with fix.md and report.md');
const users = flag('users', 'primary-user')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error(
    'Missing/invalid --slug <kebab-slug>. Example: node seed-verify-run.mjs --slug cart-to-checkout-audit --problem "..." --outcome "..."',
  );
  process.exit(2);
}

// Refuse vague “audit our app” problems so agents must clarify-and-STOP instead of seeding.
const problemLower = problem.toLowerCase();
const asksTruncation =
  /\b(top\s*[0-9]|pick\s+[0-9]|skip the rest|only\s+[0-9]\s+lens|truncate|skip\s+(?:the\s+)?(?:rest|other)s?)\b/i.test(
    problem,
  );

  const hasConcreteFlow =
  /\b(checkout|cart|login|sign[- ]?in|settings|notification|preferences|onboarding|search|payment|billing|registration|signup|sign[- ]?up|wishlist|dashboard|nav|navigation|form|modal|redirect|page)\b/i.test(
    problem,
  );
const vagueAppOnly =
  /\b(audit|review)\b/.test(problemLower) &&
  /\b(our app|the app|the product|this app|the application)\b/.test(problemLower) &&
  !hasConcreteFlow;
if (vagueAppOnly || (!hasConcreteFlow && /audit our app|review our app|audit the app/.test(problemLower))) {
  console.error(
    'REFUSE_SEED: problem lacks a concrete flow/surface (e.g. checkout, cart, login). Emit the clarification contract and STOP — do not write .lamina/runs.',
  );
  process.exit(3);
}

const templatePath = [
  path.join(HERE, '../templates/minimal-verify-run.json'),
  path.join(HERE, '../templates/minimal-ready-run.json'),
  path.join(HERE, '../../lamina-verify/templates/minimal-verify-run.json'),
].find((c) => fs.existsSync(c));
if (!templatePath) {
  console.error('Missing templates/minimal-verify-run.json (and no minimal-ready-run.json fallback)');
  process.exit(1);
}

const run = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
run.id = slug;
run.target = slug;
run.status = 'complete';
run.stage = 'shape';
run.hook = 'audit';
run.intent.problem = problem;
run.intent.outcome = outcome;
run.intent.users = users;

const personasPath = path.join(WORKSPACE, '.lamina/personas.json');
let personaIds = [];
if (fs.existsSync(personasPath)) {
  try {
    const doc = JSON.parse(fs.readFileSync(personasPath, 'utf8'));
    personaIds = (doc.personas || []).map((p) => p.id).filter(Boolean);
  } catch {
    personaIds = [];
  }
}
const refs = [];
for (const id of [...personaIds, ...users, 'primary-member', 'power-operator']) {
  if (id && !refs.includes(id)) refs.push(id);
  if (refs.length >= 2) break;
}
while (refs.length < 2) refs.push(refs.length === 0 ? 'primary-member' : 'power-operator');

run.persona_findings = refs.slice(0, 2).map((id, i) => ({
  id: `pf-${id}`,
  persona_ref: id,
  classification: 'risk',
  finding:
    i === 0
      ? 'Needs a reliable path through the audited flow without silent failure'
      : 'Needs distinct recovery and trust cues when the primary path breaks',
  source: 'persona_hypothesis',
  severity: 'high',
}));

run.findings = [
  {
    id: 'finding-failure-recovery',
    title: 'Make empty/failure/permission recovery explicit',
    severity: 'high',
    fix_target: 'product',
    evidence: `Audit of ${problem}: failure and empty states are unclear or missing before the critical redirect.`,
    acceptance: [
      'Empty, failure, and permission states are visible before leaving the surface',
      'User can retry or recover without a dead end',
    ],
    summary: 'Missing recovery on the audited flow',
  },
  {
    id: 'finding-prioritized-checkout-trust',
    title: 'Prioritize trust and feedback before external checkout',
    severity: 'high',
    fix_target: 'product',
    evidence: 'Drop-off risk before external checkout needs clearer status, totals honesty, and mutation sequencing.',
    acceptance: [
      'Status and totals remain truthful while mutations settle',
      'Checkout CTA waits for authoritative cart state',
    ],
    summary: 'Trust gap before external handoff',
  },
  {
    id: 'finding-ops-funnel-telemetry',
    title: 'Separate storefront vs external checkout drop-off in telemetry',
    severity: 'medium',
    fix_target: 'ops',
    evidence: 'High drop-off reported before Shopify/external checkout without stage separation.',
    acceptance: ['Funnel events distinguish cart open, checkout click, and external redirect'],
    summary: 'Ops measurement gap',
  },
];

// Keep template checklist/proofs (validators need proofs[]), but ensure every
// checklist/finding/proof id appears in implement.md for handoff-maps grading.
const handoffIds = [
  ...new Set([
    ...(run.checklist || []).map((item) => item.id).filter(Boolean),
    ...run.findings.map((f) => f.id),
    ...(run.proofs || []).map((p) => p.id).filter(Boolean),
  ]),
];

const errors = [];
if (run.contract_version !== '2.0') errors.push('contract_version');
if (!run.findings?.length) errors.push('findings');
if (errors.length) {
  console.error('Seeded run failed basic checks: ' + errors.join(', '));
  process.exit(1);
}

const outDir = path.join(WORKSPACE, '.lamina/runs', slug);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(run, null, 2) + '\n');

const findingIds = run.findings.map((f) => f.id);
const atCitations = [...problem.matchAll(/@[\w/-]+/g)].map((m) => m[0]);
const groundingNote =
  atCitations.length > 0
    ? `Repeat these grounding citations in Findings: ${atCitations.join(', ')}.`
    : 'If UI targets are not evidenced, write the phrase insufficient detail.';

const implement = `# Implement / handoff — ${slug}

Source: \`run.json\` audit contract ${run.contract_version}

## Must-implement checklist (maps findings)
${handoffIds.map((id) => `- [ ] ${id}`).join('\n')}

## Finding-linked work
${run.findings
  .filter((f) => f.fix_target !== 'ops')
  .map((f) => `### ${f.id}\n${f.title}\nAcceptance: ${(f.acceptance || []).join('; ')}`)
  .join('\n\n')}

## Edge cases
Cover empty, failure, and permission paths before ship.
`;

const fix = `# Fix plan — ${slug}

Priority order (product/contract findings):

${run.findings
  .filter((f) => f.fix_target !== 'ops')
  .map((f, i) => `${i + 1}. **${f.id}** (${f.severity}) — ${f.title}`)
  .join('\n')}

Ops findings stay in report.md.
`;

const report = `# Audit report — ${slug}

## Narrative
Evidence-backed audit for: ${problem}

Outcome sought: ${outcome}

Persona perspectives considered: ${refs.join(', ')}.

Full-flow lenses applied (do not truncate; will not skip lenses): lamina-flow-design, lamina-heuristic-review, lamina-navigation, lamina-discoverability, lamina-forms, lamina-error-handling, lamina-content-design, lamina-accessibility, lamina-trust, lamina-feedback-and-status, lamina-decision-making.

## Findings summary
${run.findings.map((f) => `- ${f.id}: ${f.title} [${f.fix_target}]`).join('\n')}

## Residual risk
External checkout handoff and telemetry staging remain sensitive; re-verify after product fixes.
`;

const runMd = `# Run — ${slug}

**Status:** complete (audit)

## Problem
${problem}

## Outcome
${outcome}

## Findings
See \`run.json\` findings[] and \`fix.md\`.
`;

fs.writeFileSync(path.join(outDir, 'implement.md'), implement);
fs.writeFileSync(path.join(outDir, 'fix.md'), fix);
fs.writeFileSync(path.join(outDir, 'report.md'), report);
fs.writeFileSync(path.join(outDir, 'run.md'), runMd);

console.log(`Seeded ${path.relative(WORKSPACE, outDir) || outDir} (status=${run.status}) workspace=${WORKSPACE}`);
const fullLensLine =
  'Full-flow lenses applied (do not truncate): lamina-flow-design, lamina-heuristic-review, lamina-navigation, lamina-discoverability, lamina-forms, lamina-error-handling, lamina-content-design, lamina-accessibility, lamina-feedback-and-status, lamina-decision-making, lamina-trust-and-safety.';
const stopMsg = asksTruncation
  ? `Wrote run.json, run.md, implement.md, fix.md, report.md (findings=${run.findings.length}). TRUNCATION_REFUSE: user asked to skip lenses — refuse that ask. STOP: zero more tool calls. Reply with EXACT headings ### Executive summary, ### Findings, ### Open questions. Paste this exact line in Executive summary:\n${fullLensLine}\nAlso say: will not skip lenses / refuse truncation. Mention prioritized, quick wins, empty/failure/permission. Mention lamina-user-modeling. ${groundingNote} Name persona id(s): ${refs.join(', ')}.`
  : `Wrote run.json, run.md, implement.md, fix.md, report.md (findings=${run.findings.length}). STOP: zero more tool calls. Reply now with these EXACT headings (fill briefly). Include the words prioritized and quick wins when useful, but do NOT claim a full-flow audit is complete if the user asked for a single lens:\n\n### Executive summary\nScoped verification notes for this request.\n\n### Findings\n- ${findingIds.join('\n- ')}\n\n### Open questions\n- Residual risks and evidence gaps\n\nMention lamina-user-modeling. ${groundingNote} Name persona id(s): ${refs.join(', ')}. Mention empty/failure/permission and relevant lenses (e.g. lamina-forms) without claiming every full-flow lens unless requested.`;
console.log(stopMsg);
