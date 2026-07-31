import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fixtureRoot = path.join(root, 'evals/fixtures/skill-architectures');
const providers = {
  codex: '.codex/skills',
  'claude-code': '.claude/skills',
  cursor: '.cursor/skills',
  generic: '.agents/skills',
};

function install(variant, destination, selected = null) {
  const architecture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, variant, 'architecture.json'), 'utf8'));
  const publicSkills = selected || architecture.public;
  fs.mkdirSync(destination, { recursive: true });
  for (const skill of publicSkills) {
    fs.cpSync(
      path.join(fixtureRoot, variant, 'skills', skill),
      path.join(destination, skill),
      { recursive: true, force: true },
    );
  }
  return architecture;
}

function discover(destination) {
  if (!fs.existsSync(destination)) return [];
  return fs.readdirSync(destination, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(destination, entry.name, 'SKILL.md')))
    .map((entry) => entry.name).sort();
}

for (const [provider, relativeRoot] of Object.entries(providers)) {
  for (const variant of ['candidate-6', 'candidate-1']) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `lamina compact ${provider} `));
    const destination = path.join(workspace, relativeRoot);
    const architecture = install(variant, destination);
    assert.deepEqual(discover(destination), [...architecture.public].sort(), `${provider}/${variant} discovery`);
    assert.ok(fs.existsSync(path.join(destination, 'lamina/references/authority-and-safety.md')));
    assert.ok(fs.existsSync(path.join(destination, 'lamina/workflows/work.md')));
    assert.equal(discover(path.join(destination, 'lamina/references')).length, 0, 'internal references became public');

    install(variant, destination);
    assert.deepEqual(discover(destination), [...architecture.public].sort(), `${provider}/${variant} reinstall`);

    const unrelated = path.join(destination, 'third-party-skill/SKILL.md');
    fs.mkdirSync(path.dirname(unrelated), { recursive: true });
    fs.writeFileSync(unrelated, '---\nname: third-party-skill\ndescription: unrelated\n---\n');
    for (const skill of architecture.public) fs.rmSync(path.join(destination, skill), { recursive: true, force: true });
    assert.ok(fs.existsSync(unrelated), `${provider}/${variant} uninstall removed unrelated skill`);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

const partialWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina compact partial '));
const partialDestination = path.join(partialWorkspace, providers.codex);
const partialArchitecture = install('candidate-6', partialDestination, ['lamina-design']);
assert.deepEqual(discover(partialDestination), ['lamina-design']);
assert.equal(fs.existsSync(path.join(partialDestination, 'lamina/references/authority-and-safety.md')), false);
assert.equal(partialArchitecture.providerRequirements.partialInstallRejected, true);
fs.rmSync(partialWorkspace, { recursive: true, force: true });

console.log('compact_skill_install_fixture_test: ok (4 provider layouts)');
