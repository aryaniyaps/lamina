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
import { fileURLToPath } from 'url';
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
const OVERLAY_TREATMENT = path.join(HARBOR_ROOT, 'overlays/treatment');
const VERIFIER_SRC = path.join(HARBOR_ROOT, 'verifier');
const HARBOR_TASK_ORG = 'aryaniyaps';

function parseArgs() {
  const opts = { tasks: null, agent: 'claude-code', suite: null, testsOnly: process.argv.includes('--tests-only') };
  const tasksIdx = process.argv.indexOf('--tasks');
  if (tasksIdx !== -1) opts.tasks = process.argv[tasksIdx + 1].split(',');
  const agentIdx = process.argv.indexOf('--agent');
  if (agentIdx !== -1) opts.agent = process.argv[agentIdx + 1];
  const suiteIdx = process.argv.indexOf('--suite');
  if (suiteIdx !== -1) opts.suite = process.argv[suiteIdx + 1];
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
timeout_sec = ${release.verifier_timeout_sec || 600}.0
collect = []

[verifier.env]
ANTHROPIC_API_KEY = "\${ANTHROPIC_API_KEY}"
ANTHROPIC_AUTH_TOKEN = "\${ANTHROPIC_AUTH_TOKEN}"
ANTHROPIC_BASE_URL = "\${ANTHROPIC_BASE_URL}"
REWARDKIT_JUDGE = "\${REWARDKIT_JUDGE}"
LAMINA_BENCH_RUN = "\${LAMINA_BENCH_RUN}"

[agent]
timeout_sec = ${release.agent_timeout_sec || 5400}.0

[environment]
network_mode = "public"
build_timeout_sec = 1800.0
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
  && apt-get install -y --no-install-recommends ca-certificates curl git python3 python3-venv \\
  && rm -rf /var/lib/apt/lists/* \\
  && npm install -g @anthropic-ai/claude-code \\
  && node "$(npm root -g)/@anthropic-ai/claude-code/install.cjs" \\
  && curl -LsSf https://astral.sh/uv/install.sh | sh

ENV PATH="/root/.local/bin:\${PATH}"

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
    if (err?.code === 'EBUSY' || err?.errno === -4094 || err?.code === 'EACCES') {
      spawnSync('chmod', ['-R', 'u+rwX', target], { stdio: 'ignore' });
      const shellRm = spawnSync('rm', ['-rf', target], { stdio: 'ignore' });
      if (shellRm.status === 0) return;
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
      return;
    }
    throw err;
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
    '## Golden reference checklist',
    'Concepts to look for in code; identifiers, comments, logic, and tests all count.',
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

function copyVerifierBundle(dest, task, arm) {
  const testsDir = path.join(dest, 'tests');
  if (fs.existsSync(testsDir)) rmPath(testsDir);
  copyDirRecursive(VERIFIER_SRC, testsDir);
  fs.chmodSync(path.join(testsDir, 'test.sh'), 0o755);
  fs.chmodSync(path.join(testsDir, 'run_rewardkit.sh'), 0o755);
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
}

function readOverlay(name) {
  return fs.readFileSync(path.join(OVERLAY_TREATMENT, name), 'utf8').trimEnd();
}

/** Prepend Lamina overlay; preserve upstream OSS AGENTS.md/CLAUDE.md body below a separator. */
function applyTreatmentOverlay(ctxDir, name) {
  const destPath = path.join(ctxDir, name);
  const overlay = readOverlay(name);
  if (fs.existsSync(destPath)) {
    const existing = fs.readFileSync(destPath, 'utf8').trim();
    fs.writeFileSync(destPath, `${overlay}\n\n---\n\n${existing}\n`);
  } else {
    fs.writeFileSync(destPath, `${overlay}\n`);
  }
}

function buildWorkspace(task, arm, agent) {
  const ctxDir = path.join(ROOT, 'benchmarks/tmp/harbor-build', `${task.id}-${arm}`);
  rmPath(ctxDir);
  fs.mkdirSync(ctxDir, { recursive: true });
  if (task.fixture) stageBenchFixture(task.fixture, ctxDir);
  if (arm === 'treatment') {
    installLaminaSkills(ctxDir, agent);
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      applyTreatmentOverlay(ctxDir, name);
    }
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
  copyVerifierBundle(dest, task, arm);

  if (opts.testsOnly) return;

  const workspaceDest = path.join(dest, 'environment', 'workspace');
  rmPath(workspaceDest);
  const workspaceSrc = buildWorkspace(task, arm, opts.agent);
  fs.cpSync(workspaceSrc, workspaceDest, { recursive: true });
  rmPath(workspaceSrc);
}

function main() {
  const opts = parseArgs();
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  let tasks = opts.suite ? loadRegistryBySuite(opts.suite) : loadRegistry();
  if (opts.tasks) tasks = tasks.filter((t) => opts.tasks.includes(t.id));

  fs.mkdirSync(HARBOR_TASKS_DIR, { recursive: true });
  for (const task of tasks) {
    for (const arm of ['control', 'treatment']) {
      syncHarborTask(task, arm, opts, release);
      console.log(`  synced ${task.id}-${arm}`);
    }
  }
  console.log(`\nHarbor sync: ${tasks.length * 2} task dirs refreshed`);
}

main();
