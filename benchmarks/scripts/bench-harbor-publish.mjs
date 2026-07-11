#!/usr/bin/env node
/**
 * Publish LaminaBench to the Harbor registry.
 *
 * Tasks live in benchmarks/harbor/tasks/; dataset.toml lives in benchmarks/harbor/dataset/.
 * Harbor only auto-publishes tasks that sit beside dataset.toml, so we symlink them in,
 * refresh workspaces, refresh digests, then publish the dataset (tasks + manifest).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { HARBOR_TASKS_DIR, listHarborTaskDirs } from './harbor-tasks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATASET_DIR = path.join(ROOT, 'benchmarks/harbor/dataset');
const TAG = process.env.BENCH_HARBOR_TAG || 'v1';

function run(cmd, args, { optional = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (r.status !== 0 && !optional) process.exit(r.status ?? 1);
  return r.status === 0;
}

function ensureTaskSymlinks() {
  for (const name of listHarborTaskDirs()) {
    const linkPath = path.join(DATASET_DIR, name);
    const target = path.relative(DATASET_DIR, path.join(HARBOR_TASKS_DIR, name));
    if (fs.existsSync(linkPath)) {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        if (fs.readlinkSync(linkPath) === target) continue;
        fs.unlinkSync(linkPath);
      } else if (stat.isDirectory()) {
        continue;
      } else {
        fs.unlinkSync(linkPath);
      }
    }
    fs.symlinkSync(target, linkPath);
  }
}

function main() {
  console.log('LaminaBench Harbor publish\n');
  run('node', ['benchmarks/scripts/harbor-sync.mjs']);
  ensureTaskSymlinks();
  console.log('\nRefreshing dataset task digests...');
  run('harbor', ['sync', 'benchmarks/harbor/dataset']);
  console.log(`\nPublishing aryaniyaps/lamina-bench@${TAG} (tasks + dataset)...`);
  run('harbor', ['publish', 'benchmarks/harbor/dataset', '-t', TAG, '--public']);
  console.log(`\nPublished aryaniyaps/lamina-bench@${TAG}`);
  console.log(`Run: harbor run -d "aryaniyaps/lamina-bench@${TAG}" -a claude-code -m "<model>"`);
}

main();
