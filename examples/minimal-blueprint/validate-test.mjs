#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExportGraph } from '../../packages/lamina-blueprint/cli/export-graph.js';
import { validateBlueprint } from '../../packages/lamina-blueprint/cli/validate.js';

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const blueprintRoot = path.join(exampleRoot, '.lamina/blueprints');

function blueprintDir(id) {
  return path.join(blueprintRoot, id);
}

// Demo blueprint (greenfield, no manifest)
const demo = validateBlueprint(blueprintDir('demo'));
assert.equal(demo.ok, true, `demo should pass: ${demo.errors.join('; ')}`);

// Mixed flow: manifest for existing login + new welcome screen (no manifest row)
const mixed = validateBlueprint(blueprintDir('mixed-flow'));
assert.equal(mixed.ok, true, `mixed-flow should pass: ${mixed.errors.join('; ')}`);

// Brownfield fail: manifest requires button label not in blueprint
const fail = validateBlueprint(blueprintDir('brownfield-fail'));
assert.equal(fail.ok, false, 'brownfield-fail should not pass');
assert.ok(
  fail.errors.some((e) => e.includes('run.yaml element not found')),
  `expected run.yaml fidelity error, got: ${fail.errors.join('; ')}`,
);

await runExportGraph(['--root', blueprintRoot, '--id', 'demo', '--stdout']);
console.log('validate-test OK — demo, mixed-flow pass; brownfield-fail rejects run.yaml drift');
