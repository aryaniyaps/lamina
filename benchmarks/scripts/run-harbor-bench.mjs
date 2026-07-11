#!/usr/bin/env node
/**
 * LaminaBench Harbor runner (Design B — SkillsBench-paired).
 *
 * Usage:
 *   node benchmarks/scripts/run-harbor-bench.mjs [--pilot] [--tasks task001] [--runs N]
 *     [--fresh] [--sync-only]
 *
 * Default: harbor sync + run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { readYamlSync } from './yaml.mjs';
import { loadBenchEnv, resolveBenchModel } from './load-bench-env.mjs';

loadBenchEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.PATH = `${process.env.HOME}/.local/bin:${process.env.PATH}`;
const HARBOR_TASKS = path.join(ROOT, 'benchmarks/harbor/tasks');
const HARBOR_JOBS = path.join(ROOT, 'benchmarks/results/harbor/jobs');
const PROMPT_TEMPLATE = path.join(ROOT, 'benchmarks/harbor/prompt_template.j2');

const PILOT_TASKS = ['task001', 'task002', 'task003'];

function parseArgs() {
  const opts = {
    pilot: process.argv.includes('--pilot'),
    fresh: process.argv.includes('--fresh'),
    syncOnly: process.argv.includes('--sync-only'),
    tasks: null,
    runs: null,
    concurrency: Number(process.env.BENCH_CONCURRENCY) || 4,
  };
  const tasksIdx = process.argv.indexOf('--tasks');
  if (tasksIdx !== -1) opts.tasks = process.argv[tasksIdx + 1].split(',');
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

function syncHarbor(opts) {
  const args = ['benchmarks/scripts/harbor-sync.mjs'];
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

function clearJobsDir() {
  if (fs.existsSync(HARBOR_JOBS)) {
    fs.rmSync(HARBOR_JOBS, { recursive: true, force: true });
  }
  fs.mkdirSync(HARBOR_JOBS, { recursive: true });
}

function runHarborTrial(harbor, harborName, release, attempt) {
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
    '--job-name',
    `${harborName}__run${attempt}`,
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
  args.push('--ae', `LAMINA_BENCH_RUN=${attempt}`);

  console.log(`\n[harbor] ${harborName} attempt ${attempt}`);
  const r = spawnSync(harbor, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  return r.status === 0;
}

function main() {
  const opts = parseArgs();

  syncHarbor(opts);
  if (opts.syncOnly) return;

  const harbor = ensureHarbor();
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  const suite = loadSuite();
  const runs = opts.runs ?? release.runs_per_arm ?? 1;
  const harborTasks = listHarborTasks(opts, suite);

  if (opts.fresh) {
    clearJobsDir();
  } else {
    fs.mkdirSync(HARBOR_JOBS, { recursive: true });
  }

  let done = 0;
  let failed = 0;
  const total = harborTasks.length * runs;

  for (let run = 1; run <= runs; run++) {
    for (const harborName of harborTasks) {
      const ok = runHarborTrial(harbor, harborName, release, run);
      done++;
      if (!ok) {
        failed++;
        console.warn(`WARNING: Harbor trial failed for ${harborName} run${run}`);
      }
    }
  }

  console.log(`\nHarbor bench complete: ${done}/${total} trial invocations (${failed} failed)`);
  console.log(`Jobs: ${HARBOR_JOBS}`);

  const ingest = spawnSync(
    'node',
    ['benchmarks/scripts/ingest-harbor-results.mjs', '--fresh'],
    { cwd: ROOT, stdio: 'inherit' }
  );
  if (ingest.status === 0) {
    spawnSync('node', ['benchmarks/scripts/aggregate-bench-results.mjs'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  }

  console.log('Inspect results: harbor view');
}

main();
