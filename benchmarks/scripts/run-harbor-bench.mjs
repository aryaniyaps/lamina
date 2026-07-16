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
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'node:child_process';
import { readYamlSync } from './yaml.mjs';
import { loadBenchEnv, resolveBenchModel } from './load-bench-env.mjs';
import { loadRegistry, parseHarborDirName, loadRegistryBySuite } from './harbor-tasks.mjs';
import { runPhasedBenchmark } from './run-phased.mjs';
import {
  assertPublishableWorktree,
  benchmarkProvenance,
} from './benchmark-provenance.mjs';
import { scheduledPairs } from './benchmark-schedule.mjs';

loadBenchEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARBOR_JOBS = path.join(ROOT, 'benchmarks/results/harbor/jobs');

const PILOT_TASKS = ['task001', 'task002', 'task003'];

function parseArgs() {
  const publishTaskIdx = process.argv.indexOf('--publish-task');
  const publishTask = publishTaskIdx !== -1 ? process.argv[publishTaskIdx + 1] : null;
  const opts = {
    pilot: process.argv.includes('--pilot'),
    fresh: process.argv.includes('--fresh'),
    syncOnly: process.argv.includes('--sync-only'),
    tasks: null,
    arm: null,
    suite: null,
    runs: null,
    publish: process.argv.includes('--publish') || Boolean(publishTask),
    publishTask,
    parallelPairs: process.argv.includes('--parallel-pairs'),
    preflight: process.argv.includes('--preflight'),
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

function prepareSharedRuntimeImage(harborTasks) {
  const definitions = harborTasks.map((harborName) => {
    const envDir = path.join(ROOT, 'benchmarks/harbor/tasks', harborName, 'environment');
    const dockerfile = path.join(envDir, 'Dockerfile');
    const fingerprint = createHash('sha256').update(fs.readFileSync(dockerfile)).digest('hex').slice(0, 12);
    return { envDir, dockerfile, fingerprint };
  });
  const fingerprints = new Set(definitions.map((item) => item.fingerprint));
  if (fingerprints.size !== 1) {
    throw new Error('Parallel paired trials require one byte-identical runtime definition.');
  }
  const first = definitions[0];
  const imageTag = `lamina-bench-runtime-${first.fingerprint}:local`;
  const exists = spawnSync('docker', ['image', 'inspect', imageTag], { stdio: 'ignore' }).status === 0;
  if (!exists || process.env.LAMINA_BENCH_FORCE_BUILD === '1') {
    const build = spawnSync(
      'docker',
      ['build', '-t', imageTag, '-f', first.dockerfile, first.envDir],
      { cwd: ROOT, stdio: 'inherit' }
    );
    if (build.status !== 0) throw new Error(`Failed to build shared runtime ${imageTag}`);
  }
  return imageTag;
}

function runTrialProcess(entry, execution) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['benchmarks/scripts/run-phased.mjs', entry.harborName, String(entry.run)],
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          LAMINA_BENCH_FORCE_BUILD: '0',
          LAMINA_BENCH_EXECUTION_JSON: JSON.stringify(execution),
        },
      }
    );
    child.on('error', (err) => {
      console.error(`ERROR: failed to start ${entry.harborName} run${entry.run}: ${err.message}`);
      resolve(false);
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

function syncHarbor(opts) {
  const args = ['benchmarks/scripts/harbor-sync.mjs'];
  if (opts.tasks) args.push('--tasks', opts.tasks.join(','));
  if (opts.suite) args.push('--suite', opts.suite);
  if (opts.arm) args.push('--arm', opts.arm);
  const r = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function loadSuite({ fresh = false } = {}) {
  const suitePath = path.join(ROOT, 'benchmarks/tmp/bench-suite.json');
  if (fresh || !fs.existsSync(suitePath)) {
    const compiled = spawnSync('node', ['benchmarks/scripts/compile-suite.mjs'], { cwd: ROOT, stdio: 'inherit' });
    if (compiled.status !== 0) process.exit(compiled.status ?? 1);
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

async function main() {
  const opts = parseArgs();

  if (opts.publish) {
    if (!opts.fresh) {
      console.error('ERROR: --publish requires --fresh so no prior job can be reused.');
      process.exit(1);
    }
    if (opts.publishTask) {
      if (opts.pilot || opts.tasks || opts.arm || opts.suite) {
        console.error('ERROR: --publish-task cannot be combined with pilot/tasks/arm/suite filters.');
        process.exit(1);
      }
      if (!/^task\d{3}$/.test(opts.publishTask)) {
        console.error('ERROR: --publish-task must be a task id such as task001.');
        process.exit(1);
      }
      opts.tasks = [opts.publishTask];
    } else {
      if (opts.pilot || opts.tasks || opts.arm || (opts.suite && opts.suite !== 'core')) {
        console.error('ERROR: --publish fixes the scope to the complete core suite and both arms.');
        process.exit(1);
      }
      opts.suite = 'core';
    }
  }

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

  const suite = loadSuite({ fresh: opts.publish });
  const runs = opts.publish
    ? Number(release.runs_per_arm_publish)
    : opts.runs ?? release.runs_per_arm ?? 1;
  if (opts.publish && opts.runs != null && opts.runs !== runs) {
    console.error(`ERROR: publish runs are pinned to ${runs} runs per arm.`);
    process.exit(1);
  }
  const harborTasks = listHarborTasks(opts, suite);
  if (opts.publishTask && harborTasks.length !== 2) {
    console.error(`ERROR: publish task ${opts.publishTask} did not resolve to exactly two arms.`);
    process.exit(1);
  }
  const claimScope = opts.publishTask
    ? { type: 'task', task_ids: [opts.publishTask] }
    : { type: 'core', task_ids: loadRegistryBySuite('core').map((task) => task.id) };
  const provenance = benchmarkProvenance();
  if (opts.publish) {
    try {
      assertPublishableWorktree(provenance);
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
      process.exit(1);
    }
    if (process.env.LAMINA_BENCH_ALLOW_MODEL_OVERRIDE === '1') {
      console.error('ERROR: model overrides are forbidden in --publish mode.');
      process.exit(1);
    }
  }

  const selectedTaskIds = [...new Set(harborTasks.map((name) => parseHarborDirName(name).id))];
  const schedule = opts.arm
    ? Array.from({ length: runs }, (_, index) =>
        harborTasks.map((harborName) => ({ run: index + 1, harborName }))
      ).flat()
    : scheduledPairs(selectedTaskIds, runs, release.schedule_seed || release.release_tag);
  console.log(`Protocol SHA-256: ${provenance.protocol_sha256}`);
  console.log(`Schedule: ${schedule.map((x) => `${x.harborName}@${x.run}`).join(', ')}`);
  if (opts.preflight) {
    console.log('Publish preflight passed; no jobs were deleted or executed.');
    return;
  }

  if (opts.parallelPairs) {
    try {
      prepareSharedRuntimeImage(harborTasks);
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
      process.exit(1);
    }
  }

  if (opts.fresh) {
    clearSelectedJobs(harborTasks, runs);
  } else {
    fs.mkdirSync(HARBOR_JOBS, { recursive: true });
  }

  let done = 0;
  let failed = 0;
  const total = harborTasks.length * runs;
  for (let position = 0; position < schedule.length;) {
    if (opts.parallelPairs) {
      const pair = schedule.slice(position, position + 2);
      if (
        pair.length !== 2 ||
        pair[0].taskId !== pair[1].taskId ||
        pair[0].run !== pair[1].run
      ) {
        console.error('ERROR: paired concurrency requires adjacent control/treatment cells.');
        process.exit(1);
      }
      const current = benchmarkProvenance();
      if (opts.publish && current.protocol_sha256 !== provenance.protocol_sha256) {
        console.error('ERROR: benchmark protocol changed during a publish run.');
        process.exit(1);
      }
      console.log(`\n[parallel-pair] ${pair.map((x) => `${x.harborName}@${x.run}`).join(' + ')}`);
      const outcomes = await Promise.all(
        pair.map((entry, pairIndex) =>
          runTrialProcess(entry, {
            provenance,
            publishMode: opts.publish,
            schedulePosition: position + pairIndex + 1,
            claimScope,
          })
        )
      );
      for (let pairIndex = 0; pairIndex < pair.length; pairIndex++) {
        done++;
        if (!outcomes[pairIndex]) {
          failed++;
          console.warn(`WARNING: phased trial failed for ${pair[pairIndex].harborName} run${pair[pairIndex].run}`);
        }
      }
      position += pair.length;
      continue;
    }
      const { harborName, run } = schedule[position];
      const current = benchmarkProvenance();
      if (opts.publish && current.protocol_sha256 !== provenance.protocol_sha256) {
        console.error('ERROR: benchmark protocol changed during a publish run.');
        process.exit(1);
      }
      const ok = runPhasedBenchmark(harborName, release, run, {
        provenance,
        publishMode: opts.publish,
        schedulePosition: position + 1,
        claimScope,
      });
      done++;
      if (!ok) {
        failed++;
        console.warn(`WARNING: phased trial failed for ${harborName} run${run}`);
      }
      position++;
  }

  console.log(`\nLaminaBench complete: ${done}/${total} trial invocations (${failed} failed)`);
  console.log(`Jobs: ${HARBOR_JOBS}`);

  const selectedJobNames = [];
  for (const harborName of harborTasks) {
    for (let run = 1; run <= runs; run++) selectedJobNames.push(`${harborName}__run${run}`);
  }
  const ingest = spawnSync(
    'node',
    [
      'benchmarks/scripts/ingest-harbor-results.mjs',
      '--fresh',
      '--job-names',
      selectedJobNames.join(','),
    ],
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

await main();
