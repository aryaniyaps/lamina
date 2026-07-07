#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLaminaInit } from '../scripts/check_lamina_init.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'lamina-init');

function fixture(name) {
  return path.join(FIXTURES, name);
}

const cases = [
  {
    name: 'no .lamina directory',
    root: fixture('no-lamina-dir'),
    ok: false,
    includes: ['Missing `.lamina/business-context.md`'],
  },
  {
    name: 'other artifacts only',
    root: fixture('other-artifacts-only'),
    ok: false,
    includes: ['Missing `.lamina/business-context.md`'],
  },
  {
    name: 'empty business-context.md',
    root: fixture('empty-file'),
    ok: false,
    includes: ['is empty'],
  },
  {
    name: 'frontmatter only',
    root: fixture('frontmatter-only'),
    ok: false,
    includes: ['Missing required section'],
  },
  {
    name: 'stub template placeholders',
    root: fixture('stub-template'),
    ok: false,
    includes: ['placeholder or empty **Answer:**'],
  },
  {
    name: 'missing required section',
    root: fixture('missing-section'),
    ok: false,
    includes: ['Missing required section: "Triad check"'],
  },
  {
    name: 'valid establish output',
    root: fixture('valid-establish'),
    ok: true,
  },
  {
    name: 'valid update output with changelog',
    root: fixture('valid-update'),
    ok: true,
  },
];

let failed = 0;

for (const testCase of cases) {
  const result = checkLaminaInit(testCase.root);
  try {
    assert.equal(result.ok, testCase.ok, `${testCase.name}: expected ok=${testCase.ok}`);
    if (testCase.includes) {
      for (const fragment of testCase.includes) {
        assert.ok(
          result.errors.some((error) => error.includes(fragment)),
          `${testCase.name}: expected error containing "${fragment}", got ${JSON.stringify(result.errors)}`
        );
      }
    }
    console.log(`PASS ${testCase.name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${testCase.name}: ${error.message}`);
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log(`All ${cases.length} init check tests passed.`);
