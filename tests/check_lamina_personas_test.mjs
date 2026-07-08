#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLaminaPersonas } from '../scripts/check_lamina_personas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'lamina-personas');

function fixture(name) {
  return path.join(FIXTURES, name);
}

const cases = [
  {
    name: 'valid personas from eval layer',
    root: path.join(__dirname, '..', 'evals/fixtures/_layers/lamina-personas'),
    ok: true,
  },
  {
    name: 'no .lamina directory',
    root: fixture('no-lamina-dir'),
    ok: false,
    includes: ['Missing `.lamina/personas.yaml`'],
  },
  {
    name: 'empty personas.yaml',
    root: fixture('empty-file'),
    ok: false,
    includes: ['empty'],
  },
  {
    name: 'missing primary',
    root: fixture('missing-primary'),
    ok: false,
    includes: ['Missing `primary`'],
  },
  {
    name: 'missing required persona field',
    root: fixture('missing-field'),
    ok: false,
    includes: ['missing required field'],
  },
  {
    name: 'missing nested persona sections',
    root: fixture('missing-nested'),
    ok: false,
    includes: ['missing required field: goals', 'missing required field: accessibility'],
  },
];

for (const { name, root, ok, includes = [] } of cases) {
  const result = checkLaminaPersonas(root);
  assert.equal(result.ok, ok, `${name}: expected ok=${ok}, got ${result.ok}; errors=${result.errors.join('; ')}`);
  for (const fragment of includes) {
    assert.ok(
      result.errors.some((e) => e.toLowerCase().includes(fragment.toLowerCase())),
      `${name}: expected error containing "${fragment}", got: ${result.errors.join('; ')}`,
    );
  }
}

console.log(`check_lamina_personas: ${cases.length} cases passed`);
