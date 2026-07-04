#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const REQUIRED_GUARDRAIL = 'Do not implement product code; generate UX artifacts/tasks only.';

const requiredFiles = [
  'commands/lamina.md',
  'commands/lamina-ideate.md',
  'commands/lamina-optimize.md',
  'commands/lamina-feature.md',
  'skills/lamina-core/SKILL.md',
  'skills/lamina-context-discovery/SKILL.md',
  'skills/lamina-research-questions/SKILL.md',
  'skills/lamina-flow-ideate/SKILL.md',
  'skills/lamina-flow-optimize/SKILL.md',
  'skills/lamina-flow-feature/SKILL.md',
  'skills/lamina-synthesis/SKILL.md',
  'skills/lamina-insights/SKILL.md',
  'skills/lamina-personas/SKILL.md',
  'skills/lamina-journeys/SKILL.md',
  'skills/lamina-edge-cases/SKILL.md',
  'skills/lamina-requirements/SKILL.md',
  'skills/lamina-tasks/SKILL.md',
  'skills/lamina-handoff/SKILL.md',
  'skills/lamina-artifacts/SKILL.md',
  'skills/lamina-guardrails/SKILL.md',
  'docs/superpowers/distribution/skills-cli.md',
  'mcp/README.md',
  'mcp/schema.md',
  'dashboard/README.md',
  'dashboard/visual-verification.md',
  'tests/integration/test_flows.md',
  'tests/golden/expected-artifacts.md',
  'tests/fixtures/minimal-nextjs/README.md',
  'tests/fixtures/mobile-app/README.md',
  'README.md',
  'package.json',
  'docs/superpowers/specs/2026-07-04-lamina-claude-skill-plugin-design.md'
];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function read(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

function assertExists(path) {
  assert(existsSync(resolve(ROOT, path)), `Missing: ${path}`);
}

function assertNonEmpty(path) {
  const st = statSync(resolve(ROOT, path));
  assert(st.size > 0, `Empty file: ${path}`);
}

function assertContains(path, snippets) {
  const text = read(path);
  const missing = snippets.filter((s) => !text.includes(s));
  assert(missing.length === 0, `Missing content in ${path}: ${missing.join(' | ')}`);
}

function checkStructure() {
  ['commands', 'skills', 'mcp', 'dashboard', 'tests', 'scripts', 'docs/superpowers'].forEach(assertExists);
  assert(!existsSync(resolve(ROOT, 'ux-research-skill')), 'ux-research-skill/ must be deleted');
  assertExists('scripts/verify_lamina_bundle.mjs');
}

function checkAll() {
  checkStructure();
  requiredFiles.forEach((p) => {
    assertExists(p);
    assertNonEmpty(p);
  });

  // Commands reference skills + guardrail
  assertContains('commands/lamina.md', [REQUIRED_GUARDRAIL, 'lamina-core', 'lamina-artifacts', 'lamina-guardrails']);
  assertContains('commands/lamina-ideate.md', [REQUIRED_GUARDRAIL, 'lamina-flow-ideate', 'lamina-synthesis']);
  assertContains('commands/lamina-optimize.md', [REQUIRED_GUARDRAIL, 'lamina-flow-optimize', 'lamina-synthesis']);
  assertContains('commands/lamina-feature.md', [REQUIRED_GUARDRAIL, 'lamina-flow-feature', 'lamina-synthesis']);

  // Guardrail in relevant skills
  [
    'skills/lamina-core/SKILL.md',
    'skills/lamina-flow-ideate/SKILL.md',
    'skills/lamina-flow-optimize/SKILL.md',
    'skills/lamina-flow-feature/SKILL.md',
    'skills/lamina-tasks/SKILL.md',
    'skills/lamina-guardrails/SKILL.md',
  ].forEach((p) => assertContains(p, [REQUIRED_GUARDRAIL]));

  // Checkpoints + reuse
  assertContains('skills/lamina-core/SKILL.md', ['framing checkpoint', 'synthesis validation checkpoint', 'task commit checkpoint', '.lamina']);
  assertContains('skills/lamina-artifacts/SKILL.md', ['reuse existing artifacts', '.lamina/context.md', '.lamina/insights.md', '.lamina/implementation_tasks.md']);

  // Task contract
  assertContains('skills/lamina-tasks/SKILL.md', ['P0', 'P1', 'P2', 'rationale', 'acceptance criteria', 'edge cases', 'verification', 'assumptions']);
  assertContains('skills/lamina-requirements/SKILL.md', ['UX Requirements', 'No visual styling specs', 'No component implementation instructions']);

  // MCP schema contract
  assertContains('mcp/schema.md', ['summary', 'artifactsChanged', 'implementationTasksPath', 'nextAction']);

  // Dashboard language
  assertContains('dashboard/README.md', ['verification-only', 'not orchestrator']);
  assertContains('dashboard/visual-verification.md', ['verification-only', 'not orchestrator']);

  // Distribution docs
  assertContains('docs/superpowers/distribution/skills-cli.md', [
    'skills add',
    'skills list',
    'skills update',
    'skills remove',
    '-g',
    '--copy',
    '-y',
    '-a claude-code -a cursor -a codex -a pi',
    'Tested Skills CLI version',
    'fallback manual install'
  ]);

  // Analytics deferred statement
  assertContains('README.md', ['analytics connectors are deferred']);
  assertContains('docs/superpowers/specs/2026-07-04-lamina-claude-skill-plugin-design.md', ['Provider analytics connectors are deferred']);
}

const check = process.argv[2] === '--check' ? process.argv[3] : null;
if (!check || !['structure', 'all'].includes(check)) {
  fail('Usage: node scripts/verify_lamina_bundle.mjs --check structure|all');
}

if (check === 'structure') checkStructure();
if (check === 'all') checkAll();

console.log('OK');
