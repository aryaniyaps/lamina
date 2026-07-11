#!/usr/bin/env node
/**
 * LaminaBench Harbor runner (Design B — SkillsBench-paired).
 *
 * Usage:
 *   node benchmarks/scripts/run-harbor-bench.mjs [--pilot] [--tasks task001] [--runs N]
 *     [--fresh] [--rerun task001] [--compile-only] [--ingest-only] [--legacy]
 *
 * Default: harbor run + ingest. Use --legacy for pre-v3 phase harness.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { readYamlSync } from './yaml.mjs';
import { loadBenchEnv, resolveBenchModel } from './load-bench-env.mjs';
import { computeJobFingerprint, getResultsContractVersion, readIndexRows, dedupeIndexByJob, jobKey, isCompleteForResume } from './bench-index.mjs';

loadBenchEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.PATH = `${process.env.HOME}/.local/bin:${process.env.PATH}`;
const HARBOR_TASKS = path.join(ROOT, 'benchmarks/harbor/tasks');
const HARBOR_JOBS = path.join(ROOT, 'benchmarks/results/harbor/jobs');
const PROMPT_TEMPLATE = path.join(ROOT, 'benchmarks/harbor/prompt_template.j2');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');

const PILOT_TASKS = ['task001', 'task002', 'task003'];

function parseArgs() {
  const opts = {
    pilot: process.argv.includes('--pilot'),
    fresh: process.argv.includes('--fresh'),
    compileOnly: process.argv.includes('--compile-only'),
    ingestOnly: process.argv.includes('--ingest-only'),
    legacy: process.argv.includes('--legacy'),
    tasks: null,
    rerun: null,
    runs: null,
    concurrency: Number(process.env.BENCH_CONCURRENCY) || 4,
  };
  const tasksIdx = process.argv.indexOf('--tasks');
  if (tasksIdx !== -1) opts.tasks = process.argv[tasksIdx + 1].split(',');
  const rerunIdx = process.argv.indexOf('--rerun');
  if (rerunIdx !== -1) opts.rerun = process.argv[rerunIdx + 1].split(',');
  const runsIdx = process.argv.indexOf('--runs');
  if (runsIdx !== -1) opts.runs = Number(process.argv[runsIdx + 1]);
  const concIdx = process.argv.indexOf('--concurrency');
  if (concIdx !== -1) opts.concurrency = Number(process.argv[concIdx + 1]);
  return opts;
}

function which(cmd) {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function ensureHarbor() {
  const harbor = which('harbor');
  if (!harbor) {
    console.error('Harbor CLI not found. Install: uv tool install harbor');
    console.error('  https://www.harborframework.com/docs');
    process.exit(1);
  }
  return harbor;
}

function compileHarbor(opts) {
  const args = ['benchmarks/scripts/harbor-compile.mjs'];
  if (opts.tasks) args.push('--tasks', opts.tasks.join(','));
  const r = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function loadSuite() {
  const suitePath = path.join(ROOT, 'benchmarks/tmp/bench-suite.json');
  if (!fs.existsSync(suitePath)) {
    spawnSync('node', ['benchmarks/scripts/compile-suite.mjs'], { cwd: ROOT, stdio: 'inherit' });
  }
  return JSON.parse(fs.readFileSync(suitePath, 'utf8'));
}

function listHarborTasks(opts, suite) {
  let taskIds = suite.tasks.map((t) => t.id);
  if (opts.pilot) taskIds = taskIds.filter((id) => PILOT_TASKS.includes(id));
  if (opts.tasks) taskIds = taskIds.filter((id) => opts.tasks.includes(id));
  const harborNames = [];
  for (const id of taskIds) {
    for (const arm of ['control', 'treatment']) {
      harborNames.push(`${id}-${arm}`);
    }
  }
  return harborNames;
}

function loadIndexByKey() {
  const map = new Map();
  for (const row of dedupeIndexByJob(readIndexRows(RESULTS_RAW))) {
    map.set(jobKey(row), row);
  }
  return map;
}

function shouldSkipHarborTask(harborName, run, opts, release, suite, indexByKey) {
  if (opts.rerun?.some((id) => harborName.startsWith(id))) return false;
  const m = harborName.match(/^(task\d{3})-(control|treatment)$/);
  if (!m) return false;
  const task = suite.tasks.find((t) => t.id === m[1]);
  if (!task) return false;
  const arm = m[2];
  const model = resolveBenchModel(release);
  const fp = computeJobFingerprint(task, {
    arm,
    run,
    agent: release.agent,
    model,
    resultsContractVersion: getResultsContractVersion(),
  });
  const key = `${task.id}:${arm}:run${run}`;
  const prev = indexByKey.get(key);
  return (
    isCompleteForResume(prev, fp) &&
    (prev?.runner === 'harbor' || prev?.runner == null)
  );
}

function runHarborTrial(harbor, harborName, release, opts, attempt) {
  const model = resolveBenchModel(release);
  const modelArg = model.startsWith('anthropic/') ? model : `anthropic/${model}`;
  const args = [
    'run',
    '-p',
    path.join(HARBOR_TASKS, harborName),
    '-a',
    release.agent || 'claude-code',
    '-m',
    modelArg,
    '-o',
    HARBOR_JOBS,
    '-k',
    '1',
    '-n',
    '1',
    '--ak',
    `prompt_template=${PROMPT_TEMPLATE}`,
  ];

  const token = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  if (token) {
    args.push('--ae', `ANTHROPIC_API_KEY=${token}`);
    args.push('--ae', `ANTHROPIC_AUTH_TOKEN=${token}`);
  }
  if (process.env.ANTHROPIC_BASE_URL) {
    args.push('--ae', `ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL}`);
  }
  if (model) args.push('--ae', `ANTHROPIC_MODEL=${model}`);

  console.log(`\n[harbor] ${harborName} attempt ${attempt}`);
  const r = spawnSync(harbor, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  return r.status === 0;
}

function ingest(opts) {
  const args = ['benchmarks/scripts/ingest-harbor-results.mjs', '--jobs-dir', HARBOR_JOBS];
  if (opts.fresh) args.push('--fresh');
  spawnSync('node', args, { cwd: ROOT, stdio: 'inherit' });
}

function runLegacy(opts) {
  const args = ['benchmarks/scripts/run-bench.mjs'];
  if (opts.pilot) args.push('--pilot');
  if (opts.tasks) args.push('--tasks', opts.tasks.join(','));
  if (opts.runs != null) args.push('--runs', String(opts.runs));
  if (opts.fresh) args.push('--fresh');
  if (opts.rerun) args.push('--rerun', opts.rerun.join(','));
  args.push('--legacy');
  const r = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

function main() {
  const opts = parseArgs();

  if (opts.legacy) {
    runLegacy(opts);
    return;
  }

  if (opts.ingestOnly) {
    ingest(opts);
    return;
  }

  compileHarbor(opts);
  if (opts.compileOnly) return;

  const harbor = ensureHarbor();
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  const suite = loadSuite();
  const runs = opts.runs ?? release.runs_per_arm ?? 3;
  const harborTasks = listHarborTasks(opts, suite);

  if (opts.fresh) {
    const indexPath = path.join(RESULTS_RAW, 'index.jsonl');
    if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath);
  }

  const indexByKey = loadIndexByKey();
  let done = 0;
  const total = harborTasks.length * runs;

  for (let run = 1; run <= runs; run++) {
    for (const harborName of harborTasks) {
      if (shouldSkipHarborTask(harborName, run, opts, release, suite, indexByKey)) {
        console.log(`[skip] ${harborName} run${run} (fingerprint match)`);
        done++;
        continue;
      }
      const ok = runHarborTrial(harbor, harborName, release, opts, run);
      done++;
      if (!ok) console.warn(`WARNING: Harbor trial failed for ${harborName} run${run}`);
      ingest({ fresh: false });
    }
  }

  console.log(`\nHarbor bench complete: ${done}/${total} trial invocations`);
  console.log(`Jobs: ${HARBOR_JOBS}`);
  console.log(`Index: ${path.join(RESULTS_RAW, 'index.jsonl')}`);
}

main();
