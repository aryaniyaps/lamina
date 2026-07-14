#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validateRunYaml, validateWalkthroughPack } from '../skills/lamina-orchestrator/lib/run.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-run-yaml-'));
}

function writeValidRun(dir, { status } = {}) {
  const statusLine = status ? `status: ${status}\n` : '';
  fs.writeFileSync(
    path.join(dir, 'run.yaml'),
    `id: password-reset-2026-07-08
hook: design
${statusLine}target: password reset
command: /lamina-design
started_at: 2026-07-08

domain:
  entities:
    - id: account
    - id: reset_token
  invariants:
    - id: one-active-reset
      rule: At most one active reset token per account
  dependencies:
    - id: reset-requires-account
      from: workflow.password-reset
      requires: entity.account
      in_state: active
      mode: unreachable
      scenario_ref: account-missing

actors:
  - id: primary-user
    permissions: [request_reset, set_password]
    resource_filters:
      - resource: account
        filter: "self only"

workflows:
  - id: account-create
    standalone: true
    provides: [entity.account]
    steps:
      - operation: register
  - id: password-reset
    requires: [reset-requires-account]
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
    workflow_ref: password-reset
    regions: [main]
    a11y:
      labels: every primary control has accessible name
      touch_min_px: 48
      color_not_only: true
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
    workflow_ref: password-reset
    regions: [main]
    a11y:
      labels: heading and body text are accessible
      touch_min_px: 48
      color_not_only: true
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
    acceptance: "Alert states no account found; reset email is not sent"

tradeoffs:
  - id: clarity_vs_granularity
    choice: Prefer a single clear reset path over multi-step recovery options
    cost: Advanced recovery requires support escalation
    surfaces: [request-reset]

out_of_scope:
  - CI/CD pipelines
  - Push notification vendors
  - Production IdP

forbidden_content:
  - investment advice

seed:
  summary: One active account and one unknown email for negative reset path
  - account: user@example.com active
  - account: missing@example.com absent

evidence:
  - id: business-context
    source: .lamina/business-context.md
    kind: business_context
    summary: Account recovery must be clear and secure
`,
  );
}

// ready_to_build requires full machine contract
{
  const dir = tmpDir();
  writeValidRun(dir, { status: 'ready_to_build' });
  const runPath = path.join(dir, 'run.yaml');
  const ok = validateRunYaml(runPath);
  assert.equal(ok.ok, true, ok.errors.join('; '));
  assert.ok(ok.run.domain.dependencies.length >= 1);
  assert.equal(ok.run.domain.dependencies[0].mode, 'unreachable');

  fs.writeFileSync(
    runPath,
    fs
      .readFileSync(runPath, 'utf8')
      .replace(/^scenarios:[\s\S]*?^out_of_scope:/m, 'scenarios: []\n\nout_of_scope:'),
  );
  const missing = validateRunYaml(runPath);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.includes('ready_to_build requires scenarios')));
  fs.rmSync(dir, { recursive: true, force: true });
}

// scenario missing acceptance fails validation
{
  const dir = tmpDir();
  writeValidRun(dir);
  const runPath = path.join(dir, 'run.yaml');
  fs.writeFileSync(
    runPath,
    fs.readFileSync(runPath, 'utf8').replace(/\n    acceptance:.*\n/, '\n'),
  );
  const result = validateRunYaml(runPath);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('missing acceptance')));
  fs.rmSync(dir, { recursive: true, force: true });
}

// freestyle edge_cases rejected at ready_to_build
{
  const dir = tmpDir();
  writeValidRun(dir, { status: 'ready_to_build' });
  const runPath = path.join(dir, 'run.yaml');
  fs.appendFileSync(runPath, `\nedge_cases:\n  - foo:\n      handling: bar\n`);
  const result = validateRunYaml(runPath);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('edge_cases')));
  fs.rmSync(dir, { recursive: true, force: true });
}

// degraded mode requires degraded_surfaces
{
  const dir = tmpDir();
  writeValidRun(dir, { status: 'ready_to_build' });
  const runPath = path.join(dir, 'run.yaml');
  let text = fs.readFileSync(runPath, 'utf8');
  text = text.replace(
    'mode: unreachable\n      scenario_ref: account-missing',
    'mode: degraded\n      scenario_ref: account-missing',
  );
  fs.writeFileSync(runPath, text);
  const result = validateRunYaml(runPath);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('degraded_surfaces')));
  fs.rmSync(dir, { recursive: true, force: true });
}

// valid design run with workflows and dependency graph
{
  const dir = tmpDir();
  writeValidRun(dir);
  const result = validateRunYaml(path.join(dir, 'run.yaml'));
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.run.workflows.length, 2);
  assert.deepEqual(result.run.workflows[1].requires, ['reset-requires-account']);
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

// ready_to_build requires tradeoffs + screen a11y
{
  const dir = tmpDir();
  writeValidRun(dir, { status: 'ready_to_build' });
  const runPath = path.join(dir, 'run.yaml');
  const ok = validateRunYaml(runPath);
  assert.equal(ok.ok, true, ok.errors.join('; '));
  assert.equal(ok.run.tradeoffs[0].id, 'clarity_vs_granularity');
  assert.equal(ok.run.screens[0].a11y.touch_min_px, '48');

  fs.writeFileSync(
    runPath,
    fs.readFileSync(runPath, 'utf8').replace(/^tradeoffs:[\s\S]*?^out_of_scope:/m, 'out_of_scope:'),
  );
  const missingTradeoffs = validateRunYaml(runPath);
  assert.equal(missingTradeoffs.ok, false);
  assert.ok(missingTradeoffs.errors.some((e) => e.includes('tradeoffs')));
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = tmpDir();
  writeValidRun(dir, { status: 'ready_to_build' });
  const runPath = path.join(dir, 'run.yaml');
  fs.writeFileSync(
    runPath,
    fs
      .readFileSync(runPath, 'utf8')
      .replace(/\n    a11y:[\s\S]*?\n    elements:/g, '\n    elements:'),
  );
  const missingA11y = validateRunYaml(runPath);
  assert.equal(missingA11y.ok, false);
  assert.ok(missingA11y.errors.some((e) => e.includes('a11y.labels')));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('validate_run_yaml_test: ok');
