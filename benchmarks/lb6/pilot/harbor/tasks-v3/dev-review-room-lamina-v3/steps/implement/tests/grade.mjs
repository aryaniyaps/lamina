#!/usr/bin/env node
import fs from 'node:fs';
import { checkPilotLaminaTreatment } from './pilot-treatment.mjs';
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

const golden = {"sequences":[{"id":"accepted-comment","actor":"reviewer","actions":[{"type":"invite","id":"invite-1","document":"example-document"},{"type":"accept_invite","id":"invite-1","email":"participant@example.org"},{"type":"add_comment","id":"c-1","text":"Example note text"}]},{"id":"expiry","actor":"reviewer","actions":[{"type":"invite","id":"invite-1","document":"example-document"},{"type":"accept_invite","id":"invite-1","email":"participant@example.org"},{"type":"expire_invite","id":"invite-1"},{"type":"add_comment","id":"c-expired","text":"Example note text"}]},{"id":"revocation","actor":"reviewer","actions":[{"type":"invite","id":"invite-1","document":"example-document"},{"type":"accept_invite","id":"invite-1","email":"participant@example.org"},{"type":"revoke_invite","id":"invite-1"},{"type":"add_comment","id":"c-revoked","text":"Example note text"}]}]};
const arm = "lamina";
const phase = "implement";

let reward = 0;
let importOk = 0;
let behavior = 0;
let invalidTreatment = false;
let treatment = { valid: true, missing: [] };
let selfcheck = { ok: false, errors: ['app not built yet'] };

if (true) {
  try {
    selfcheck = await runBehaviorSelfcheck({ root: '/app', golden });
    importOk = 1;
    behavior = selfcheck.ok ? 1 : 0;
    reward = selfcheck.ok ? 1 : 0;
  } catch {
    selfcheck = { ok: false, errors: ['app.mjs not importable yet'] };
  }
}

if (arm === 'lamina') {
  treatment = checkPilotLaminaTreatment('/app', phase);
  invalidTreatment = !treatment.valid;
  if (invalidTreatment) reward = 0;
  else if (false) reward = 1;
}

const result = {
  reward,
  scores: { import: importOk, behavior },
  arm,
  phase,
  measurement: 'structural_only',
  invalid_treatment: invalidTreatment,
  treatment,
  selfcheck,
  development_only: true,
  confirmatory: false,
  child_actual_model_unverified: true,
};

fs.mkdirSync('/logs/verifier', { recursive: true });
fs.writeFileSync('/logs/verifier/reward.json', JSON.stringify({ reward, behavior, import_ok: importOk }, null, 2) + '\n');
fs.writeFileSync('/logs/verifier/structural_report.json', JSON.stringify(result, null, 2) + '\n');
if (!selfcheck.ok && true) process.exit(1);
if (invalidTreatment && false) process.exit(1);
console.log(JSON.stringify(result));
