#!/usr/bin/env node
/**
 * LaminaBench Harbor runner (Design C — ecological matched phases).
 *
 * Usage:
 *   node benchmarks/scripts/run-harbor-bench.mjs [--pilot] [--tasks task001] [--runs N]
 *     [--fresh] [--sync-only]
 *
 * Default: harbor sync + matched phased run for both arms.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { readYamlSync } from './yaml.mjs';
import { loadBenchEnv, resolveBenchModel } from './load-bench-env.mjs';
import { loadRegistry, parseHarborDirName, loadRegistryBySuite } from './harbor-tasks.mjs';
import { runPhasedBenchmark } from './run-phased.mjs';

loadBenchEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARBOR_JOBS = path.join(ROOT, 'benchmarks/results/harbor/jobs');

const PILOT_TASKS = ['task001', 'task002', 'task003'];

function parseArgs() {
  const opts = {
    pilot: process.argv.includes('--pilot'),
    fresh: process.argv.includes('--fresh'),
    syncOnly: process.argv.includes('--sync-only'),
    tasks: null,
    arm: null,
    suite: null,
    runs: null,
  };
  const tasksIdx = process.argv.indexOf('--tasks');
  if (tasksIdx !== -1) opts.tasks = process.argv[tasksIdx + 1].split(',');
  const armIdx = process.argv.indexOf('--arm');
  if (armIdx !== -1) opts.arm = process.argv[armIdx + 1];
  const suiteIdx = process.argv.indexOf('--suite');
  if (suiteIdx !== -1) opts.suite = process.argv[suiteIdx + 1];
  const runsIdx = process.argv.indexOf('--runs');
  if (runsIdx !== -1) opts.runs = Number(process.argv[runsIdx + 1]);
  return opts;
}

function syncHarbor(opts) {
  const args = ['benchmarks/scripts/harbor-sync.mjs'];
  if (opts.tasks) args.push('--tasks', opts.tasks.join(','));
  if (opts.suite) args.push('--suite', opts.suite);
  if (opts.arm) args.push('--arm', opts.arm);
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
  if (opts.suite) {
    const allowed = new Set(
      loadRegistryBySuite(opts.suite === 'full' ? 'full' : 'core').map((t) => t.id)
    );
    taskIds = taskIds.filter((id) => allowed.has(id));
  }
  if (opts.pilot) taskIds = taskIds.filter((id) => PILOT_TASKS.includes(id));
  if (opts.tasks) taskIds = taskIds.filter((id) => opts.tasks.includes(id));
  const harborNames = [];
  const arms = opts.arm ? [opts.arm] : ['control', 'treatment'];
  for (const id of taskIds) {
    for (const arm of arms) {
      harborNames.push(`${id}-${arm}`);
    }
  }
  return harborNames;
}

function clearSelectedJobs(harborTasks, runs) {
  fs.mkdirSync(HARBOR_JOBS, { recursive: true });
  for (const harborName of harborTasks) {
    for (let run = 1; run <= runs; run++) {
      const jobDir = path.join(HARBOR_JOBS, `${harborName}__run${run}`);
      if (!fs.existsSync(jobDir)) continue;
      const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
      const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
      spawnSync(
        'docker',
        ['run', '--rm', '-v', `${jobDir}:/work`, 'alpine', 'chown', '-R', `${uid}:${gid}`, '/work'],
        { cwd: ROOT, stdio: 'ignore' }
      );
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  }
}

function main() {
  const opts = parseArgs();

  // Initial sync (fixtures, Dockerfiles, verifier). Each trial also refreshes its
  // own workspace so --runs N replications stay independent.
  syncHarbor(opts);
  if (opts.syncOnly) return;

  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  try {
    const model = resolveBenchModel(release);
    if (!model) throw new Error('no model pin in release.yaml or CODEX_MODEL');
    console.log(`Model pin: ${model}`);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }

  const suite = loadSuite();
  const runs = opts.runs ?? release.runs_per_arm ?? 1;
  const harborTasks = listHarborTasks(opts, suite);

  if (opts.fresh) {
    clearSelectedJobs(harborTasks, runs);
  } else {
    fs.mkdirSync(HARBOR_JOBS, { recursive: true });
  }

  let done = 0;
  let failed = 0;
  const total = harborTasks.length * runs;

  for (let run = 1; run <= runs; run++) {
    for (const harborName of harborTasks) {
      const ok = runPhasedBenchmark(harborName, release, run);
      done++;
      if (!ok) {
        failed++;
        console.warn(`WARNING: phased trial failed for ${harborName} run${run}`);
      }
    }
  }

  console.log(`\nLaminaBench complete: ${done}/${total} trial invocations (${failed} failed)`);
  console.log(`Jobs: ${HARBOR_JOBS}`);

  const ingest = spawnSync(
    'node',
    ['benchmarks/scripts/ingest-harbor-results.mjs', '--fresh'],
    { cwd: ROOT, stdio: 'inherit' }
  );
  if (ingest.status === 0) {
    const agg = spawnSync('node', ['benchmarks/scripts/aggregate-bench-results.mjs'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    if (agg.status !== 0) {
      console.warn('WARNING: aggregation failed');
      failed++;
    }
    const hasTreatment = harborTasks.some((name) => name.endsWith('-treatment'));
    if (hasTreatment) {
      const skillCheck = spawnSync('node', ['benchmarks/scripts/check-treatment-skills.mjs'], {
        cwd: ROOT,
        stdio: 'inherit',
      });
      if (skillCheck.status !== 0) {
        console.error('ERROR: treatment skillUsage check failed');
        process.exit(skillCheck.status ?? 1);
      }
    }
  } else {
    process.exit(ingest.status ?? 1);
  }

  if (failed > 0) {
    console.warn(`\n${failed} trial(s) failed — see jobs under ${HARBOR_JOBS}`);
    process.exit(1);
  }

  console.log('Inspect results: harbor view (if Harbor CLI installed) or results/harbor/jobs/');
}

main();
