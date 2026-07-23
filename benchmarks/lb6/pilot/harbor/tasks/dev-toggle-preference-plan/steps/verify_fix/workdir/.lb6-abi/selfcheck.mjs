#!/usr/bin/env node
import { runBehaviorSelfcheck } from './behavior-selfcheck.mjs';

const golden = {"sequences":[{"actor":"user","actions":[{"type":"register_device_context","id":"pref-1","contextToken":"example-contextToken"},{"type":"enable_focus_mode","id":"pref-1"}]},{"actor":"user","actions":[{"type":"register_device_context","id":"pref-1","contextToken":"example-contextToken"},{"type":"enable_focus_mode","id":"pref-1"},{"type":"disable_focus_mode","id":"pref-1"}]},{"actor":"user","actions":[{"type":"register_device_context","id":"pref-1","contextToken":"example-contextToken"},{"type":"enable_focus_mode","id":"pref-1"},{"type":"toggle_focus_mode","id":"pref-1"},{"type":"toggle_focus_mode","id":"pref-1"}]}]};
const result = await runBehaviorSelfcheck({ root: '/app', golden });
if (!result.ok) {
  console.error('Structural self-check FAILED:');
  for (const error of result.errors) console.error(' - ' + error);
  process.exit(1);
}
console.log('Structural self-check passed.');
