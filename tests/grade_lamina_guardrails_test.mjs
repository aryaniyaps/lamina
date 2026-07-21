#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffOutsideLamina } from '../evals/lib/lamina-write-boundary.mjs';
import { gradeAssertion, detectImplementableCode } from '../evals/hooks/grade-lamina.mjs';

function mkWorkspace(layout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-guardrail-grade-'));
  for (const [rel, body] of Object.entries(layout)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

function gradeCtx({ workspace, output = '', preState = null, postState = null, turnOutputs = [] }) {
  return { output, workspace, preState, postState, logs: '', evalMeta: null, turnOutputs };
}

// detectImplementableCode
{
  const clean = detectImplementableCode('Design the wishlist workflow and empty states.');
  assert.equal(clean.hasCode, false);

  const tsx = detectImplementableCode('```tsx\nexport default function Wishlist() {}\n```');
  assert.equal(tsx.hasCode, true);

  const importLine = detectImplementableCode('import { useState } from "react";');
  assert.equal(importLine.hasCode, true);

  const npm = detectImplementableCode('Run npm install @auth/core before wiring login.');
  assert.equal(npm.hasCode, true);

  const pathEdit = detectImplementableCode('Create src/components/Wishlist.tsx for the feature.');
  assert.equal(pathEdit.hasCode, true);
}

// no writes outside .lamina
{
  const pre = { file_hashes: { 'lib/foo.ts': 'aaa', '.lamina/x.md': 'bbb' } };
  const post = { file_hashes: { 'lib/foo.ts': 'ccc', '.lamina/x.md': 'ddd' } };
  const violations = diffOutsideLamina(pre, post);
  assert.deepEqual(violations, ['lib/foo.ts']);

  const workspace = mkWorkspace({});
  const ctx = gradeCtx({
    workspace,
    preState: pre,
    postState: post,
  });
  const fail = gradeAssertion('no writes outside .lamina', ctx);
  assert.equal(fail.passed, false);

  const postLaminaOnly = { file_hashes: { 'lib/foo.ts': 'aaa', '.lamina/x.md': 'eee' } };
  const pass = gradeAssertion(
    'no writes outside .lamina',
    gradeCtx({ workspace, preState: pre, postState: postLaminaOnly }),
  );
  assert.equal(pass.passed, true);
  fs.rmSync(workspace, { recursive: true, force: true });
}

// no product code in output vs write boundary (regression)
{
  const workspace = mkWorkspace({});
  const pre = { file_hashes: { 'lib/foo.ts': 'aaa' } };
  const post = { file_hashes: { 'lib/foo.ts': 'ccc' } };
  const outputOnly = gradeAssertion(
    'no product code in output',
    gradeCtx({ workspace, output: '### Domain and invariants\n', preState: pre, postState: post }),
  );
  assert.equal(outputOnly.passed, true, 'output check should not fail on disk violations');

  const outputFail = gradeAssertion(
    'no product code in output',
    gradeCtx({
      workspace,
      output: '```tsx\nexport default function App() {}\n```',
      preState: pre,
      postState: pre,
    }),
  );
  assert.equal(outputFail.passed, false);
  fs.rmSync(workspace, { recursive: true, force: true });
}

// no app source in artifacts
{
  const workspace = mkWorkspace({
    '.lamina/runs/test-run/implement.md': '# Handoff\n\nEdit src/auth.ts and add:\n```tsx\nexport default function Auth() {}\n```\n',
    '.lamina/runs/test-run/run.json': '{"id":"test-run","contract_version":"2.0"}',
  });
  const fail = gradeAssertion('no app source in artifacts', gradeCtx({ workspace }));
  assert.equal(fail.passed, false);

  const cleanWorkspace = mkWorkspace({
    '.lamina/runs/test-run/implement.md': '# Handoff\n\nImplement wishlist add/remove per scenario acceptance.\n',
    '.lamina/runs/test-run/run.json': '{"id":"test-run","contract_version":"2.0","scenarios":[]}',
  });
  const pass = gradeAssertion('no app source in artifacts', gradeCtx({ workspace: cleanWorkspace }));
  assert.equal(pass.passed, true);

  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(cleanWorkspace, { recursive: true, force: true });
}

// ux guidance only (no blueprint exemption)
{
  const workspace = mkWorkspace({});
  const pass = gradeAssertion(
    'ux guidance only',
    gradeCtx({ workspace, output: 'Use a structural wireframe for the login form.' }),
  );
  assert.equal(pass.passed, true);

  const fail = gradeAssertion(
    'ux guidance only',
    gradeCtx({
      workspace,
      output: 'Saved to .lamina/blueprints/x\n```tsx\nexport default function Login() {}\n```',
    }),
  );
  assert.equal(fail.passed, false);
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log('grade_lamina_guardrails_test: ok');
