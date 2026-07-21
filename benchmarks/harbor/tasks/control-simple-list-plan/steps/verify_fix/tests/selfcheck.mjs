#!/usr/bin/env node
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

// Public actions only — graded expect substrings are intentionally omitted.
const golden = {"sequences":[{"actor":"owner","actions":[{"type":"add_item","id":"item-1","title":"Buy milk"},{"type":"complete_item","id":"item-1"}]}]};
const result = await runBehaviorSelfcheck({ root: '/app', golden });
if (!result.ok) {
  console.error('Structural self-check FAILED:');
  for (const error of result.errors) console.error(' - ' + error);
  process.exit(1);
}
console.log('Structural self-check passed.');
