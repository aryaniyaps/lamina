import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS as BASELINE_SCENARIOS } from '../runtime-baseline-v1/contract.mjs';

export const QUALIFICATION_SCHEMA = 'lamina.runtime-qualification-result/v1';
export const MANIFEST_SCHEMA = 'lamina.runtime-qualification-manifest/v1';
export const INDEX_SCHEMA = 'lamina.runtime-qualification-index/v1';

export const PROFILES = Object.freeze(['16gb', '8gb']);
export const FIXTURES = Object.freeze(['small', 'medium', 'large']);
export const BASELINE_SCENARIOS_LIST = BASELINE_SCENARIOS;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_FILE = path.join(HERE, 'manifest.json');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function loadManifest() {
  const bytes = fs.readFileSync(MANIFEST_FILE);
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.version !== 1) {
    throw new Error('runtime qualification manifest is invalid');
  }
  return { manifest, digest: sha256(bytes), file: MANIFEST_FILE };
}

export function profileById(id) {
  const { manifest } = loadManifest();
  const profile = manifest.profiles.find((item) => item.id === id);
  if (!profile) throw new Error(`unknown qualification profile: ${id}`);
  return profile;
}

export function fixturesForProfile(profileId) {
  return [...profileById(profileId).fixtures];
}

export function latencyGate(manifest, gate, fixtureId) {
  const value = manifest.latency_gates_ns[gate];
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') return value[fixtureId] ?? null;
  return null;
}

export function nsToMs(ns) {
  return Number.isFinite(ns) ? Math.round(ns / 1_000_000) : null;
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
