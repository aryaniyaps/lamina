#!/usr/bin/env node
/**
 * Secondary metric (optional): runtime / live verification depth beyond source review.
 * Primary LaminaBench composite scores post-fix **implementation source** from bench:run.
 *
 * Usage:
 *   node benchmarks/scripts/secondary-verify-metric.mjs --help
 *   node benchmarks/scripts/secondary-verify-metric.mjs --plan
 *   node benchmarks/scripts/secondary-verify-metric.mjs --tasks task001 --dry-run
 *
 * Status: scaffolding + protocol. Full automation requires a live app harness per task.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const HELP = `
secondary-verify-metric — optional LaminaBench usefulness path

Protocol (per task, both arms — optional add-on):
  1. Take the post-fix workspace from bench:run (or deploy the vertical slice)
  2. Run persona/invariant checks against live or mocked product
  3. Record finding counts by severity (high/med/low)
  4. Compare treatment vs control runtime behavior

Primary LaminaBench remains contract-quality A/B. This metric is reported separately.

Flags:
  --help       Show this help
  --plan       Write protocol stub to benchmarks/results/secondary/protocol.md
  --tasks ids  Comma-separated task ids (default: human_eval subset)
  --dry-run    Print planned steps without invoking agents
`;

function writeProtocol() {
  const outDir = path.join(ROOT, 'benchmarks/results/secondary');
  fs.mkdirSync(outDir, { recursive: true });
  const md = `# Secondary verify metric protocol

## Goal

Measure whether higher-quality product-behavior briefs (treatment vs control) lead to
fewer high-severity product-behavior findings after a thin-slice implementation.

## Steps

1. Select tasks (start with human_eval subset).
2. For each arm's best brief artifact, prompt the pinned coding agent:
   "Implement a minimal vertical slice from this brief. Do not expand scope."
3. Against the resulting app (or fixture harness), run:
   - Invariant checks from the golden reference checklist
   - Persona walk scripts where available
4. Score: count of high/med/low findings; time-to-first-correct-guard (optional).
5. Emit \`secondary-summary.json\` with paired per-task deltas.

## Non-goals

- Replacing the primary contract A/B composite
- Claiming WCAG or production readiness
- Using Lamina during the implement step (hold implement agent constant)

## Status

Scaffolding only — wire task-specific harnesses before publishing secondary numbers.
`;
  const out = path.join(outDir, 'protocol.md');
  fs.writeFileSync(out, md);
  console.log(`Wrote ${out}`);
}

function main() {
  if (process.argv.includes('--help') || process.argv.length <= 2) {
    console.log(HELP);
    return;
  }
  if (process.argv.includes('--plan')) {
    writeProtocol();
    return;
  }
  const dry = process.argv.includes('--dry-run');
  const tasksIdx = process.argv.indexOf('--tasks');
  const tasks = tasksIdx !== -1 ? process.argv[tasksIdx + 1].split(',') : ['task001', 'task006', 'task011'];

  console.log('Secondary verify metric');
  console.log(`Tasks: ${tasks.join(', ')}`);
  console.log(dry ? 'Dry run — no agent invocations.' : 'Live implement+verify not fully automated yet.');
  console.log('Run with --plan to materialize protocol.md');
  console.log('Primary benchmark remains: npm run bench:all');
}

main();
