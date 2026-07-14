/**
 * Load benchmarks/.env into process.env (does not override existing shell vars).
 *
 * Supports optional `export` prefix and quoted values. Maps gateway credentials
 * for tools that expect ANTHROPIC_API_KEY (e.g. Rewardkit LLM judge) while preserving
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

  // Anthropic SDK / Rewardkit expect ANTHROPIC_API_KEY; gateway setups use AUTH_TOKEN.
  if (!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_AUTH_TOKEN) {
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_AUTH_TOKEN;
  }

  return { loaded: true, path: ENV_PATH };
}

/** Resolved model pin: release.yaml is authoritative.
 * Env ANTHROPIC_MODEL may only differ when LAMINA_BENCH_ALLOW_MODEL_OVERRIDE=1.
 */
export function resolveBenchModel(release, { allowOverride } = {}) {
  const pinned = release?.model || null;
  const envModel = process.env.ANTHROPIC_MODEL || null;
  const override =
    allowOverride === true ||
    allowOverride === false
      ? allowOverride
      : process.env.LAMINA_BENCH_ALLOW_MODEL_OVERRIDE === '1';

  if (envModel && pinned && envModel !== pinned) {
    if (!override) {
      throw new Error(
        `ANTHROPIC_MODEL=${envModel} differs from release.yaml model=${pinned}. ` +
          `Update release.yaml to the model you intend to pin, or set LAMINA_BENCH_ALLOW_MODEL_OVERRIDE=1.`
      );
    }
    console.warn(
      `[bench] model override: using ${envModel} (release pin was ${pinned}; LAMINA_BENCH_ALLOW_MODEL_OVERRIDE=1)`
    );
    return envModel;
  }
  return envModel || pinned;
}

/** True when Anthropic credentials are available (direct API key or gateway token). */
export function hasAnthropicCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

loadBenchEnv();
