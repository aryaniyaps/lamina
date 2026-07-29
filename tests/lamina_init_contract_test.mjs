#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const skill = fs.readFileSync('skills/lamina-init/SKILL.md', 'utf8');

assert.match(skill, /Core graph initialization may continue/);
assert.match(skill, /do not\s+create Evidence Resources or attach evidence claims/);
assert.match(skill, /observed\.resource_ids/);
assert.match(skill, /exact `Resource\.id` values/);
assert.match(skill, /Never substitute a path alias, source key, view name, or\s+generation/);
assert.match(skill, /Report canonical graph initialization and observation as separate outcomes/);
assert.match(skill, /Only report observation coverage.*exited zero/s);
assert.match(skill, /Never claim complete observation coverage/);
assert.match(skill, /generated canonical Resources normally use `res_\*` ids/);

console.log('lamina_init_contract_test: ok');
