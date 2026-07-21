#!/usr/bin/env node
/**
 * Run the next N incomplete eval ids (suite order) across all agents.
 * Stops on first uncovered failure. Usage:
 *   node evals/scripts/loop-next-batch.mjs [--limit 8]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : 8;

const statePath = path.join(ROOT, 'evals/tmp/loop-state.json');
const evals = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals/lamina/evals.json'), 'utf8')).evals;
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const agents = state.agents || ['claude-code', 'codex', 'opencode'];

const pendingIds = [];
for (const ev of evals) {
  const incomplete = agents.some((a) => (state.cases[ev.id]?.[a] || 'pending') !== 'pass');
  if (incomplete) pendingIds.push(ev.id);
}

const batch = pendingIds.slice(0, limit);
console.log(`Batch ${batch.length}/${pendingIds.length} remaining cases: ${batch.join(', ')}`);

for (const id of batch) {
  for (const agent of agents) {
    const cur = state.cases[id]?.[agent] || 'pending';
    if (cur === 'pass') {
      console.log(`SKIP ${id}/${agent}`);
      continue;
    }
    console.log(`===== ${id} / ${agent} =====`);
    const run = spawnSync(
      'node',
      [
        path.join(ROOT, 'evals/scripts/run-suite.mjs'),
        '--evals',
        './evals/lamina/evals.json',
        '--eval-id',
        id,
        '--agent',
        agent,
        '--runs',
        '1',
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'inherit',
        env: { ...process.env, ASE_AGENT_TIMEOUT: process.env.ASE_AGENT_TIMEOUT || '900' },
      },
    );
    const logPath = path.join(ROOT, 'evals/tmp', `loop-${id}-${agent}.log`);
    // run-suite already teed by caller if desired; record result
    const rec = spawnSync('node', [path.join(ROOT, 'evals/scripts/loop-record-result.mjs'), id, agent], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'inherit',
    });
    // reload state
    Object.assign(state, JSON.parse(fs.readFileSync(statePath, 'utf8')));
    if ((rec.status ?? 1) !== 0) {
      console.error(`STOP_FAIL ${id} ${agent}`);
      process.exit(1);
    }
    if ((run.status ?? 1) !== 0) {
      // ASE often exits 0 even on grading fails; recording is authoritative
    }
  }
  console.log(`CASE_PASS ${id}`);
  fs.appendFileSync(
    path.join(ROOT, 'evals/feedback/loop-log.md'),
    `\n## ${new Date().toISOString()} — ${id} ALL AGENTS PASS\n`,
  );
}

console.log('BATCH_DONE');
const fresh = JSON.parse(fs.readFileSync(statePath, 'utf8'));
let pass = 0;
let pending = 0;
for (const ev of evals) {
  for (const a of agents) {
    const v = fresh.cases[ev.id]?.[a] || 'pending';
    if (v === 'pass') pass++;
    else pending++;
  }
}
console.log(JSON.stringify({ pass, pending }));
process.exit(0);
