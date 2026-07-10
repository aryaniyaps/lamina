#!/usr/bin/env node
/**
 * LaminaBench runner: control vs treatment agent executions.
 *
 * Usage:
 *   node benchmarks/scripts/run-bench.mjs [--pilot] [--tasks id1,id2] [--runs N]
 *     [--concurrency N] [--fresh]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { stageBenchFixture } from './stage-bench-fixture.mjs';
import { readYamlSync } from './yaml.mjs';
import { isAgentAvailable } from '../../evals/scripts/invoke-agent.mjs';
import { runControlWorkflow, runTreatmentWorkflow } from './bench-workflow.mjs';
import { loadBenchEnv, resolveBenchModel } from './load-bench-env.mjs';
import { installLaminaSkills } from './bench-skills.mjs';

loadBenchEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');
const METHODOLOGY = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'benchmarks/methodology.json'), 'utf8')
);

const DEFAULT_CONCURRENCY = Number(process.env.BENCH_CONCURRENCY) || 4;

function parseArgs() {
  const opts = {
    pilot: process.argv.includes('--pilot'),
    fresh: process.argv.includes('--fresh'),
    tasks: null,
    runs: null,
    agent: null,
    concurrency: DEFAULT_CONCURRENCY,
  };
  const tasksIdx = process.argv.indexOf('--tasks');
  if (tasksIdx !== -1) opts.tasks = process.argv[tasksIdx + 1].split(',');
  const runsIdx = process.argv.indexOf('--runs');
  if (runsIdx !== -1) opts.runs = Number(process.argv[runsIdx + 1]);
  const agentIdx = process.argv.indexOf('--agent');
  if (agentIdx !== -1) opts.agent = process.argv[agentIdx + 1];
  const concIdx = process.argv.indexOf('--concurrency');
  if (concIdx !== -1) opts.concurrency = Number(process.argv[concIdx + 1]);
  return opts;
}

function loadSuite() {
  const suitePath = path.join(ROOT, 'benchmarks/tmp/bench-suite.json');
  if (!fs.existsSync(suitePath)) {
    spawnSync('node', ['benchmarks/scripts/compile-suite.mjs'], { cwd: ROOT, stdio: 'inherit' });
  }
  return JSON.parse(fs.readFileSync(suitePath, 'utf8'));
}

function loadCompletedJobs() {
  const indexPath = path.join(RESULTS_RAW, 'index.jsonl');
  const completed = new Set();
  if (!fs.existsSync(indexPath)) return completed;
  for (const line of fs.readFileSync(indexPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.artifact_valid === true) {
        completed.add(`${row.task_id}:${row.arm}:run${row.run}`);
      }
    } catch {
      /* skip */
    }
  }
  return completed;
}

let indexLock = Promise.resolve();

function appendIndex(entry) {
  const indexPath = path.join(RESULTS_RAW, 'index.jsonl');
  fs.mkdirSync(RESULTS_RAW, { recursive: true });
  fs.appendFileSync(indexPath, JSON.stringify(entry) + '\n');
}

function appendIndexSafe(entry) {
  indexLock = indexLock.then(() => appendIndex(entry));
  return indexLock;
}

async function runTask(task, run, arm, opts, release, workerId) {
  const jobKey = `${task.id}:${arm}:run${run}`;
  const workspace = path.join(RESULTS_RAW, 'workspaces', `${task.id}_${arm}_run${run}`);
  const artifactRel = `artifacts/${task.id}_${arm}_run${run}.md`;
  const artifactAbs = path.join(RESULTS_RAW, artifactRel);

  if (fs.existsSync(workspace)) {
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Could not clear ${workspace}: ${err.message}`);
    }
  }
  fs.mkdirSync(workspace, { recursive: true });

  if (task.fixture) {
    stageBenchFixture(task.fixture, workspace);
  }

  const agent = opts.agent || release.agent;
  const start = Date.now();
  let workflowResult;

  if (!isAgentAvailable(agent)) {
    throw new Error(`Agent ${agent} not available. Install the agent CLI before running benchmarks.`);
  }

  if (arm === 'treatment') {
    installLaminaSkills(workspace, agent);
    workflowResult = await runTreatmentWorkflow(agent, workspace, task);
  } else {
    workflowResult = await runControlWorkflow(agent, workspace, task);
  }

  const elapsed = Date.now() - start;
  fs.mkdirSync(path.dirname(artifactAbs), { recursive: true });
  fs.writeFileSync(artifactAbs, workflowResult.artifact);

  const entry = {
    task_id: task.id,
    category: task.category,
    run,
    arm,
    agent,
    model: resolveBenchModel(release),
    artifact_path: artifactRel,
    workspace: path.relative(ROOT, workspace),
    duration_ms: elapsed,
    total_tokens: workflowResult.total_tokens ?? null,
    cost_usd: workflowResult.cost_usd ?? null,
    timestamp: new Date().toISOString(),
    scoring_target: 'implementation',
    methodology_id: METHODOLOGY.id,
    methodology_document: 'benchmarks/METHODOLOGY.md',
    workflow: workflowResult.workflow,
    phases: workflowResult.phases,
    steps: workflowResult.steps,
    status: workflowResult.status,
    failed_gate: workflowResult.failed_gate ?? null,
    artifact_valid: workflowResult.artifact_valid,
  };

  if (!workflowResult.artifact_valid) {
    console.warn(
      `WARNING [w${workerId}]: ${jobKey} — invalid artifact (${workflowResult.status}${workflowResult.failed_gate ? `, gate=${workflowResult.failed_gate}` : ''})`
    );
  }

  await appendIndexSafe(entry);
  return { entry, workerId, jobKey };
}

async function runPool(jobs, concurrency, workerFn) {
  let cursor = 0;
  let done = 0;
  const total = jobs.length;

  async function worker(workerId) {
    while (true) {
      const idx = cursor++;
      if (idx >= jobs.length) break;
      const job = jobs[idx];
      await workerFn(job, workerId, () => {
        done++;
        return { done, total };
      });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, (_, i) => worker(i + 1));
  await Promise.all(workers);
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
  const arms = ['control', 'treatment'];

  if (opts.fresh) {
    const indexPath = path.join(RESULTS_RAW, 'index.jsonl');
    if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath);
  }

  fs.mkdirSync(RESULTS_RAW, { recursive: true });
  const completed = opts.fresh ? new Set() : loadCompletedJobs();

  const jobs = [];
  for (const task of tasks) {
    for (let run = 1; run <= runsPerArm; run++) {
      for (const arm of arms) {
        const key = `${task.id}:${arm}:run${run}`;
        if (completed.has(key)) {
          console.log(`skip ${key} (already complete)`);
          continue;
        }
        jobs.push({ task, run, arm });
      }
    }
  }

  if (!jobs.length) {
    console.log('No benchmark jobs to run (all complete or empty task list).');
    return;
  }

  console.log(`LaminaBench: ${jobs.length} workflow(s), concurrency=${opts.concurrency}`);

  await runPool(jobs, opts.concurrency, async (job, workerId, progress) => {
    const { entry } = await runTask(job.task, job.run, job.arm, opts, release, workerId);
    const { done, total } = progress();
    console.log(
      `[${done}/${total}] w${workerId} ${entry.task_id} ${entry.arm} run${entry.run} → ${entry.artifact_path} (${entry.duration_ms}ms, valid=${entry.artifact_valid})`
    );
  });

  console.log(`\nLaminaBench run complete: ${jobs.length} workflow(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
