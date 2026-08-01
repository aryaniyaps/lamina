#!/usr/bin/env node
/**
 * Aggregate eval reports from agent-skills-eval and agent-skill-eval workspaces.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPORTS = path.join(ROOT, 'evals/reports');

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function latestIteration(dir) {
  if (!fs.existsSync(dir)) return null;
  const iters = fs
    .readdirSync(dir)
    .filter((n) => /^iteration-\d+$/.test(n))
    .sort((a, b) => parseInt(b.split('-')[1], 10) - parseInt(a.split('-')[1], 10));
  return iters[0] ?? null;
}

const out = {
  timestamp: new Date().toISOString(),
  portable: null,
  harness: {},
  compatibility: readJsonSafe(path.join(REPORTS, 'compatibility-matrix.json')),
  promptfoo: readJsonSafe(path.join(REPORTS, 'promptfoo-redteam.json')),
};

const portableWs = path.join(ROOT, 'evals/workspace');
const portableIter = latestIteration(portableWs);
if (portableIter) {
  out.portable = readJsonSafe(path.join(portableWs, portableIter, 'benchmark.json'));
}

function findHarnessWorkspaces(dir, depth = 0) {
  if (!fs.existsSync(dir) || depth > 3) return [];
  const found = latestIteration(dir) ? [dir] : [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    found.push(...findHarnessWorkspaces(path.join(dir, entry.name), depth + 1));
  }
  return found;
}

const harnessRoots = [path.join(ROOT, 'eval-workspace'), path.join(ROOT, 'evals/workspace')];
for (const ws of harnessRoots.flatMap((root) => findHarnessWorkspaces(root))) {
  const iter = latestIteration(ws);
  if (!iter) continue;
  const summary = readJsonSafe(path.join(ws, iter, 'summary.json'));
  const benchmark = readJsonSafe(path.join(ws, iter, 'benchmark.json'));
  out.harness[path.relative(ROOT, ws)] = { summary, benchmark };
}

const iterNum = Date.now();
const outDir = path.join(REPORTS, `iteration-${iterNum}`);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'combined-benchmark.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${path.join(outDir, 'combined-benchmark.json')}`);
