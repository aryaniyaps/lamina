#!/usr/bin/env node
/**
 * Smoke validation for parallel bench harness.
 * 1. Single control workflow (task001) — gates, session resume, artifact
 * 2. Parallel overlap — control + treatment with concurrency 2
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { stageBenchFixture } from './stage-bench-fixture.mjs';
import { runControlWorkflow, runTreatmentWorkflow } from './bench-workflow.mjs';
import { isAgentAvailable } from '../../evals/scripts/invoke-agent.mjs';
import { loadBenchEnv } from './load-bench-env.mjs';
import { installLaminaSkills } from './bench-skills.mjs';

loadBenchEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SMOKE_ROOT = path.join(ROOT, 'benchmarks/tmp/smoke');

function loadTask001() {
  const suitePath = path.join(ROOT, 'benchmarks/tmp/bench-suite.json');
  if (!fs.existsSync(suitePath)) {
    spawnSync('node', ['benchmarks/scripts/compile-suite.mjs'], { cwd: ROOT, stdio: 'inherit' });
  }
  const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));
  const task = suite.tasks.find((t) => t.id === 'task001');
  if (!task) throw new Error('task001 not found in suite');
  return task;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function smokeControl(task) {
  const workspace = path.join(SMOKE_ROOT, 'control-only');
  if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  if (task.fixture) stageBenchFixture(task.fixture, workspace);

  console.log('\n[smoke 1/2] control-only task001...');
  const result = await runControlWorkflow('claude-code', workspace, task);

  assert(result.status === 'success', `control status=${result.status}`);
  assert(result.artifact_valid === true, 'control artifact invalid');
  assert(fs.existsSync(path.join(workspace, 'bench-plan.md')), 'bench-plan.md missing');
  assert(result.steps?.length >= 2, 'expected >= 2 steps');

  const sessionIds = result.steps.map((s) => s.session_id).filter(Boolean);
  assert(sessionIds.length >= 2, 'expected session_id on steps');
  const uniqueSessions = new Set(sessionIds);
  assert(uniqueSessions.size === 1, `session crosstalk: ${[...uniqueSessions].join(', ')}`);

  console.log('  OK control-only:', {
    status: result.status,
    artifact_valid: result.artifact_valid,
    session_id: sessionIds[0]?.slice(0, 12) + '...',
    steps: result.steps.length,
  });
}

async function smokeParallel(task) {
  console.log('\n[smoke 2/2] parallel control+treatment task001...');

  const jobs = [
    { arm: 'control', workspace: path.join(SMOKE_ROOT, 'parallel-control') },
    { arm: 'treatment', workspace: path.join(SMOKE_ROOT, 'parallel-treatment') },
  ];

  for (const job of jobs) {
    if (fs.existsSync(job.workspace)) fs.rmSync(job.workspace, { recursive: true, force: true });
    fs.mkdirSync(job.workspace, { recursive: true });
    if (task.fixture) stageBenchFixture(task.fixture, job.workspace);
  }

  const start = Date.now();
  const results = await Promise.all(
    jobs.map(async (job) => {
      if (job.arm === 'treatment') installLaminaSkills(job.workspace, 'claude-code');
      const fn = job.arm === 'control' ? runControlWorkflow : runTreatmentWorkflow;
      const result = await fn('claude-code', job.workspace, task);
      return { ...job, result };
    })
  );
  const elapsed = Date.now() - start;

  const sessions = results.flatMap((r) =>
    (r.result.steps || []).map((s) => s.session_id).filter(Boolean)
  );
  const unique = new Set(sessions);
  assert(unique.size >= 2, 'expected distinct sessions per workflow');

  for (const { arm, result } of results) {
    assert(result.status === 'success', `${arm} status=${result.status} gate=${result.failed_gate}`);
    assert(result.artifact_valid === true, `${arm} artifact invalid (status=${result.status})`);
    console.log(`  OK ${arm}: status=${result.status}, steps=${result.steps?.length}`);
  }

  console.log(`  OK parallel overlap (${elapsed}ms, ${unique.size} distinct session(s) across workflows)`);
}

async function main() {
  if (!isAgentAvailable('claude-code')) {
    console.error('Claude Code CLI not available — skip smoke or install claude');
    process.exit(1);
  }

  const task = loadTask001();
  fs.mkdirSync(SMOKE_ROOT, { recursive: true });

  await smokeControl(task);
  await smokeParallel(task);

  console.log('\nSmoke validation passed.');
}

main().catch((err) => {
  console.error('\nSmoke validation FAILED:', err.message);
  process.exit(1);
});
