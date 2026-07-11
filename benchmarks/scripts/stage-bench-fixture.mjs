#!/usr/bin/env node
/**
 * Stage benchmark fixtures from benchmarks/fixtures/manifests.
 * Layers may reference evals/fixtures paths via "evals:" prefix.
 * Cache key = hash(manifest + layer paths) so manifest/layer changes invalidate.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { copyTree } from '../../evals/scripts/vendor-fixture-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BENCH_FIXTURES = path.join(ROOT, 'benchmarks/fixtures');
const EVALS_FIXTURES = path.join(ROOT, 'evals/fixtures');
const FIXTURE_CACHE = path.join(ROOT, 'benchmarks/tmp/fixture-cache');

export function loadBenchManifest(name) {
  const manifestPath = path.join(BENCH_FIXTURES, 'manifests', `${name}.json`);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Unknown benchmark fixture manifest: ${name}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.layers?.length) {
    throw new Error(`Manifest ${name} has no layers`);
  }
  return manifest;
}

function resolveLayerRoot(layer) {
  if (layer.startsWith('evals:')) {
    return path.join(EVALS_FIXTURES, layer.slice('evals:'.length));
  }
  return path.join(BENCH_FIXTURES, layer);
}

function stageToDir(manifest, outDir) {
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const layer of manifest.layers) {
    const src = resolveLayerRoot(layer);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing fixture layer: ${layer} (${src})`);
    }
    copyTree(src, outDir);
  }
}

/** Stable cache key from manifest contents + resolved layer paths. */
export function fixtureCacheKey(name, manifest) {
  const hash = crypto.createHash('sha256');
  hash.update(name);
  hash.update(JSON.stringify(manifest.layers || []));
  for (const layer of manifest.layers || []) {
    hash.update(resolveLayerRoot(layer));
  }
  return hash.digest('hex').slice(0, 12);
}

function ensureFixtureCache(name) {
  const manifest = loadBenchManifest(name);
  const key = fixtureCacheKey(name, manifest);
  const cacheDir = path.join(FIXTURE_CACHE, `${name}-${key}`);
  const stamp = path.join(cacheDir, '.fixture-cache-key');

  if (fs.existsSync(cacheDir) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === key) {
    return cacheDir;
  }

  // Drop legacy unhashed cache dir if present
  const legacy = path.join(FIXTURE_CACHE, name);
  if (fs.existsSync(legacy)) {
    try {
      fs.rmSync(legacy, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
  stageToDir(manifest, cacheDir);
  fs.writeFileSync(stamp, key + '\n');
  return cacheDir;
}

export function stageBenchFixture(name, outDir) {
  const manifest = loadBenchManifest(name);
  const cacheDir = ensureFixtureCache(name);
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });
  copyTree(cacheDir, outDir);
  // Don't copy cache stamp into workspace
  const stamp = path.join(outDir, '.fixture-cache-key');
  if (fs.existsSync(stamp)) fs.unlinkSync(stamp);
  return manifest;
}

function main() {
  const args = process.argv.slice(2);
  const name = args[0];
  if (!name) {
    console.error('Usage: node benchmarks/scripts/stage-bench-fixture.mjs <manifest> --out <dir>');
    process.exit(1);
  }
  const outIdx = args.indexOf('--out');
  const outDir =
    outIdx !== -1 ? path.resolve(args[outIdx + 1]) : path.join(ROOT, 'benchmarks/tmp', `fixture-${name}`);
  const manifest = stageBenchFixture(name, outDir);
  console.log(`Staged benchmark fixture "${manifest.name}" → ${outDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
