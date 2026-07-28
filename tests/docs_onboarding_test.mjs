#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readme = fs.readFileSync('README.md', 'utf8');
const index = fs.readFileSync('docs/content/index.mdx', 'utf8');
const loop = fs.readFileSync('docs/content/concepts/the-loop.mdx', 'utf8');
const reference = fs.readFileSync('docs/content/reference/transactional-graph.mdx', 'utf8');
const diagrams = fs.readFileSync('docs/components/flow-diagrams.tsx', 'utf8');
const combined = `${readme}\n${index}\n${loop}\n${reference}`;

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

assert.match(readme, /releases\/latest\/download\/install\.sh/);
assert.match(readme, /npx skills add aryaniyaps\/lamina --skill '\*' -a <active-agent> -y/);
assert.match(readme, /router plus 58 focused workflow and craft skills/);
assert.match(readme, /lamina doctor --json/);
assert.match(readme, /Do not use sudo and do not edit application source/);
assert.match(readme, /Node\.js\/npm are required only for the preceding `npx skills` command/i);
assert.match(readme, /never stages or creates an initial commit/i);
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
assert.doesNotMatch(readme, /```mermaid/);
assert.match(readme, /docs\/public\/diagrams\/product-loop\.svg/);

for (const diagram of [
  'ProductLoopDiagram',
  'RuntimeArchitectureDiagram',
  'TransactionLifecycleDiagram',
]) {
  assert.match(diagrams, new RegExp(`export function ${diagram}`));
  assert.match(combined, new RegExp(`<${diagram} \\/>`));
}

assert.match(diagrams, /nodesDraggable=\{false\}/);
assert.match(diagrams, /nodesConnectable=\{false\}/);
assert.match(diagrams, /figcaption/);
assert.match(index, /Every write crosses `graphd`/);
assert.match(loop, /implementation defect/i);
assert.match(loop, /contract gap/i);
assert.match(reference, /never leaves a partial GraphVersion/i);

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
