#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSafeRunnerContext } from '../../scripts/safe-runner/context.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assertSafeRunnerContext('reference evaluation matrix', { minimumTier: 'medium' });
const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'evals/reference-smoke/ids.json'), 'utf8')).ids;
const iteration = path.join(ROOT, 'eval-workspace/lamina-workspace/iteration-1');
const matrixEnv = {
  ...process.env,
  LAMINA_EVAL_CLAUDE_MODEL: process.env.LAMINA_EVAL_CLAUDE_MODEL || 'gpt-5.6-terra',
  LAMINA_EVAL_OPENCODE_MODEL: process.env.LAMINA_EVAL_OPENCODE_MODEL || 'openai/gpt-5.6-terra',
};

// Remove only the six generated matrix case directories so stale provider
// artifacts cannot satisfy a later qualification run.
for (const id of ids) {
  fs.rmSync(path.join(iteration, `eval-${id}`), { recursive: true, force: true });
}

for (const agent of ['claude-code', 'codex', 'opencode']) {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'evals/scripts/run-suite.mjs'),
    '--evals', './evals/lamina/evals.json',
    '--eval-ids-file', 'evals/reference-smoke/ids.json',
    '--agent', agent,
    '--runs', '1',
    '--no-baseline',
  ], { cwd: ROOT, env: matrixEnv, stdio: 'inherit' });
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

const verified = spawnSync(process.execPath, [path.join(ROOT, 'evals/scripts/verify-reference-matrix.mjs')], {
  cwd: ROOT,
  env: matrixEnv,
  stdio: 'inherit',
});
process.exit(verified.status ?? 1);
