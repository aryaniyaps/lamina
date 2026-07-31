import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fixtures = path.join(root, 'evals/fixtures/skill-architectures');
const criteria = JSON.parse(fs.readFileSync(path.join(root, 'docs/migrations/compact-skills/decision-criteria.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs/migrations/compact-skills/normative-ledger.json'), 'utf8'));

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function approximateTokens(text) {
  return Math.ceil(text.length / 4);
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

for (const variant of ['candidate-6', 'candidate-1']) {
  const variantRoot = path.join(fixtures, variant);
  const architecture = JSON.parse(fs.readFileSync(path.join(variantRoot, 'architecture.json'), 'utf8'));
  const traceability = JSON.parse(fs.readFileSync(path.join(variantRoot, 'traceability.json'), 'utf8'));
  const expectedPublic = variant === 'candidate-6'
    ? ['lamina', 'lamina-init', 'lamina-design', 'lamina-work', 'lamina-verify', 'lamina-product']
    : ['lamina'];
  assert.deepEqual(architecture.public, expectedPublic);
  assert.equal(architecture.sourceCommit, criteria.baseline.commit);
  assert.equal(traceability.rules.length, ledger.rules.length);
  assert.equal(new Set(traceability.rules.map((rule) => rule.rule)).size, ledger.rules.length);

  const publicRoots = walk(path.join(variantRoot, 'skills'))
    .filter((file) => path.basename(file) === 'SKILL.md')
    .map((file) => path.basename(path.dirname(file))).sort();
  assert.deepEqual(publicRoots, [...expectedPublic].sort(), `${variant} public boundary drifted`);

  const descriptions = [];
  for (const skill of expectedPublic) {
    const content = fs.readFileSync(path.join(variantRoot, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.ok(words(content) <= criteria.contextBudgets.genericRootWords, `${variant}/${skill} exceeds root budget`);
    assert.doesNotMatch(content.toLowerCase(), /read every reference|load all capabilities|read all workflow documents/);
    descriptions.push(content.match(/^description:\s*"(.+)"$/m)?.[1] || '');
  }
  assert.equal(new Set(descriptions).size, descriptions.length, `${variant} descriptions must be unique`);
  assert.ok(approximateTokens(descriptions.join('\n')) < criteria.contextBudgets.installedPublicDescriptionTokens);

  for (const relative of Object.values(architecture.workflows)) {
    assert.ok(fs.existsSync(path.join(variantRoot, relative)), `${variant} missing workflow ${relative}`);
  }
  for (const relative of Object.values(architecture.references)) {
    assert.ok(fs.existsSync(path.join(variantRoot, relative)), `${variant} missing reference ${relative}`);
  }
  for (const profile of Object.values(architecture.profiles)) {
    for (const relative of [...profile.always, ...Object.values(profile.conditional).flat()]) {
      assert.ok(fs.existsSync(path.join(variantRoot, 'skills/lamina', relative)), `${variant} profile missing ${relative}`);
    }
  }
  for (const rule of traceability.rules) {
    assert.ok(fs.existsSync(path.join(variantRoot, rule.destination)), `${variant} rule ${rule.rule} has no destination`);
  }
  assert.deepEqual(
    walk(variantRoot).map((file) => path.relative(variantRoot, file).replaceAll(path.sep, '/')).sort(),
    architecture.expectedInstallInventory,
  );
}

const sharedFiles = walk(path.join(fixtures, '_shared'));
for (const file of sharedFiles) {
  const relative = path.relative(path.join(fixtures, '_shared'), file);
  const shared = fs.readFileSync(file);
  for (const variant of ['candidate-6', 'candidate-1']) {
    assert.deepEqual(
      fs.readFileSync(path.join(fixtures, variant, 'skills/lamina', relative)),
      shared,
      `${variant} diverged from shared content: ${relative}`,
    );
  }
}

const productionPublic = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, 'skills', entry.name, 'SKILL.md')));
assert.equal(productionPublic.length, 59, 'candidate fixtures must not alter production discovery');

console.log('compact_skill_fixtures_test: ok');
