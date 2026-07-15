#!/usr/bin/env node
/**
 * Publish the LaminaBench dataset to the Harbor registry.
 *
 * This uploads task definitions (instruction.md, environments, verifiers) and
 * dataset.toml only. Benchmark runs and results/ are NOT required.
 *
 * Harbor cannot publish tasks via symlinks (paths must stay inside each task dir),
 * so tasks are published from benchmarks/harbor/tasks/, then the dataset manifest.
 *
 * Prerequisites: `harbor auth login`, vendored fixtures (`npm run fixtures:vendor` for OSS tasks).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { HARBOR_TASKS_DIR, listHarborTaskDirs, loadRegistryBySuite } from './harbor-tasks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATASET_DIR = path.join(ROOT, 'benchmarks/harbor/dataset');
const TAG = process.env.BENCH_HARBOR_TAG || 'v1';
const SUITE = process.argv.includes('--suite')
  ? process.argv[process.argv.indexOf('--suite') + 1]
  : 'core';

function run(cmd, args, { optional = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (r.status !== 0 && !optional) process.exit(r.status ?? 1);
  return r.status === 0;
}

/** Remove legacy symlinks under dataset/ — Harbor publish rejects out-of-tree paths. */
function removeDatasetTaskSymlinks() {
  if (!fs.existsSync(DATASET_DIR)) return;
  for (const name of fs.readdirSync(DATASET_DIR)) {
    if (!name.startsWith('task')) continue;
    const entry = path.join(DATASET_DIR, name);
    if (fs.lstatSync(entry).isSymbolicLink()) fs.unlinkSync(entry);
  }
}

function publishTasks() {
  const coreIds = new Set(loadRegistryBySuite('core').map((t) => t.id));
  const allDirs = listHarborTaskDirs();
  const taskPaths = allDirs
    .filter((name) => {
      if (SUITE === 'full') return true;
      const taskId = name.match(/^(task\d{3})-/)?.[1];
      return taskId && coreIds.has(taskId);
    })
    .map((name) => path.relative(ROOT, path.join(HARBOR_TASKS_DIR, name)));
  console.log(`\nPublishing ${taskPaths.length} tasks (${SUITE} suite) from benchmarks/harbor/tasks/...`);
  run('harbor', ['publish', ...taskPaths, '-t', TAG, '--public', '-c', '10']);
}

function main() {
  console.log('Publish LaminaBench dataset to Harbor (task definitions only — no results needed)\n');
  run('node', ['benchmarks/scripts/harbor-sync.mjs']);
  removeDatasetTaskSymlinks();
  publishTasks();
  const datasetDir =
    SUITE === 'full' ? 'benchmarks/harbor/dataset-full' : 'benchmarks/harbor/dataset';
  console.log('\nRefreshing dataset task digests from registry...');
  run('harbor', ['sync', datasetDir, '--upgrade']);
  console.log(`\nPublishing dataset manifest aryaniyaps/lamina-bench@${TAG} (${SUITE})...`);
  run('harbor', ['publish', datasetDir, '-t', TAG, '--public', '--no-tasks']);
  console.log(`\nPublished aryaniyaps/lamina-bench@${TAG}`);
  console.log('Others can run the dataset with:');
  console.log(`  CODEX_FORCE_AUTH_JSON=1 harbor run -d "aryaniyaps/lamina-bench@${TAG}" -a codex -m "gpt-5.6-sol"`);
  console.log('\nTo run benchmarks yourself later: npm run bench:run');
}

main();
