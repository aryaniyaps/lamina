#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validateRunYaml, validateWalkthroughPack } from '../lib/run.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-run-yaml-'));
}

function writeValidRun(dir) {
  fs.writeFileSync(
    path.join(dir, 'run.yaml'),
    `id: password-reset-2026-07-08
hook: design
target: password reset
command: /lamina-design
started_at: 2026-07-08

domain:
  dependencies:
    - id: reset-requires-account
      from: workflow.password-reset
      requires: entity.account
      in_state: active
      failure: unreachable

workflows:
  - id: password-reset
    requires: [reset-requires-account]
    actor: primary-user
    steps:
      - operation: submit email
      - operation: check inbox

flows:
  - id: password-reset
    name: Password reset
    status: planned
    graphs:
      - id: main
        entry_screen: request-reset
        transitions:
          - trigger: submit-email
            from: request-reset
            target: check-email

screens:
  - id: request-reset
    title: Request reset
    status: new
    regions: [main]
    elements:
      - component: Heading
        text: Reset your password
        level: 1
      - component: Button
        label: Send reset link
        trigger: submit-email
  - id: check-email
    title: Check email
    status: new
    regions: [main]
    elements:
      - component: Heading
        text: Check your email
        level: 1

scenarios:
  - id: account-missing
    title: No account for email
    screen: request-reset
    category: precondition
    ux: alert
    trigger:
      operation: submit email
      subject: account
      when: dependency_unmet
    dependency_ref: reset-requires-account

evidence:
  - id: business-context
    source: .lamina/business-context.md
    kind: business_context
    summary: Account recovery must be clear and secure
`,
  );
}

// valid design run with workflows and dependency graph
{
  const dir = tmpDir();
  writeValidRun(dir);
  const result = validateRunYaml(path.join(dir, 'run.yaml'));
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.run.workflows.length, 1);
  assert.deepEqual(result.run.workflows[0].requires, ['reset-requires-account']);
  assert.equal(result.run.evidence.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
}

// transition references must stay tied to known screens
{
  const dir = tmpDir();
  writeValidRun(dir);
  const runPath = path.join(dir, 'run.yaml');
  fs.writeFileSync(
    runPath,
    fs.readFileSync(runPath, 'utf8').replace('            target: check-email', '            target: unknown-screen'),
  );
  const result = validateRunYaml(runPath);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('transition to unknown screen')));
  fs.rmSync(dir, { recursive: true, force: true });
}

// design requires workflows[] or flows[]
{
  const dir = tmpDir();
  writeValidRun(dir);
  const runPath = path.join(dir, 'run.yaml');
  fs.writeFileSync(
    runPath,
    fs
      .readFileSync(runPath, 'utf8')
      .replace(/^workflows:[\s\S]*?^flows:/m, 'flows:'),
  );
  const withoutBoth = validateRunYaml(runPath);
  assert.equal(withoutBoth.ok, true, withoutBoth.errors.join('; '));

  fs.writeFileSync(
    runPath,
    fs
      .readFileSync(runPath, 'utf8')
      .replace(/^flows:[\s\S]*?^screens:/m, 'screens:'),
  );
  const result = validateRunYaml(runPath);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('missing workflows[] or flows[]')));
  fs.rmSync(dir, { recursive: true, force: true });
}

// visual walkthrough pack validates when evidence references it
{
  const fixtureDir = path.join(process.cwd(), 'tests/fixtures/walkthrough-run');
  const result = validateRunYaml(path.join(fixtureDir, 'run.yaml'));
  assert.equal(result.ok, true, result.errors.join('; '));
  const visual = result.run.evidence.find((e) => e.kind === 'visual_walkthrough');
  assert.ok(visual);
  assert.equal(visual.source, 'walkthrough/index.yaml');
}

// walkthrough rejects blueprint/studio source
{
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'walkthrough', 'steps'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'walkthrough', 'index.yaml'),
    `flow_id: checkout
base_url: http://localhost:3000
mode: live_app
source: studio
steps:
  - id: 01-cart
    screenshot: steps/01-cart.png
`,
  );
  fs.writeFileSync(path.join(dir, 'walkthrough', 'steps', '01-cart.png'), 'png');
  const errors = validateWalkthroughPack(dir, 'walkthrough/index.yaml', 'run.yaml');
  assert.ok(errors.some((e) => e.includes('not allowed')));
  fs.rmSync(dir, { recursive: true, force: true });
}

// walkthrough requires screenshot files to exist
{
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'walkthrough'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'walkthrough', 'index.yaml'),
    `flow_id: checkout
base_url: http://localhost:3000
mode: live_app
source: product
steps:
  - id: 01-cart
    screenshot: steps/missing.png
`,
  );
  const errors = validateWalkthroughPack(dir, 'walkthrough/index.yaml', 'run.yaml');
  assert.ok(errors.some((e) => e.includes('screenshot not found')));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('validate_run_yaml_test: ok');
