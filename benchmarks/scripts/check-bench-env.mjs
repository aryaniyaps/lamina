#!/usr/bin/env node
/** Verify Codex subscription auth, model pin, Docker, and Harbor for live runs. */
import { loadBenchEnv, hasCodexSubscriptionCredentials, resolveBenchModel } from './load-bench-env.mjs';
import { readYamlSync } from './yaml.mjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const which = (cmd) => {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
const dockerReady = () => spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

const { loaded, path: envPath } = loadBenchEnv();
const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
let model;
try { model = resolveBenchModel(release); } catch (err) {
  console.error(`Model pin error: ${err.message}`);
  process.exit(1);
}
const authPath = process.env.CODEX_AUTH_JSON_PATH || path.join(process.env.HOME || '', '.codex', 'auth.json');
const harbor = which('harbor');
const codex = which('codex');
const authReady = hasCodexSubscriptionCredentials();

console.log('LaminaBench environment check (Harbor + Codex)\n');
console.log(`  benchmarks/.env: ${loaded ? `loaded (${envPath})` : 'not found (using shell env only)'}`);
console.log(`  Agent: ${release.agent}`);
console.log(`  Model pin: ${model || '(none)'}`);
console.log(`  ChatGPT subscription auth: ${authReady ? `found (${authPath})` : `MISSING (${authPath}) — run codex login`}`);
console.log(`  Codex CLI: ${codex || 'NOT FOUND — install @openai/codex'}`);
console.log(`  Harbor CLI: ${harbor || 'NOT FOUND — install: uv tool install harbor'}`);
console.log(`  Docker: ${dockerReady() ? 'found' : 'NOT FOUND — required'}`);
console.log(`  LLM judge: ${(release.llm_judges || []).join(', ') || '(none)'}`);
console.log('  Judge auth: ChatGPT subscription (same Codex login; no API key)');

if (!authReady || !codex || !harbor || !dockerReady() || !model) {
  console.log('\nFix the issues above before running bench:all.');
  process.exit(1);
}
console.log('\nReady for Codex-hosted Harbor benchmark runs (npm run bench:all).');
