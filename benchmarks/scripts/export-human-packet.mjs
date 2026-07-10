#!/usr/bin/env node
/**
 * Generate optional blind human review packet (not in claim composite).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';
import { CRITERIA } from './human-eval-lib.mjs';
import { writeHumanEvalManifest, hashArtifactContent } from './human-eval-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASKS_DIR = path.join(ROOT, 'benchmarks/tasks');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');
const PACKET_DIR = path.join(ROOT, 'benchmarks/human/review-packet');

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
  return files.length ? path.join(artifactsDir, files[0]) : null;
}

function main() {
  const humanTasks = loadHumanEvalTasks();
  if (!fs.existsSync(path.join(RESULTS_RAW, 'index.jsonl'))) {
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
    `<p>Tasks: ${humanTasks.length}. Score implementations <strong>A</strong> and <strong>B</strong> using the rubric.</p>`,
    `<p><a href="../../judges/rubric.md">Rubric</a> · Import CSV via <code>npm run bench:import-human</code></p>`,
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
  console.log(`Human review packet → ${PACKET_DIR} (${answerKey.length} tasks, eval_id: ${evalId})`);
  console.log(`Manifest → ${manifestPath}`);
}

main();
