#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validateRunYaml } from '../packages/lamina-studio/lib/run.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-run-yaml-'));
}

function writeValidRun(dir) {
  fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'artifacts', 'flow-pack.md'),
    `---
id: flow-pack
title: Flow pack
confidence: medium
sources:
  - run.yaml
---

# Flow pack

\`\`\`mermaid
flowchart TD
  Start --> Finish
\`\`\`
`,
  );
  fs.writeFileSync(
    path.join(dir, 'handoff.md'),
    `---
id: handoff
title: Developer handoff
confidence: medium
sources:
  - run.yaml
---

# Developer handoff

\`\`\`mermaid
flowchart TD
  Start --> Finish
\`\`\`
`,
  );
  fs.writeFileSync(
    path.join(dir, 'run.yaml'),
    `id: password-reset-2026-07-08
hook: design
target: password reset
command: /lamina-design
flows_touched: [password-reset]
personas_updated: false
started_at: 2026-07-08

evidence:
  - id: business-context
    source: .lamina/business-context.md
    kind: business_context
    summary: Account recovery must be clear and secure

artifacts:
  - id: flow-pack
    type: user_flow
    pack: flow
    path: artifacts/flow-pack.md
    confidence: medium
    evidence_mode: run_yaml_required
    diagram: flowchart
  - id: developer-handoff
    type: developer_handoff
    pack: handoff
    path: handoff.md
    confidence: medium
    evidence_mode: run_yaml_required
    diagram: flowchart

flows:
  - id: password-reset
    name: Password reset
    status: planned
    routes: ["/reset-password"]
    priority: high
    evidence: []
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

checklist:
  - id: password-reset-request
    priority: P0
    title: Add reset request flow
    acceptance:
      - Email submission shows check email confirmation
    screens: [request-reset, check-email]

simulation:
  panel: [primary-user, support-admin]
  results:
    - persona_id: primary-user
      outcome: partial_fail
      blockers:
        - step: Request reset
          screen_id: request-reset
          severity: medium
          quote: Email copy is unclear
    - persona_id: support-admin
      outcome: success
  confidence: medium
`,
  );
}

// valid run with artifact index
{
  const dir = tmpDir();
  writeValidRun(dir);
  const result = validateRunYaml(path.join(dir, 'run.yaml'));
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.run.artifacts.length, 2);
  assert.equal(result.run.evidence.length, 1);
  assert.equal(result.run.simulation.confidence, 'medium');
  assert.equal(result.run.simulation.results[0].blockers[0].quote, 'Email copy is unclear');
  assert.equal(result.run.simulation.results[1].persona_id, 'support-admin');
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

// artifact index paths must exist and remain inside the run directory
{
  const dir = tmpDir();
  writeValidRun(dir);
  fs.rmSync(path.join(dir, 'artifacts', 'flow-pack.md'));
  const result = validateRunYaml(path.join(dir, 'run.yaml'));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('file not found')));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('validate_run_yaml_test: ok');
