#!/usr/bin/env node
/**
 * Build promptfoo test cases from scored benchmark artifacts for LLM judging.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from '../scripts/yaml.mjs';
import { loadScoreableIndex } from './bench-index.mjs';

import { harborPath } from './harbor-tasks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');
const GOLDENS_DIR = path.join(ROOT, 'benchmarks/goldens');

function buildTests() {
  const index = loadScoreableIndex(RESULTS_RAW);
  const tests = [];
  for (const entry of index) {
    const artifactPath = path.join(RESULTS_RAW, entry.artifact_path);
    if (!fs.existsSync(artifactPath)) continue;

    const instructionPath = path.join(harborPath(entry.task_id, 'control'), 'instruction.md');
    if (!fs.existsSync(instructionPath)) continue;
    const instruction = fs.readFileSync(instructionPath, 'utf8');
    const parts = instruction.split(/\n## Context\n\n/);
    const description = parts[0] || instruction;
    const context = parts[1] || '';
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
