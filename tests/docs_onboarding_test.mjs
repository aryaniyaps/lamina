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

assert.match(readme, /brand\/assets\/wordmark\/lamina-lockup-readme\.svg/);
assert.match(readme, /Design is how it works — not just how it looks\./);
assert.match(readme, /Headless product design for AI coding agents/i);

for (const heading of [
  'Quickstart',
  'How it works',
  'Fits your stack',
  'Demo: a hotel booking platform',
  'Pair with',
  'Why not …?',
  'Commands',
]) {
  assert.ok(readme.includes(`## ${heading}`), `README must retain the ${heading} section`);
}

assert.match(readme, /npm install -g @laminadev\/cli@latest/);
assert.match(readme, /npx skills add aryaniyaps\/lamina --skill lamina -a '\*' -y/);
assert.match(readme, /one installed `lamina` skill contains all 58/i);
assert.match(readme, /lamina doctor --json/);
assert.match(readme, /Do not use sudo and do not edit application source/);
assert.match(readme, /start a fresh agent session/i);

const workflowSignals = [
  '/lamina-init',
  '/lamina-design',
  'Implement',
  '/lamina-verify',
];
let workflowOffset = readme.indexOf('## Quickstart');
for (const signal of workflowSignals) {
  workflowOffset = readme.indexOf(signal, workflowOffset);
  assert.ok(workflowOffset >= 0, `README quickstart must include ${signal} in workflow order`);
  workflowOffset += signal.length;
}

assert.match(readme, /Validated `GraphVersion` plus an implementation projection/);
assert.match(readme, /independent persona missions/i);
assert.match(readme, /never edits application source|do not edit application source/i);
assert.match(readme, /legacy run files are left untouched and have no runtime meaning/i);
assert.match(readme, /HavenStay predates the transactional graph runtime/);
assert.doesNotMatch(readme, /run\.json|\.lamina\/runs\//);
assert.doesNotMatch(readme, /Brownfield minimum/i);

for (const screenshot of [
  'demo/hotel-booking-with-lamina/screenshot.png',
  'demo/hotel-booking-without-lamina/screenshot.png',
]) {
  assert.ok(fs.existsSync(screenshot), `README demo asset must exist: ${screenshot}`);
  assert.ok(readme.includes(screenshot), `README must reference demo asset: ${screenshot}`);
}

assert.match(combined, /every relevant Persona/i);
assert.match(combined, /never edit application source|do not edit application source/i);
assert.match(combined, /legacy run files? (?:are )?(?:ignored|left untouched|have no runtime meaning)/i);
assert.doesNotMatch(combined, /at most three|up to three|≤\s*3/i);

console.log('docs_onboarding_test: ok');
