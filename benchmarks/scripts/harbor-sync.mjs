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
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';
import { stageBenchFixture } from './stage-bench-fixture.mjs';
import { installLaminaSkills } from './bench-skills.mjs';
import {
  HARBOR_TASKS_DIR,
  harborPath,
  loadRegistry,
  writeRegistry,
} from './harbor-tasks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARBOR_ROOT = path.join(ROOT, 'benchmarks/harbor');
const GOLDENS_DIR = path.join(ROOT, 'benchmarks/goldens');
const OVERLAY_TREATMENT = path.join(HARBOR_ROOT, 'overlays/treatment');
const SCRIPTS = path.join(ROOT, 'benchmarks/scripts');
const DEPS = ['artifact-contract.mjs', 'bench-clarify.mjs', 'yaml.mjs'];

function parseArgs() {
  const opts = { tasks: null, agent: 'claude-code' };
  const tasksIdx = process.argv.indexOf('--tasks');
  if (tasksIdx !== -1) opts.tasks = process.argv[tasksIdx + 1].split(',');
  const agentIdx = process.argv.indexOf('--agent');
  if (agentIdx !== -1) opts.agent = process.argv[agentIdx + 1];
  return opts;
}

function writeTaskToml(dest, { task, arm, release }) {
  const taskTomlPath = path.join(dest, 'task.toml');
  if (fs.existsSync(taskTomlPath) && fs.readFileSync(taskTomlPath, 'utf8').includes('[task]')) {
    return;
  }
  const fixtureLine =
    task.fixture == null ? '' : `lamina_fixture = "${task.fixture}"\n`;
  const content = `version = "1.0"

[metadata]
author_name = "LaminaBench"
category = "${task.category}"
difficulty = "hard"
tags = ["lamina", "skillsbench-paired", "${arm}"]
lamina_task_id = "${task.id}"
lamina_arm = "${arm}"
lamina_workflow = "${task.workflow}"
${fixtureLine}
[verifier]
timeout_sec = ${release.verifier_timeout_sec || 600}.0

[agent]
timeout_sec = ${release.agent_timeout_sec || 5400}.0

[environment]
build_timeout_sec = 1800.0
cpus = 2
memory = "4G"
storage = "10G"
allow_internet = true
`;
  fs.writeFileSync(path.join(dest, 'task.toml'), content);
}

function writeDockerfile(dest) {
  fs.writeFileSync(
    path.join(dest, 'environment', 'Dockerfile'),
    `FROM node:20-bookworm-slim

RUN apt-get update \\
  && apt-get install -y --no-install-recommends ca-certificates git \\
  && rm -rf /var/lib/apt/lists/* \\
  && npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY workspace/ /app/

CMD ["bash"]
`
  );
}

function copyVerifierBundle(dest, task, arm) {
  const testsDir = path.join(dest, 'tests');
  const depsDir = path.join(testsDir, 'deps');
  fs.mkdirSync(depsDir, { recursive: true });
  for (const file of DEPS) {
    fs.copyFileSync(path.join(SCRIPTS, file), path.join(depsDir, file));
  }
  fs.copyFileSync(path.join(SCRIPTS, 'harbor-score.mjs'), path.join(testsDir, 'harbor-score.mjs'));
  fs.writeFileSync(
    path.join(testsDir, 'test.sh'),
    `#!/bin/bash
set -euo pipefail
node /tests/harbor-score.mjs --workspace /app --golden /tests/golden.yaml --meta /tests/task-meta.json --out /logs/verifier/reward.json
`
  );
  fs.chmodSync(path.join(testsDir, 'test.sh'), 0o755);
  fs.copyFileSync(path.join(GOLDENS_DIR, task.id, 'golden.yaml'), path.join(testsDir, 'golden.yaml'));
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
  if (fs.existsSync(ctxDir)) fs.rmSync(ctxDir, { recursive: true, force: true });
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

  const workspaceDest = path.join(dest, 'environment', 'workspace');
  if (fs.existsSync(workspaceDest)) fs.rmSync(workspaceDest, { recursive: true, force: true });
  const workspaceSrc = buildWorkspace(task, arm, opts.agent);
  fs.cpSync(workspaceSrc, workspaceDest, { recursive: true });
  fs.rmSync(workspaceSrc, { recursive: true, force: true });
}

function main() {
  const opts = parseArgs();
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  let tasks = loadRegistry();
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
