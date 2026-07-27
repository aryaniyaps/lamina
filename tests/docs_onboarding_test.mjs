#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readme = fs.readFileSync('README.md', 'utf8');
const index = fs.readFileSync('docs/content/index.mdx', 'utf8');
const reference = fs.readFileSync('docs/content/reference/transactional-graph.mdx', 'utf8');
const combined = `${readme}\n${index}\n${reference}`;

for (const signal of ['CocoIndex', 'graphd', 'Ladybug', 'GraphVersion', 'lamina graph status']) {
  assert.ok(combined.includes(signal), `documentation must explain ${signal}`);
}
assert.match(readme, /Sources ──▶ CocoIndex[\s\S]*Agents[\s\S]*Runs/);
assert.match(readme, /lamina session start[\s\S]*lamina session publish/);
assert.match(readme, /lamina mission compile[\s\S]*lamina mission run/);
assert.match(combined, /every relevant Persona/i);
assert.match(combined, /never edit application source|do not edit application source/i);
assert.match(combined, /legacy run files? (?:are )?(?:ignored|left untouched|have no runtime meaning)/i);
assert.doesNotMatch(combined, /at most three|up to three|≤\s*3/i);

console.log('docs_onboarding_test: ok');
