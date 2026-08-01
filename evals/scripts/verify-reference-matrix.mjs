#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ITERATION = path.join(ROOT, 'eval-workspace/lamina-workspace/iteration-1');
const IDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals/reference-smoke/ids.json'), 'utf8')).ids;
const AGENTS = ['claude-code', 'codex', 'opencode'];
const errors = [];
const cells = [];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

for (const evalId of IDS) {
  for (const agent of AGENTS) {
    const root = path.join(ITERATION, `eval-${evalId}`, agent, 'with_skill');
    const grading = readJson(path.join(root, 'grading.json'));
    const run = readJson(path.join(root, 'run_meta.json'));
    const outputPath = path.join(root, 'outputs/output.txt');
    const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (!grading || !run || !output) {
      errors.push(`${evalId}/${agent}: missing grading, run metadata, or output`);
      continue;
    }
    const failed = grading.summary?.failed ?? grading.assertion_results?.filter((item) => !item.passed).length;
    const skipped = grading.summary?.skipped ?? grading.assertion_results?.filter((item) => item.skipped).length;
    if (failed !== 0 || skipped !== 0 || grading.summary?.passed !== grading.summary?.total) {
      const failedNames = (grading.assertion_results || []).filter((item) => !item.passed || item.skipped).map((item) => item.text);
      errors.push(`${evalId}/${agent}: ${failed} failed, ${skipped} skipped — ${failedNames.join('; ')}`);
    }
    if (/API Error:|Failed to authenticate|timed out/i.test(output)) {
      errors.push(`${evalId}/${agent}: agent output contains a provider/runtime error`);
    }
    cells.push({
      eval_id: evalId,
      agent,
      run_id: run.run_id,
      assertions: grading.summary?.total,
      passed: grading.summary?.passed,
      output_sha256: crypto.createHash('sha256').update(output).digest('hex'),
    });
  }
}

if (cells.length !== IDS.length * AGENTS.length) {
  errors.push(`expected ${IDS.length * AGENTS.length} complete cells, found ${cells.length}`);
}

if (errors.length) {
  console.error('Reference matrix FAILED:\n');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const report = {
  schema: 'lamina.reference-matrix/v1',
  generated_at: new Date().toISOString(),
  eval_ids: IDS,
  agents: AGENTS,
  qualification_models: {
    claude_code_proxy: process.env.LAMINA_EVAL_CLAUDE_MODEL || 'gpt-5.6-terra',
    opencode: process.env.LAMINA_EVAL_OPENCODE_MODEL || 'openai/gpt-5.6-terra',
    codex: 'provider default',
  },
  cells,
};
const reportPath = path.join(ROOT, 'evals/reports/reference-matrix.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Reference matrix passed: ${cells.length}/${cells.length} cells → ${path.relative(ROOT, reportPath)}`);
