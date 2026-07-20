#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildActionSchema } from '../lib/action-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const corpusRoot = path.join(ROOT, 'benchmarks/corpus');
const tasksRoot = path.join(ROOT, 'benchmarks/harbor/tasks');
const libRoot = path.join(ROOT, 'benchmarks/lib');

const arms = ['direct', 'plan', 'checklist', 'lamina'];

// Matched total agent budget across arms (70 min).
const AGENT_BUDGET_SEC = 4200;

const baselineSteps = [
  { name: 'shape_build', agentTimeout: 2100, verifierTimeout: 60 },
  { name: 'verify_fix', agentTimeout: 2100, verifierTimeout: 60 },
];

const laminaSteps = [
  { name: 'lamina_init', agentTimeout: 600, verifierTimeout: 60 },
  { name: 'lamina_design', agentTimeout: 1100, verifierTimeout: 60 },
  { name: 'implement', agentTimeout: 800, verifierTimeout: 60 },
  { name: 'lamina_verify', agentTimeout: 1100, verifierTimeout: 90 },
  { name: 'fix', agentTimeout: 600, verifierTimeout: 60 },
];

// Risk-capability skills from audit-profiles + core loop. Intentionally excludes
// marketing/research lab skills that do not help thin-slice authority/lifecycle.
const LAMINA_BENCH_SKILLS = [
  'lamina',
  'lamina-init',
  'lamina-design',
  'lamina-verify',
  'lamina-orchestrator',
  'lamina-core',
  'lamina-system-structure',
  'lamina-invariants',
  'lamina-dependencies',
  'lamina-user-modeling',
  'lamina-flow-design',
  'lamina-edge-cases',
  'lamina-error-handling',
  'lamina-business-context',
  'lamina-multi-view-integrity',
  'lamina-task-analysis',
  'lamina-usability-evaluation',
  'lamina-accessibility',
  'lamina-trust',
  'lamina-consistency-guarantees',
  'lamina-idempotency-concurrency',
  'lamina-side-effects',
  'lamina-empty-states',
  'lamina-time-semantics',
  'lamina-feedback-and-status',
  'lamina-forms',
  'lamina-information-architecture',
  'lamina-modularity-boundaries',
  'lamina-tradeoffs',
  'lamina-product-behavior',
  'lamina-content-design',
  'lamina-heuristic-review',
  'lamina-system-traps',
];

const armPrompts = {
  direct: 'Act as a normal coding agent. Do not use Lamina skills or slash commands. Decide what the product needs from the founder brief and implement a runnable thin slice.',
  plan: 'Act as a normal coding agent using a plan-first workflow. Think through the product, write a short plan, then implement. Do not use Lamina skills or slash commands.',
  checklist: 'Act as a normal coding agent. Before building, use this generic product checklist: identify actors and goals; define the happy path and lifecycle states; define permissions and ownership; consider empty, failure, conflict, boundary, and recovery cases; then implement and self-review. Do not use Lamina skills or slash commands.',
  lamina:
    'Use the installed Lamina skills and slash commands fully. Follow Mode B: during `/lamina-*` commands write only under `.lamina/`; implement application source in separate coding turns. ' +
    'Do not skip persona-panel subagents, UI walkthrough capture, risk-skill loads, or authority/lifecycle modeling because this is a benchmark — those are part of how Lamina works.',
};

function stepsForArm(arm) {
  return arm === 'lamina' ? laminaSteps : baselineSteps;
}

function agentTimeoutForArm(arm) {
  const total = stepsForArm(arm).reduce((sum, step) => sum + step.agentTimeout, 0);
  if (total !== AGENT_BUDGET_SEC) {
    throw new Error(`${arm} arm agent budget is ${total}s; expected ${AGENT_BUDGET_SEC}s`);
  }
  return total;
}

function shellQuote(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'";
}

function dockerfile(task) {
  const setup = task.fixture
    ? [
        'rm -rf /app',
        'git clone --depth 1 ' + shellQuote(task.fixture_repo) + ' /app',
        'cd /app && git fetch --depth 1 origin ' + task.fixture_commit + ' && git checkout --detach ' + task.fixture_commit,
      ].join(' && ')
    : 'mkdir -p /app';
  return (
    'FROM node:22-bookworm-slim\n\n' +
    'RUN apt-get update && apt-get install -y --no-install-recommends \\\n' +
    '    bash ca-certificates git jq python3 curl \\\n' +
    '    chromium fonts-liberation fonts-noto-core \\\n' +
    '    && rm -rf /var/lib/apt/lists/*\n' +
    'ENV CHROME_PATH=/usr/bin/chromium\n' +
    'ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium\n' +
    'WORKDIR /app\nRUN ' + setup + '\n'
  );
}

function taskToml(task, arm) {
  const steps = stepsForArm(arm);
  const stepBlocks = steps
    .map(
      (step) =>
        '[[steps]]\n' +
        'name = "' + step.name + '"\n' +
        'min_reward = 0.0\n' +
        '[steps.agent]\n' +
        'timeout_sec = ' + step.agentTimeout + '.0\n' +
        '[steps.verifier]\n' +
        'timeout_sec = ' + step.verifierTimeout + '.0\n'
    )
    .join('\n');

  return (
    'schema_version = "1.3"\n' +
    'multi_step_reward_strategy = "final"\n\n' +
    '[task]\n' +
    'name = "aryaniyaps/' + task.id + '-' + arm + '"\n' +
    'description = "Lamina works behavior benchmark: ' + task.id + ' (' + arm + ')"\n' +
    'authors = [{ name = "LaminaBench" }]\n' +
    'keywords = ["fuzzy-prompt", "product-shaping", "behavior-oracle", "' + arm + '"]\n\n' +
    '[metadata]\n' +
    'benchmark = "lamina-product-shaping"\n' +
    'benchmark_version = "harbor-v4"\n' +
    'task_id = "' + task.id + '"\n' +
    'arm = "' + arm + '"\n' +
    'kind = "' + task.kind + '"\n' +
    'stage = "' + task.stage + '"\n\n' +
    '[agent]\n' +
    'timeout_sec = ' + agentTimeoutForArm(arm) + '.0\n\n' +
    '[environment]\n' +
    'network_mode = "public"\n' +
    'build_timeout_sec = 180.0\n' +
    'workdir = "/app"\n' +
    'os = "linux"\n' +
    'cpus = 4\n' +
    'memory_mb = 8192\n' +
    'storage_mb = 20480\n\n' +
    stepBlocks
  );
}

function selfCheckBlock() {
  return (
    '## Structural self-check (required before finishing this step)\n\n' +
    'Run `node /tests/selfcheck.mjs` and fix until it exits 0.\n\n' +
    'This checks only structural integrity (every published action mutates state; action ids stick; revoke/expire actions change actor projections). ' +
    'It does **not** reveal Harbor golden expects. Do not invent static `project()` keyword stubs.\n'
  );
}

function thinSliceContract(actionSchema) {
  return (
    '## Required thin-slice ship target\n\n' +
    'Build a self-contained product in `/app` with no external services. Use plain HTML/CSS/JavaScript and Node ESM so it runs offline.\n\n' +
    'Required files:\n' +
    '- `index.html`: minimal UI with a `<main>` landmark and controls for the core flow\n' +
    '- `app.mjs`: exports `createInitialState()`, `reduce(state, action)`, and `project(state, actorId)`\n\n' +
    '`reduce()` must be deterministic and side-effect free. **Every published action type must actually mutate domain state** (no silent no-ops). ' +
    '`project()` must return JSON-serializable **actor-scoped** views (permissions/ownership visible as different projections). ' +
    'Lifecycle actions (complete / miss / handoff / expire / revoke) must leave distinct, inspectable state — not UI-only flags.\n\n' +
    '## Published action schema\n\n' +
    actionSchema +
    '\n\n' +
    selfCheckBlock() +
    '\nThe Harbor behavior grader is the sole scored proof oracle. Do not create `product-proof-manifest.json` unless you choose to; it is not scored.\n'
  );
}

function laminaBenchProfile(task) {
  return (
    '## Lamina bench profile (required)\n\n' +
    '- Contract stage: start from **`' + task.stage + '`**. Follow `/lamina-design` stage rules — apply harden-level rigor at in-scope authority, privacy, and lifecycle boundaries without expanding into production auth/infra.\n' +
    '- Delivery posture: in-memory reducer + HTML UI in `/app` (no OAuth, CSRF productization, or server-clock infrastructure). **Still model** actor authority, revoke/deny, private vs shared projections, and lifecycle transitions as first-class `reduce`/`project` behavior — do not drop them because the delivery is a prototype.\n' +
    '- `proof_budget`: use normal design ceilings (≤3 critical promises, ≤10 operations, ≤6 workflows, ≤12 proofs). Budget must cover **every published action type** and each critical multi-actor path; do not shrink below that to look “minimal.”\n' +
    '- Design must run the persona-panel (isolated subagents when available) before `ready_to_build`, and `implement.md` must include acceptance for: each published action mutates state; actor-scoped projections; revoke/expire/deny paths when those actions exist.\n' +
    '- Load supporting skills from `audit-profiles.yaml` when risk signals fire (multi-actor, trust, accessibility, time, empty/error, concurrency). Do not skip required risk skills to keep context small.\n' +
    '- Verify (required full audit — live UI + persona panel):\n' +
    '  1. Serve the product (`index.html` + `app.mjs`) on localhost (e.g. `python3 -m http.server 8765` in `/app`)\n' +
    '  2. Run a **UI / visual walkthrough** per `lamina-orchestrator/patterns/visual-walkthrough.md` — write `.lamina/runs/<run>/walkthrough/` (`index.yaml` with `mode: live_app`, `source: product`, plus step screenshots and/or `.a11y.json` dumps). Chromium is at `/usr/bin/chromium`.\n' +
    '  3. Spawn **isolated persona-panel subagents** (≥2 distinct personas) per `patterns/persona-panel.md` + `prompts/subagents/persona-panel-spawn.md`; merge into `persona_findings[]` (`source: persona_hypothesis`). The agent owns spawning — the Harbor harness does not spawn reviewers for you.\n' +
    '  4. Prioritize findings about missing lifecycle transitions, authority changes, and actor-view divergence; still write `findings[]`, `report.md`, and `fix.md`\n' +
    '- Mode B: during `/lamina-*` write only `.lamina/`; implement or fix app source in the next coding turn. You may Read skills and `.lamina/` freely in coding turns.\n' +
    '- Harbor golden sequences are the scored proof oracle. `product-proof-manifest.json` is optional and unscored — do not burn the step trying to satisfy unmarked suite markers.\n'
  );
}

function laminaStepCommand(phase) {
  const commands = {
    lamina_init:
      'Run **only** `/lamina-init` via the `lamina-init` skill (full establish mode). ' +
      'Write real `business-context.md` + evidence-grounded `personas.json` (≥2 materially distinct personas for multi-actor briefs). ' +
      'Do not run `/lamina-design`, `/lamina-verify`, or implement application code in this step.',
    lamina_design:
      'Run **only** `/lamina-design` via the `lamina-design` skill end-to-end: graph tool create → risk-skill loads → persona-panel subagents → proofs → validate → `ready_to_build` with `implement.md` + `run.md`. ' +
      'Do not implement application code in this step. Do not skip the persona panel or shrink the graph below published actions.',
    implement:
      'Implement the thin slice from the latest `implement.md` in a normal coding turn. ' +
      'You may Read `.lamina/` and supporting skills. **Do not** invoke `/lamina-*` slash commands in this step; write application source (`index.html`, `app.mjs`, etc.).',
    lamina_verify:
      'Run **only** `/lamina-verify` via the `lamina-verify` skill end-to-end.\n\n' +
      'Required verify procedure (do not skip):\n' +
      '1. Load `run.json`, set `status: verifying`.\n' +
      '2. Start a local server for `/app` and capture a **live UI walkthrough** into `.lamina/runs/<run_id>/walkthrough/` (follow `visual-walkthrough.md`; use Chromium at `/usr/bin/chromium` or host browser tools).\n' +
      '3. Spawn **≥2 isolated persona-panel subagents** (Task/Agent tool) using `persona-panel-spawn.md` — one materially distinct persona each; do not inline-fake the panel in the parent turn when subagents are available.\n' +
      '4. Merge structural persona results into `persona_findings[]`, write ticket-shaped `findings[]`, `report.md`, and `fix.md`.\n' +
      '5. Leave application source read-only; write only under `.lamina/`.',
    fix:
      'Apply fixes from the latest `fix.md` in a normal coding turn. You may Read `.lamina/` and supporting skills. ' +
      '**Do not** invoke `/lamina-*` slash commands in this step. Leave the product runnable.',
  };
  return commands[phase] ?? '';
}

function instruction(task, arm, phase) {
  const brief = fs.readFileSync(path.join(corpusRoot, task.brief), 'utf8');
  const actionSchema = buildActionSchema(task.golden);
  const contract = thinSliceContract(actionSchema);

  if (arm === 'lamina') {
    const titles = {
      lamina_init: task.id + ' — lamina init',
      lamina_design: task.id + ' — lamina design',
      implement: task.id + ' — implement',
      lamina_verify: task.id + ' — lamina verify',
      fix: task.id + ' — fix',
    };
    let body = '# ' + titles[phase] + '\n\n' + armPrompts.lamina + '\n\n' + laminaStepCommand(phase) + '\n\n';
    if (phase === 'lamina_init' || phase === 'lamina_design' || phase === 'lamina_verify') {
      body += laminaBenchProfile(task) + '\n\n';
    }
    if (phase === 'implement') {
      body += contract + '\n';
    }
    if (phase === 'fix') {
      body +=
        'Prefer fixing incorrect state, authority, lifecycle, and recovery behavior over visual polish. Do not expand scope.\n\n' +
        selfCheckBlock() +
        '\n';
    }
    if (phase !== 'fix') {
      body += '## Founder brief\n\n' + brief + '\n\n';
    }
    if (phase === 'implement') {
      body += 'Do not wait for clarification: this is unattended work. Ship a coherent thin slice, not a broad feature list.\n';
    }
    if (phase === 'fix') {
      body += '## Founder brief\n\n' + brief + '\n';
    }
    return body;
  }

  if (phase === 'shape_build') {
    return (
      '# ' + task.id + ' — shape and build\n\n' +
      armPrompts[arm] +
      '\n\n## Founder brief\n\n' +
      brief +
      '\n\n' +
      contract +
      '\nDo not wait for clarification: this is unattended work. Ship a coherent thin slice, not a broad feature list.\n'
    );
  }

  return (
    '# ' + task.id + ' — verify and fix\n\n' +
    'Self-review behavior against the founder brief and action schema. Test permissions, invalid transitions, and recovery. Fix the highest-value issues and leave the product runnable.\n\n' +
    selfCheckBlock() +
    '\n## Founder brief\n\n' +
    brief +
    '\n\nDo not expand scope. Prefer fixing incorrect state, authority, lifecycle, and recovery behavior over visual polish.\n'
  );
}

/** Actions + actors only — never expect / must_not_include (agent-readable). */
function publicGolden(golden) {
  return {
    sequences: (golden.sequences ?? []).map((sequence) => ({
      actor: sequence.actor,
      actions: (sequence.actions ?? []).map((action) => {
        const copy = { ...action };
        delete copy.expect;
        delete copy.expects;
        delete copy.must_not_include;
        return copy;
      }),
    })),
  };
}

function selfcheckSource(task) {
  return `#!/usr/bin/env node
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

// Public actions only — graded expect substrings are intentionally omitted.
const golden = ${JSON.stringify(publicGolden(task.golden))};
const result = await runBehaviorSelfcheck({ root: '/app', golden });
if (!result.ok) {
  console.error('Structural self-check FAILED:');
  for (const error of result.errors) console.error(' - ' + error);
  process.exit(1);
}
console.log('Structural self-check passed.');
`;
}

function graderSource(task, arm, phase) {
  const midPhase = arm === 'lamina' ? 'implement' : 'shape_build';
  // Opaque payload so casual reads of /tests/grade.mjs do not expose expect substrings.
  const encoded = Buffer.from(JSON.stringify(task.golden), 'utf8').toString('base64');
  return `#!/usr/bin/env node
import fs from 'node:fs';
import { gradeBehavior } from './behavior-grade.mjs';

const golden = JSON.parse(Buffer.from(${JSON.stringify(encoded)}, 'base64').toString('utf8'));
const arm = ${JSON.stringify(arm)};
const phase = ${JSON.stringify(phase)};
const taskId = ${JSON.stringify(task.id)};

const result = await gradeBehavior({ root: '/app', golden, arm, phase, taskId });
const harborRewards = {
  reward: result.reward,
  behavior: result.scores?.behavior ?? 0,
  import_ok: result.scores?.import ?? 0,
};
if (result.invalid_treatment) harborRewards.reward = 0;

fs.mkdirSync('/logs/verifier', { recursive: true });
fs.writeFileSync('/logs/verifier/reward.json', JSON.stringify(harborRewards, null, 2) + '\\n');
fs.writeFileSync('/logs/verifier/behavior_report.json', JSON.stringify(result, null, 2) + '\\n');
if (phase === ${JSON.stringify(midPhase)}) {
  fs.writeFileSync('/logs/verifier/mid_behavior.json', JSON.stringify({ behavior_pass_rate: result.behavior_pass_rate, sequences: result.sequences }, null, 2) + '\\n');
}
console.log(JSON.stringify(result));
`;
}

function writeTask(task, arm) {
  const dir = path.join(tasksRoot, task.id + '-' + arm);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'environment'), { recursive: true });
  const behaviorGrade = fs.readFileSync(path.join(libRoot, 'behavior-grade.mjs'), 'utf8');
  const behaviorSelfcheck = fs.readFileSync(path.join(libRoot, 'behavior-selfcheck.mjs'), 'utf8');
  const steps = stepsForArm(arm);
  const codingSteps = new Set(['shape_build', 'verify_fix', 'implement', 'fix']);

  for (const step of steps) {
    const stepDir = path.join(dir, 'steps', step.name, 'tests');
    fs.mkdirSync(stepDir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'steps', step.name, 'instruction.md'), instruction(task, arm, step.name));
    fs.writeFileSync(
      path.join(stepDir, 'test.sh'),
      '#!/usr/bin/env bash\nset -euo pipefail\nnode /tests/grade.mjs\n'
    );
    fs.chmodSync(path.join(stepDir, 'test.sh'), 0o755);
    fs.writeFileSync(path.join(stepDir, 'grade.mjs'), graderSource(task, arm, step.name));
    fs.writeFileSync(path.join(stepDir, 'behavior-grade.mjs'), behaviorGrade);
    if (codingSteps.has(step.name)) {
      fs.writeFileSync(path.join(stepDir, 'behavior-selfcheck.mjs'), behaviorSelfcheck);
      fs.writeFileSync(path.join(stepDir, 'selfcheck.mjs'), selfcheckSource(task));
    }
  }

  fs.writeFileSync(path.join(dir, 'task.toml'), taskToml(task, arm));
  fs.writeFileSync(path.join(dir, 'environment/Dockerfile'), dockerfile(task));
}

const manifest = JSON.parse(fs.readFileSync(path.join(corpusRoot, 'manifest.json'), 'utf8'));
fs.mkdirSync(tasksRoot, { recursive: true });
for (const entry of fs.readdirSync(tasksRoot, { withFileTypes: true })) {
  fs.rmSync(path.join(tasksRoot, entry.name), { recursive: true, force: true });
}
for (const task of manifest.tasks) {
  for (const arm of arms) writeTask(task, arm);
}

const datasetDir = path.join(ROOT, 'benchmarks/harbor/dataset');
fs.mkdirSync(datasetDir, { recursive: true });
fs.writeFileSync(
  path.join(datasetDir, 'dataset.toml'),
  '[dataset]\n' +
    'name = "aryaniyaps/lamina-product-shaping"\n' +
    'description = "Harbor v4: prove Lamina works via behavior oracle and treatment gates"\n' +
    'keywords = ["fuzzy-prompt", "product-design", "behavior-oracle", "lamina-loop"]\n\n' +
    '[[dataset.authors]]\n' +
    'name = "LaminaBench"\n'
);

const skillsManifest = {
  version: 'harbor-v4',
  skills: LAMINA_BENCH_SKILLS,
};
fs.writeFileSync(path.join(ROOT, 'benchmarks/corpus/lamina-bench-skills.json'), JSON.stringify(skillsManifest, null, 2) + '\n');

const laminaCount = manifest.tasks.length;
const baselineCount = manifest.tasks.length * 3;
console.log(
  'Generated ' +
    manifest.tasks.length * arms.length +
    ' Harbor v4 tasks: ' +
    baselineCount +
    ' baseline (2-step) + ' +
    laminaCount +
    ' lamina (5-step) across ' +
    arms.length +
    ' matched arms.'
);
