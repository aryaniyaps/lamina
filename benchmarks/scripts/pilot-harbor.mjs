#!/usr/bin/env node
/**
 * Pilot: sync task001 Harbor tasks and validate structure (no live agent run).
 * Live pilot: npm run bench:run -- --tasks task001 --runs 1 (requires Docker + credentials).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.PATH = `${process.env.HOME}/.local/bin:${process.env.PATH}`;

const steps = [
  ['node', ['benchmarks/scripts/harbor-sync.mjs', '--tasks', 'task001']],
  ['node', ['tests/harbor_sync_test.mjs']],
];

for (const [cmd, args] of steps) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const control = path.join(ROOT, 'benchmarks/harbor/tasks/task001-control');
const treatment = path.join(ROOT, 'benchmarks/harbor/tasks/task001-treatment');
for (const dir of [control, treatment]) {
  if (!fs.existsSync(path.join(dir, 'instruction.md'))) {
    console.error(`Missing ${dir}/instruction.md`);
    process.exit(1);
  }
}

const harbor = spawnSync('sh', ['-c', 'command -v harbor'], { encoding: 'utf8' });
if (harbor.stdout.trim()) {
  console.log('\nOptional: harbor check benchmarks/harbor/tasks/task001-control (requires Docker)');
}

console.log('\nPilot sync OK. Live run:');
console.log('  npm run bench:run -- --tasks task001 --runs 1 --fresh');
