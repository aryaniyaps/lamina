#!/usr/bin/env node
import fs from 'node:fs';
import { checkPilotLaminaTreatment } from './pilot-treatment.mjs';
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

const golden = {"sequences":[{"id":"request","actor":"borrower","actions":[{"type":"request_loan","id":"loan-1","item":"Example item"}]},{"id":"handoff","actor":"borrower","actions":[{"type":"request_loan","id":"loan-1","item":"Example item"},{"type":"confirm_handoff","id":"loan-1","actor":"borrower"},{"type":"confirm_handoff","id":"loan-1","actor":"owner"}]},{"id":"damage","actor":"owner","actions":[{"type":"request_loan","id":"loan-1","item":"Example item"},{"type":"confirm_handoff","id":"loan-1","actor":"borrower"},{"type":"confirm_handoff","id":"loan-1","actor":"owner"},{"type":"report_damage","id":"loan-1"}]},{"id":"premature-damage","actor":"owner","actions":[{"type":"request_loan","id":"loan-early","item":"Example item"},{"type":"report_damage","id":"loan-early"}]},{"id":"loan-isolation","actor":"borrower","actions":[{"type":"request_loan","id":"loan-a","item":"Example item"},{"type":"request_loan","id":"loan-b","item":"Example item"}]}]};
const arm = "lamina";
const phase = "lamina_init";

let reward = 0;
let importOk = 0;
let behavior = 0;
let invalidTreatment = false;
let treatment = { valid: true, missing: [] };
let selfcheck = { ok: false, errors: ['app not built yet'] };

if (false) {
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
  else if (true) reward = 1;
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
if (!selfcheck.ok && false) process.exit(1);
if (invalidTreatment && true) process.exit(1);
console.log(JSON.stringify(result));
