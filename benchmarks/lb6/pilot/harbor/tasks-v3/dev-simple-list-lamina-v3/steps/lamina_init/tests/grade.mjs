#!/usr/bin/env node
import fs from 'node:fs';
import { checkPilotLaminaTreatment } from './pilot-treatment.mjs';
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

const golden = {"sequences":[{"id":"add-and-complete","actor":"owner","actions":[{"type":"add_item","id":"item-1","title":"Example title"},{"type":"complete_item","id":"item-1"}]},{"id":"missing-id","actor":"owner","actions":[{"type":"complete_item","id":"missing-item"}]},{"id":"idempotent-complete","actor":"owner","actions":[{"type":"add_item","id":"item-idem","title":"Example title"},{"type":"complete_item","id":"item-idem"},{"type":"complete_item","id":"item-idem"}]},{"id":"multi-item-isolation","actor":"owner","actions":[{"type":"add_item","id":"item-a","title":"Example title"},{"type":"add_item","id":"item-b","title":"Example title"},{"type":"complete_item","id":"item-a"}]},{"id":"clear-completed","actor":"owner","actions":[{"type":"add_item","id":"item-clear","title":"Example title"},{"type":"add_item","id":"item-keep","title":"Example title"},{"type":"complete_item","id":"item-clear"},{"type":"clear_completed"}]}]};
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
