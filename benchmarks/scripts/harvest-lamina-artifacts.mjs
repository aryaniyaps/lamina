#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const harvestRoot = path.join(ROOT, 'benchmarks/results/harvested-lamina');
const scanRoots = [
  path.join(ROOT, 'jobs'),
  path.join(ROOT, 'benchmarks/results'),
];

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let entries;
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM') return;
    throw error;
  }
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    try {
      if (entry.isDirectory()) copyTree(from, to);
      else fs.copyFileSync(from, to);
    } catch (error) {
      if (error?.code === 'EACCES' || error?.code === 'EPERM') continue;
      throw error;
    }
  }
}

function walk(dir, visitor, depth = 0) {
  if (!fs.existsSync(dir) || depth > 24) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'sessions') continue;
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name === '.lamina') {
      visitor(full);
      continue;
    }
    walk(full, visitor, depth + 1);
  }
}

let copied = 0;
for (const root of scanRoots) {
  walk(root, (laminaDir) => {
    const rel = path.relative(ROOT, laminaDir);
    const target = path.join(harvestRoot, rel);
    copyTree(laminaDir, target);
    copied += 1;
  });
}

console.log(copied ? `Harvested ${copied} .lamina tree(s) to ${harvestRoot}` : 'No .lamina directories found under jobs/ or benchmarks/results');
