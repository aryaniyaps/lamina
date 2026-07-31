import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateArchitecture } from '../scripts/lib/compact-skill-architecture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'evals/fixtures/skill-architectures/candidate-6');
const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/migrations/compact-skills/normative-ledger.json'), 'utf8'));
const ruleIds = ledger.rules.map((rule) => rule.id);

function mutate(name, callback, expected) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), `lamina-compact-${name}-`));
  fs.cpSync(source, temporaryRoot, { recursive: true });
  callback(temporaryRoot);
  const result = validateArchitecture(temporaryRoot, ruleIds);
  assert.ok(result.errors.some((error) => expected.test(error)), `${name} was not detected: ${result.errors.join('; ')}`);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

mutate('missing-reference', (directory) => {
  fs.rmSync(path.join(directory, 'skills/lamina/references/domain-integrity/invariants.md'));
}, /missing declared file|missing profile reference|traceability destination missing|inventory/);

mutate('misspelled-profile', (directory) => {
  const file = path.join(directory, 'architecture.json');
  const architecture = JSON.parse(fs.readFileSync(file, 'utf8'));
  architecture.profiles.design.conditional.domain_change[0] = 'references/domain-integrity/missing.md';
  fs.writeFileSync(file, `${JSON.stringify(architecture, null, 2)}\n`);
}, /missing profile reference/);

mutate('nested-manifest', (directory) => {
  const file = path.join(directory, 'skills/lamina/references/SKILL.md');
  fs.writeFileSync(file, '---\nname: accidental\ndescription: accidental\n---\n');
}, /nested public manifest/);

mutate('duplicate-public-name', (directory) => {
  const sourceFile = path.join(directory, 'skills/lamina-product/SKILL.md');
  const target = path.join(directory, 'skills/duplicate/SKILL.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(sourceFile, target);
}, /duplicate public skill name/);

mutate('root-budget', (directory) => {
  const file = path.join(directory, 'skills/lamina/SKILL.md');
  fs.appendFileSync(file, `\n${'excess '.repeat(1700)}`);
}, /root exceeds word budget/);

mutate('eager-load', (directory) => {
  fs.appendFileSync(path.join(directory, 'skills/lamina/SKILL.md'), '\nRead every reference.\n');
}, /eager-load instruction/);

mutate('design-write-boundary', (directory) => {
  const file = path.join(directory, 'skills/lamina/workflows/design.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace(/must not edit application source/gi, 'may change code')
    .replace(/never edit application source/gi, 'may change code'));
}, /design source-write prohibition/);

mutate('accessibility-route', (directory) => {
  const file = path.join(directory, 'architecture.json');
  const architecture = JSON.parse(fs.readFileSync(file, 'utf8'));
  architecture.profiles.design.conditional.user_facing_form = architecture.profiles.design.conditional.user_facing_form
    .filter((reference) => !reference.includes('accessibility'));
  fs.writeFileSync(file, `${JSON.stringify(architecture, null, 2)}\n`);
}, /omits accessibility/);

mutate('concurrency-route', (directory) => {
  const file = path.join(directory, 'architecture.json');
  const architecture = JSON.parse(fs.readFileSync(file, 'utf8'));
  architecture.profiles.design.conditional.time_bearing_operation = architecture.profiles.design.conditional.time_bearing_operation
    .filter((reference) => !reference.includes('idempotency-concurrency'));
  fs.writeFileSync(file, `${JSON.stringify(architecture, null, 2)}\n`);
}, /omits concurrency/);

mutate('traceability', (directory) => {
  const file = path.join(directory, 'traceability.json');
  const traceability = JSON.parse(fs.readFileSync(file, 'utf8'));
  traceability.rules.shift();
  fs.writeFileSync(file, `${JSON.stringify(traceability, null, 2)}\n`);
}, /traceability missing baseline rule/);

console.log('compact_skill_architecture_mutation_test: ok');
