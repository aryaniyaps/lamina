#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-limit-cleanup-'));
const scratch = fs.mkdtempSync(path.join(process.cwd(), '.safe-runner-limit-cleanup-'));
const report = path.join(root, 'report.json');
const phases = path.join(root, 'phases.txt');
const graphRepository = path.join(scratch, 'graph-repository');
fs.mkdirSync(graphRepository);
assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: graphRepository }).status, 0);
const child = spawn(process.execPath, [
  'tests/fixtures/safe-runner-limit-controller.mjs', process.cwd(), report,
  graphRepository, phases,
], {
  cwd: process.cwd(), stdio: 'ignore',
  env: { ...process.env, LAMINA_SAFE_RUNNER_STATE_DIR: path.join(root, 'state') },
});
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 15_000);
try {
  await once(child, 'exit');
  clearTimeout(timer);
  const trace = fs.existsSync(phases) ? fs.readFileSync(phases, 'utf8') : '';
  assert.equal(timedOut, false, `killed-wrapper cleanup hung; phases:\n${trace}`);
  assert.match(trace, /finally:broker-closed/);
  assert.match(trace, /finally:output-(?:closed|close-timeout)/);
  assert.match(trace, /finally:complete/);
  assert.match(trace, /report:write-start/);
  const evidence = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.ok(['safety_limit_exceeded', 'internal_error'].includes(evidence.outcome));
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write('safe-runner killed-wrapper cleanup regression passed\n');
