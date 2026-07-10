/**
 * Shared human-eval import helpers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PACKET_DIR = path.join(SCRIPT_DIR, '../human/review-packet');
export const SCORED_DIR = path.join(SCRIPT_DIR, '../results/scored');

export const CRITERIA = [
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

export const CRITERIA_LABELS = {
  domain_system_structure: 'Domain / system structure',
  invariants_product_rules: 'Invariants and product rules',
  actors_permissions: 'Actors and permissions',
  workflow_quality: 'Workflow quality',
  scenario_edge_coverage: 'Scenario / edge coverage',
  systems_judgment: 'Systems judgment',
  ux_expression_under_rules: 'UX expression under rules',
  brownfield_fit: 'Brownfield fit',
  implementation_readiness: 'Product implementation completeness',
  overall_product_behavior: 'Overall product-behavior quality',
};

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath, 'utf8'));
}

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i]?.trim() ?? '';
    });
    return row;
  });
  return { headers, rows };
}

export function splitCsvLine(line) {
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

export function loadAnswerKey() {
  const keyPath = path.join(PACKET_DIR, 'answer-key.json');
  if (!fs.existsSync(keyPath)) {
    throw new Error('Missing answer-key.json. Run bench:human-packet first.');
  }
  const answerKey = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const armMap = new Map(answerKey.map((k) => [k.task_id, { A: k.A, B: k.B }]));
  return { answerKey, armMap, keyPath };
}

export function loadManifest() {
  const manifestPath = path.join(PACKET_DIR, 'human-eval-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

export function fleissKappa(ratings, tasks, labels) {
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

export function ratingsFromLongRows(rows, armMap, raterDefault = 1) {
  const ratings = [];
  for (const row of rows) {
    const taskId = (row.task_id || row['Task ID'] || '').trim();
    const label = (row.artifact_label || row.label || '').trim().toUpperCase();
    if (!taskId || !label || !armMap.has(taskId)) continue;

    const arm = armMap.get(taskId)[label];
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
      rater: Number(row.rater || row['Rater code']) || raterDefault,
      notes: row.notes || row['Notes'] || '',
      ...scores,
    });
  }
  return ratings;
}

export function writeHumanScores(ratings, meta = {}) {
  const controlScores = ratings
    .filter((r) => r.arm === 'control')
    .map((r) => r.overall_product_behavior);
  const treatmentScores = ratings
    .filter((r) => r.arm === 'treatment')
    .map((r) => r.overall_product_behavior);

  const tasks = [...new Set(ratings.map((r) => r.task_id))];
  const kappa = fleissKappa(ratings, tasks, ['A', 'B']);

  const human = {
    note: meta.note || 'Imported from real rater submissions. Safe for release when raters were blind.',
    source: meta.source || 'csv_import',
    synthetic: false,
    fleiss_kappa: kappa,
    control_mean: avg(controlScores),
    treatment_mean: avg(treatmentScores),
    n_ratings: ratings.length,
    n_tasks: tasks.length,
    ratings,
    verification: meta.verification || undefined,
  };

  fs.mkdirSync(SCORED_DIR, { recursive: true });
  const outPath = path.join(SCORED_DIR, 'human-scores.json');
  fs.writeFileSync(outPath, JSON.stringify(human, null, 2) + '\n');
  return { human, outPath, kappa };
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
