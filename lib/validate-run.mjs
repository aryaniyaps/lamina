#!/usr/bin/env node
import { validateRunYaml } from './run.mjs';

const runPath = process.argv[2];
if (!runPath) {
  console.error('Usage: node lib/validate-run.mjs <path-to-run.yaml>');
  process.exit(1);
}
const result = validateRunYaml(runPath);
if (!result.ok) {
  for (const e of result.errors) console.error(e);
  process.exit(1);
}
console.log('run.yaml valid');
