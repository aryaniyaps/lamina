#!/usr/bin/env node
/**
 * LaminaBench runner: control vs treatment agent executions.
 * Usage: node benchmarks/scripts/run-bench.mjs [--mock] [--pilot] [--tasks id1,id2] [--runs N]
 *
 * --mock is for pipeline validation only. Never use mock results for external claims.
 * Release path: npm run bench:all (live runs, no --mock).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { stageBenchFixture } from './stage-bench-fixture.mjs';
import { readYamlSync } from './yaml.mjs';
import { isAgentAvailable } from '../../evals/scripts/invoke-agent.mjs';
import { runControlWorkflow, runTreatmentWorkflow } from './bench-workflow.mjs';
import { copyTree } from '../../evals/scripts/vendor-fixture-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');
const SKILLS_SRC = path.join(ROOT, 'skills');
const METHODOLOGY = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'benchmarks/methodology.json'), 'utf8')
);

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

/**
 * Mock implementation bundles for pipeline validation only.
 * Both arms get the same inclusion rate so mock deltas are not claimable.
 */
function generateMockArtifact(task, arm) {
  const goldenPath = path.join(ROOT, 'benchmarks/goldens', task.id, 'golden.yaml');
  const golden = fs.existsSync(goldenPath) ? readYamlSync(goldenPath) : {};
  const boost = 0.75;
  const lines = [
    `# LaminaBench implementation capture — ${task.id} (${arm}, mock)\n`,
    'Captured 2 source file(s): src/domain/model.ts, src/workflows/primary.ts\n',
    '## src/domain/model.ts\n```typescript\n',
    '// Mock vertical slice for pipeline validation\n',
  ];

  const fields = [
    'required_entities',
    'required_invariants',
    'required_personas',
    'required_flows',
    'required_rules',
    'required_scenarios',
    'required_edge_cases',
    'required_tradeoffs',
    'required_a11y',
    'required_findings',
  ];
  for (const field of fields) {
    const items = golden[field];
    if (!items) continue;
    const count = Math.ceil(items.length * boost);
    for (let i = 0; i < count; i++) {
      const phrase = items[i].replace(/_/g, ' ');
      lines.push(`// ${phrase}\n`);
      lines.push(`const ${String(items[i]).replace(/[^a-z0-9]+/gi, '_')} = true;\n`);
    }
  }

  lines.push('```\n\n## src/workflows/primary.ts\n```typescript\n');
  lines.push('export function runPrimaryWorkflow() {\n  // end-to-end path with guard rails\n}\n');
  if (task.workflow === 'audit') {
    lines.push('// audit fix: invariant violations addressed in code\n');
  }
  lines.push('```\n');

  return lines.join('');
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
  let workflowMeta = null;

  if (opts.mock) {
    output = generateMockArtifact(task, arm);
  } else {
    if (!isAgentAvailable(agent)) {
      throw new Error(`Agent ${agent} not available. Use --mock for pipeline checks or install the agent CLI.`);
    }
    if (arm === 'treatment') {
      installLaminaSkills(workspace, agent);
      const result = runTreatmentWorkflow(agent, workspace, task);
      output = result.artifact;
      workflowMeta = { workflow: result.workflow, steps: result.steps };
    } else {
      const result = runControlWorkflow(agent, workspace, task);
      output = result.artifact;
      workflowMeta = { workflow: result.workflow, steps: result.steps };
    }
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
    scoring_target: 'implementation',
    methodology_id: METHODOLOGY.id,
    methodology_document: 'benchmarks/METHODOLOGY.md',
    workflow: workflowMeta?.workflow ?? (opts.mock ? 'mock' : null),
    phases: workflowMeta?.phases ?? (opts.mock ? null : arm === 'treatment' ? 5 : 2),
    steps: workflowMeta?.steps ?? null,
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
  if (opts.mock) {
    console.log('WARNING: mock mode — equal-coverage synthetic artifacts for pipeline validation only.');
    console.log('Do NOT cite mock results externally. Use npm run bench:all for live release runs.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
