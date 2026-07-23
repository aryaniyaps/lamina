#!/usr/bin/env node
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

const golden = {"sequences":[{"actor":"reviewer","actions":[{"type":"invite","id":"invite-1","document":"example-document"},{"type":"accept_invite","id":"invite-1","email":"participant@example.org"},{"type":"add_comment","id":"c-1","text":"Example note text"}]},{"actor":"reviewer","actions":[{"type":"invite","id":"invite-1","document":"example-document"},{"type":"accept_invite","id":"invite-1","email":"participant@example.org"},{"type":"expire_invite","id":"invite-1"},{"type":"add_comment","id":"c-expired","text":"Example note text"}]},{"actor":"reviewer","actions":[{"type":"invite","id":"invite-1","document":"example-document"},{"type":"accept_invite","id":"invite-1","email":"participant@example.org"},{"type":"revoke_invite","id":"invite-1"},{"type":"add_comment","id":"c-revoked","text":"Example note text"}]}]};
const result = await runBehaviorSelfcheck({ root: '/app', golden });
if (!result.ok) {
  console.error('Structural self-check FAILED:');
  for (const error of result.errors) console.error(' - ' + error);
  process.exit(1);
}
console.log('Structural self-check passed.');
