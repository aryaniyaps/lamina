/**
 * Load benchmarks/.env into process.env (does not override existing shell vars).
 *
 * Supports optional `export` prefix and quoted values. Maps gateway credentials
 * for tools that expect ANTHROPIC_API_KEY (e.g. promptfoo) while preserving
 * ANTHROPIC_AUTH_TOKEN for Claude Code gateway auth.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_PATH = path.join(ROOT, 'benchmarks/.env');

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const withoutExport = trimmed.replace(/^export\s+/, '');
  const m = withoutExport.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) return null;
  let value = m[2].trim();
  const hash = value.indexOf(' #');
  if (hash !== -1) value = value.slice(0, hash).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [m[1], value];
}

export function loadBenchEnv() {
  if (!fs.existsSync(ENV_PATH)) return { loaded: false, path: ENV_PATH };

  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (process.env[key] === undefined) process.env[key] = value;
  }

  // promptfoo / Anthropic SDK expect ANTHROPIC_API_KEY; gateway setups use AUTH_TOKEN.
  if (!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_AUTH_TOKEN) {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_AUTH_TOKEN;
  }

  return { loaded: true, path: ENV_PATH };
}

/** Resolved model pin: env override → release.yaml → null */
export function resolveBenchModel(release) {
  return process.env.ANTHROPIC_MODEL || release?.model || null;
}

/** True when Anthropic credentials are available (direct API key or gateway token). */
export function hasAnthropicCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

loadBenchEnv();
