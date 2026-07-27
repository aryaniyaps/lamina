#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const contractPath = 'skills/lamina-orchestrator/prerequisites/cli-required.md';
const contract = fs.readFileSync(contractPath, 'utf8');
const commandSkills = ['lamina', 'lamina-init', 'lamina-design', 'lamina-verify'];

assert.match(contract, /lamina doctor --json/);
assert.match(contract, /cli\.api_version` is exactly `1/);
assert.match(contract, /npm install -g @laminadev\/cli@latest/);
assert.match(contract, /stop before any graph or evidence mutation/);
assert.match(contract, /Never invoke the runtime through `npx`/);
assert.match(contract, /never install it automatically/);
assert.match(contract, /never fall back to copied or embedded runtime scripts/);

for (const name of commandSkills) {
  const source = fs.readFileSync(`skills/${name}/SKILL.md`, 'utf8');
  assert.match(
    source,
    /prerequisites\/cli-required\.md/,
    `${name} must use the shared CLI prerequisite`,
  );
}

console.log('skill_cli_prerequisite_test: ok');
