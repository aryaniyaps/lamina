#!/usr/bin/env node
/**
 * Regression: verify seed initializes draft workspace only — no fabricated findings,
 * no completion artifacts, arbitrary-domain briefs accepted, both bundle copies identical.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRunFields } from '../skills/lamina-orchestrator/lib/run.mjs';
import {
  hasConcreteTarget,
  isVagueBrief,
} from '../skills/lamina-verify/scripts/seed-verify-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_VERIFY = path.join(ROOT, 'skills/lamina-verify/scripts/seed-verify-run.mjs');
const SEED_LAMINA = path.join(ROOT, 'skills/lamina/scripts/seed-verify-run.mjs');

const LEAKED_DOMAIN_TERMS = [
  'household shared budget',
  'household owner',
  'checkout',
  'shopify',
  'storefront',
  'cart modal',
  'primary-member',
  'power-operator',
  'external checkout',
  'storefront vs external',
  'patient-intake',
  'intake-coordinator',
  'clinical reviewer',
  'patient intake',
];

const EXAMPLE_DOMAIN_TERMS = [
  'patient-intake',
  'intake-coordinator',
  'clinical staff',
  'patient intake',
  'matchmaking queue',
];

const LEAKED_STOP_TERMS = ['STOP: zero more tool calls', 'Wrote run.json, run.md, implement.md, fix.md, report.md'];

const VERIFY_RUNTIME_PATHS = [
  'skills/lamina-verify/scripts/seed-verify-run.mjs',
  'skills/lamina/scripts/seed-verify-run.mjs',
  'skills/lamina-verify/SKILL.md',
  'skills/lamina-orchestrator/workflows/verify.md',
  'skills/lamina-orchestrator/patterns/persona-panel.md',
];

const BUSINESS_CONTEXT = `---
lamina:
  maturity: brownfield
  platform: [web]
  last_updated: 2026-07-23
---

## Problem statement
**Answer:** Operators need a reliable primary workflow surface.
**Confidence:** medium
**Evidence:** user brief

## Business goals
**Answer:** Reduce friction on the named target flow.
**Confidence:** medium
**Evidence:** user brief

## Success metrics
**Answer:** Operators complete the flow without dead ends.
**Confidence:** medium
**Evidence:** user brief

## Scope
**Answer:** The named target flow only.
**Confidence:** high
**Evidence:** user brief

## Users & market
**Answer:** Primary operators of the product surface.
**Confidence:** medium
**Evidence:** user brief

## Product posture
**Answer:** Clarity and recovery over novelty.
**Confidence:** medium
**Evidence:** user brief

## Constraints
**Answer:** Read-only verification of existing UI.
**Confidence:** high
**Evidence:** guardrails

## Stakeholders
**Answer:** Product and engineering.
**Confidence:** medium
**Evidence:** user brief

## Risks & unknowns
**Answer:** Legacy behavior may be opaque.
**Confidence:** medium
**Evidence:** user brief

## Research posture
**Answer:** Ground findings in observed UI and code paths.
**Confidence:** medium
**Evidence:** repo/readme

## Triad check
**Answer:** Desirable for users, viable for the business, feasible on current stack.
**Confidence:** medium
**Evidence:** triad
`;

const PERSONAS = {
  contract_version: '2.0',
  personas: [
    {
      id: 'primary-user',
      role: 'Primary user',
      primary: true,
      goals: ['Complete the core task'],
      constraints: ['Limited time'],
      confidence: 'medium',
      evidence: ['user brief'],
    },
    {
      id: 'secondary-user',
      role: 'Secondary user',
      goals: ['Support the primary user'],
      constraints: ['Needs clarity'],
      confidence: 'medium',
      evidence: ['user brief'],
    },
  ],
};

function mkWorkspace({ personas = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-verify-seed-'));
  fs.mkdirSync(path.join(dir, '.lamina'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.lamina/business-context.md'), BUSINESS_CONTEXT);
  if (personas === true) {
    fs.writeFileSync(path.join(dir, '.lamina/personas.json'), JSON.stringify(PERSONAS, null, 2) + '\n');
  } else if (personas) {
    fs.writeFileSync(path.join(dir, '.lamina/personas.json'), personas);
  }
  return dir;
}

function runSeed(workspace, scriptPath, { slug = 'target-flow-audit', problem, outcome, users = 'primary-user' } = {}) {
  return execFileSync(
    process.execPath,
    [
      scriptPath,
      '--slug',
      slug,
      '--problem',
      problem || 'Audit the named target flow for recovery and permission gaps',
      '--outcome',
      outcome || 'Evidence-backed findings with fix plan',
      '--users',
      users,
    ],
    { cwd: workspace, encoding: 'utf8' },
  );
}

function readRun(workspace, slug = 'target-flow-audit') {
  const runPath = path.join(workspace, '.lamina/runs', slug, 'run.json');
  return JSON.parse(fs.readFileSync(runPath, 'utf8'));
}

function seedContentBlob(run, runMd, stdout) {
  return [
    run.intent?.problem,
    run.intent?.outcome,
    JSON.stringify(run.findings),
    JSON.stringify(run.persona_findings),
    JSON.stringify(run.actors),
    JSON.stringify(run.entities),
    JSON.stringify(run.operations),
    runMd,
    stdout,
  ].join('\n');
}

function assertNoLeaks(run, runMd, stdout, label) {
  const blob = seedContentBlob(run, runMd, stdout);
  for (const term of LEAKED_DOMAIN_TERMS) {
    assert.ok(!blob.toLowerCase().includes(term.toLowerCase()), `${label} leaked domain term "${term}"`);
  }
  for (const term of LEAKED_STOP_TERMS) {
    assert.ok(!stdout.includes(term), `${label} leaked stop instruction "${term}"`);
  }
}

function assertRuntimeHasNoExampleDomains() {
  for (const rel of VERIFY_RUNTIME_PATHS) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8').toLowerCase();
    for (const term of EXAMPLE_DOMAIN_TERMS) {
      assert.ok(!text.includes(term.toLowerCase()), `${rel} contains example-domain token "${term}"`);
    }
  }
  for (const rel of [
    'skills/lamina-verify/templates/minimal-verify-run.json',
    'skills/lamina-verify/templates/minimal-ready-run.json',
    'skills/lamina-verify/templates/minimal-implement.md',
    'skills/lamina/templates/minimal-verify-run.json',
  ]) {
    assert.ok(!fs.existsSync(path.join(ROOT, rel)), `dead verify template still present: ${rel}`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'package-lock.json')), 'unrequested root package-lock.json present');
}

function run() {
  assert.equal(
    fs.readFileSync(SEED_VERIFY, 'utf8'),
    fs.readFileSync(SEED_LAMINA, 'utf8'),
    'lamina-verify and lamina seed-verify-run.mjs must remain identical',
  );

  assert.equal(isVagueBrief('Audit our app.'), true);
  assert.equal(isVagueBrief('Review the product.'), true);
  assert.equal(isVagueBrief("Audit our app's matchmaking queue"), false);
  assert.equal(hasConcreteTarget("Audit our app's matchmaking queue"), true);
  assert.equal(hasConcreteTarget('Audit the settings permissions panel'), true);

  assertRuntimeHasNoExampleDomains();

  const workspace = mkWorkspace();
  try {
    const stdout = runSeed(workspace, SEED_VERIFY);
    const runDir = path.join(workspace, '.lamina/runs/target-flow-audit');

    assert.match(stdout, /status=draft/);
    assert.doesNotMatch(stdout, /STOP: zero more tool calls/i);
    assert.doesNotMatch(stdout, /skip persona panel/i);
    assert.match(stdout, /Inspect the target project/i);
    assert.match(stdout, /persona-packs/i);
    assert.match(stdout, /Persona panel is mandatory/i);

    assert.ok(fs.existsSync(path.join(runDir, 'run.json')));
    assert.ok(fs.existsSync(path.join(runDir, 'run.md')));
    assert.ok(!fs.existsSync(path.join(runDir, 'fix.md')), 'seed must not write fix.md');
    assert.ok(!fs.existsSync(path.join(runDir, 'report.md')), 'seed must not write report.md');
    assert.ok(!fs.existsSync(path.join(runDir, 'implement.md')), 'seed must not write implement.md');

    const run = readRun(workspace);
    assert.equal(run.status, 'draft');
    assert.equal(run.hook, 'audit');
    assert.deepEqual(run.findings, []);
    assert.deepEqual(run.persona_findings, []);
    assert.deepEqual(validateRunFields(run, 'run.json'), []);

    const runMd = fs.readFileSync(path.join(runDir, 'run.md'), 'utf8');
    assertNoLeaks(run, runMd, stdout, 'seed output');

    const laminaStdout = runSeed(workspace, SEED_LAMINA, { slug: 'lamina-bundle-path-check' });
    assert.match(laminaStdout, /status=draft/);
    assert.ok(fs.existsSync(path.join(workspace, '.lamina/runs/lamina-bundle-path-check/run.json')));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  const ourAppConcreteWorkspace = mkWorkspace();
  try {
    const stdout = runSeed(ourAppConcreteWorkspace, SEED_VERIFY, {
      slug: 'matchmaking-queue-audit',
      problem: "Audit our app's matchmaking queue",
    });
    assert.match(stdout, /status=draft/);
    assert.ok(
      fs.existsSync(path.join(ourAppConcreteWorkspace, '.lamina/runs/matchmaking-queue-audit/run.json')),
    );
  } finally {
    fs.rmSync(ourAppConcreteWorkspace, { recursive: true, force: true });
  }

  const vagueWorkspace = mkWorkspace();
  try {
    let failed = false;
    try {
      execFileSync(
        process.execPath,
        [SEED_VERIFY, '--slug', 'vague-audit', '--problem', 'Audit our app.', '--outcome', 'Findings'],
        { cwd: vagueWorkspace, encoding: 'utf8' },
      );
    } catch (error) {
      failed = true;
      assert.equal(error.status, 3);
      assert.match(String(error.stderr || error.stdout), /REFUSE_SEED/);
    }
    assert.ok(failed, 'vague brief must exit 3');
    assert.ok(!fs.existsSync(path.join(vagueWorkspace, '.lamina/runs/vague-audit')));
  } finally {
    fs.rmSync(vagueWorkspace, { recursive: true, force: true });
  }

  const noPersonasWorkspace = mkWorkspace({ personas: false });
  try {
    const stdout = runSeed(noPersonasWorkspace, SEED_VERIFY, { slug: 'no-personas-audit' });
    assert.match(stdout, /personas\.json is missing/i);
    assert.match(stdout, /lamina-user-modeling/i);
    assert.doesNotMatch(stdout, /skip persona panel/i);
    assert.match(stdout, /Never skip the panel/i);
  } finally {
    fs.rmSync(noPersonasWorkspace, { recursive: true, force: true });
  }

  const emptyPersonasWorkspace = mkWorkspace({ personas: '{"contract_version":"2.0","personas":[]}\n' });
  try {
    const stdout = runSeed(emptyPersonasWorkspace, SEED_VERIFY, { slug: 'empty-personas-audit' });
    assert.match(stdout, /personas\.json is empty/i);
    assert.match(stdout, /lamina-user-modeling/i);
    assert.doesNotMatch(stdout, /skip persona panel/i);
  } finally {
    fs.rmSync(emptyPersonasWorkspace, { recursive: true, force: true });
  }

  const skillVerify = fs.readFileSync(path.join(ROOT, 'skills/lamina-verify/SKILL.md'), 'utf8');
  const skillLamina = fs.readFileSync(path.join(ROOT, 'skills/lamina/SKILL.md'), 'utf8');
  assert.match(skillVerify, /status=draft.*continue verification/is);
  assert.match(skillVerify, /unconditional for brownfield/i);
  assert.match(skillVerify, /lamina-user-modeling/i);
  assert.doesNotMatch(skillVerify, /Prefer seed-complete artifacts/i);
  assert.doesNotMatch(skillLamina, /STOP after seed `status=complete`/i);
  assert.match(skillLamina, /project-grounded graph/i);
  assert.match(skillLamina, /lamina-user-modeling/i);

  const workflow = fs.readFileSync(path.join(ROOT, 'skills/lamina-orchestrator/workflows/verify.md'), 'utf8');
  assert.match(workflow, /Draft seed \(not completion\)/);
  assert.match(workflow, /Persona simulation is mandatory/i);

  const personaPanel = fs.readFileSync(
    path.join(ROOT, 'skills/lamina-orchestrator/patterns/persona-panel.md'),
    'utf8',
  );
  assert.match(personaPanel, /unconditional/i);
  assert.match(personaPanel, /Never skip the panel/i);

  console.log('seed_verify_run_test: ok');
}

run();
