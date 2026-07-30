#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePassiveTrace } from '../benchmarks/lb6/passive-v5/validate-trace.mjs';

const protocol = JSON.parse(fs.readFileSync('benchmarks/lb6/passive-v5/protocol.json', 'utf8'));
assert.equal(protocol.schema, 'lamina.passive-benchmark/v5');
assert.ok(protocol.semantic_rows.includes('implicit_activation'));
assert.ok(protocol.semantic_rows.includes('current_persona_walk_coverage'));
assert.ok(protocol.semantic_rows.includes('case_bound_behavioral_proof'));

const obligationIds = ['obligation_a', 'obligation_b'];
const experienceCaseIds = ['case_requiredness', 'case_duplicate_recovery'];
const valid = {
  schema: 'lamina.passive-trace/v5',
  ui: true,
  messages: ['Implemented the ordinary request with passive product context.'],
  events: [
    { type: 'ordinary_request_received' },
    { type: 'implementation_packet_prepared', obligation_ids: obligationIds, experience_case_ids: experienceCaseIds },
    { type: 'work_map_checked', obligation_ids: obligationIds, experience_case_ids: experienceCaseIds },
    { type: 'source_edit_started' },
    ...experienceCaseIds.map((case_id) => ({
      type: 'experience_case_passed',
      case_id,
      artifact: `${case_id}.json`,
      observation: { observed: 'matched' },
    })),
    ...protocol.ui_audit_classes.map((audit_kind) => ({
      type: 'ui_audit_passed',
      audit_kind,
      surface: 'surface.fixture',
      state: 'ready',
      artifact: `${audit_kind}.json`,
    })),
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

const genericPass = structuredClone(valid);
genericPass.events = genericPass.events.filter((item) => item.type !== 'experience_case_passed');
genericPass.events.splice(4, 0, { type: 'experience_case_passed' });
assert.equal(validatePassiveTrace(genericPass).valid, false);

console.log('passive_benchmark_v4_test: ok');
