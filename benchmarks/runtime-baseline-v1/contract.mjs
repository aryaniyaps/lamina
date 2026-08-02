import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_SCHEMA = 'lamina.runtime-baseline-result/v1';
export const WORKLOAD_SCHEMA = 'lamina.runtime-baseline-workload/v1';
export const MANIFEST_SCHEMA = 'lamina.runtime-baseline-manifest/v1';
export const SCENARIOS = Object.freeze([
  'footprint',
  'doctor-status-startup',
  'initial-observation',
  'initial-retrieval-readiness',
  'first-useful-preparation',
  'warm-preparation',
  'noop-synchronization',
  'one-file-change',
  'multi-file-change',
  'full-derived-state-rebuild',
  'post-command-idle-rss',
  'cancellation-shutdown-cleanup',
]);
export const COLD_RUNS = 3;
export const WARM_SAMPLES = 30;
export const WARMUP_SAMPLES = 1;
export const MAX_WORKLOAD_OUTPUT_BYTES = 7 * 1024;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_FILE = path.join(HERE, 'manifest.json');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function loadManifest() {
  const bytes = fs.readFileSync(MANIFEST_FILE);
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.version !== 1
    || !Array.isArray(manifest.fixtures) || manifest.fixtures.length !== 3) {
    throw new Error('runtime baseline manifest is invalid');
  }
  return { manifest, digest: sha256(bytes), file: MANIFEST_FILE };
}

export function fixtureById(id) {
  const { manifest } = loadManifest();
  const fixture = manifest.fixtures.find((item) => item.id === id);
  if (!fixture) throw new Error(`unknown runtime baseline fixture: ${id}`);
  return fixture;
}

export function assertScenario(scenario) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`unknown runtime baseline scenario: ${scenario}`);
  return scenario;
}

export function summarizeNanoseconds(samples, warm) {
  if (!Array.isArray(samples) || samples.length === 0
    || samples.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('latency samples must be non-empty non-negative safe integers');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1];
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  return {
    count: samples.length,
    median,
    maximum: sorted.at(-1),
    p90: warm && samples.length >= WARM_SAMPLES ? percentile(0.90) : null,
    p95: warm && samples.length >= WARM_SAMPLES ? percentile(0.95) : null,
  };
}
