#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePassiveTrace } from '../benchmarks/lb6/passive-v4/validate-trace.mjs';

const protocol = JSON.parse(fs.readFileSync('benchmarks/lb6/passive-v4/protocol.json', 'utf8'));
assert.equal(protocol.schema, 'lamina.passive-benchmark/v4');
assert.ok(protocol.semantic_rows.includes('implicit_activation'));
assert.ok(protocol.semantic_rows.includes('live_ui_proof'));

const obligationIds = ['obligation_a', 'obligation_b'];
const valid = {
  schema: 'lamina.passive-trace/v4',
  ui: true,
  messages: ['Implemented the ordinary request with passive product context.'],
  events: [
    { type: 'ordinary_request_received' },
    { type: 'implementation_packet_prepared', obligation_ids: obligationIds },
    { type: 'work_map_checked', obligation_ids: obligationIds },
    { type: 'source_edit_started' },
    ...protocol.ui_audit_classes.map((audit_kind) => ({ type: 'ui_audit_passed', audit_kind })),
    { type: 'work_verified' },
  ],
};
assert.equal(validatePassiveTrace(valid).valid, true);

const explicitRecommendation = structuredClone(valid);
explicitRecommendation.messages = ['Now run /lamina-verify.'];
assert.equal(validatePassiveTrace(explicitRecommendation).valid, false);

const earlyEdit = structuredClone(valid);
earlyEdit.events[1] = { type: 'source_edit_started' };
assert.equal(validatePassiveTrace(earlyEdit).valid, false);

const missingResponsive = structuredClone(valid);
missingResponsive.events = missingResponsive.events.filter((item) =>
  item.type !== 'ui_audit_passed' || item.audit_kind !== 'responsive');
assert.equal(validatePassiveTrace(missingResponsive).valid, false);

console.log('passive_benchmark_v4_test: ok');
