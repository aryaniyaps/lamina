#!/usr/bin/env node
/**
 * Verify benchmarks/.env, Anthropic credentials, Docker, and Harbor CLI for live runs.
 */
import { loadBenchEnv, hasAnthropicCredentials, resolveBenchModel } from './load-bench-env.mjs';
import { readYamlSync } from './yaml.mjs';
import { isAgentAvailable } from '../../evals/scripts/invoke-agent.mjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROBE_TIMEOUT_MS = 180_000;

function which(cmd) {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function isDockerAvailable() {
  const r = spawnSync('docker', ['info'], { encoding: 'utf8', stdio: 'pipe' });
  return r.status === 0;
}

const { loaded, path: envPath } = loadBenchEnv();
const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
const model = resolveBenchModel(release);
const llmJudges = release.llm_judges || [];
const harbor = which('harbor');

console.log('LaminaBench environment check (Harbor / Design B)\n');
console.log(`  benchmarks/.env: ${loaded ? `loaded (${envPath})` : 'not found (using shell env only)'}`);
console.log(`  Model pin: ${model || '(none)'}`);
console.log(`  ANTHROPIC_BASE_URL: ${process.env.ANTHROPIC_BASE_URL || '(default api.anthropic.com)'}`);
console.log(
  `  Anthropic credentials: ${hasAnthropicCredentials() ? 'yes' : 'MISSING — set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY'}`
);
console.log(`  LLM judge: ${llmJudges.join(', ') || '(none)'} (Anthropic only)`);
console.log(`  Harbor CLI: ${harbor ? harbor : 'NOT FOUND — install: uv tool install harbor'}`);
console.log(`  Docker: ${isDockerAvailable() ? 'found' : 'NOT FOUND — required for harbor run'}`);
console.log(
  `  Claude CLI (claude-code): ${isAgentAvailable('claude-code') ? 'found on host' : 'optional on host (Harbor runs agent in container)'}`
);

let exitCode = 0;

if (!hasAnthropicCredentials()) exitCode = 1;
if (!harbor) exitCode = 1;
if (!isDockerAvailable()) exitCode = 1;

if (exitCode !== 0) {
  console.log('\nFix the issues above before running bench:all.');
  process.exit(exitCode);
}

const baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
const token = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;

function authHeaders() {
  return {
    authorization: `Bearer ${token}`,
    'x-api-key': token,
  };
}

async function fetchGatewayModels() {
  const res = await fetch(`${baseUrl}/v1/models`, { headers: authHeaders() });
  if (!res.ok) return null;
  const body = await res.json();
  return Array.isArray(body?.data) ? body.data.map((m) => m.id) : null;
}

async function probeGateway() {
  const url = `${baseUrl}/v1/messages`;
  const body = JSON.stringify({
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: 8,
    messages: [{ role: 'user', content: 'OK' }],
  });
  const headers = {
    'content-type': 'application/json',
    ...authHeaders(),
    'anthropic-version': '2023-06-01',
  };

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body,
      });
      const text = await res.text();
      if (res.ok) {
        console.log(`\n  Gateway probe (${url}): OK${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
        return;
      }
      if ([429, 502, 503, 504].includes(res.status) && attempt < 3) {
        lastError = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
    } catch (err) {
      lastError = err.name === 'AbortError' ? new Error(`timed out after ${PROBE_TIMEOUT_MS / 1000}s`) : err;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('Gateway probe failed');
}

if (process.env.ANTHROPIC_BASE_URL) {
  const catalog = await fetchGatewayModels();
  if (catalog?.length) {
    const sonnetIds = catalog.filter((id) => /sonnet/i.test(id));
    console.log(`\n  Gateway catalog: ${catalog.length} models (${sonnetIds.length} Sonnet)`);
    if (model && !catalog.includes(model)) {
      console.error(`\n  Model "${model}" is not in the gateway catalog.`);
      if (sonnetIds.length) {
        console.error(`  Available Sonnet models: ${sonnetIds.join(', ')}`);
      }
      exitCode = 1;
    }
  }
}

if (exitCode === 0) {
  try {
    await probeGateway();
  } catch (err) {
    const msg = err.name === 'AbortError' ? `timed out after ${PROBE_TIMEOUT_MS / 1000}s` : err.message;
    console.error(`\n  Gateway probe failed: ${msg}`);
    exitCode = 1;
  }
}

if (exitCode === 0) {
  console.log('\nReady for Harbor benchmark runs (npm run bench:all).');
  console.log('Sync workspaces: npm run bench:harbor:sync -- --tasks task001');
  console.log('Pilot: npm run bench:run -- --pilot --tasks task001 --runs 1');
} else {
  console.log('\nFix the issues above before running bench:all.');
}

process.exit(exitCode);
