#!/usr/bin/env node
/**
 * Run full Harbor matrix: every corpus task × every arm.
 * Resumes by skipping cells already present in publish-final-results.json
 * unless --force is set. Supports --only-task / --only-arm / --phase.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmarks/corpus/manifest.json'), 'utf8'));
const statePath = path.join(ROOT, 'benchmarks/results/publish-full-matrix-state.json');
const resultsPath = path.join(ROOT, 'benchmarks/results/publish-final-results.json');

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const attempts = Number(readFlag('--attempts', '2'));
const agent = readFlag('--agent', manifest.pilot?.agent ?? 'cursor-cli');
const model = readFlag('--model', manifest.pilot?.model ?? 'composer-2.5');
const concurrency = Number(readFlag('--concurrency', '1'));
const onlyTask = readFlag('--only-task', null);
const onlyArm = readFlag('--only-arm', null);
const phase = readFlag('--phase', null); // e.g. care, control, loan, review
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');
const skipBuild = process.argv.includes('--skip-build');
const maxCells = Number(readFlag('--max-cells', '0')) || Infinity;

const phaseTasks = {
  care: ['pilot-care-circle'],
  control: ['control-simple-list'],
  loan: ['pilot-loan-library'],
  review: ['pilot-review-room'],
};

function loadDoneCells() {
  const done = new Set();
  if (fs.existsSync(resultsPath)) {
    const summary = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    for (const row of summary.coverage ?? []) {
      if (row.status === 'done' && row.n_trials >= attempts) {
        done.add(`${row.task}::${row.arm}`);
      }
    }
  }
  return done;
}

function refreshAggregate() {
  spawnSync('node', ['benchmarks/scripts/aggregate-publish-results.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

let taskIds = manifest.tasks.map((t) => t.id);
let arms = [...manifest.arms];
if (phase && phaseTasks[phase]) taskIds = phaseTasks[phase];
if (onlyTask) taskIds = taskIds.filter((t) => t === onlyTask);
if (onlyArm) arms = arms.filter((a) => a === onlyArm);

const cells = [];
for (const task of taskIds) {
  for (const arm of arms) cells.push({ task, arm });
}

if (!skipBuild && !dryRun) {
  const build = spawnSync('npm', ['run', 'bench:build'], { cwd: ROOT, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
  const validate = spawnSync('npm', ['run', 'bench:validate'], { cwd: ROOT, stdio: 'inherit' });
  if (validate.status !== 0) process.exit(validate.status ?? 1);
}

refreshAggregate();
const done = force ? new Set() : loadDoneCells();

const pending = cells.filter((c) => !done.has(`${c.task}::${c.arm}`)).slice(0, maxCells);

console.log(`Full matrix: ${cells.length} cells; done=${cells.length - pending.length}; pending=${pending.length}`);
if (dryRun) {
  for (const c of pending) console.log(`- PENDING ${c.task} × ${c.arm}`);
  for (const c of cells.filter((x) => done.has(`${x.task}::${x.arm}`))) {
    console.log(`- DONE ${c.task} × ${c.arm}`);
  }
  process.exit(0);
}

const state = {
  started_at: new Date().toISOString(),
  agent,
  model,
  attempts,
  pending: pending.map((c) => `${c.task}×${c.arm}`),
  completed: [],
  failed: [],
};
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

let failed = 0;
for (const [index, cell] of pending.entries()) {
  const label = `${cell.task} × ${cell.arm}`;
  console.log(`\n[${index + 1}/${pending.length}] ${label}`);
  const jobName = `publish-${cell.task}-${cell.arm}-${Date.now()}`;
  const result = spawnSync(
    'node',
    [
      'benchmarks/scripts/run-harbor-arm.mjs',
      '--arm', cell.arm,
      '--task', cell.task,
      '--attempts', String(attempts),
      '--concurrency', String(concurrency),
      '--agent', agent,
      '--model', model,
      '--job-name', jobName,
    ],
    { cwd: ROOT, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    failed += 1;
    state.failed.push({ ...cell, job: jobName });
    console.error(`FAILED: ${label}`);
  } else {
    state.completed.push({ ...cell, job: jobName });
  }
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  refreshAggregate();
}

spawnSync('npm', ['run', 'bench:harvest'], { cwd: ROOT, stdio: 'inherit' });
refreshAggregate();

if (failed) {
  console.error(`\nMatrix finished with ${failed} failed cell(s).`);
  process.exit(1);
}
console.log(`\nMatrix complete. Pending run: ${pending.length} cells.`);
