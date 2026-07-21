#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmarks/corpus/manifest.json'), 'utf8'));

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const attempts = Number(readFlag('--attempts', String(manifest.pilot.attempts_per_arm)));
const model = readFlag('--model', manifest.pilot.model);
const concurrency = Number(readFlag('--concurrency', '1'));
const skipBuild = process.argv.includes('--skip-build');
const dryRun = process.argv.includes('--dry-run');

const cells = [];
for (const task of manifest.pilot.tasks) {
  for (const arm of manifest.pilot.arms) {
    cells.push({ task, arm });
  }
}

if (dryRun) {
  console.log('Publish pilot matrix (dry run):');
  for (const cell of cells) {
    console.log(`- ${cell.task} × ${cell.arm} × ${attempts} (${model})`);
  }
  process.exit(0);
}

if (!skipBuild) {
  const build = spawnSync('npm', ['run', 'bench:build'], { cwd: ROOT, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
  const validate = spawnSync('npm', ['run', 'bench:validate'], { cwd: ROOT, stdio: 'inherit' });
  if (validate.status !== 0) process.exit(validate.status ?? 1);
}

let failed = 0;
for (const [index, cell] of cells.entries()) {
  const label = `${cell.task} × ${cell.arm}`;
  console.log(`\n[${index + 1}/${cells.length}] ${label}`);
  const args = [
    'benchmarks/scripts/run-harbor-arm.mjs',
    '--arm', cell.arm,
    '--task', cell.task,
    '--attempts', String(attempts),
    '--concurrency', String(concurrency),
    '--model', model,
    '--job-name', `publish-${cell.task}-${cell.arm}-${Date.now()}`,
  ];
  const result = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    failed += 1;
    console.error(`FAILED: ${label}`);
  }
}

const harvest = spawnSync('npm', ['run', 'bench:harvest'], { cwd: ROOT, stdio: 'inherit' });
if (harvest.status !== 0) failed += 1;

if (failed) {
  console.error(`\nPublish pilot finished with ${failed} failed cell(s).`);
  process.exit(1);
}
console.log(`\nPublish pilot complete: ${cells.length} cells × ${attempts} attempt(s).`);
