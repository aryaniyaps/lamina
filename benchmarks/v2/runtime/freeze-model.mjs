#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAdapter } from './agent-adapters.mjs';

const [provider, model, outputPath] = process.argv.slice(2);
if (!provider || !model || !outputPath) {
  console.error('Usage: freeze-model.mjs <codex|claude-code> <model-or-alias> <manifest.json>');
  process.exit(1);
}
const adapter = createAdapter({ provider, model, reasoningEffort: 'low', effort: 'low' });
const preflight = adapter.preflight();
const auth = spawnSync(preflight.command, preflight.args, { encoding: 'utf8' });
if (auth.status !== 0) throw new Error(`${provider} authentication preflight failed`);
const invocation = adapter.start('Reply with exactly MODEL_READY. Do not use tools or edit files.');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-model-freeze-'));
const run = spawnSync(invocation.command, invocation.args, { cwd: workspace, encoding: 'utf8', timeout: 120000 });
fs.rmSync(workspace, { recursive: true, force: true });
if (run.status !== 0) throw new Error(`${provider} model resolution failed`);
const normalized = adapter.normalize(`${run.stdout}\n${run.stderr}`);
if (!normalized.resolved_model) throw new Error('Runtime did not report a resolved model');
const cli = spawnSync(invocation.command, ['--version'], { encoding: 'utf8' });
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ provider, requested_model: model, resolved_model: normalized.resolved_model, cli_version: `${cli.stdout || cli.stderr}`.trim().split('\n')[0], frozen_at: new Date().toISOString() }, null, 2)}\n`);
