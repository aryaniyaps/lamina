#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gradeAssertion } from '../evals/hooks/grade-lamina.mjs';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-reference-grader-'));

function ctx(output = '', logs = '') {
  return {
    output,
    logs,
    workspace,
    preState: { files: [] },
    postState: { files: [] },
    evalMeta: {},
    turnOutputs: [],
  };
}

const readLog = JSON.stringify({
  type: 'item.completed',
  item: {
    type: 'command_execution',
    command: "/usr/bin/zsh -lc 'sed -n 1,200p .codex/skills/lamina-ux/references/forms.md'",
  },
});

assert.equal(
  gradeAssertion('read reference skills/lamina-ux/references/forms.md', ctx('', readLog)).passed,
  true,
  'an exact reader command must prove the topic was loaded',
);
assert.equal(
  gradeAssertion(
    'read reference skills/lamina-ux/references/forms.md',
    ctx('I used skills/lamina-ux/references/forms.md', 'find .codex/skills/lamina-ux -type f'),
  ).passed,
  false,
  'an output claim or directory listing must not prove a topic read',
);
const opaqueProviderOutput = 'Using lamina-ux: forms\nValidate after blur, preserve entered values after failure, and require a field only when an invariant or workflow depends on it.';
assert.equal(
  gradeAssertion(
    'read reference skills/lamina-ux/references/forms.md',
    ctx(opaqueProviderOutput, ''),
  ).passed,
  true,
  'providers with opaque tool logs may prove loading only with provenance plus reference-specific content',
);
assert.equal(
  gradeAssertion('read skill lamina-ux', ctx(opaqueProviderOutput, '')).passed,
  true,
  'capability proof requires its Using marker plus a recognized topic fingerprint',
);
const markdownProviderOutput = 'Using **lamina-ux**: **Forms**, **Error Handling**. Validate after blur, preserve entered data, favor data immunity, and batch-review anomalies.';
assert.equal(
  gradeAssertion('read reference skills/lamina-ux/references/forms.md', ctx(markdownProviderOutput, '')).passed,
  true,
  'Markdown emphasis in the provenance marker must remain valid when topic-specific proof is present',
);
const linkedProviderOutput = 'Using **lamina-ux**: **[Forms](references/forms.md)**. Validation runs on blur and submit. Preserve entered data and focus the failed field. Make fields required only when crucial to the process. Prefer immunity over rejection for recoverable uncertainty.';
for (const assertion of [
  'read skill lamina-ux',
  'read reference skills/lamina-ux/references/forms.md',
  'reference provenance skills/lamina-ux/references/forms.md',
  'forms recovery rules',
]) {
  assert.equal(gradeAssertion(assertion, ctx(linkedProviderOutput, '')).passed, true, assertion);
}
const discoveryOutput = 'Using lamina-product-discovery: references/problem-framing.md. Actors are household members. The outcome is fewer disputes. The bounded problem excludes full financial merging and is not automatically worth solving as another tracker. Key risk: shared may mean pooled money or visibility-only; validate recurring conflict before investing.';
for (const assertion of [
  'read skill lamina-product-discovery',
  'read reference skills/lamina-product-discovery/references/problem-framing.md',
  'problem-framing boundary',
]) {
  assert.equal(gradeAssertion(assertion, ctx(discoveryOutput, '')).passed, true, assertion);
}
const systemsOutput = 'Using lamina-systems: references/feedback-loops.md. Unread reminders create a reinforcing loop. Acknowledgement delays cause overshoot. Add a recipient-level attention budget and conditional escalation controls that stop after acknowledgement.';
for (const assertion of [
  'read skill lamina-systems',
  'read reference skills/lamina-systems/references/feedback-loops.md',
  'feedback-loop diagnosis',
]) {
  assert.equal(gradeAssertion(assertion, ctx(systemsOutput, '')).passed, true, assertion);
}
assert.equal(
  gradeAssertion('reference provenance skills/lamina-ux/references/forms.md', ctx(markdownProviderOutput, '')).passed,
  true,
);
assert.equal(
  gradeAssertion(
    'reference provenance skills/lamina-ux/references/forms.md',
    ctx('Using lamina-ux: skills/lamina-ux/references/forms.md'),
  ).passed,
  true,
  'the response must expose the selected capability and exact topic',
);
assert.equal(
  gradeAssertion(
    'no deprecated public skill names',
    ctx('Using lamina-ux: forms. Do not invoke lamina-forms.'),
  ).passed,
  false,
  'deprecated public names must fail even when presented as instructions',
);
assert.equal(
  gradeAssertion(
    'forms recovery rules',
    ctx('Validate after blur, preserve entered values after failure, and require a field only when an invariant or workflow depends on it.'),
  ).passed,
  true,
);
assert.equal(
  gradeAssertion(
    'idempotency-concurrency rules',
    ctx('Repeated duplicate requests return the same result; concurrent edits surface a conflict; fence stale retries after state changes.'),
  ).passed,
  true,
);

fs.rmSync(workspace, { recursive: true, force: true });
console.log('reference_loading_grader_test: ok');
