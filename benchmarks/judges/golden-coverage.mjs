#!/usr/bin/env node
/**
 * Objective golden-spec coverage scorer for LaminaBench artifacts.
 * Usage: node benchmarks/judges/golden-coverage.mjs [--results-dir path]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from '../scripts/yaml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');
const GOLDENS_DIR = path.join(ROOT, 'benchmarks/goldens');
const SCORED_DIR = path.join(ROOT, 'benchmarks/results/scored');

/** Core contract fields weighted 2×; a11y and legacy fields weighted 1× */
const GOLDEN_FIELD_WEIGHTS = {
  required_invariants: 2,
  required_entities: 2,
  required_scenarios: 2,
  required_tradeoffs: 2,
  required_personas: 1,
  required_flows: 1,
  required_rules: 1,
  required_edge_cases: 1,
  required_a11y: 1,
  required_sections: 1,
  required_findings: 1,
};

function normalize(text) {
  return text.toLowerCase().replace(/[_-]/g, ' ');
}

function itemMatches(item, text) {
  const norm = normalize(item);
  const words = norm.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return false;
  const matched = words.filter((w) => text.includes(w));
  return matched.length >= Math.ceil(words.length * 0.6);
}

function scoreArtifact(golden, artifactText) {
  const text = normalize(artifactText);
  const checks = [];
  let totalWeight = 0;
  let passedWeight = 0;

  for (const [field, weight] of Object.entries(GOLDEN_FIELD_WEIGHTS)) {
    const items = golden[field];
    if (!items?.length) continue;
    for (const item of items) {
      totalWeight += weight;
      const pass = itemMatches(item, text);
      if (pass) passedWeight += weight;
      checks.push({ field, item, pass, weight, method: 'keyword' });
    }
  }

  const coverage_score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;
  return { coverage_score, checks, passed: passedWeight, total: totalWeight };
}

function loadIndex(resultsDir) {
  const indexPath = path.join(resultsDir, 'index.jsonl');
  if (!fs.existsSync(indexPath)) {
    console.error(`No index.jsonl at ${indexPath}. Run bench:run first.`);
    process.exit(1);
  }
  return fs
    .readFileSync(indexPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function main() {
  const resultsIdx = process.argv.indexOf('--results-dir');
  const resultsDir = resultsIdx !== -1 ? path.resolve(process.argv[resultsIdx + 1]) : RESULTS_RAW;

  const index = loadIndex(resultsDir);
  fs.mkdirSync(SCORED_DIR, { recursive: true });

  const scores = [];
  for (const entry of index) {
    const goldenPath = path.join(GOLDENS_DIR, entry.task_id, 'golden.yaml');
    if (!fs.existsSync(goldenPath)) continue;

    const golden = readYamlSync(goldenPath);
    const artifactPath = path.join(resultsDir, entry.artifact_path);
    if (!fs.existsSync(artifactPath)) {
      scores.push({ ...entry, coverage_score: 0, error: 'artifact missing' });
      continue;
    }

    const artifactText = fs.readFileSync(artifactPath, 'utf8');
    const result = scoreArtifact(golden, artifactText);
    const scored = {
      ...entry,
      coverage_score: result.coverage_score,
      coverage_passed: result.passed,
      coverage_total: result.total,
      checks: result.checks,
    };
    scores.push(scored);

    const outFile = path.join(SCORED_DIR, `${entry.task_id}_${entry.arm}_run${entry.run}.json`);
    fs.writeFileSync(outFile, JSON.stringify(scored, null, 2) + '\n');
  }

  const summaryPath = path.join(SCORED_DIR, 'coverage-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(scores, null, 2) + '\n');
  console.log(`Golden coverage scored ${scores.length} artifacts → ${SCORED_DIR}`);
}

main();
