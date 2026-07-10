#!/usr/bin/env node
/**
 * Generate blind human review packet for human_eval tasks.
 * Usage:
 *   node benchmarks/scripts/export-human-packet.mjs
 *   node benchmarks/scripts/export-human-packet.mjs --example-scores  # synthetic only; not for claims
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';
import { writeHumanEvalManifest, hashArtifactContent } from './human-eval-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASKS_DIR = path.join(ROOT, 'benchmarks/tasks');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');
const PACKET_DIR = path.join(ROOT, 'benchmarks/human/review-packet');

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

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadHumanEvalTasks() {
  const tasks = [];
  for (const dir of fs.readdirSync(TASKS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const yaml = readYamlSync(path.join(TASKS_DIR, dir.name, 'task.yaml'));
    if (yaml.human_eval) tasks.push(yaml.id);
  }
  return tasks.sort();
}

function pickRepresentativeArtifact(taskId, arm) {
  const pattern = `${taskId}_${arm}_run`;
  const artifactsDir = path.join(RESULTS_RAW, 'artifacts');
  if (!fs.existsSync(artifactsDir)) return null;
  const files = fs.readdirSync(artifactsDir).filter((f) => f.startsWith(pattern));
  if (!files.length) return null;
  return path.join(artifactsDir, files[0]);
}

function main() {
  const exampleScores = process.argv.includes('--example-scores');
  const humanTasks = loadHumanEvalTasks();
  const indexPath = path.join(RESULTS_RAW, 'index.jsonl');
  if (!fs.existsSync(indexPath)) {
    console.error('No benchmark results. Run bench:run first.');
    process.exit(1);
  }

  fs.mkdirSync(PACKET_DIR, { recursive: true });
  const answerKey = [];
  const artifactPairs = [];
  const csvRows = ['task_id,artifact_label,rater,' + CRITERIA.join(',') + ',notes'];
  const htmlParts = [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>LaminaBench Blind Review</title>',
    '<style>body{font-family:system-ui;max-width:900px;margin:2rem auto;padding:0 1rem}',
    'article{border:1px solid #ddd;margin:2rem 0;padding:1.5rem;border-radius:8px}',
    'pre{white-space:pre-wrap;background:#f6f6f6;padding:1rem;max-height:400px;overflow:auto}',
    'h2{margin-top:0}</style></head><body>',
    '<h1>LaminaBench Blind Review Packet</h1>',
    `<p>Tasks: ${humanTasks.length}. Score each implementation <strong>A</strong> and <strong>B</strong> using the product-behavior rubric. Review source code, not design briefs.</p>`,
    `<p><strong>Methodology:</strong> <a href="../../METHODOLOGY.md">Design A — ecological adoption</a> (Plan+implement vs Lamina loop; unequal turns intentional).</p>`,
    `<p><a href="../../judges/rubric.md">Rubric</a></p>`,
    '<p>Score via <a href="../google-form/SETUP.md">Google Form</a> or CSV. Import: <code>npm run bench:import-google-form</code></p>',
  ];

  for (const taskId of humanTasks) {
    const controlPath = pickRepresentativeArtifact(taskId, 'control');
    const treatmentPath = pickRepresentativeArtifact(taskId, 'treatment');
    if (!controlPath || !treatmentPath) {
      console.warn(`Skipping ${taskId}: missing artifacts`);
      continue;
    }

    const controlText = fs.readFileSync(controlPath, 'utf8');
    const treatmentText = fs.readFileSync(treatmentPath, 'utf8');
    const desc = fs.readFileSync(path.join(TASKS_DIR, taskId, 'description.md'), 'utf8');

    const arms = shuffle([
      { arm: 'control', text: controlText },
      { arm: 'treatment', text: treatmentText },
    ]);
    const a = { label: 'A', ...arms[0] };
    const b = { label: 'B', ...arms[1] };

    answerKey.push({ task_id: taskId, A: a.arm, B: b.arm });
    artifactPairs.push({
      task_id: taskId,
      a_sha256: hashArtifactContent(a.text),
      b_sha256: hashArtifactContent(b.text),
    });

    htmlParts.push(`<article><h2>${taskId}</h2>`);
    htmlParts.push(`<h3>Task</h3><pre>${desc.replace(/</g, '&lt;')}</pre>`);
    htmlParts.push(`<h3>Artifact A</h3><pre>${a.text.replace(/</g, '&lt;')}</pre>`);
    htmlParts.push(`<h3>Artifact B</h3><pre>${b.text.replace(/</g, '&lt;')}</pre>`);
    htmlParts.push('</article>');

    csvRows.push(`${taskId},A,1,,,,,,,,,,,`);
    csvRows.push(`${taskId},B,1,,,,,,,,,,,`);
  }

  htmlParts.push('</body></html>');

  fs.writeFileSync(path.join(PACKET_DIR, 'packet.html'), htmlParts.join('\n'));
  fs.writeFileSync(path.join(PACKET_DIR, 'scores-template.csv'), csvRows.join('\n') + '\n');
  fs.writeFileSync(path.join(PACKET_DIR, 'answer-key.json'), JSON.stringify(answerKey, null, 2) + '\n');

  const { manifestPath, evalId } = writeHumanEvalManifest({ answerKey, artifactPairs });
  console.log(`Human eval manifest → ${manifestPath} (eval_id: ${evalId})`);
  console.log(`Google Form spec → benchmarks/human/google-form/form-spec.json`);

  // Remove stale synthetic human-scores unless explicitly regenerating examples
  const humanScoresPath = path.join(ROOT, 'benchmarks/results/scored/human-scores.json');
  if (exampleScores) {
    generateExampleHumanScores(answerKey);
    console.log('WARNING: wrote synthetic human-scores.json — not for external claims.');
  } else if (fs.existsSync(humanScoresPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(humanScoresPath, 'utf8'));
      const keepImported = existing.synthetic === false && existing.source === 'csv_import';
      if (keepImported) {
        console.log('Keeping imported human-scores.json');
      } else {
        fs.unlinkSync(humanScoresPath);
        console.log('Removed stale/synthetic human-scores.json');
      }
    } catch {
      fs.unlinkSync(humanScoresPath);
      console.log('Removed unreadable human-scores.json');
    }
  }

  console.log(`Human review packet → ${PACKET_DIR}`);
  console.log(`Tasks in packet: ${answerKey.length}`);
  console.log('Import real scores: npm run bench:import-human -- --csv path/to/scores.csv');
}

function generateExampleHumanScores(answerKey) {
  const coveragePath = path.join(ROOT, 'benchmarks/results/scored/coverage-summary.json');
  if (!fs.existsSync(coveragePath)) return;

  const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
  const ratings = [];

  for (const key of answerKey) {
    for (const rater of [1, 2, 3]) {
      for (const [label, arm] of Object.entries({ A: key.A, B: key.B })) {
        const entry = coverage.find((c) => c.task_id === key.task_id && c.arm === arm);
        const base = entry ? entry.coverage_score / 20 : 3;
        const noise = (rater - 2) * 0.15;
        const overall = Math.min(5, Math.max(1, Math.round((base + noise) * 10) / 10));
        ratings.push({
          task_id: key.task_id,
          label,
          arm,
          rater,
          overall_product_behavior: overall,
        });
      }
    }
  }

  const controlScores = ratings.filter((r) => r.arm === 'control').map((r) => r.overall_product_behavior);
  const treatmentScores = ratings.filter((r) => r.arm === 'treatment').map((r) => r.overall_product_behavior);

  const human = {
    note: 'SYNTHETIC — derived from coverage for pipeline validation only. Do not cite. Import real CSV via bench:import-human.',
    source: 'synthetic_from_coverage',
    synthetic: true,
    fleiss_kappa: null,
    control_mean: avg(controlScores),
    treatment_mean: avg(treatmentScores),
    ratings,
  };

  fs.mkdirSync(path.join(ROOT, 'benchmarks/results/scored'), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, 'benchmarks/results/scored/human-scores.json'),
    JSON.stringify(human, null, 2) + '\n'
  );
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

main();
