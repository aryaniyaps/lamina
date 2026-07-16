#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAdapter } from './agent-adapters.mjs';
import { snapshotWorkspace } from './workspace-snapshot.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) { result[argv[index].slice(2)] = argv[++index]; }
  }
  return result;
}

function run(adapter, sessionId, prompt, cwd, timeout) {
  const invocation = sessionId ? adapter.resume(sessionId, prompt) : adapter.start(prompt);
  const startedAt = new Date().toISOString();
  const child = spawnSync(invocation.command, invocation.args, { cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  if (child.status !== 0) throw new Error(`Transfer phase failed: ${child.stderr || child.stdout}`);
  const normalized = adapter.normalize(`${child.stdout || ''}\n${child.stderr || ''}`);
  return { sessionId: normalized.session_id || sessionId || invocation.sessionId, telemetry: { provider: adapter.provider, model: adapter.model, resolved_model: normalized.resolved_model, session_id: normalized.session_id || sessionId || invocation.sessionId, started_at: startedAt, ended_at: new Date().toISOString(), exit_code: child.status || 0, input_tokens: normalized.input_tokens, output_tokens: normalized.output_tokens, tool_calls: normalized.tool_calls, retries: 0 } };
}

const config = parseArgs(process.argv);
for (const key of ['contract', 'brief', 'workspace', 'output', 'provider', 'model']) if (!config[key]) throw new Error(`Missing --${key}`);
const extension = path.extname(config.contract) || '.txt';
const destination = path.join(config.workspace, `implementation-contract${extension}`);
fs.copyFileSync(config.contract, destination);
const brief = fs.readFileSync(config.brief, 'utf8');
const adapter = createAdapter({ provider: config.provider, model: config.model });
const timeout = Number(config.timeout || 7200) * 1000;
const telemetry = [];
let sessionId = null;
const phase = (name, prompt) => {
  const result = run(adapter, sessionId, `${prompt}\n\n## Original brief\n${brief}\n\n## Frozen contract\nRead ${path.basename(destination)}. You cannot ask the contract author for missing decisions; make only labeled, coherent implementation assumptions.`, config.workspace, timeout);
  sessionId = result.sessionId;
  telemetry.push({ ...result.telemetry, phase: name });
};
phase('transfer_implement', 'Implement the product from the frozen contract completely. Run appropriate validation.');
snapshotWorkspace(config.workspace, path.join(config.output, 'product-stages', 'after-implement'));
phase('transfer_review', 'Review the implementation against the frozen contract and brief. Write transfer-review.md and transfer-fix-list.md without editing application source.');
phase('transfer_fix', 'Implement transfer-fix-list.md completely and run appropriate validation.');
snapshotWorkspace(config.workspace, path.join(config.output, 'product-stages', 'after-fix'));
fs.mkdirSync(config.output, { recursive: true });
fs.writeFileSync(path.join(config.output, 'telemetry.json'), `${JSON.stringify(telemetry, null, 2)}\n`);
fs.writeFileSync(path.join(config.output, 'transfer.json'), `${JSON.stringify({ provider: config.provider, model: config.model, session_id: sessionId, contract_file: path.basename(destination), product_stages: ['after-implement', 'after-fix'] }, null, 2)}\n`);
