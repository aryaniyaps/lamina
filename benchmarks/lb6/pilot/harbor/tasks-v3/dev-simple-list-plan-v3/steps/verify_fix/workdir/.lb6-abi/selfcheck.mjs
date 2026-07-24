#!/usr/bin/env node
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

const golden = {"sequences":[{"id":"add-and-complete","actor":"owner","actions":[{"type":"add_item","id":"item-1","title":"Example title"},{"type":"complete_item","id":"item-1"}]},{"id":"missing-id","actor":"owner","actions":[{"type":"complete_item","id":"missing-item"}]},{"id":"idempotent-complete","actor":"owner","actions":[{"type":"add_item","id":"item-idem","title":"Example title"},{"type":"complete_item","id":"item-idem"},{"type":"complete_item","id":"item-idem"}]},{"id":"multi-item-isolation","actor":"owner","actions":[{"type":"add_item","id":"item-a","title":"Example title"},{"type":"add_item","id":"item-b","title":"Example title"},{"type":"complete_item","id":"item-a"}]},{"id":"clear-completed","actor":"owner","actions":[{"type":"add_item","id":"item-clear","title":"Example title"},{"type":"add_item","id":"item-keep","title":"Example title"},{"type":"complete_item","id":"item-clear"},{"type":"clear_completed"}]}]};
const result = await runBehaviorSelfcheck({ root: '/app', golden });
if (!result.ok) {
  console.error('Structural self-check FAILED:');
  for (const error of result.errors) console.error(' - ' + error);
  process.exit(1);
}
console.log('Structural self-check passed.');
