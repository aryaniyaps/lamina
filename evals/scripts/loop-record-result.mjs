#!/usr/bin/env node
/**
 * Update evals/tmp/loop-state.json from the latest with_skill grading.json.
 * Usage: node evals/scripts/loop-record-result.mjs <eval-id> <agent>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [evalId, agent] = process.argv.slice(2);
if (!evalId || !agent) {
  console.error('Usage: loop-record-result.mjs <eval-id> <agent>');
  process.exit(2);
}

const gradingPath = path.join(
  ROOT,
  'eval-workspace/lamina-workspace/iteration-1',
  `eval-${evalId}`,
  agent,
  'with_skill',
  'grading.json',
);
const statePath = path.join(ROOT, 'evals/tmp/loop-state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

function isPass(grading) {
  if (!grading?.assertion_results?.length) return false;
  const byText = new Map();
  for (const a of grading.assertion_results) {
    const list = byText.get(a.text) || [];
    list.push(a);
    byText.set(a.text, list);
  }
  // Lamina post-grade hooks are authoritative for domain assertions. Accept when
  // every distinct assertion text has at least one non-skipped pass (hook may
  // override a flaky LLM fail/skip on the same text).
  for (const [, list] of byText) {
    const covered = list.some((a) => a.passed && !a.skipped);
    if (!covered) return false;
  }
  return byText.size > 0;
}

let status = 'fail';
let detail = { missing: true };
if (fs.existsSync(gradingPath)) {
  const grading = JSON.parse(fs.readFileSync(gradingPath, 'utf8'));
  status = isPass(grading) ? 'pass' : 'fail';
  detail = grading.summary;
} else {
  status = 'fail';
}

state.cases[evalId] = state.cases[evalId] || {};
state.cases[evalId][agent] = status;
state.current = { id: evalId, agent };
if (status === 'fail') {
  state.last_failure = { id: evalId, agent, detail, at: new Date().toISOString() };
} else if (state.last_failure?.id === evalId && state.last_failure?.agent === agent) {
  state.last_failure = null;
}
state.updated_at = new Date().toISOString();
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
console.log(JSON.stringify({ evalId, agent, status, detail }));
process.exit(status === 'pass' ? 0 : 1);
