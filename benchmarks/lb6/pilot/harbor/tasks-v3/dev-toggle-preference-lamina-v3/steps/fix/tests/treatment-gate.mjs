#!/usr/bin/env node
import fs from 'node:fs';
import { checkPilotLaminaTreatment } from './pilot-treatment.mjs';

const phase = "fix";
const treatment = checkPilotLaminaTreatment('/app', phase);
fs.mkdirSync('/logs/verifier', { recursive: true });
fs.writeFileSync('/logs/verifier/treatment_report.json', JSON.stringify(treatment, null, 2) + '\n');
if (!treatment.valid) {
  fs.writeFileSync('/logs/verifier/reward.json', JSON.stringify({
    reward: 0,
    invalid_treatment: true,
    missing: treatment.missing,
  }, null, 2) + '\n');
  console.error(JSON.stringify(treatment));
  process.exit(1);
}
