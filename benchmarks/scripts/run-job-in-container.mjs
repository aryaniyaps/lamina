#!/usr/bin/env node
/**
 * In-container entrypoint for a single LaminaBench workflow job.
 * Reads /meta/task.json, runs control or treatment workflow in /workspace,
 * writes /meta/result.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { runControlWorkflow, runTreatmentWorkflow } from './bench-workflow.mjs';

const WORKSPACE = '/workspace';
const META_DIR = '/meta';

function parseArgs() {
  const opts = { arm: null, agent: 'claude-code' };
  const armIdx = process.argv.indexOf('--arm');
  if (armIdx !== -1) opts.arm = process.argv[armIdx + 1];
  const agentIdx = process.argv.indexOf('--agent');
  if (agentIdx !== -1) opts.agent = process.argv[agentIdx + 1];
  return opts;
}

function writeResult(payload) {
  fs.mkdirSync(META_DIR, { recursive: true });
  fs.writeFileSync(path.join(META_DIR, 'result.json'), JSON.stringify(payload, null, 2));
}

async function main() {
  const opts = parseArgs();
  if (!opts.arm || !['control', 'treatment'].includes(opts.arm)) {
    throw new Error('Missing or invalid --arm (control|treatment)');
  }

  const taskPath = path.join(META_DIR, 'task.json');
  if (!fs.existsSync(taskPath)) {
    throw new Error(`Missing ${taskPath}`);
  }

  const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  const start = Date.now();

  let workflowResult;
  if (opts.arm === 'treatment') {
    workflowResult = await runTreatmentWorkflow(opts.agent, WORKSPACE, task);
  } else {
    workflowResult = await runControlWorkflow(opts.agent, WORKSPACE, task);
  }

  writeResult({
    ok: true,
    duration_ms: Date.now() - start,
    ...workflowResult,
  });
}

main().catch((err) => {
  writeResult({
    ok: false,
    error: err.message,
    stack: err.stack,
    status: 'container_error',
    artifact: '',
    artifact_valid: false,
    steps: [],
    workflow: null,
    phases: null,
    total_tokens: null,
    cost_usd: null,
    failed_gate: null,
  });
  console.error(err);
  process.exit(1);
});
