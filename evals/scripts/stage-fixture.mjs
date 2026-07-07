#!/usr/bin/env node
/**
 * Stage a composite eval fixture from manifests + layers into an output directory.
 * Usage: node evals/scripts/stage-fixture.mjs <manifest-name> --out <dir>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = path.join(ROOT, 'evals/fixtures');

export function loadManifest(name) {
  const manifestPath = path.join(FIXTURES, 'manifests', `${name}.json`);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Unknown fixture manifest: ${name} (${manifestPath})`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.layers?.length) {
    throw new Error(`Manifest ${name} has no layers`);
  }
  return manifest;
}

export function resolveManifestFiles(name) {
  const manifest = loadManifest(name);
  const files = [];
  for (const layer of manifest.layers) {
    const layerRoot = path.join(FIXTURES, layer);
    if (!fs.existsSync(layerRoot)) {
      throw new Error(`Missing layer: ${layer}`);
    }
    for (const rel of walkFiles(layerRoot)) {
      files.push(path.join(layer, rel));
    }
  }
  return { manifest, files };
}

function walkFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

function copyLayer(layerRel, outDir) {
  const src = path.join(FIXTURES, layerRel);
  if (!fs.existsSync(src)) throw new Error(`Missing layer: ${layerRel}`);
  copyTree(src, outDir);
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

export function stageFixture(name, outDir) {
  const manifest = loadManifest(name);
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const layer of manifest.layers) {
    copyLayer(layer, outDir);
  }
  return manifest;
}

function main() {
  const args = process.argv.slice(2);
  const name = args[0];
  if (!name || name.startsWith('-')) {
    console.error('Usage: node evals/scripts/stage-fixture.mjs <manifest-name> --out <dir>');
    process.exit(1);
  }
  const outIdx = args.indexOf('--out');
  const outDir = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : path.join(ROOT, 'evals/workspace', `fixture-${name}`);
  const manifest = stageFixture(name, outDir);
  console.log(`Staged fixture "${manifest.name}" (${manifest.layers.length} layers) → ${outDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
