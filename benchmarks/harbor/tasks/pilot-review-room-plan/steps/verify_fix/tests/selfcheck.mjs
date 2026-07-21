#!/usr/bin/env node
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

// Public actions only — graded expect substrings are intentionally omitted.
const golden = {"sequences":[{"actor":"reviewer","actions":[{"type":"invite","id":"invite-1","document":"doc-1"},{"type":"accept_invite","id":"invite-1","email":"reviewer@example.com"},{"type":"add_comment","id":"c-1","text":"Looks good"}]},{"actor":"reviewer","actions":[{"type":"invite","id":"invite-1","document":"doc-1"},{"type":"expire_invite","id":"invite-1"}]},{"actor":"reviewer","actions":[{"type":"invite","id":"invite-1","document":"doc-1"},{"type":"revoke_invite","id":"invite-1"}]}]};
const result = await runBehaviorSelfcheck({ root: '/app', golden });
if (!result.ok) {
  console.error('Structural self-check FAILED:');
  for (const error of result.errors) console.error(' - ' + error);
  process.exit(1);
}
console.log('Structural self-check passed.');
