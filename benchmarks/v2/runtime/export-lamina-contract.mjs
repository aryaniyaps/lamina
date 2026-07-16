#!/usr/bin/env node
import fs from 'node:fs';
import { loadRunJson } from '../../../skills/lamina-orchestrator/lib/run.mjs';

const [runPath, outputPath] = process.argv.slice(2);
if (!runPath || !outputPath) {
  console.error('Usage: export-lamina-contract.mjs <run.json> <benchmark-contract.json>');
  process.exit(1);
}
const run = loadRunJson(runPath);
const neutral = {
  intent: run.intent,
  decisions: run.decisions,
  actors: run.actors,
  entities: run.entities,
  operations: run.operations,
  workflows: run.workflows,
  rules: run.invariants,
  dependencies: run.dependencies,
  scenarios: run.scenarios,
  traceability: run.traceability,
};
fs.writeFileSync(outputPath, `${JSON.stringify(neutral, null, 2)}\n`);
