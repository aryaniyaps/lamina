#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPublicActionSchema,
  publicGolden,
  writeTextFile,
} from '../lib/public-golden.mjs';
import {
  assertBuildSelectionAllowed,
  parseMigrateFrozen,
  parseSelectedTaskIds,
  publishedFrozenTaskIds,
} from '../lib/frozen-tasks.mjs';
import {
  AGENT_BUDGET_SEC,
  AGENT_RUNTIME_IMAGE,
  BASELINE_STEPS,
  BENCHMARK_VERSION,
  DEVELOPMENT_FLAGS,
  HARBOR_AGENT,
  HARBOR_MODEL,
  HARBOR_VERSION,
  CURSOR_CLI_VERSION,
  LAMINA_BENCH_SKILLS,
  LAMINA_STEPS,
  MEASUREMENT_CONTRACT,
  PILOT_ARMS,
  PINNED_SKILL_COMMIT,
  REQUIRED_PERSONA_CHILDREN,
  SKILL_RERUN_CAMPAIGN_ID,
} from '../lib/constants.mjs';
import {
  stageSkillBundleFromWorkingTree,
  verifyStagedSkillBundle,
} from '../lib/skill-bundle.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '../../../..');

function pilotBuildPaths(root = DEFAULT_ROOT) {
  const pilotRoot = path.join(root, 'benchmarks/lb6/pilot');
  return {
    root,
    pilotRoot,
    corpusRoot: path.join(pilotRoot, 'corpus'),
    tasksRoot: path.join(pilotRoot, 'harbor/tasks-v3'),
    privateVerifierRoot: path.join(pilotRoot, 'private-verifier-v3'),
    libRoot: path.join(root, 'benchmarks/lib'),
    pilotLibRoot: path.join(pilotRoot, 'lib'),
    runtimeRoot: path.join(pilotRoot, 'runtime'),
  };
}

function loadPilotManifest(corpusRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(corpusRoot, 'manifest.json'), 'utf8'));
  if (manifest.version !== BENCHMARK_VERSION) {
    throw new Error(`expected manifest.version=${BENCHMARK_VERSION}`);
  }
  if (!manifest.development_only || manifest.confirmatory !== false) {
    throw new Error('pilot manifest must declare development_only=true and confirmatory=false');
  }
  return manifest;
}

const LAMINA_BENCH_SKILLS_LOCAL = LAMINA_BENCH_SKILLS;

const armPrompts = {
  direct:
    'Act as a normal coding agent. Do not use Lamina skills or slash commands. Decide what the product needs from the founder brief and implement a runnable thin slice.',
  plan:
    'Act as a normal coding agent using a plan-first workflow. Think through the product, write a short plan, then implement. Do not use Lamina skills or slash commands.',
  lamina:
    'Use the installed Lamina skills and slash commands fully. Follow Mode B: during `/lamina-*` commands write only under `.lamina/`; implement application source in separate coding turns. ' +
    'Do not skip persona-panel native Task children, risk-skill loads, or authority/lifecycle modeling because this is a development pilot — those are part of how Lamina works.',
};

function stepsForArm(arm) {
  return arm === 'lamina' ? LAMINA_STEPS : BASELINE_STEPS;
}

function finalStepForArm(arm) {
  return arm === 'lamina' ? 'fix' : 'verify_fix';
}

function agentTimeoutForArm(arm) {
  const total = stepsForArm(arm).reduce((sum, step) => sum + step.agentTimeout, 0);
  if (total !== AGENT_BUDGET_SEC) {
    throw new Error(`${arm} arm agent budget is ${total}s; expected ${AGENT_BUDGET_SEC}s`);
  }
  return total;
}

function dockerfile() {
  return (
    'FROM node:22-bookworm-slim\n\n' +
    'RUN apt-get update && apt-get install -y --no-install-recommends \\\n' +
    '    bash ca-certificates git jq python3 curl \\\n' +
    '    chromium fonts-liberation fonts-noto-core \\\n' +
    '    && rm -rf /var/lib/apt/lists/*\n' +
    'RUN curl -LsSf https://astral.sh/uv/install.sh | sh\n' +
    'ENV PATH="/root/.local/bin:${PATH}"\n' +
    'ENV CHROME_PATH=/usr/bin/chromium\n' +
    'ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium\n' +
    `COPY cursor-agent-version/ /root/.local/share/cursor-agent/versions/${CURSOR_CLI_VERSION}/\n` +
    `RUN mkdir -p /root/.local/bin && ln -s /root/.local/share/cursor-agent/versions/${CURSOR_CLI_VERSION}/cursor-agent /root/.local/bin/cursor-agent\n` +
    'WORKDIR /app\nRUN mkdir -p /app\n'
  );
}

function taskToml(task, arm) {
  const steps = stepsForArm(arm);
  const finalStep = finalStepForArm(arm);
  const stepBlocks = steps
    .map((step) => {
      const isFinal = step.name === finalStep;
      // Task-level artifacts already collects `/app/.lamina` every step; only add app files on final.
      const stepArtifacts = isFinal
        ? 'artifacts = ["/app/app.mjs", "/app/index.html", "/app/ui.mjs", "/app/styles.css"]\n'
        : '';
      return (
        '[[steps]]\n' +
        `name = "${step.name}"\n` +
        'min_reward = 0.0\n' +
        stepArtifacts +
        '[steps.agent]\n' +
        `timeout_sec = ${step.agentTimeout}.0\n` +
        '[steps.verifier]\n' +
        `timeout_sec = ${step.verifierTimeout}.0\n`
      );
    })
    .join('\n');

  return (
    'schema_version = "1.3"\n' +
    'multi_step_reward_strategy = "final"\n' +
    // Issue #18: collect Lamina artifacts on every Harbor step.
    'artifacts = ["/app/.lamina"]\n\n' +
    '[task]\n' +
    `name = "aryaniyaps/${task.id}-${arm}-v3"\n` +
    `description = "LB6 development pilot: ${task.id} (${arm}) — RewardKit LLM judge; not claim-ready LaminaBench-6"\n` +
    'authors = [{ name = "LaminaBench" }]\n' +
    `keywords = ["fuzzy-prompt", "development-pilot", "lb6", "${arm}", "rewardkit"]\n\n` +
    '[metadata]\n' +
    'benchmark = "lamina-lb6-pilot"\n' +
    `benchmark_version = "${BENCHMARK_VERSION}"\n` +
    `campaign_id = "${SKILL_RERUN_CAMPAIGN_ID}"\n` +
    `task_id = "${task.id}"\n` +
    `arm = "${arm}"\n` +
    `kind = "${task.kind}"\n` +
    `stage = "${task.stage}"\n` +
    `development_only = ${DEVELOPMENT_FLAGS.development_only}\n` +
    `confirmatory = ${DEVELOPMENT_FLAGS.confirmatory}\n` +
    `child_actual_model_unverified = ${DEVELOPMENT_FLAGS.child_actual_model_unverified}\n` +
    // Issue #18: stock Harbor + RewardKit (no host-sealed custom fork).
    'host_sealed_supervisor_required = false\n' +
    `measurement_contract = "${MEASUREMENT_CONTRACT}"\n` +
    `harbor_version = "${HARBOR_VERSION}"\n` +
    `agent = "${HARBOR_AGENT}"\n` +
    `model = "${HARBOR_MODEL}"\n\n` +
    '[agent]\n' +
    `timeout_sec = ${agentTimeoutForArm(arm)}.0\n\n` +
    '[verifier]\n' +
    'timeout_sec = 300.0\n\n' +
    '[verifier.env]\n' +
    'OPENAI_API_KEY = "${OPENAI_API_KEY}"\n' +
    'REWARDKIT_JUDGE = "${REWARDKIT_JUDGE}"\n' +
    'LITELLM_DROP_PARAMS = "1"\n\n' +
    '[environment]\n' +
    `docker_image = "${AGENT_RUNTIME_IMAGE}"\n` +
    'network_mode = "public"\n' +
    'build_timeout_sec = 180.0\n' +
    'workdir = "/app"\n' +
    'os = "linux"\n' +
    'cpus = 2\n' +
    'memory_mb = 4096\n' +
    'storage_mb = 10240\n\n' +
    stepBlocks
  );
}

function selfCheckBlock() {
  return (
    '## Structural self-check (required before finishing this step)\n\n' +
    'Run `node /app/.lb6-abi/selfcheck.mjs` and fix until it exits 0.\n\n' +
    'This checks only structural integrity (every published action mutates state; action ids stick; revoke/expire actions change actor projections). ' +
    'It does **not** reveal hidden behavior assertions.\n'
  );
}

function thinSliceContract(actionSchema, projectionContract) {
  return (
    '## Required thin-slice ship target\n\n' +
    'Build a self-contained product in `/app` with no external services. Use plain HTML/CSS/JavaScript and Node ESM so it runs offline.\n\n' +
    'Required files (these are what the judge scores — do **not** ship a parallel `app.js`):\n' +
    '- `index.html`: minimal UI with a `<main>` landmark and controls for the core flow\n' +
    '- `app.mjs`: exports `createInitialState()`, `reduce(state, action)`, and `project(state, actorId)`\n' +
    '- `ui.mjs` (recommended): browser UI that imports from `app.mjs` — do not put domain rules only in the DOM layer\n\n' +
    '`reduce()` must be deterministic and side-effect free. **Every published action type must actually mutate domain state** (no silent no-ops). ' +
    '`project()` must return JSON-serializable **actor-scoped** views.\n\n' +
    '## Product-quality bar (beyond selfcheck)\n\n' +
    '- Enforce authority and illegal transitions **inside `reduce`** (not only by hiding buttons in the UI).\n' +
    '- Reject unknown ids / empty payloads; do not autovivify phantom domain records.\n' +
    '- Cover failure, empty, and recovery paths that the founder brief implies.\n' +
    '- Prefer durable invariants from design artifacts over comment slogans.\n\n' +
    '## Published action schema\n\n' +
    actionSchema +
    '\n\n' +
    '## Published typed projection contract\n\n' +
    'The verifier checks the following structured behavior contract. Equivalent values listed here are accepted; arbitrary UI wording is not graded.\n\n' +
    '```json\n' + JSON.stringify(projectionContract ?? {}, null, 2) + '\n```\n\n' +
    'Final scoring uses Harbor RewardKit LLM-as-judge (no hardcoded semantic rubric). Keep the product coherent and runnable.\n\n' +
    selfCheckBlock()
  );
}

function laminaImplementQualityBlock() {
  return (
    '## Lamina implement mandate\n\n' +
    'Translate `.lamina/` design (`implement.md`, personas, authority/lifecycle notes) into the **published ABI files** above.\n' +
    '- Write `/app/app.mjs` (+ `ui.mjs` / `index.html` / `styles.css` as needed). **Never** create `/app/app.js` as the product.\n' +
    '- Run `node /app/.lb6-abi/selfcheck.mjs` until it exits 0 before finishing this step.\n' +
    '- Spend the budget on domain correctness in `reduce`/`project`, not a throwaway non-ABI prototype.\n'
  );
}

function shapingContract() {
  return (
    '## Pre-ABI shaping target\n\n' +
    'Build the next coherent, self-contained offline product in `/app` using plain HTML/CSS/JavaScript. ' +
    'Timebox the work: ship a deliberately small thin slice, use at most `index.html`, `styles.css`, and one application JavaScript file, and finish the response within six minutes. ' +
    'Include an `index.html` with a `<main>` landmark and enough real interaction to express the product you shaped. Do not start a server, browser, watcher, or background process. ' +
    'Do not search for or infer a benchmark API, hidden test, action vocabulary, or evaluator contract; none is available in this phase.\n'
  );
}

function developmentProvenanceBlock() {
  return (
    '## Development-only persona provenance envelope\n\n' +
    'This pilot accepts Cursor native `taskToolCall` metadata in the parent session when independent child `system.init` events are unavailable:\n\n' +
    '- parent `system.init.model = Composer 2.5`\n' +
    '- native `taskToolCall` with child `agentId`\n' +
    '- requested child model `composer-2.5`\n' +
    '- successful completion, duration, and conversation steps\n\n' +
    `Record \`child_actual_model_unverified: true\`. This pilot cannot satisfy the claim-ready LaminaBench-6 native-child contract.\n`
  );
}

function laminaPersonaBlock() {
  return (
    '## Required native persona Task children\n\n' +
    `Spawn **≥${REQUIRED_PERSONA_CHILDREN} materially distinct personas** using Cursor's native Task/subagent tool (\`taskToolCall\`), not parent-authored simulation. ` +
    'Each child must run on requested `composer-2.5`. Preserve child `agentId`, success, duration, and conversation steps in the run record.\n\n' +
    developmentProvenanceBlock()
  );
}

function laminaBenchProfile(task) {
  return (
    '## Lamina development pilot profile\n\n' +
    `- Contract stage: start from **\`${task.stage}\`**. Model authority, privacy, and lifecycle boundaries in \`reduce\`/\`project\`.\n` +
    '- Delivery posture: in-memory reducer + HTML UI in `/app`.\n' +
    '- Design must run the persona-panel via native Task children before `ready_to_build`.\n' +
    '- Mode B: during `/lamina-*` write only `.lamina/`; implement app source in coding turns.\n' +
    laminaPersonaBlock()
  );
}

function laminaStepCommand(phase) {
  const commands = {
    lamina_init:
      'Run **only** `/lamina-init` via the `lamina-init` skill. ' +
      'Write real `business-context.md` + evidence-grounded `personas.json` (≥2 materially distinct personas). ' +
      'Do not implement application code in this step.',
    lamina_design:
      'Run **only** `/lamina-design` via the `lamina-design` skill end-to-end through `ready_to_build` with `implement.md`. ' +
      `Spawn **≥${REQUIRED_PERSONA_CHILDREN} native Task persona children** during design — do not inline-fake the panel in parent text when Task is available. ` +
      'In `implement.md`, specify reducer-enforced authority, illegal-state bans, and edge/recovery paths the next coding step must ship in `app.mjs` (not UI-only).',
    implement:
      'Implement the **published ABI** (`app.mjs` / `ui.mjs`) from the latest `implement.md` in a normal coding turn. ' +
      'You may Read `.lamina/` and supporting skills. **Do not** invoke `/lamina-*` slash commands in this step. ' +
      'Do not build a non-ABI `app.js` prototype first.',
    fix:
      'Harden the already-shipped ABI product using the latest design artifacts. ' +
      'Fix authority gaps, edge/recovery paths, and runtime bugs in `app.mjs`/`ui.mjs`. Leave the product runnable. ' +
      '**Do not** rewrite from scratch or invent a parallel `app.js`. **Do not** invoke `/lamina-*` slash commands in this step.',
  };
  return commands[phase] ?? '';
}

function instruction(task, arm, phase, ctx) {
  const brief = fs.readFileSync(path.join(ctx.corpusRoot, task.brief), 'utf8').replace(/\n+$/u, '');
  const actionSchema = buildPublicActionSchema(task.golden);
  const contract = thinSliceContract(actionSchema, task.projection_contract);

  if (arm === 'lamina') {
    const titles = {
      lamina_init: `${task.id} — lamina init`,
      lamina_design: `${task.id} — lamina design`,
      implement: `${task.id} — implement`,
      fix: `${task.id} — fix`,
    };
    let body =
      `# ${titles[phase]}\n\n` +
      `${armPrompts.lamina}\n\n` +
      `${laminaStepCommand(phase)}\n\n`;
    if (phase === 'lamina_init' || phase === 'lamina_design') {
      body += `${laminaBenchProfile(task)}\n\n`;
    }
    // Ship the judged ABI during implement (not only in fix) so design time converts to product code.
    if (phase === 'implement') {
      body += `${contract}\n`;
      body += `${laminaImplementQualityBlock()}\n`;
    }
    if (phase === 'fix') body += `${contract}\n`;
    if (phase !== 'fix') body += `## Founder brief\n\n${brief}\n\n`;
    else body += `## Founder brief\n\n${brief}\n\n`;
    if (phase === 'implement' || phase === 'fix') {
      body += 'Do not wait for clarification: this is unattended development-pilot work.\n';
    }
    return writeTextFile('', body);
  }

  if (phase === 'shape_build') {
    return writeTextFile(
      '',
      `# ${task.id} — shape and build\n\n` +
        `${armPrompts[arm]}\n\n` +
        `## Founder brief\n\n${brief}\n\n` +
        `${shapingContract()}\n` +
        'Do not wait for clarification: this is unattended development-pilot work.\n',
    );
  }

  return writeTextFile(
    '',
    `# ${task.id} — verify and fix\n\n` +
      'The host supervisor has sealed the shaping snapshot. Implement the newly injected public ABI, self-review behavior against the founder brief, and leave the product runnable.\n\n' +
      `${contract}\n` +
      `## Founder brief\n\n${brief}\n\n` +
      'Do not expand scope. Prefer fixing incorrect state, authority, lifecycle, and recovery behavior.\n',
  );
}

function publicGoldenForTask(task) {
  return publicGolden(task.golden);
}

function selfcheckSource(task) {
  return `#!/usr/bin/env node
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

const golden = ${JSON.stringify(publicGoldenForTask(task))};
const result = await runBehaviorSelfcheck({ root: '/app', golden });
if (!result.ok) {
  console.error('Structural self-check FAILED:');
  for (const error of result.errors) console.error(' - ' + error);
  process.exit(1);
}
console.log('Structural self-check passed.');
`;
}

function structuralGradeSource(task, arm, phase) {
  const isLamina = arm === 'lamina';
  return `#!/usr/bin/env node
import fs from 'node:fs';
import { checkPilotLaminaTreatment } from './pilot-treatment.mjs';
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

const golden = ${JSON.stringify(publicGoldenForTask(task))};
const arm = ${JSON.stringify(arm)};
const phase = ${JSON.stringify(phase)};

let reward = 0;
let importOk = 0;
let behavior = 0;
let invalidTreatment = false;
let treatment = { valid: true, missing: [] };
let selfcheck = { ok: false, errors: ['app not built yet'] };

if (${JSON.stringify(['shape_build', 'implement', 'fix', 'verify_fix'].includes(phase))}) {
  try {
    selfcheck = await runBehaviorSelfcheck({ root: '/app', golden });
    importOk = 1;
    behavior = selfcheck.ok ? 1 : 0;
    reward = selfcheck.ok ? 1 : 0;
  } catch {
    selfcheck = { ok: false, errors: ['app.mjs not importable yet'] };
  }
}

if (arm === 'lamina') {
  treatment = checkPilotLaminaTreatment('/app', phase);
  invalidTreatment = !treatment.valid;
  if (invalidTreatment) reward = 0;
}

const result = {
  reward,
  scores: { import: importOk, behavior },
  arm,
  phase,
  measurement: 'structural_only',
  invalid_treatment: invalidTreatment,
  treatment,
  selfcheck,
  development_only: true,
  confirmatory: false,
  child_actual_model_unverified: true,
};

fs.mkdirSync('/logs/verifier', { recursive: true });
fs.writeFileSync('/logs/verifier/reward.json', JSON.stringify({ reward, behavior, import_ok: importOk }, null, 2) + '\\n');
fs.writeFileSync('/logs/verifier/structural_report.json', JSON.stringify(result, null, 2) + '\\n');
if (!selfcheck.ok && ${JSON.stringify(['shape_build', 'implement'].includes(phase))}) process.exit(1);
if (invalidTreatment && ${JSON.stringify(['lamina_init', 'lamina_design'].includes(phase))}) process.exit(1);
console.log(JSON.stringify(result));
`;
}

function finalGradeSource(task, arm, phase) {
  const encoded = Buffer.from(JSON.stringify(task.golden), 'utf8').toString('base64');
  return `#!/usr/bin/env node
import fs from 'node:fs';
import { gradePilotBehavior } from './pilot-behavior-grade.mjs';

const golden = JSON.parse(Buffer.from(${JSON.stringify(encoded)}, 'base64').toString('utf8'));
const arm = ${JSON.stringify(arm)};
const phase = ${JSON.stringify(phase)};
const taskId = ${JSON.stringify(task.id)};

const result = await gradePilotBehavior({ root: '/candidate', treatmentRoot: '/treatment', golden, arm, phase, taskId });
const harborRewards = {
  reward: result.reward,
  measurement: result.measurement,
  reward_transform: result.reward_transform,
  behavior: result.scores?.behavior ?? 0,
  raw_behavior: result.raw_behavior ?? 0,
  earned: result.earned ?? 0,
  possible: result.possible ?? 0,
  measurement_invalid: result.measurement_invalid ?? false,
  measurement_invalid_reason: result.measurement_invalid_reason ?? null,
  import_ok: result.scores?.import ?? 0,
};
if (result.invalid_treatment || result.measurement_invalid) harborRewards.reward = 0;

fs.mkdirSync('/output', { recursive: true });
fs.writeFileSync('/output/reward.json', JSON.stringify(harborRewards, null, 2) + '\\n');
fs.writeFileSync('/output/behavior_report.json', JSON.stringify(result, null, 2) + '\\n');
console.log(JSON.stringify(result));
`;
}

function publicAbi(task) {
  return {
    contract_version: 'lb6-pilot-semantic-abi-v3',
    task_id: task.id,
    action_schema_markdown: buildPublicActionSchema(task.golden),
    projection_contract: task.projection_contract ?? null,
    scoring_protocol: {
      behavior_points: 10,
      raw_score: 'earned / 10',
      valid_reward: '(earned + 1) / 12',
      determinism: 'hard measurement-validity gate',
    },
    public_sequences: publicGoldenForTask(task),
  };
}

function loadRewardkitTemplates(ctx) {
  const rewardkitRoot = path.join(ctx.pilotLibRoot, 'rewardkit');
  const contextsRoot = path.join(ctx.pilotLibRoot, 'llm-judge', 'judge-contexts');
  return {
    judgeToml: fs.readFileSync(path.join(rewardkitRoot, 'judge.toml'), 'utf8'),
    promptMd: fs.readFileSync(path.join(rewardkitRoot, 'prompt.md'), 'utf8'),
    testFinal: fs.readFileSync(path.join(rewardkitRoot, 'test-final.sh'), 'utf8'),
    testPass: fs.readFileSync(path.join(rewardkitRoot, 'test-pass.sh'), 'utf8'),
    contextsRoot,
  };
}

function writeTask(task, arm, ctx) {
  const dir = path.join(ctx.tasksRoot, `${task.id}-${arm}-v3`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'environment'), { recursive: true });

  const behaviorSelfcheck = fs.readFileSync(path.join(ctx.libRoot, 'behavior-selfcheck.mjs'), 'utf8');
  const templates = loadRewardkitTemplates(ctx);
  const briefPath = path.join(ctx.corpusRoot, task.brief || `${task.id}/brief.md`);
  const brief = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, 'utf8') : `# ${task.id}\n`;
  const contextExtraPath = path.join(templates.contextsRoot, `${task.id}.md`);
  const contextExtra = fs.existsSync(contextExtraPath)
    ? fs.readFileSync(contextExtraPath, 'utf8')
    : '';
  const judgeContext = `${brief.trim()}\n\n${contextExtra.trim()}\n`.trim() + '\n';

  const steps = stepsForArm(arm);
  const finalStep = finalStepForArm(arm);

  for (const step of steps) {
    const stepDir = path.join(dir, 'steps', step.name, 'tests');
    fs.mkdirSync(stepDir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'steps', step.name, 'instruction.md'), instruction(task, arm, step.name, ctx));
    const isFinal = step.name === finalStep;
    if (isFinal) {
      fs.writeFileSync(path.join(stepDir, 'test.sh'), templates.testFinal);
      fs.writeFileSync(path.join(stepDir, 'judge.toml'), templates.judgeToml);
      fs.writeFileSync(path.join(stepDir, 'prompt.md'), templates.promptMd);
      fs.writeFileSync(path.join(stepDir, 'judge-context.md'), judgeContext);
    } else {
      fs.writeFileSync(path.join(stepDir, 'test.sh'), templates.testPass);
    }
    fs.chmodSync(path.join(stepDir, 'test.sh'), 0o755);
  }

  // Keep public ABI/selfcheck as agent aids only — not the claim verifier (issue #18).
  // For lamina, inject ABI on implement (primary ship) and fix (harden), not only on the final step.
  const abiSteps =
    arm === 'lamina' ? ['implement', finalStep] : [finalStep];
  for (const abiStep of [...new Set(abiSteps)]) {
    const abiDir = path.join(dir, 'steps', abiStep, 'workdir', '.lb6-abi');
    fs.mkdirSync(abiDir, { recursive: true });
    fs.writeFileSync(path.join(abiDir, 'public-abi.json'), `${JSON.stringify(publicAbi(task), null, 2)}\n`);
    fs.writeFileSync(path.join(abiDir, 'selfcheck.mjs'), selfcheckSource(task));
    fs.writeFileSync(path.join(abiDir, 'behavior-selfcheck.mjs'), behaviorSelfcheck);
  }

  // Remove obsolete private verifier fixtures for rebuilt tasks.
  const privateDir = path.join(ctx.privateVerifierRoot, task.id, arm);
  fs.rmSync(privateDir, { recursive: true, force: true });

  fs.writeFileSync(path.join(dir, 'task.toml'), taskToml(task, arm));
  fs.writeFileSync(path.join(dir, 'environment/Dockerfile'), dockerfile());
}

export { parseSelectedTaskIds } from '../lib/frozen-tasks.mjs';

export function buildPilot({ root = DEFAULT_ROOT, selectedTaskIds = null, migrateFrozen = false } = {}) {
  const ctx = pilotBuildPaths(root);
  const manifest = loadPilotManifest(ctx.corpusRoot);
  const allTasks = manifest.tasks;
  if (!allTasks.length) {
    throw new Error('lb6 pilot manifest must declare at least one task');
  }
  const allTaskIds = allTasks.map((task) => task.id);
  if (new Set(allTaskIds).size !== allTaskIds.length) {
    throw new Error('lb6 pilot manifest contains duplicate task ids');
  }
  const frozenTaskIds = publishedFrozenTaskIds(manifest);
  const frozenSet = new Set(frozenTaskIds);

  const selective = Array.isArray(selectedTaskIds) && selectedTaskIds.length > 0;
  if (selective) {
    assertBuildSelectionAllowed(selectedTaskIds, manifest, { migrateFrozen });
  }

  const tasksToBuild = selective
    ? allTasks.filter((task) => selectedTaskIds.includes(task.id))
    : allTasks.filter((task) => !frozenSet.has(task.id));

  if (selective) {
    for (const taskId of selectedTaskIds) {
      if (!allTaskIds.includes(taskId)) {
        throw new Error(`selected task not present in manifest: ${taskId}`);
      }
    }
  }

  fs.mkdirSync(ctx.tasksRoot, { recursive: true });
  fs.mkdirSync(ctx.runtimeRoot, { recursive: true });
  fs.writeFileSync(path.join(ctx.runtimeRoot, 'Dockerfile'), writeTextFile('', dockerfile()));

  if (!selective) {
    fs.mkdirSync(ctx.privateVerifierRoot, { recursive: true });
    for (const entry of fs.readdirSync(ctx.tasksRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const taskId = PILOT_ARMS.reduce((found, arm) => {
        if (found) return found;
        return entry.name.endsWith(`-${arm}-v3`)
          ? entry.name.slice(0, -(`-${arm}-v3`.length))
          : null;
      }, null);
      if (taskId && frozenSet.has(taskId)) continue;
      fs.rmSync(path.join(ctx.tasksRoot, entry.name), { recursive: true, force: true });
    }
    for (const entry of fs.readdirSync(ctx.privateVerifierRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && frozenSet.has(entry.name)) continue;
      fs.rmSync(path.join(ctx.privateVerifierRoot, entry.name), { recursive: true, force: true });
    }
  } else {
    fs.mkdirSync(ctx.privateVerifierRoot, { recursive: true });
    for (const task of tasksToBuild) {
      for (const arm of PILOT_ARMS) {
        fs.rmSync(path.join(ctx.tasksRoot, `${task.id}-${arm}-v3`), { recursive: true, force: true });
        fs.rmSync(path.join(ctx.privateVerifierRoot, task.id, arm), { recursive: true, force: true });
      }
    }
  }

  for (const task of tasksToBuild) {
    for (const arm of PILOT_ARMS) writeTask(task, arm, ctx);
  }

  // Issue #18: always restage the full repo skills/ set into the lamina arm env.
  const skillBundle = stageSkillBundleFromWorkingTree(ctx.root, {
    skillNames: [...LAMINA_BENCH_SKILLS],
    sourceSkillCommit: PINNED_SKILL_COMMIT,
    requirePinnedMatch: false,
    write: true,
  });
  const verified = verifyStagedSkillBundle(ctx.root, skillBundle.manifest);
  if (!verified.ok) {
    throw new Error(`skill bundle failed verification after restage: ${verified.reason}`);
  }
  if (skillBundle.manifest.skills.length < 50) {
    throw new Error(
      `expected ~60 staged skills for issue #18; got ${skillBundle.manifest.skills.length}`,
    );
  }

  if (!selective) {
    fs.writeFileSync(
      path.join(ctx.pilotRoot, 'package.manifest-v3.json'),
      writeTextFile(
        '',
        JSON.stringify(
          {
            kind: 'lb6-dev-pilot-package',
            benchmark_version: BENCHMARK_VERSION,
            campaign_id: SKILL_RERUN_CAMPAIGN_ID,
            pinned_skill_commit: PINNED_SKILL_COMMIT,
            skill_bundle_digest: skillBundle.manifest.aggregate_digest,
            harbor_version: HARBOR_VERSION,
            agent: HARBOR_AGENT,
            model: HARBOR_MODEL,
            ...DEVELOPMENT_FLAGS,
            task_ids: allTaskIds,
            arms: [...PILOT_ARMS],
            attempts_per_arm: manifest.attempts_per_arm ?? 1,
            agent_budget_sec: AGENT_BUDGET_SEC,
            skills: [...LAMINA_BENCH_SKILLS_LOCAL],
            not_claim_ready: true,
            distinct_from: 'lamina-bench-6',
          },
          null,
          2,
        ),
      ),
    );
  }

  return {
    selective,
    builtTaskIds: tasksToBuild.map((task) => task.id),
    preservedTaskIds: selective
      ? allTaskIds.filter((id) => !selectedTaskIds.includes(id))
      : frozenTaskIds,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const selectedTaskIds = parseSelectedTaskIds();
  const migrateFrozen = parseMigrateFrozen();
  const result = buildPilot({ selectedTaskIds, migrateFrozen });

  console.log(
    `${result.selective ? 'Selectively generated' : 'Generated'} ${result.builtTaskIds.length} tasks × ${PILOT_ARMS.length} arms ` +
      `(${result.builtTaskIds.length * PILOT_ARMS.length} Harbor cells) ` +
      `(${BASELINE_STEPS.length}-step baseline, ${LAMINA_STEPS.length}-step lamina) ` +
      `with ${AGENT_BUDGET_SEC}s matched agent budget.` +
      (result.preservedTaskIds.length ? ` Preserved: ${result.preservedTaskIds.join(', ')}.` : ''),
  );
}
