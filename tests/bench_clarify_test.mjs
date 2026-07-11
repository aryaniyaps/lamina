#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  isClarifyOutput,
  shouldAttemptClarifyRecovery,
  withUnattendedContract,
  buildClarifyAutoReply,
  summarizeInteraction,
  createInteractionTracker,
  recordClarifyEvent,
} from '../benchmarks/scripts/bench-clarify.mjs';

const clarifySample = `## Lamina: clarification needed
### Status
Blocked before artifact generation.
### Clarifying questions
- Who is the primary user?
### How to proceed
Answer the questions above.`;

assert.equal(isClarifyOutput(clarifySample), true);
assert.equal(isClarifyOutput('Here is bench-plan.md content...'), false);
assert.equal(isClarifyOutput(''), false);

assert.equal(
  shouldAttemptClarifyRecovery({ ok: false, reason: 'missing file' }, clarifySample),
  true
);
assert.equal(
  shouldAttemptClarifyRecovery({ ok: true }, clarifySample),
  false
);

const wrapped = withUnattendedContract('Do the task.');
assert.ok(wrapped.includes('Unattended benchmark run'));
assert.ok(wrapped.includes('Do the task.'));

const reply = buildClarifyAutoReply(
  { prompt: 'Build a budgeting app' },
  'Description line\n\n---\n\nContext:\nContext line'
);
assert.ok(reply.includes('Build a budgeting app'));
assert.ok(reply.includes('Description line'));
assert.ok(reply.includes('Open questions'));

const tracker = createInteractionTracker();
recordClarifyEvent(tracker, 'lamina-init', { detected: true, autoReplied: true });
const summary = summarizeInteraction(tracker);
assert.equal(summary.clarify_detected, true);
assert.equal(summary.auto_replied, true);
assert.equal(summary.clarify_stalled, false);

console.log('bench_clarify_test: ok');
