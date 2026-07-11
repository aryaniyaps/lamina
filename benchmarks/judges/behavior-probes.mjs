#!/usr/bin/env node
/**
 * Structural behavior-probe scorer (stricter than golden phrase coverage).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from '../scripts/yaml.mjs';
import { loadScoreableIndex } from '../scripts/bench-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');
const PROBES_DIR = path.join(ROOT, 'benchmarks/probes');
const SCORED_DIR = path.join(ROOT, 'benchmarks/results/scored');

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/#(?!\!).*$/gm, '');
}

function matchPatterns(patterns, text) {
  if (!patterns?.length) return false;
  for (const pat of patterns) {
    try {
      const body = String(pat).replace(/\(\?[ims]+\)/g, '');
      if (new RegExp(body, 'is').test(text)) return true;
    } catch {
      /* skip invalid pattern */
    }
  }
  return false;
}

function main() {
  const resultsIdx = process.argv.indexOf('--results-dir');
  const resultsDir = resultsIdx !== -1 ? path.resolve(process.argv[resultsIdx + 1]) : RESULTS_RAW;
  const allPath = path.join(resultsDir, 'index.jsonl');
  if (!fs.existsSync(allPath)) {
    console.error(`No index.jsonl at ${allPath}. Run bench:run first.`);
    process.exit(1);
  }
  const allCount = fs.readFileSync(allPath, 'utf8').trim().split('\n').filter(Boolean).length;
  const index = loadScoreableIndex(resultsDir);
  const skipped = allCount - index.length;
  if (skipped > 0) {
    console.log(`Skipping ${skipped} index row(s) (invalid, failed, or stale contract)`);
  }
  fs.mkdirSync(SCORED_DIR, { recursive: true });

  const rows = [];
  for (const entry of index) {
    const probesPath = path.join(PROBES_DIR, entry.task_id, 'probes.yaml');
    if (!fs.existsSync(probesPath)) {
      console.warn(`No probes for ${entry.task_id}; skipping`);
      continue;
    }
    const doc = readYamlSync(probesPath);
    const artifactPath = path.join(resultsDir, entry.artifact_path);
    const artifact = fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, 'utf8') : '';
    const code = stripComments(artifact);

    let passedWeight = 0;
    let totalWeight = 0;
    const checks = [];
    for (const probe of doc.probes || []) {
      const weight = Number(probe.weight ?? 1);
      totalWeight += weight;
      const pass = matchPatterns(probe.patterns, code) || matchPatterns(probe.patterns, artifact);
      if (pass) passedWeight += weight;
      checks.push({ id: probe.id, kind: probe.kind, weight, pass });
    }

    rows.push({
      ...entry,
      probe_score: totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0,
      probe_passed: passedWeight,
      probe_total: totalWeight,
      checks,
    });
  }

  const outPath = path.join(SCORED_DIR, 'probes-summary.json');
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2) + '\n');
  const mean = rows.length ? rows.reduce((s, r) => s + r.probe_score, 0) / rows.length : 0;
  console.log(`Behavior probes scored ${rows.length} artifacts (mean ${mean.toFixed(1)}) → ${outPath}`);
}

main();
