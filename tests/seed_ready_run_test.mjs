#!/usr/bin/env node
/**
 * Regression: design seed builds brief-parameterized ready runs with no legacy template leaks.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRunJson } from '../skills/lamina-orchestrator/lib/run.mjs';
import {
  LEGACY_TEMPLATE_LEAK_TERMS,
  findTemplateLeaks,
} from '../skills/lamina-design/scripts/seed-ready-run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DESIGN = path.join(ROOT, 'skills/lamina-design/scripts/seed-ready-run.mjs');
const SEED_LAMINA = path.join(ROOT, 'skills/lamina/scripts/seed-ready-run.mjs');

const REMOVED_PATHS = [
  'skills/lamina-design/templates/minimal-ready-run.json',
  'skills/lamina-design/templates/minimal-implement.md',
  'skills/lamina-design/scripts/build-minimal-ready.mjs',
  'skills/lamina/templates/minimal-ready-run.json',
  'skills/lamina/templates/minimal-implement.md',
  'skills/lamina/scripts/build-minimal-ready.mjs',
  'skills/lamina-orchestrator/workflows/design-feature.md',
  'skills/lamina-orchestrator/workflows/design-concept.md',
  'skills/lamina-orchestrator/prompts/outputs/design-feature.md',
  'skills/lamina-orchestrator/prompts/outputs/design-concept.md',
];

const BUSINESS_CONTEXT = `---
lamina:
  maturity: greenfield
  platform: [web]
  last_updated: 2026-07-25
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
**Answer:** Mobile-first product behavior.
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

function mkWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-design-seed-'));
  fs.mkdirSync(path.join(dir, '.lamina'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.lamina/business-context.md'), BUSINESS_CONTEXT);
  fs.writeFileSync(
    path.join(dir, '.lamina/personas.json'),
    `${JSON.stringify(
      {
        contract_version: '2.0',
        personas: [
          { id: 'primary-user', role: 'Primary user', primary: true },
          { id: 'partner', role: 'Partner', primary: false },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

function runSeed(workspace, scriptPath, { slug, problem, outcome, users = 'primary-user,partner' } = {}) {
  return execFileSync(
    process.execPath,
    [
      scriptPath,
      '--slug',
      slug,
      '--problem',
      problem,
      '--outcome',
      outcome,
      '--users',
      users,
    ],
    { cwd: workspace, encoding: 'utf8' },
  );
}

function readArtifacts(workspace, slug) {
  const runDir = path.join(workspace, '.lamina/runs', slug);
  const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  const implementMd = fs.readFileSync(path.join(runDir, 'implement.md'), 'utf8');
  return { runDir, run, implementMd };
}

function assertNoLeaks(run, implementMd, allowed, label) {
  const blob = `${JSON.stringify(run)}\n${implementMd}`;
  const leaks = findTemplateLeaks(blob, allowed);
  assert.equal(leaks.length, 0, `${label} leaked template terms: ${leaks.join(', ')}`);
}

function run() {
  assert.equal(
    fs.readFileSync(SEED_DESIGN, 'utf8'),
    fs.readFileSync(SEED_LAMINA, 'utf8'),
    'lamina-design and lamina seed-ready-run.mjs must remain identical',
  );

  for (const rel of REMOVED_PATHS) {
    assert.ok(!fs.existsSync(path.join(ROOT, rel)), `removed path still present: ${rel}`);
  }

  assert.ok(LEGACY_TEMPLATE_LEAK_TERMS.includes('view-budget'));

  const workspace = mkWorkspace();
  try {
    const problem = 'Add two-factor authentication to settings';
    const outcome = 'Users can enroll and verify TOTP before sensitive actions';
    const stdout = runSeed(workspace, SEED_DESIGN, {
      slug: 'two-factor-auth',
      problem,
      outcome,
    });
    assert.match(stdout, /status=ready_to_build/);

    const { run, implementMd } = readArtifacts(workspace, 'two-factor-auth');
    assert.equal(run.status, 'ready_to_build');
    assert.equal(run.intent.problem, problem);
    assert.equal(run.intent.outcome, outcome);
    assert.equal(run.id, 'two-factor-auth');
    assert.ok(run.persona_findings.length >= 2);

    const validation = validateRunJson(path.join(workspace, '.lamina/runs/two-factor-auth/run.json'));
    assert.equal(validation.ok, true, validation.errors?.join('; '));

    assertNoLeaks(run, implementMd, `${problem}\n${outcome}`, 'non-budget brief');
    assert.ok(!implementMd.toLowerCase().includes('household budget'));
    assert.ok(!JSON.stringify(run).includes('view-budget'));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  const budgetWorkspace = mkWorkspace();
  try {
    const problem = 'Mobile budgeting for households with multiple accounts';
    const outcome = 'Members see shared spend and category limits';
    runSeed(budgetWorkspace, SEED_DESIGN, {
      slug: 'household-budgeting',
      problem,
      outcome,
    });
    const { run, implementMd } = readArtifacts(budgetWorkspace, 'household-budgeting');
    assert.equal(run.intent.problem, problem);
    assertNoLeaks(run, implementMd, `${problem}\n${outcome}`, 'budgeting brief');
    assert.ok(!JSON.stringify(run).includes('view-budget'), 'template-only operation id must not appear');
    assert.ok(!implementMd.includes('budget-home'), 'template-only surface id must not appear');
  } finally {
    fs.rmSync(budgetWorkspace, { recursive: true, force: true });
  }

  console.log('seed_ready_run_test: ok');
}

run();
