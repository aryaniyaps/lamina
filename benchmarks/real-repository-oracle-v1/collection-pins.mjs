import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadManifest } from '../runtime-baseline-v1/contract.mjs';

const manifestBytes = fs.readFileSync(new URL('../runtime-baseline-v1/manifest.json', import.meta.url));
const { manifest: loadedManifest } = loadManifest();

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const manifest = deepFreeze(structuredClone(loadedManifest));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(
    typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value)),
  ).digest('hex');
}

export const BASELINE_MANIFEST_SHA256 = '9e8319288d69b77f77f2b3e386c868f83e62a1b7032ca4f3deb443acf60bb3ba';
export function reviewedManifestDigest(bytes) {
  return digest(Buffer.from(Buffer.from(bytes).toString('utf8').replaceAll('\r\n', '\n')));
}
if (reviewedManifestDigest(manifestBytes) !== BASELINE_MANIFEST_SHA256) {
  throw new Error('runtime baseline manifest bytes no longer match the reviewed #60 identity');
}

const COLLECTION_TREE_OIDS = Object.freeze({
  small: 'b03782f905ffcd394bdaf597c06322afbc8ed991',
  medium: '1ada87cb0c8c8066fd8f8df2401c187c05632e9d',
  large: '382c6539083af65e86cdddbffd4e09884773e64e',
});

export const COLLECTION_PINS = Object.freeze(Object.fromEntries(manifest.fixtures.map((fixture) => [
  fixture.id,
  Object.freeze({
    fixture_id: fixture.id,
    fixture_class: fixture.class,
    repository_url: fixture.url,
    commit: fixture.commit,
    tree_oid: COLLECTION_TREE_OIDS[fixture.id],
  }),
])));

export const CANDIDATE_POLICY_SHA256 = digest({
  source_extensions: manifest.source_extensions,
  retrieval_extensions: manifest.retrieval_extensions,
  retrieval_max_file_bytes: manifest.retrieval_max_file_bytes,
  exclusions: manifest.exclusions,
});

export function pinnedCollectionForTier(tier) {
  const pin = COLLECTION_PINS[tier];
  if (!pin || pin.fixture_id !== tier || pin.fixture_class !== tier) {
    throw new Error('real-repository inventory work requires an exact signed collection tier');
  }
  const fixture = manifest.fixtures.find((candidate) => candidate.id === tier);
  if (!fixture || fixture.class !== pin.fixture_class || fixture.url !== pin.repository_url
    || fixture.commit !== pin.commit) {
    throw new Error(`real-repository ${tier} pin no longer matches the reviewed #60 manifest`);
  }
  return Object.freeze({
    ...pin,
    baseline_manifest_sha256: BASELINE_MANIFEST_SHA256,
    candidate_policy_sha256: CANDIDATE_POLICY_SHA256,
    manifest,
    fixture,
  });
}
