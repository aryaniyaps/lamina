#!/usr/bin/env node
/**
 * Build promptfoo test cases from scored benchmark artifacts for LLM judging.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from '../scripts/yaml.mjs';
import { loadScoreableIndex } from './bench-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');
const TASKS_DIR = path.join(ROOT, 'benchmarks/tasks');
const GOLDENS_DIR = path.join(ROOT, 'benchmarks/goldens');

function buildTests() {
  const index = loadScoreableIndex(RESULTS_RAW);
  const tests = [];
  for (const entry of index) {
    const taskDir = path.join(TASKS_DIR, entry.task_id);
    const artifactPath = path.join(RESULTS_RAW, entry.artifact_path);
    if (!fs.existsSync(artifactPath)) continue;

    const description = fs.readFileSync(path.join(taskDir, 'description.md'), 'utf8');
    const context = fs.readFileSync(path.join(taskDir, 'context.md'), 'utf8');
    const golden = readYamlSync(path.join(GOLDENS_DIR, entry.task_id, 'golden.yaml'));
    const artifact = fs.readFileSync(artifactPath, 'utf8');

    tests.push({
      description: `${entry.task_id} ${entry.arm} run${entry.run}`,
      vars: {
        description,
        context,
        golden: JSON.stringify(golden, null, 2),
        artifact: artifact.slice(0, 24000),
        metadata: {
          task_id: entry.task_id,
          arm: entry.arm,
          run: entry.run,
        },
      },
      metadata: {
        task_id: entry.task_id,
        arm: entry.arm,
        run: entry.run,
      },
    });
  }
  return tests;
}

function main() {
  const tests = buildTests();
  const outPath = path.join(ROOT, 'benchmarks/judges/promptfoo-tests.json');
  fs.writeFileSync(outPath, JSON.stringify(tests, null, 2) + '\n');
  console.log(`Built ${tests.length} promptfoo judge tests → ${outPath}`);
}

main();
