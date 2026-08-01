#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const productionRoots = [
  'packages/cli',
  'scripts',
  'skills',
  'evals/hooks',
  'evals/lib',
  'benchmarks/lb6/pilot/lib',
];
const forbiddenRuntimeFiles = [
  'skills/lamina/orchestrator/lib/graph-tool.mjs',
  'skills/lamina/orchestrator/lib/run.mjs',
  'skills/lamina/orchestrator/lib/validate-run.mjs',
  'skills/lamina-design/scripts/seed-ready-run.mjs',
  'skills/lamina-verify/scripts/seed-verify-run.mjs',
];
for (const file of forbiddenRuntimeFiles) assert.equal(fs.existsSync(file), false, `${file} must be retired`);
assert.equal(fs.existsSync('skills/lamina/orchestrator/bin'), false, 'skills must not embed a CLI');
assert.equal(fs.existsSync('skills/lamina/orchestrator/lib'), false, 'skills must not embed a graph runtime');
assert.equal(fs.existsSync('evals/lib/run-assertions.mjs'), false, 'evals must not retain a legacy run grader');

function walk(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const executableFiles = productionRoots.flatMap(walk).filter((file) => /\.(mjs|js|py|sh)$/.test(file));
for (const file of executableFiles) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /run\.json/, `production executable discovers legacy run.json: ${file}`);
}

// `benchmarks/lib/behavior-grade.mjs` is part of the commit-pinned historical
// web-release protocol. Current graph-backed benchmark code lives under
// `benchmarks/lb6/pilot/lib` and is covered above.

const personaText = walk('skills').filter((file) => file.endsWith('.md')).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
assert.doesNotMatch(personaText, /at most three|no more than three|≤\s*3/i);
assert.match(personaText, /every active Persona/i);

console.log('no_legacy_runtime_test: ok');
