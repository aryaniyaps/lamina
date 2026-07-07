#!/usr/bin/env node
/**
 * LaminaBench runner: control vs treatment agent executions.
 * Usage: node benchmarks/scripts/run-bench.mjs [--mock] [--pilot] [--tasks id1,id2] [--runs N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { stageBenchFixture } from './stage-bench-fixture.mjs';
import { readYamlSync } from './yaml.mjs';
import { invokeAgent, isAgentAvailable } from '../../evals/scripts/invoke-agent.mjs';
import { listWorkspaceFiles } from '../../evals/scripts/workspace-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');
const SKILLS_SRC = path.join(ROOT, 'skills');

function parseArgs() {
  const opts = {
    mock: process.argv.includes('--mock'),
    pilot: process.argv.includes('--pilot'),
    tasks: null,
    runs: null,
    agent: null,
  };
  const tasksIdx = process.argv.indexOf('--tasks');
  if (tasksIdx !== -1) opts.tasks = process.argv[tasksIdx + 1].split(',');
  const runsIdx = process.argv.indexOf('--runs');
  if (runsIdx !== -1) opts.runs = Number(process.argv[runsIdx + 1]);
  const agentIdx = process.argv.indexOf('--agent');
  if (agentIdx !== -1) opts.agent = process.argv[agentIdx + 1];
  return opts;
}

function loadSuite() {
  const suitePath = path.join(ROOT, 'benchmarks/tmp/bench-suite.json');
  if (!fs.existsSync(suitePath)) {
    spawnSync('node', ['benchmarks/scripts/compile-suite.mjs'], { cwd: ROOT, stdio: 'inherit' });
  }
  return JSON.parse(fs.readFileSync(suitePath, 'utf8'));
}

function installLaminaSkills(workspace, agent) {
  const agentDirs = {
    'claude-code': '.claude/skills',
    codex: '.codex/skills',
    opencode: '.opencode/skills',
  };
  const rel = agentDirs[agent] || '.claude/skills';
  const dest = path.join(workspace, rel);
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(SKILLS_SRC, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(SKILLS_SRC, entry.name);
    const target = path.join(dest, entry.name);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    copyTree(src, target);
  }
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function generateMockArtifact(task, arm) {
  const goldenPath = path.join(ROOT, 'benchmarks/goldens', task.id, 'golden.yaml');
  const golden = fs.existsSync(goldenPath) ? readYamlSync(goldenPath) : {};
  const boost = arm === 'treatment' ? 1.0 : 0.55;
  const sections = golden.required_sections || ['flows', 'edge cases'];
  const lines = [`# UX Artifact — ${task.id} (${arm}, mock)\n`];

  for (const section of sections) {
    lines.push(`### ${section.charAt(0).toUpperCase() + section.slice(1)}\n`);
  }

  const fields = [
    'required_personas',
    'required_flows',
    'required_rules',
    'required_edge_cases',
    'required_a11y',
    'required_findings',
  ];
  for (const field of fields) {
    const items = golden[field];
    if (!items) continue;
    const count = Math.ceil(items.length * boost);
    for (let i = 0; i < count; i++) {
      lines.push(`- ${items[i]}: detailed UX reasoning for ${items[i].replace(/_/g, ' ')}`);
    }
  }

  if (task.workflow === 'audit') {
    lines.push('\n### Executive summary\nMock audit findings with prioritized improvements.\n');
    lines.push('### Findings by flow\nIdentified usability issues with impact and effort ratings.\n');
    lines.push('### Prioritized improvements\n1. High-impact quick wins listed.\n');
  }

  return lines.join('\n');
}

function captureArtifact(workspace, agentOutput) {
  const parts = [agentOutput || ''];
  const laminaDir = path.join(workspace, '.lamina');
  if (fs.existsSync(laminaDir)) {
    for (const f of listWorkspaceFiles(laminaDir, '.lamina')) {
      try {
        parts.push(`\n--- ${f} ---\n${fs.readFileSync(path.join(workspace, f), 'utf8')}`);
      } catch {
        /* skip */
      }
    }
  }
  return parts.join('\n');
}

function appendIndex(entry) {
  const indexPath = path.join(RESULTS_RAW, 'index.jsonl');
  fs.mkdirSync(RESULTS_RAW, { recursive: true });
  fs.appendFileSync(indexPath, JSON.stringify(entry) + '\n');
}

async function runTask(task, run, arm, opts, release) {
  const workspace = path.join(RESULTS_RAW, 'workspaces', `${task.id}_${arm}_run${run}`);
  const artifactRel = `artifacts/${task.id}_${arm}_run${run}.md`;
  const artifactAbs = path.join(RESULTS_RAW, artifactRel);

  if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });

  if (task.fixture) {
    stageBenchFixture(task.fixture, workspace);
  }

  const agent = opts.agent || release.agent;
  const start = Date.now();
  let output = '';

  if (opts.mock) {
    output = generateMockArtifact(task, arm);
  } else {
    if (!isAgentAvailable(agent)) {
      throw new Error(`Agent ${agent} not available. Use --mock or install the agent CLI.`);
    }
    if (arm === 'treatment') {
      installLaminaSkills(workspace, agent);
    }
    const result = invokeAgent(agent, task.full_prompt, workspace);
    output = captureArtifact(workspace, result.output);
  }

  const elapsed = Date.now() - start;
  fs.mkdirSync(path.dirname(artifactAbs), { recursive: true });
  fs.writeFileSync(artifactAbs, output);

  const entry = {
    task_id: task.id,
    category: task.category,
    run,
    arm,
    agent,
    model: release.model || null,
    artifact_path: artifactRel,
    workspace: path.relative(ROOT, workspace),
    duration_ms: elapsed,
    timestamp: new Date().toISOString(),
    mock: opts.mock,
  };
  appendIndex(entry);
  return entry;
}

async function main() {
  const opts = parseArgs();
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  const suite = loadSuite();

  let tasks = suite.tasks;
  if (opts.pilot) {
    tasks = tasks.filter((t) => ['task001', 'task006', 'task011'].includes(t.id));
  }
  if (opts.tasks) {
    tasks = tasks.filter((t) => opts.tasks.includes(t.id));
  }

  const runsPerArm = opts.runs ?? release.runs_per_arm ?? 3;

  // Fresh index for full runs; append for partial
  if (!opts.tasks && !opts.pilot) {
    const indexPath = path.join(RESULTS_RAW, 'index.jsonl');
    if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath);
  }

  fs.mkdirSync(RESULTS_RAW, { recursive: true });
  const arms = ['control', 'treatment'];
  let count = 0;

  for (const task of tasks) {
    for (let run = 1; run <= runsPerArm; run++) {
      for (const arm of arms) {
        const entry = await runTask(task, run, arm, opts, release);
        count++;
        console.log(`[${count}] ${entry.task_id} ${entry.arm} run${entry.run} → ${entry.artifact_path} (${entry.duration_ms}ms)`);
      }
    }
  }

  console.log(`\nLaminaBench run complete: ${count} executions`);
  if (opts.mock) console.log('(mock mode — artifacts are synthetic for pipeline validation)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
