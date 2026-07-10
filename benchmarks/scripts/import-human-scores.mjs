#!/usr/bin/env node
/**
 * Import real human rater CSV into human-scores.json for analyze.py.
 *
 * CSV format (from scores-template.csv):
 *   task_id,artifact_label,domain_system_structure,...,overall_product_behavior,notes
 * Optional column: rater (defaults to 1)
 *
 * Requires answer-key.json from export-human-packet to map A/B → control/treatment.
 *
 * Usage:
 *   node benchmarks/scripts/import-human-scores.mjs --csv path/to/scores.csv
 *   node benchmarks/scripts/import-human-scores.mjs --csv a.csv --csv b.csv
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKET_DIR = path.join(ROOT, 'benchmarks/human/review-packet');
const SCORED_DIR = path.join(ROOT, 'benchmarks/results/scored');

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

function parseArgs() {
  const csvs = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--csv' && process.argv[i + 1]) {
      csvs.push(path.resolve(process.argv[++i]));
    }
  }
  return { csvs };
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i]?.trim() ?? '';
    });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function fleissKappa(ratings, tasks, labels) {
  // Simplified Fleiss' κ on overall_product_behavior rounded to int 1–5
  const categories = [1, 2, 3, 4, 5];
  let N = 0;
  let P_sum = 0;
  const p_j = Object.fromEntries(categories.map((c) => [c, 0]));

  for (const taskId of tasks) {
    for (const label of labels) {
      const group = ratings.filter((r) => r.task_id === taskId && r.label === label);
      if (group.length < 2) continue;
      const n = group.length;
      N++;
      const counts = Object.fromEntries(categories.map((c) => [c, 0]));
      for (const r of group) {
        const v = Math.round(Number(r.overall_product_behavior));
        if (counts[v] !== undefined) counts[v]++;
      }
      let sumSq = 0;
      for (const c of categories) {
        sumSq += counts[c] * counts[c];
        p_j[c] += counts[c];
      }
      P_sum += (sumSq - n) / (n * (n - 1));
    }
  }

  if (N === 0) return null;
  const P_bar = P_sum / N;
  const totalRatings = Object.values(p_j).reduce((a, b) => a + b, 0);
  if (totalRatings === 0) return null;
  let Pe = 0;
  for (const c of categories) {
    const pj = p_j[c] / totalRatings;
    Pe += pj * pj;
  }
  if (Pe === 1) return 1;
  return Math.round(((P_bar - Pe) / (1 - Pe)) * 1000) / 1000;
}

function main() {
  const { csvs } = parseArgs();
  if (!csvs.length) {
    console.error('Usage: node benchmarks/scripts/import-human-scores.mjs --csv scores.csv');
    process.exit(1);
  }

  const keyPath = path.join(PACKET_DIR, 'answer-key.json');
  if (!fs.existsSync(keyPath)) {
    console.error('Missing answer-key.json. Run bench:human-packet first.');
    process.exit(1);
  }
  const answerKey = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const armMap = new Map(answerKey.map((k) => [k.task_id, { A: k.A, B: k.B }]));

  const ratings = [];
  let raterAuto = 1;

  for (const csvPath of csvs) {
    if (!fs.existsSync(csvPath)) {
      console.error(`CSV not found: ${csvPath}`);
      process.exit(1);
    }
    const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    for (const row of rows) {
      const taskId = row.task_id;
      const label = row.artifact_label || row.label;
      if (!taskId || !label || !armMap.has(taskId)) continue;

      const map = armMap.get(taskId);
      const arm = map[label];
      if (!arm) continue;

      const scores = {};
      for (const c of CRITERIA) {
        const v = Number(row[c]);
        scores[c] = Number.isFinite(v) ? v : null;
      }
      if (scores.overall_product_behavior == null) continue;

      ratings.push({
        task_id: taskId,
        label,
        arm,
        rater: Number(row.rater) || raterAuto,
        ...scores,
      });
    }
    raterAuto++;
  }

  if (!ratings.length) {
    console.error('No valid rating rows imported.');
    process.exit(1);
  }

  const controlScores = ratings
    .filter((r) => r.arm === 'control')
    .map((r) => r.overall_product_behavior);
  const treatmentScores = ratings
    .filter((r) => r.arm === 'treatment')
    .map((r) => r.overall_product_behavior);

  const tasks = [...new Set(ratings.map((r) => r.task_id))];
  const kappa = fleissKappa(ratings, tasks, ['A', 'B']);

  const human = {
    note: 'Imported from real rater CSV. Safe for release analysis when raters were blind.',
    source: 'csv_import',
    synthetic: false,
    fleiss_kappa: kappa,
    control_mean: avg(controlScores),
    treatment_mean: avg(treatmentScores),
    n_ratings: ratings.length,
    n_tasks: tasks.length,
    ratings,
  };

  fs.mkdirSync(SCORED_DIR, { recursive: true });
  const outPath = path.join(SCORED_DIR, 'human-scores.json');
  fs.writeFileSync(outPath, JSON.stringify(human, null, 2) + '\n');
  console.log(`Imported ${ratings.length} ratings → ${outPath}`);
  console.log(`Fleiss' κ: ${kappa ?? 'N/A'}; control=${human.control_mean.toFixed(2)} treatment=${human.treatment_mean.toFixed(2)}`);
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

main();
