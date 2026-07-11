#!/usr/bin/env node
/**
 * Compile LaminaBench tasks into Harbor task directories (control + treatment per task).
 *
 * Usage:
 *   node benchmarks/scripts/harbor-compile.mjs [--tasks task001,task002] [--out benchmarks/harbor/tasks]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { readYamlSync } from './yaml.mjs';
import { stageBenchFixture } from './stage-bench-fixture.mjs';
import { installLaminaSkills } from './bench-skills.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARBOR_ROOT = path.join(ROOT, 'benchmarks/harbor');
const TASKS_SRC = path.join(ROOT, 'benchmarks/tasks');
const GOLDENS_DIR = path.join(ROOT, 'benchmarks/goldens');
const OVERLAY_TREATMENT = path.join(HARBOR_ROOT, 'overlays/treatment');
const SCRIPTS = path.join(ROOT, 'benchmarks/scripts');

const DEPS = ['artifact-contract.mjs', 'bench-clarify.mjs', 'yaml.mjs'];

function parseArgs() {
  const opts = {
    out: path.join(HARBOR_ROOT, 'tasks'),
    tasks: null,
    agent: 'claude-code',
  };
  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1) opts.out = path.resolve(process.argv[outIdx + 1]);
  const tasksIdx = process.argv.indexOf('--tasks');
  if (tasksIdx !== -1) opts.tasks = process.argv[tasksIdx + 1].split(',');
  const agentIdx = process.argv.indexOf('--agent');
  if (agentIdx !== -1) opts.agent = process.argv[agentIdx + 1];
  return opts;
}

function ensureSuite() {
  const suitePath = path.join(ROOT, 'benchmarks/tmp/bench-suite.json');
  if (!fs.existsSync(suitePath)) {
    spawnSync('node', ['benchmarks/scripts/compile-suite.mjs'], { cwd: ROOT, stdio: 'inherit' });
  }
  return JSON.parse(fs.readFileSync(suitePath, 'utf8'));
}

function readInstruction(task) {
  const descPath = path.join(ROOT, task.paths?.description || `benchmarks/tasks/${task.id}/description.md`);
  const ctxPath = path.join(ROOT, task.paths?.context || `benchmarks/tasks/${task.id}/context.md`);
  const description = fs.readFileSync(descPath, 'utf8').trim();
  const context = fs.readFileSync(ctxPath, 'utf8').trim();
  return `${description}\n\n## Context\n\n${context}`.trim();
}

function writeTaskToml(dest, { task, arm, release }) {
  const content = `version = "1.0"

[metadata]
author_name = "LaminaBench"
category = "${task.category}"
difficulty = "hard"
tags = ["lamina", "skillsbench-paired", "${arm}"]
lamina_task_id = "${task.id}"
lamina_arm = "${arm}"
lamina_workflow = "${task.workflow}"

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

function copyVerifierBundle(dest) {
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
}

function buildEnvironmentContext(task, arm, agent) {
  const ctxDir = path.join(ROOT, 'benchmarks/tmp/harbor-build', `${task.id}-${arm}`);
  if (fs.existsSync(ctxDir)) fs.rmSync(ctxDir, { recursive: true, force: true });
  fs.mkdirSync(ctxDir, { recursive: true });

  if (task.fixture) {
    stageBenchFixture(task.fixture, ctxDir);
  }

  if (arm === 'treatment') {
    installLaminaSkills(ctxDir, agent);
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      fs.copyFileSync(path.join(OVERLAY_TREATMENT, name), path.join(ctxDir, name));
    }
  }

  return ctxDir;
}

function writeDockerfile(dest, hasFixtureLayers) {
  const dockerfile = `FROM node:20-bookworm-slim

RUN apt-get update \\
  && apt-get install -y --no-install-recommends ca-certificates git \\
  && rm -rf /var/lib/apt/lists/* \\
  && npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Workspace seed (fixture + treatment overlays)
COPY workspace/ /app/

CMD ["bash"]
`;
  fs.writeFileSync(path.join(dest, 'environment', 'Dockerfile'), dockerfile);
}

function compileHarborTask(task, arm, opts, release) {
  const harborName = `${task.id}-${arm}`;
  const dest = path.join(opts.out, harborName);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.mkdirSync(path.join(dest, 'environment'), { recursive: true });

  const instruction = readInstruction(task);
  fs.writeFileSync(path.join(dest, 'instruction.md'), instruction + '\n');

  writeTaskToml(dest, { task, arm, release });
  copyVerifierBundle(dest);

  const goldenSrc = path.join(GOLDENS_DIR, task.id, 'golden.yaml');
  fs.copyFileSync(goldenSrc, path.join(dest, 'tests', 'golden.yaml'));
  fs.writeFileSync(
    path.join(dest, 'tests', 'task-meta.json'),
    JSON.stringify(
      {
        task_id: task.id,
        arm,
        category: task.category,
        workflow: task.workflow,
        prompt: task.prompt,
        fixture: task.fixture,
      },
      null,
      2
    ) + '\n'
  );

  const workspaceSrc = buildEnvironmentContext(task, arm, opts.agent);
  const workspaceDest = path.join(dest, 'environment', 'workspace');
  fs.cpSync(workspaceSrc, workspaceDest, { recursive: true });
  fs.rmSync(workspaceSrc, { recursive: true, force: true });

  writeDockerfile(dest, Boolean(task.fixture));
  return harborName;
}

function main() {
  const opts = parseArgs();
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  const suite = ensureSuite();
  let tasks = suite.tasks;
  if (opts.tasks) {
    tasks = tasks.filter((t) => opts.tasks.includes(t.id));
  }

  fs.mkdirSync(opts.out, { recursive: true });
  const manifest = { compiled: [], out: opts.out, release: release.release_tag };

  for (const task of tasks) {
    for (const arm of ['control', 'treatment']) {
      const name = compileHarborTask(task, arm, opts, release);
      manifest.compiled.push({ harbor_task: name, task_id: task.id, arm });
      console.log(`  ${name}`);
    }
  }

  fs.writeFileSync(path.join(opts.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nHarbor compile: ${manifest.compiled.length} tasks → ${opts.out}`);
}

main();
