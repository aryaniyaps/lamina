#!/usr/bin/env node
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

const golden = {"sequences":[{"id":"request","actor":"borrower","actions":[{"type":"request_loan","id":"loan-1","item":"Example item"}]},{"id":"handoff","actor":"borrower","actions":[{"type":"request_loan","id":"loan-1","item":"Example item"},{"type":"confirm_handoff","id":"loan-1","actor":"borrower"},{"type":"confirm_handoff","id":"loan-1","actor":"owner"}]},{"id":"damage","actor":"owner","actions":[{"type":"request_loan","id":"loan-1","item":"Example item"},{"type":"confirm_handoff","id":"loan-1","actor":"borrower"},{"type":"confirm_handoff","id":"loan-1","actor":"owner"},{"type":"report_damage","id":"loan-1"}]},{"id":"premature-damage","actor":"owner","actions":[{"type":"request_loan","id":"loan-early","item":"Example item"},{"type":"report_damage","id":"loan-early"}]},{"id":"loan-isolation","actor":"borrower","actions":[{"type":"request_loan","id":"loan-a","item":"Example item"},{"type":"request_loan","id":"loan-b","item":"Example item"}]}]};
const result = await runBehaviorSelfcheck({ root: '/app', golden });
if (!result.ok) {
  console.error('Structural self-check FAILED:');
  for (const error of result.errors) console.error(' - ' + error);
  process.exit(1);
}
console.log('Structural self-check passed.');
