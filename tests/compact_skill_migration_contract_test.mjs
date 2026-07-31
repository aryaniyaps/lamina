import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const criteria = JSON.parse(read('docs/migrations/compact-skills/decision-criteria.json'));
const adr003 = read('docs/decisions/003-public-sibling-skills.md');
const adr013 = read('docs/decisions/013-compact-skill-architecture-experiment.md');

assert.equal(criteria.schema, 'lamina.skill-architecture-decision/v1');
assert.match(criteria.baseline.commit, /^[0-9a-f]{40}$/);
assert.deepEqual(criteria.candidates.map((candidate) => candidate.variant), [
  'candidate-6',
  'candidate-1',
]);
assert.deepEqual(criteria.candidates[0].publicSkills, [
  'lamina',
  'lamina-init',
  'lamina-design',
  'lamina-work',
  'lamina-verify',
  'lamina-product',
]);
assert.deepEqual(criteria.candidates[1].publicSkills, ['lamina']);
assert.equal(criteria.productionSelection, null);

assert.equal(
  Object.values(criteria.decisionWeightsPercent).reduce((total, weight) => total + weight, 0),
  100,
  'decision weights must total 100 percent',
);
assert.equal(criteria.thresholds.requiredGraphSafetyRetentionPercent, 100);
assert.equal(criteria.thresholds.requiredWriteBoundaryRetentionPercent, 100);
assert.equal(criteria.thresholds.requiredSupportedProviderInstallSuccessPercent, 100);
assert.equal(criteria.thresholds.maximumUnresolvedCriticalRegressions, 0);
assert.ok(criteria.disqualifiers.includes('mandatory_safety_rule_loss'));

assert.match(adr003, /## Status\s+\nAccepted/);
assert.match(adr013, /- Status: Proposed/);
assert.match(adr013, /ADR 003 remains \*\*Accepted\*\*/);
assert.doesNotMatch(adr013, /- Status: Accepted/);

const publicSkills = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, 'skills', entry.name, 'SKILL.md')));
assert.equal(publicSkills.length, 59, 'the experiment must not change the production public catalog');

console.log('compact_skill_migration_contract_test: ok');
