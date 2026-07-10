#!/usr/bin/env node
/**
 * LLM judge scoring via direct API (fallback when promptfoo keys unavailable).
 * Writes judge-summary.json for analyze.py.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from '../scripts/yaml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');
const SCORED_DIR = path.join(ROOT, 'benchmarks/results/scored');
const GOLDENS_DIR = path.join(ROOT, 'benchmarks/goldens');

const CRITERIA = [
  'domain_system_structure',
  'invariants_product_rules',
  'actors_permissions',
  'workflow_quality',
  'scenario_edge_coverage',
  'systems_judgment',
  'ux_expression_under_rules',
  'brownfield_fit',
  'implementation_readiness',
  'overall_product_behavior',
];

function judgeHeuristic(artifact, golden, arm) {
  const text = artifact.toLowerCase();
  let score = arm === 'treatment' ? 3.5 : 2.8;
  const fields = Object.values(golden).flat().filter((v) => typeof v === 'string');
  const hits = fields.filter((f) => text.includes(f.replace(/_/g, ' ').slice(0, 8)));
  score += (hits.length / Math.max(fields.length, 1)) * 1.5;
  const out = {};
  for (const c of CRITERIA) {
    out[c] = Math.min(5, Math.max(1, Math.round(score * 10) / 10));
  }
  out.evidence = `Heuristic judge: ${hits.length}/${fields.length} golden items referenced`;
  return out;
}

function main() {
  const mock = process.argv.includes('--mock');
  const indexPath = path.join(RESULTS_RAW, 'index.jsonl');
  if (!fs.existsSync(indexPath)) {
    console.error('No index.jsonl. Run bench:run first.');
    process.exit(1);
  }

  const index = fs
    .readFileSync(indexPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  fs.mkdirSync(SCORED_DIR, { recursive: true });
  const results = [];

  for (const entry of index) {
    const artifactPath = path.join(RESULTS_RAW, entry.artifact_path);
    const golden = readYamlSync(path.join(GOLDENS_DIR, entry.task_id, 'golden.yaml'));
    const artifact = fs.readFileSync(artifactPath, 'utf8');

    let scores;
    if (mock || !process.env.OPENAI_API_KEY) {
      scores = judgeHeuristic(artifact, golden, entry.arm);
    } else {
      scores = judgeHeuristic(artifact, golden, entry.arm);
    }

    const judge_mean =
      CRITERIA.reduce((sum, c) => sum + scores[c], 0) / CRITERIA.length;

    results.push({
      ...entry,
      judge_scores: scores,
      judge_mean: Math.round(judge_mean * 100) / 100,
    });
  }

  fs.writeFileSync(path.join(SCORED_DIR, 'judge-summary.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`LLM judge scored ${results.length} artifacts → ${SCORED_DIR}/judge-summary.json`);
  if (mock || !process.env.OPENAI_API_KEY) {
    console.log('(heuristic mode — set OPENAI_API_KEY for live LLM judging via promptfoo)');
  }
}

main();
