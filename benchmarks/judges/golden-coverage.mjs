#!/usr/bin/env node
/**
 * Objective golden-spec coverage scorer for LaminaBench **implementations**.
 *
 * Artifacts are bundled application source (post fix). Goldens are a *reference checklist*, not ground truth.
 * required_sections are NOT scored (format-neutral — avoids Lamina-shaped bias).
 * Matching uses humanized phrases + optional aliases, not raw snake_case tokens.
 *
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

/** Core contract fields weighted 2×. Sections intentionally omitted (format bias). */
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
  required_findings: 1,
};

/** Extra phrase aliases for common golden tokens (synonym tolerance). */
const ALIASES = {
  one_active_budget_per_household: ['single active budget', 'one budget per household', 'only one active budget'],
  partner_privacy_boundary: ['partner privacy', 'privacy between partners', 'partner data boundary'],
  no_investment_advice_display: ['no investment advice', 'exclude investment advice', 'without investment advice'],
  sync_failure_recovery: ['sync failure', 'when sync fails', 'recover from sync'],
  zero_income_month: ['zero income', 'no income month', 'month with no income'],
  duplicate_transaction_handling: ['duplicate transaction', 'dedupe transaction', 'duplicate transactions'],
  order_total_matches_line_items: ['order total matches', 'total equals line items', 'line item total'],
  payment_required_before_confirmation: ['payment before confirm', 'pay before confirmation', 'payment required'],
  payment_declined_recovery: ['payment declined', 'card declined', 'declined payment'],
  session_timeout_mid_checkout: ['session timeout', 'session expired', 'timeout mid checkout'],
};

function normalize(text) {
  return text.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
}

function humanize(item) {
  return normalize(String(item));
}

function phrasesFor(item) {
  const key = String(item);
  const phrases = [humanize(key)];
  if (ALIASES[key]) phrases.push(...ALIASES[key].map(normalize));
  return phrases;
}

function phraseMatches(phrase, text) {
  const words = phrase.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) {
    return phrase.length > 0 && text.includes(phrase);
  }
  // Prefer full phrase containment; fall back to ≥60% significant words
  if (text.includes(phrase)) return true;
  const matched = words.filter((w) => text.includes(w));
  return matched.length >= Math.ceil(words.length * 0.6);
}

function itemMatches(item, text) {
  return phrasesFor(item).some((p) => phraseMatches(p, text));
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
      checks.push({ field, item, pass, weight, method: 'phrase' });
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
      note: 'Goldens are a reference checklist applied to implementation source, not ground truth.',
    };
    scores.push(scored);

    const outFile = path.join(SCORED_DIR, `${entry.task_id}_${entry.arm}_run${entry.run}.json`);
    fs.writeFileSync(outFile, JSON.stringify(scored, null, 2) + '\n');
  }

  const summaryPath = path.join(SCORED_DIR, 'coverage-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(scores, null, 2) + '\n');
  console.log(`Golden coverage scored ${scores.length} artifacts → ${SCORED_DIR}`);
  console.log('(required_sections not scored — format-neutral)');
}

main();
