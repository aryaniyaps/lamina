#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAdapter } from './agent-adapters.mjs';
import { auditIsolation, prepareRuntimeHome, scrubRuntimeCredentials } from './isolation.mjs';
import { runtimeFingerprint } from './freeze-lib.mjs';

const V2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = JSON.parse(fs.readFileSync(path.join(V2, 'release.json'), 'utf8'));
const modelConfigs = [...release.cohorts, release.model_judge].filter(Boolean);
const adapters = [...new Map(modelConfigs.map((cohort) => [cohort.provider, createAdapter({ provider: cohort.provider, model: cohort.model || cohort.model_alias || cohort.resolved_model })])).values()];
const primary = release.cohorts.find((cohort) => cohort.id === release.primary_cohort);

function authStatus(adapter) {
  const command = adapter.preflight();
  const result = spawnSync(command.command, command.args, { encoding: 'utf8', timeout: 30000 });
  const raw = `${result.stdout || result.stderr || ''}`;
  if (adapter.provider === 'codex') return { provider: adapter.provider, authenticated: result.status === 0 && /logged in/i.test(raw), auth_method: /ChatGPT/i.test(raw) ? 'chatgpt_subscription' : 'unknown', exit_code: result.status };
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  return { provider: adapter.provider, authenticated: result.status === 0 && parsed.loggedIn === true, auth_method: parsed.authMethod || 'unknown', subscription_type: parsed.subscriptionType || null, exit_code: result.status };
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-v2-preflight-workspace-'));
const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-v2-preflight-home-'));
prepareRuntimeHome(primary.provider, runtimeHome);
const isolation = auditIsolation(workspace, runtimeHome);
scrubRuntimeCredentials(runtimeHome);
fs.rmSync(workspace, { recursive: true, force: true });
fs.rmSync(runtimeHome, { recursive: true, force: true });

const auth = adapters.map(authStatus);
const report = {
  checked_at: new Date().toISOString(),
  runtime: runtimeFingerprint(),
  authentication: auth,
  isolation,
  cohorts: release.cohorts.map((cohort) => ({ id: cohort.id, provider: cohort.provider, requested_model: cohort.model || cohort.model_alias || null, resolved_model: cohort.resolved_model || null, freeze_status: cohort.resolved_model ? 'pinned' : 'requires_model_lock' })),
  model_judge: release.model_judge ? { id: release.model_judge.id, provider: release.model_judge.provider, requested_model: release.model_judge.model || release.model_judge.model_alias || null, resolved_model: release.model_judge.resolved_model || null, freeze_status: release.model_judge.resolved_model ? 'pinned' : 'requires_model_lock' } : null,
  ready_for_development_primary: auth.find((item) => item.provider === primary.provider)?.authenticated === true && isolation.passed,
  ready_for_publication_freeze: modelConfigs.every((cohort) => cohort.resolved_model) && auth.every((item) => item.authenticated),
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex !== -1) {
  const output = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
if (!report.ready_for_development_primary) process.exitCode = 1;
