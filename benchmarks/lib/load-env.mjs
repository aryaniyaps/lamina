import fs from 'node:fs';
import path from 'node:path';

export function parseEnvFile(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const withoutExport = trimmed.replace(/^export\s+/, '');
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function rootEnvPath(root) {
  return path.join(root, '.env');
}

export function loadBenchEnv(root) {
  const filePath = rootEnvPath(root);
  if (!fs.existsSync(filePath)) return {};
  return parseEnvFile(fs.readFileSync(filePath, 'utf8'));
}

export function applyBenchEnv(root) {
  const env = loadBenchEnv(root);
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') process.env[key] = value;
  }
  return env;
}

export function resolveAnthropicCredential(env = process.env) {
  return env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || '';
}

export function resolveCursorCredential(env = process.env) {
  return env.CURSOR_API_KEY || env.CURSOR_AUTH_TOKEN || '';
}

export function pickEnvFile(root) {
  const filePath = rootEnvPath(root);
  return fs.existsSync(filePath) ? filePath : null;
}
