#!/usr/bin/env node
/**
 * Sync Harbor benchmark tasks: refresh workspaces (fixtures/skills), verifier bundle, registry.
 * Canonical task source: benchmarks/harbor/tasks/{taskNNN}-{control|treatment}/
 *
 * Usage:
 *   node benchmarks/scripts/harbor-sync.mjs [--tasks task001,task002]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { readYamlSync } from './yaml.mjs';
import { stageBenchFixture } from './stage-bench-fixture.mjs';
import { installLaminaSkills } from './bench-skills.mjs';
import {
  HARBOR_TASKS_DIR,
  harborPath,
  loadRegistry,
  loadRegistryBySuite,
} from './harbor-tasks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARBOR_ROOT = path.join(ROOT, 'benchmarks/harbor');
const GOLDENS_DIR = path.join(ROOT, 'benchmarks/goldens');
const VERIFIER_SRC = path.join(HARBOR_ROOT, 'verifier');
const HARBOR_TASK_ORG = 'aryaniyaps';

function parseArgs() {
  const opts = {
    tasks: null,
    agent: 'codex',
    suite: null,
    arm: null,
    testsOnly: process.argv.includes('--tests-only'),
  };
  const tasksIdx = process.argv.indexOf('--tasks');
  if (tasksIdx !== -1) opts.tasks = process.argv[tasksIdx + 1].split(',');
  const agentIdx = process.argv.indexOf('--agent');
  if (agentIdx !== -1) opts.agent = process.argv[agentIdx + 1];
  const suiteIdx = process.argv.indexOf('--suite');
  if (suiteIdx !== -1) opts.suite = process.argv[suiteIdx + 1];
  const armIdx = process.argv.indexOf('--arm');
  if (armIdx !== -1) opts.arm = process.argv[armIdx + 1];
  return opts;
}

function writeTaskToml(dest, { task, arm, release }) {
  const fixtureLine = task.fixture == null ? '' : `lamina_fixture = "${task.fixture}"\n`;
  const taskName = `${HARBOR_TASK_ORG}/${task.id}-${arm}`;
  const description = `LaminaBench ${task.id} ${arm} arm (${task.category})`;
  const content = `schema_version = "1.3"
artifacts = []

[task]
name = "${taskName}"
description = "${description}"
authors = [{ name = "LaminaBench" }]
keywords = ["lamina", "ecological-matched-phases", "${arm}", "${task.category}"]

[metadata]
author_name = "LaminaBench"
category = "${task.category}"
difficulty = "hard"
tags = ["lamina", "ecological-matched-phases", "${arm}"]
lamina_task_id = "${task.id}"
lamina_arm = "${arm}"
lamina_workflow = "${task.workflow}"
${fixtureLine}
[verifier]
timeout_sec = ${release.verifier_timeout_sec || 180}.0
collect = []

[verifier.env]
LAMINA_BENCH_RUN = "\${LAMINA_BENCH_RUN}"

[agent]
timeout_sec = ${release.agent_timeout_sec || 600}.0

[environment]
network_mode = "public"
build_timeout_sec = 300.0
os = "linux"
cpus = 2
memory_mb = 4096
storage_mb = 10240
mcp_servers = []

[environment.env]

[solution.env]
`;
  fs.writeFileSync(path.join(dest, 'task.toml'), content);
}

function writeDockerfile(dest) {
  fs.writeFileSync(
    path.join(dest, 'environment', 'Dockerfile'),
    `FROM node:20-bookworm-slim

RUN apt-get update \\
  && apt-get install -y --no-install-recommends ca-certificates git jq python3 \\
  && rm -rf /var/lib/apt/lists/* \\
  && npm install -g @openai/codex

WORKDIR /app

COPY workspace/ /app/

CMD ["bash"]
`
  );
}

function rmPath(target) {
  if (!fs.existsSync(target)) return;
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err) {
    if (err?.code === 'EBUSY' || err?.errno === -4094 || err?.code === 'EACCES' || err?.code === '') {
      spawnSync('chmod', ['-R', 'u+rwX', target], { stdio: 'ignore' });
      const shellRm = spawnSync('rm', ['-rf', target], { stdio: 'ignore' });
      if (shellRm.status === 0 && !fs.existsSync(target)) return;
      // Leftover sandbox bind-mounts (e.g. skills/*/evals/evals.json) can make
      // recursive rm fail. Delete everything we can; leave busy nodes in place.
      bestEffortClear(target);
      return;
    }
    throw err;
  }
}

/** Depth-first delete; skip EBUSY/EACCES nodes so sync can proceed. */
function bestEffortClear(target) {
  if (!fs.existsSync(target)) return;
  let st;
  try {
    st = fs.lstatSync(target);
  } catch {
    return;
  }
  if (st.isDirectory() && !st.isSymbolicLink()) {
    for (const name of fs.readdirSync(target)) {
      bestEffortClear(path.join(target, name));
    }
  }
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // leave busy mount / permission-denied node
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function buildJudgeContext(task, golden) {
  const lines = [
    '# LaminaBench judge context',
    '',
    '## Task description',
    task.prompt || task.id,
    '',
    '## Behavioral reference checklist',
    'Use as a **rubric for product behavior**, not a phrase hunt.',
    'Credit implemented behavior (types, handlers, UI, validation, filters, empty/error states).',
    'Do **not** require checklist id strings or slogan comments.',
    'Negations/bans: absence or explicit rejection counts — the ban phrase need not appear.',
    'Trade-offs/a11y: look for chosen behavior and accessible hooks, not snake_case labels.',
    'Cite evidence (path/symbol/control) in criterion reasoning.',
    '',
  ];
  for (const [field, items] of Object.entries(golden)) {
    if (!field.startsWith('required_') || !Array.isArray(items) || !items.length) continue;
    lines.push(`### ${field}`);
    for (const item of items) lines.push(`- ${item}`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

function copyVerifierBundle(dest, task, arm, release) {
  const testsDir = path.join(dest, 'tests');
  if (fs.existsSync(testsDir)) rmPath(testsDir);
  copyDirRecursive(VERIFIER_SRC, testsDir);
  fs.chmodSync(path.join(testsDir, 'test.sh'), 0o755);
  fs.chmodSync(path.join(testsDir, 'run_rewardkit.sh'), 0o755);
  fs.chmodSync(path.join(testsDir, 'subscription_judge.py'), 0o755);
  fs.chmodSync(path.join(testsDir, 'capture_artifact.py'), 0o755);
  fs.chmodSync(path.join(testsDir, 'finalize_reward.py'), 0o755);

  const golden = readYamlSync(path.join(GOLDENS_DIR, task.id, 'golden.yaml'));
  fs.copyFileSync(path.join(GOLDENS_DIR, task.id, 'golden.yaml'), path.join(testsDir, 'golden.yaml'));
  fs.writeFileSync(path.join(testsDir, 'judge-context.md'), buildJudgeContext(task, golden));
  fs.writeFileSync(
    path.join(testsDir, 'task-meta.json'),
    JSON.stringify(
      {
        task_id: task.id,
        arm,
        category: task.category,
        workflow: task.workflow,
        prompt: task.prompt,
        fixture: task.fixture ?? null,
      },
      null,
      2
    ) + '\n'
  );

  // Remove legacy Node verifier artifacts if present from prior syncs.
  for (const legacy of ['harbor-score.mjs', 'deps', 'artifact']) {
    rmPath(path.join(testsDir, legacy));
  }
  const matchedPhased = path.join(testsDir, 'matched-phased-agent.sh');
  if (fs.existsSync(matchedPhased)) fs.chmodSync(matchedPhased, 0o755);

  // Keep the documented judge model aligned with release.yaml.
  const judgeToml = path.join(testsDir, 'llm_judge', 'product-behavior.toml');
  if (fs.existsSync(judgeToml) && release?.llm_judges?.[0]) {
    const judgeModel = String(release.llm_judges[0]).replace(/^openai:/, 'openai/');
    let text = fs.readFileSync(judgeToml, 'utf8');
    text = text.replace(/^judge\s*=\s*".*"/m, `judge = "${judgeModel}"`);
    fs.writeFileSync(judgeToml, text);
  }
}

function buildWorkspace(task, arm, agent) {
  const ctxDir = path.join(ROOT, 'benchmarks/tmp/harbor-build', `${task.id}-${arm}`);
  rmPath(ctxDir);
  fs.mkdirSync(ctxDir, { recursive: true });
  if (task.fixture) stageBenchFixture(task.fixture, ctxDir);
  // The benchmark is Codex-only; do not carry fixture-local configuration for
  // another coding-agent host into either arm.
  rmPath(path.join(ctxDir, '.claude'));
  // Treatment: install Lamina skills only. No workflow overlay —
  // the harness sends /lamina-* user messages; skills carry Mode B behavior.
  if (arm === 'treatment') {
    installLaminaSkills(ctxDir, agent);
  }
  return ctxDir;
}

function syncHarborTask(task, arm, opts, release) {
  const dest = harborPath(task.id, arm);
  fs.mkdirSync(path.join(dest, 'environment'), { recursive: true });

  if (!fs.existsSync(path.join(dest, 'instruction.md'))) {
    throw new Error(`Missing ${dest}/instruction.md — Harbor task must include instruction.md`);
  }

  writeTaskToml(dest, { task, arm, release });
  writeDockerfile(dest);
  copyVerifierBundle(dest, task, arm, release);

  if (opts.testsOnly) return;

  const workspaceDest = path.join(dest, 'environment', 'workspace');
  rmPath(workspaceDest);
  const workspaceSrc = buildWorkspace(task, arm, opts.agent);
  fs.cpSync(workspaceSrc, workspaceDest, { recursive: true });
  rmPath(workspaceSrc);
}

/**
 * Rebuild a single (task, arm) workspace from fixture + skills.
 * Call before every trial so --runs N replications are independent.
 */
export function refreshTrialWorkspace(taskId, arm, { agent = 'codex' } = {}) {
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  const task = loadRegistry().find((t) => t.id === taskId);
  if (!task) throw new Error(`Unknown task id for workspace refresh: ${taskId}`);
  if (arm !== 'control' && arm !== 'treatment') {
    throw new Error(`Invalid arm for workspace refresh: ${arm}`);
  }
  syncHarborTask(task, arm, { agent, testsOnly: false }, release);
}

function main() {
  const opts = parseArgs();
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  let tasks = opts.suite ? loadRegistryBySuite(opts.suite) : loadRegistry();
  if (opts.tasks) tasks = tasks.filter((t) => opts.tasks.includes(t.id));
  const arms = opts.arm ? [opts.arm] : ['control', 'treatment'];

  fs.mkdirSync(HARBOR_TASKS_DIR, { recursive: true });
  for (const task of tasks) {
    for (const arm of arms) {
      syncHarborTask(task, arm, opts, release);
      console.log(`  synced ${task.id}-${arm}`);
    }
  }
  console.log(`\nHarbor sync: ${tasks.length * arms.length} task dirs refreshed`);
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main();
}
