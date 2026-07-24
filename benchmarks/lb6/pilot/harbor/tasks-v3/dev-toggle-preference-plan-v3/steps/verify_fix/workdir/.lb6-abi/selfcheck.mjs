#!/usr/bin/env node
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

const golden = {"sequences":[{"id":"enable-disable","actor":"user","actions":[{"type":"enable_focus_mode","id":"pref-1"},{"type":"disable_focus_mode","id":"pref-1"}]},{"id":"toggle-roundtrip","actor":"user","actions":[{"type":"toggle_focus_mode","id":"pref-toggle"},{"type":"toggle_focus_mode","id":"pref-toggle"}]}]};
const result = await runBehaviorSelfcheck({ root: '/app', golden });
if (!result.ok) {
  console.error('Structural self-check FAILED:');
  for (const error of result.errors) console.error(' - ' + error);
  process.exit(1);
}
console.log('Structural self-check passed.');
