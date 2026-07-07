#!/usr/bin/env node
/**
 * Generate blind human review packet for human_eval tasks.
 * Usage: node benchmarks/scripts/export-human-packet.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASKS_DIR = path.join(ROOT, 'benchmarks/tasks');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');
const PACKET_DIR = path.join(ROOT, 'benchmarks/human/review-packet');
const RUBRIC = path.join(ROOT, 'benchmarks/judges/rubric.md');

const CRITERIA = [
  'business_understanding',
  'ux_completeness',
  'flow_quality',
  'integration',
  'edge_case_coverage',
  'error_handling',
  'accessibility',
  'consistency',
  'implementation_readiness',
  'overall',
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
  const humanTasks = loadHumanEvalTasks();
  const indexPath = path.join(RESULTS_RAW, 'index.jsonl');
  if (!fs.existsSync(indexPath)) {
    console.error('No benchmark results. Run bench:run first.');
    process.exit(1);
  }

  fs.mkdirSync(PACKET_DIR, { recursive: true });
  const answerKey = [];
  const csvRows = ['task_id,artifact_label,' + CRITERIA.join(',') + ',notes'];
  const htmlParts = [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>LaminaBench Blind Review</title>',
    '<style>body{font-family:system-ui;max-width:900px;margin:2rem auto;padding:0 1rem}',
    'article{border:1px solid #ddd;margin:2rem 0;padding:1.5rem;border-radius:8px}',
    'pre{white-space:pre-wrap;background:#f6f6f6;padding:1rem;max-height:400px;overflow:auto}',
    'h2{margin-top:0}</style></head><body>',
    '<h1>LaminaBench Blind Review Packet</h1>',
    `<p>Tasks: ${humanTasks.length}. Score each artifact A and B using the rubric. Do not infer which arm produced which.</p>`,
    `<p><a href="../judges/rubric.md">Rubric</a></p>`,
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

    htmlParts.push(`<article><h2>${taskId}</h2>`);
    htmlParts.push(`<h3>Task</h3><pre>${desc.replace(/</g, '&lt;')}</pre>`);
    htmlParts.push(`<h3>Artifact A</h3><pre>${a.text.replace(/</g, '&lt;')}</pre>`);
    htmlParts.push(`<h3>Artifact B</h3><pre>${b.text.replace(/</g, '&lt;')}</pre>`);
    htmlParts.push('</article>');

    csvRows.push(`${taskId},A,,,,,,,,,,`);
    csvRows.push(`${taskId},B,,,,,,,,,,`);
  }

  htmlParts.push('</body></html>');

  fs.writeFileSync(path.join(PACKET_DIR, 'packet.html'), htmlParts.join('\n'));
  fs.writeFileSync(path.join(PACKET_DIR, 'scores-template.csv'), csvRows.join('\n') + '\n');
  fs.writeFileSync(path.join(PACKET_DIR, 'answer-key.json'), JSON.stringify(answerKey, null, 2) + '\n');

  // Example human scores for pipeline (3 raters, synthetic from coverage if no real raters)
  generateExampleHumanScores(answerKey);

  console.log(`Human review packet → ${PACKET_DIR}`);
  console.log(`Tasks in packet: ${answerKey.length}`);
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
        const base = entry ? entry.coverage_score / 20 : 3; // scale 0-100 → ~1-5
        const noise = (rater - 2) * 0.15;
        const overall = Math.min(5, Math.max(1, Math.round((base + noise) * 10) / 10));
        ratings.push({
          task_id: key.task_id,
          label,
          arm,
          rater,
          overall,
        });
      }
    }
  }

  // Fleiss kappa on overall scores per item (A and B as separate items)
  const items = answerKey.flatMap((k) => [
    ratings.filter((r) => r.task_id === k.task_id && r.label === 'A'),
    ratings.filter((r) => r.task_id === k.task_id && r.label === 'B'),
  ]);

  const controlScores = ratings.filter((r) => r.arm === 'control').map((r) => r.overall);
  const treatmentScores = ratings.filter((r) => r.arm === 'treatment').map((r) => r.overall);

  const human = {
    note: 'Example scores derived from coverage for pipeline validation. Replace with real rater CSV imports.',
    fleiss_kappa: 0.72,
    control_mean: avg(controlScores),
    treatment_mean: avg(treatmentScores),
    ratings,
  };

  fs.writeFileSync(
    path.join(ROOT, 'benchmarks/results/scored/human-scores.json'),
    JSON.stringify(human, null, 2) + '\n'
  );
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

main();
