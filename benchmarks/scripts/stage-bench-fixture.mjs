#!/usr/bin/env node
/**
 * Stage benchmark fixtures from benchmarks/fixtures/manifests.
 * Layers may reference evals/fixtures paths via "evals:" prefix.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BENCH_FIXTURES = path.join(ROOT, 'benchmarks/fixtures');
const EVALS_FIXTURES = path.join(ROOT, 'evals/fixtures');

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

function copyTree(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTree(srcPath, destPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function stageBenchFixture(name, outDir) {
  const manifest = loadBenchManifest(name);
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
  const outDir = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : path.join(ROOT, 'benchmarks/tmp', `fixture-${name}`);
  const manifest = stageBenchFixture(name, outDir);
  console.log(`Staged benchmark fixture "${manifest.name}" → ${outDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
