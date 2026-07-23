#!/usr/bin/env node
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

const golden = {"sequences":[{"actor":"caregiver","actions":[{"type":"add_task","id":"med-1","title":"Morning medication"},{"type":"mark_missed","id":"med-1"}]},{"actor":"caregiver","actions":[{"type":"add_task","id":"med-1","title":"Morning medication"},{"type":"complete_task","id":"med-1"}]},{"actor":"caregiver","actions":[{"type":"add_note","id":"n-1","text":"Private note"}]},{"actor":"revoked-caregiver","actions":[{"type":"revoke_caregiver","actor":"revoked-caregiver"},{"type":"add_note","id":"n-2","text":"Should not be visible"}]}]};
const result = await runBehaviorSelfcheck({ root: '/app', golden });
if (!result.ok) {
  console.error('Structural self-check FAILED:');
  for (const error of result.errors) console.error(' - ' + error);
  process.exit(1);
}
console.log('Structural self-check passed.');
