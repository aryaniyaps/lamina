#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  approximateTokens,
  loadedContext,
  validateArchitecture,
  walk,
} from './lib/compact-skill-architecture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const migrationRoot = path.join(root, 'docs/migrations/compact-skills');
const fixtureRoot = path.join(root, 'evals/fixtures/skill-architectures');
const criteria = JSON.parse(fs.readFileSync(path.join(migrationRoot, 'decision-criteria.json'), 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(migrationRoot, 'baseline-inventory.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(migrationRoot, 'normative-ledger.json'), 'utf8'));
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'evals/corpora/compact-skill-routing.json'), 'utf8'));
const writeMode = process.argv.includes('--write');
const checkMode = process.argv.includes('--check');

if (writeMode === checkMode) {
  console.error('usage: node scripts/evaluate-compact-skill-architectures.mjs --write|--check');
  process.exit(2);
}

const baselineTokens = new Map(baseline.skills.map((skill) => [skill.name, skill.approximateTokens]));
const baselineSignalSkills = {
  business_context: ['lamina-business-context'], actor_population: ['lamina-user-modeling'], evidence_gap: ['lamina-research-scoping'],
  domain_change: ['lamina-system-structure', 'lamina-invariants'], active_personas: ['lamina-user-modeling', 'lamina-research-planning'],
  time_bearing_operation: ['lamina-time-semantics', 'lamina-idempotency-concurrency'], user_facing_form: ['lamina-forms', 'lamina-accessibility'],
  destructive_action: ['lamina-trust', 'lamina-error-handling'], user_facing: ['lamina-feedback-and-status', 'lamina-accessibility'],
  graph_gap: ['lamina-design'], shared_mutation: ['lamina-idempotency-concurrency', 'lamina-invariants'], findings: ['lamina-decision-making'],
  empty_state: ['lamina-empty-states'], permission_denial: ['lamina-multi-view-integrity'], navigation: ['lamina-navigation'],
  form_validation: ['lamina-forms'], accessibility: ['lamina-accessibility'], prioritization: ['lamina-feature-prioritization'],
};
const baselineWorkflowSkill = {
  init: 'lamina-init', design: 'lamina-design', work: 'lamina', verify: 'lamina-verify', 'product-question': 'lamina-core',
};

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function baselineContext(testCase) {
  if (!testCase.activate) return { skills: [], approximateTokens: 0 };
  const skills = new Set([baselineWorkflowSkill[testCase.workflow]]);
  for (const signal of testCase.signals) for (const skill of baselineSignalSkills[signal] || []) skills.add(skill);
  return {
    skills: [...skills],
    approximateTokens: [...skills].reduce((total, skill) => total + (baselineTokens.get(skill) || 0), 0),
  };
}

function candidateReport(variant) {
  const variantRoot = path.join(fixtureRoot, variant);
  const validation = validateArchitecture(variantRoot, ledger.rules.map((rule) => rule.id));
  const architecture = validation.architecture;
  const cases = corpus.cases.map((testCase) => {
    const context = testCase.activate
      ? loadedContext(variantRoot, architecture, testCase.workflow, testCase.signals)
      : { files: [], approximateTokens: 0, capabilityReferences: 0 };
    return { id: testCase.id, workflow: testCase.workflow, signals: testCase.signals, focused: Boolean(testCase.focused), ...context };
  });
  const publicDescriptions = architecture.public.map((skill) => {
    const text = fs.readFileSync(path.join(variantRoot, 'skills', skill, 'SKILL.md'), 'utf8');
    return text.match(/^description:\s*"(.+)"$/m)?.[1] || '';
  }).join('\n');
  const focusedCandidate = cases.filter((item) => item.focused).map((item) => item.approximateTokens);
  const focusedBaseline = corpus.cases.filter((item) => item.focused).map((item) => baselineContext(item).approximateTokens);
  const baselineMedian = median(focusedBaseline);
  const candidateMedian = median(focusedCandidate);
  const catalogTokens = approximateTokens(publicDescriptions);
  const catalogReduction = Number(((1 - catalogTokens / baseline.publicCatalogMetadata.approximateTokens) * 100).toFixed(2));
  const focusedReduction = Number(((1 - candidateMedian / baselineMedian) * 100).toFixed(2));
  const installedFiles = walk(variantRoot).length;
  const installedBytes = walk(variantRoot).reduce((total, file) => total + fs.statSync(file).size, 0);
  const automatedThresholds = {
    publicSkillCount: architecture.public.length <= criteria.thresholds.maximumPublicSkillCount,
    catalogMetadataReduction: catalogReduction >= criteria.thresholds.minimumCatalogMetadataReductionPercent,
    focusedInstructionReduction: focusedReduction >= criteria.thresholds.minimumFocusedInstructionReductionPercent,
    mechanicalTaskZeroBodies: cases.filter((item) => !item.workflow).every((item) => item.files.length === 0),
    focusedQuestionOnePrimaryReference: cases.filter((item) => item.focused).every((item) => item.capabilityReferences <= 1),
    structuralSafety: validation.errors.length === 0,
  };
  return {
    variant,
    sourceCommit: architecture.sourceCommit,
    publicSkillCount: architecture.public.length,
    catalogMetadata: { approximateTokens: catalogTokens, reductionPercent: catalogReduction },
    installFixture: { files: installedFiles, bytes: installedBytes, status: 'simulated_only' },
    context: {
      focusedBaselineMedianTokens: baselineMedian,
      focusedCandidateMedianTokens: candidateMedian,
      focusedReductionPercent: focusedReduction,
      cases,
    },
    routingContract: { cases: corpus.cases.length, representable: corpus.cases.length, coveragePercent: 100, status: 'static_contract_only' },
    traceability: { baselineRules: ledger.rules.length, mappedRules: validation.traceability.rules.length },
    structuralErrors: validation.errors,
    automatedThresholds,
    automatedGatePassed: Object.values(automatedThresholds).every(Boolean),
    evidenceStillRequired: [
      'live_model_routing_accuracy',
      'false_and_missed_activation',
      'behavioral_semantic_parity',
      'real_provider_install_matrix',
      'developer_comprehension_study',
      'migration_and_rollback_rehearsal',
    ],
    decisionScore: null,
  };
}

const baselineCases = corpus.cases.map((testCase) => ({ id: testCase.id, ...baselineContext(testCase) }));
const result = {
  schema: 'lamina.skill-architecture-comparison/v1',
  sourceCommit: criteria.baseline.commit,
  productionSelection: null,
  baseline: {
    publicSkillCount: baseline.publicSkillCount,
    catalogMetadataApproximateTokens: baseline.publicCatalogMetadata.approximateTokens,
    installed: baseline.installed,
    contextCases: baselineCases,
  },
  candidates: [candidateReport('candidate-6'), candidateReport('candidate-1')],
  decisionStatus: 'blocked_pending_live_and_human_evidence',
};

const report = `# Compact skill architecture comparison\n\n` +
  `Production selection: **none**. Static fixtures are not release evidence.\n\n` +
  `| Variant | Public | Catalog reduction | Focused instruction reduction | Static gate |\n` +
  `|---|---:|---:|---:|---|\n` +
  result.candidates.map((candidate) =>
    `| ${candidate.variant} | ${candidate.publicSkillCount} | ${candidate.catalogMetadata.reductionPercent}% | ${candidate.context.focusedReductionPercent}% | ${candidate.automatedGatePassed ? 'pass' : 'fail'} |`,
  ).join('\n') +
  `\n\n## Evidence boundary\n\nThe routing corpus proves that the architecture manifests can express every labeled route and loading signal. It does not measure model routing behavior. Provider installation is a local recursive-copy simulation, not a clean-provider run. No decision score is calculated until live routing, behavioral parity, real provider, developer-study, migration, and rollback evidence is recorded.\n`;

const outputs = new Map([
  ['comparison-report.json', `${JSON.stringify(result, null, 2)}\n`],
  ['comparison-report.md', report],
]);
let failed = false;
for (const [name, content] of outputs) {
  const file = path.join(migrationRoot, name);
  if (writeMode) fs.writeFileSync(file, content);
  else if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
    console.error(`${name} is missing or stale; run npm run compact-skills:evaluate`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`compact skill comparison: ok (${result.candidates.map((item) => `${item.variant}:${item.automatedGatePassed ? 'pass' : 'fail'}`).join(', ')})`);
