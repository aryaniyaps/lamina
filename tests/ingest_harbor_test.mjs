#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { upsertIndexEntry, readIndexRows } from '../benchmarks/scripts/bench-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jobsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-ingest-'));
const jobName = '2026-07-11__pilot';
const trialName = 'task001-control__abc123';
const trialPath = path.join(jobsDir, jobName, trialName);
fs.mkdirSync(path.join(trialPath, 'verifier'), { recursive: true });
fs.mkdirSync(path.join(trialPath, 'agent'), { recursive: true });

fs.writeFileSync(
  path.join(trialPath, 'verifier', 'reward.json'),
  JSON.stringify({
    reward: 0.42,
    artifact_valid: true,
    golden_coverage: 55,
    llm_judge_mean: 3.5,
    judge_mode: 'heuristic',
    clarify_stall: false,
  }) + '\n'
);
fs.writeFileSync(
  path.join(trialPath, 'verifier', 'implementation.md'),
  '# LaminaBench implementation capture\n\nCaptured 2 source file(s): app/Home.tsx, app/api.ts\n\n## app/Home.tsx\n```\nexport default function Home() {}\n```\n'
);
fs.writeFileSync(path.join(trialPath, 'agent', 'stdout.txt'), 'normal output\n');

spawnSync(
  'node',
  ['benchmarks/scripts/ingest-harbor-results.mjs', '--jobs-dir', jobsDir, '--fresh'],
  { cwd: ROOT, stdio: 'inherit' }
);

const rows = readIndexRows(path.join(ROOT, 'benchmarks/results/raw'));
const row = rows.find((r) => r.task_id === 'task001' && r.arm === 'control');
assert.ok(row, 'ingested row missing');
assert.equal(row.runner, 'harbor');
assert.equal(row.harbor_reward, 0.42);
assert.equal(row.clarify_stall, false);

fs.rmSync(jobsDir, { recursive: true, force: true });
console.log('ingest_harbor_test: ok');
