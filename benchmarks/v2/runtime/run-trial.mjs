#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createAdapter } from './agent-adapters.mjs';
import { invokeAgent } from './agent-invocation.mjs';
import { answerQuestions } from './oracle.mjs';
import { loadRunJson } from '../../../skills/lamina-orchestrator/lib/run.mjs';
import { scopeRun } from '../../../skills/lamina-orchestrator/lib/graph.mjs';
import { isReviewSourcePath, snapshotWorkspace } from './workspace-snapshot.mjs';
import { auditIsolation, prepareRuntimeHome, scrubRuntimeCredentials } from './isolation.mjs';
import { auditSnapshot, hashFile, indexTree, validateContractArtifact, validateLaminaInitialization, validateProductProofManifest, validateProductWorkspace, validateQuestions, validateTelemetry, writeProductValidationReceipt } from './trial-validation.mjs';

function args(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    result[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function invoke(adapter, sessionId, prompt, cwd, timeout, { phase, evidenceDir, runtimeHome }) {
  return invokeAgent({
    adapter,
    sessionId,
    prompt,
    workspace: cwd,
    timeout,
    phase,
    evidenceRoot: evidenceDir,
    evidenceBase: path.dirname(evidenceDir),
    runtimeHome,
    maxTransientRetries: Number(config['transient-retries'] || 0),
  });
}

function latestRun(workspace) {
  const root = path.join(workspace, '.lamina', 'runs');
  if (!fs.existsSync(root)) return null;
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'run.json'))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, modified: fs.statSync(file).mtimeMs }))
    .toSorted((left, right) => left.modified - right.modified)
    .at(-1)?.file || null;
}

function artifactFor(arm, workspace) {
  if (arm === 'raw') return path.join(workspace, 'product-contract.md');
  if (arm === 'structured') return path.join(workspace, 'benchmark-contract.json');
  return latestRun(workspace);
}

function assertValid(label, validation) {
  if (!validation.ok) throw new Error(`${label}: ${validation.errors.join('; ')}`);
}

function sameProductSnapshot(left, right) {
  const simplify = (items) => items.filter((item) => isReviewSourcePath(item.path)).map(({ path: file, sha256, bytes }) => ({ path: file, sha256, bytes }));
  return JSON.stringify(simplify(indexTree(left))) === JSON.stringify(simplify(indexTree(right)));
}

function copyReviewArtifacts(arm, reviewWorkspace, workspace, reviewText) {
  const handoffDir = path.join(workspace, '.benchmark-review');
  fs.mkdirSync(handoffDir, { recursive: true });
  fs.writeFileSync(path.join(handoffDir, 'review-final.txt'), reviewText || 'No final review text was returned.\n');

  if (arm === 'lamina') {
    const reviewedRun = latestRun(reviewWorkspace);
    const authoritativeRun = latestRun(workspace);
    if (!reviewedRun || !authoritativeRun) throw new Error('Lamina review handoff is missing a run');
    const reviewedDir = path.dirname(reviewedRun);
    const authoritativeDir = path.dirname(authoritativeRun);
    for (const name of ['report.md', 'fix.md']) {
      const source = path.join(reviewedDir, name);
      if (!fs.existsSync(source)) throw new Error(`Lamina review did not produce ${name}`);
      fs.copyFileSync(source, path.join(authoritativeDir, name));
      fs.copyFileSync(source, path.join(handoffDir, name));
    }
    return;
  }

  for (const name of ['product-review.md', 'product-fix-list.md']) {
    const source = path.join(reviewWorkspace, name);
    if (!fs.existsSync(source)) throw new Error(`${arm} review did not produce ${name}`);
    fs.copyFileSync(source, path.join(workspace, name));
  }
}

const config = args(process.argv);
for (const key of ['task-dir', 'workspace', 'output', 'arm', 'track', 'provider', 'model']) if (!config[key]) throw new Error(`Missing --${key}`);
if (!['raw', 'structured', 'lamina'].includes(config.arm)) throw new Error('Invalid arm');
if (!['autonomous', 'oracle'].includes(config.track)) throw new Error('Invalid track');

const protocolRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const prompts = JSON.parse(fs.readFileSync(path.join(protocolRoot, 'protocol', 'prompts.json'), 'utf8'))[config.arm];
const reviewerPrompts = JSON.parse(fs.readFileSync(path.join(protocolRoot, 'protocol', 'reviewer-prompts.json'), 'utf8'));
const brief = fs.readFileSync(path.join(config['task-dir'], 'brief.md'), 'utf8');
const adapter = createAdapter({ provider: config.provider, model: config.model });
const timeout = Number(config.timeout || 7200) * 1000;
fs.mkdirSync(config.output, { recursive: true });
const evidenceDir = path.join(config.output, 'agent-evidence');
const runtimeHome = prepareRuntimeHome(config.provider, path.join(config.output, '.runtime-home'));
const isolation = auditIsolation(config.workspace, runtimeHome);
fs.writeFileSync(path.join(config.output, 'isolation.json'), `${JSON.stringify(isolation, null, 2)}\n`);
if (!isolation.passed) throw new Error(`Filesystem isolation preflight failed: ${isolation.stderr}`);

const benchmarkDir = path.join(config.workspace, '.benchmark');
fs.mkdirSync(benchmarkDir, { recursive: true });
fs.copyFileSync(path.join(protocolRoot, 'schemas', 'questions.schema.json'), path.join(benchmarkDir, 'questions.schema.json'));
if (config.arm === 'structured') {
  fs.copyFileSync(path.join(protocolRoot, 'schemas', 'benchmark-contract.schema.json'), path.join(benchmarkDir, 'benchmark-contract.schema.json'));
}

const telemetry = [];
const checks = { isolation, review_isolation: null, questions: null, oracle: null, initialization: null, contract_draft: null, contract_final: null, preimplementation_source_immutable: true, contract_immutable: true, reviewers: [], product_stages: {}, telemetry: null };
let sessionId = null;
let trialError = null;
const baselineSnapshot = path.join(config.output, 'phase-guards', 'precontract-baseline');
snapshotWorkspace(config.workspace, baselineSnapshot);

const persist = () => {
  fs.writeFileSync(path.join(config.output, 'telemetry.json'), `${JSON.stringify(telemetry, null, 2)}\n`);
  fs.writeFileSync(path.join(config.output, 'checks.json'), `${JSON.stringify(checks, null, 2)}\n`);
};

const providerPrompt = (prompt) => config.provider === 'claude-code'
  ? prompt.replaceAll('$lamina-init', '/lamina-init').replaceAll('$lamina-design', '/lamina-design').replaceAll('$lamina-verify', '/lamina-verify')
  : prompt;

const PRODUCT_OUTPUT_HYGIENE = `Keep application source, tests, generated assets, and product documentation method-neutral. Do not mention the benchmark, oracle, reviewers, harness-owned directories, method names, or any contract artifact filename supplied by the harness. Product documentation may describe the implemented product requirements generically. This is an output-custody requirement: the native contract remains available for implementation but must not be copied or named in judge-visible product artifacts.`;

const LAMINA_PROOF_OUTPUT_REQUIREMENTS = `

## Mandatory proof execution outputs
For the Lamina proof-carrying product, these are required deliverables, not optional documentation:
- Include package.json with a declared scripts.test command that exercises every test file listed by product-proof-manifest.json. If no package.json exists, create the smallest truthful one for the chosen test runner.
- Create root proof-execution-summary.json after actually running the proof suite. It must be valid JSON with result:"passed", a non-empty requirements[] containing result:"passed" for every declared proof requirement, and runtime_state with node, browser_executable when browser evidence is required, isolated_temporary_databases, test_concurrency, nested_timeout_ms, nested_timed_out:false, and skipped_tests_observed:false.
- Report actual executions only; do not use planned, prose-only, or placeholder proof entries. Keep both files method-neutral.
`;

const runPhase = (phase, extra = '', workspace = config.workspace, options = {}) => {
  const invocationSessionId = Object.hasOwn(options, 'sessionId') ? options.sessionId : sessionId;
  const phaseRuntimeHome = options.runtimeHome || runtimeHome;
  const outputHygiene = ['implement', 'fix'].includes(phase) ? `\n\n## Product artifact hygiene\n${PRODUCT_OUTPUT_HYGIENE}${config.arm === 'lamina' ? LAMINA_PROOF_OUTPUT_REQUIREMENTS : ''}` : '';
  try {
    const result = invoke(adapter, invocationSessionId, providerPrompt(`${prompts[phase]}\n\n## Authoritative brief\n\n${brief}\n\n${extra}${outputHygiene}`), workspace, timeout, { phase, evidenceDir, runtimeHome: phaseRuntimeHome });
    if (options.adoptSession !== false) sessionId = result.normalized.session_id || result.telemetry.session_id;
    telemetry.push(result.telemetry);
    persist();
    if (result.normalized.subagent_calls > 0) throw new Error(`${phase}: uncounted subagent opportunity is prohibited`);
    return result;
  } catch (error) {
    if (error.phaseTelemetry) telemetry.push(error.phaseTelemetry);
    persist();
    throw error;
  }
};

const assertNoEarlyImplementation = (phase) => {
  const snapshot = path.join(config.output, 'phase-guards', phase);
  snapshotWorkspace(config.workspace, snapshot);
  if (!sameProductSnapshot(baselineSnapshot, snapshot)) {
    checks.preimplementation_source_immutable = false;
    throw new Error(`${phase}: application source changed before the matched implementation phase`);
  }
};

try {
  runPhase('discover', config.track === 'autonomous' ? 'The founder cannot answer. Do not create questions.json; label assumptions.' : 'The founder oracle will answer questions.json after this turn.');
  assertNoEarlyImplementation('discover');

  if (config.track === 'oracle') {
    const questionPath = path.join(config.workspace, 'questions.json');
    if (!fs.existsSync(questionPath)) throw new Error('Oracle track requires questions.json');
    const questions = JSON.parse(fs.readFileSync(questionPath, 'utf8'));
    checks.questions = validateQuestions(questions);
    assertValid('Question protocol failed', checks.questions);
    const intent = JSON.parse(fs.readFileSync(path.join(config['task-dir'], 'founder-intent.json'), 'utf8'));
    const answers = answerQuestions(questions, intent);
    checks.oracle = {
      ok: answers.answers.every((answer) => answer.facts.every((returned) => intent.facts.some((fact) => fact.id === returned.id && fact.topic === returned.topic && fact.answer === returned.answer) && answer.topics.includes(returned.topic))),
      question_count: questions.questions.length,
      returned_facts: answers.answers.flatMap((answer) => answer.facts.map((fact) => ({ id: fact.id, topic: fact.topic }))),
      matched_topics_only: true,
    };
    if (!checks.oracle.ok) throw new Error('Oracle returned a founder fact outside the matching question topic');
    fs.writeFileSync(path.join(config.workspace, 'oracle-answers.json'), `${JSON.stringify(answers, null, 2)}\n`);
    fs.writeFileSync(path.join(config.output, 'oracle-audit.json'), `${JSON.stringify(checks.oracle, null, 2)}\n`);
  } else {
    checks.questions = { ok: !fs.existsSync(path.join(config.workspace, 'questions.json')), expected: 'absent' };
    if (!checks.questions.ok) throw new Error('Autonomous track must not create questions.json');
  }

  runPhase('initialize', config.track === 'oracle' ? 'Read oracle-answers.json.' : 'No founder answers are available. Preserve labeled assumptions.');
  assertNoEarlyImplementation('initialize');
  if (config.arm === 'lamina') {
    checks.initialization = validateLaminaInitialization(config.workspace);
    assertValid('Lamina initialization failed', checks.initialization);
  } else checks.initialization = { ok: true, method_specific: false };

  runPhase('contract', config.track === 'oracle' ? 'Read oracle-answers.json.' : 'No founder answers are available.');
  assertNoEarlyImplementation('contract');
  const artifact = artifactFor(config.arm, config.workspace);
  checks.contract_draft = validateContractArtifact(config.arm, artifact);
  assertValid('Draft contract validation failed', checks.contract_draft);

  const reviewerDir = path.join(config.workspace, '.benchmark-reviewers');
  fs.mkdirSync(reviewerDir, { recursive: true });
  if (config.arm !== 'raw') {
    const artifactText = fs.readFileSync(artifact, 'utf8');
    let contexts = [{ id: 'critic-1', contractText: artifactText }, { id: 'critic-2', contractText: artifactText }, { id: 'critic-3', contractText: artifactText }];
    if (config.arm === 'lamina') {
      const personasPath = path.join(config.workspace, '.lamina', 'personas.json');
      const personas = JSON.parse(fs.readFileSync(personasPath, 'utf8')).personas || [];
      const run = loadRunJson(artifact);
      const criticalWorkflows = run.workflows.filter((workflow) => workflow.criticality === 'critical');
      const criticalActors = run.actors.filter((actor) => actor.criticality === 'critical');
      contexts = personas.slice(0, 3).map((persona, index) => {
        const explicitRefs = Array.isArray(persona.actor_refs) ? persona.actor_refs : [];
        const inferredRefs = run.actors.filter((actor) => (actor.persona_refs || []).includes(`persona.${persona.id}`) || actor.id === persona.id).map((actor) => `actor.${actor.id}`);
        const mappedRefs = [...explicitRefs, ...inferredRefs];
        const fallback = criticalWorkflows[index % Math.max(criticalWorkflows.length, 1)]
          ? [`workflow.${criticalWorkflows[index % criticalWorkflows.length].id}`]
          : criticalActors[index % Math.max(criticalActors.length, 1)]
            ? [`actor.${criticalActors[index % criticalActors.length].id}`]
            : [];
        const refs = mappedRefs.length ? mappedRefs : fallback;
        return { id: persona.id, persona, routing: mappedRefs.length ? 'explicit_actor_mapping' : 'critical_workflow_fallback', contractText: JSON.stringify(scopeRun(run, refs), null, 2) };
      });
      while (contexts.length < 3) {
        const index = contexts.length;
        const workflow = criticalWorkflows[index % Math.max(criticalWorkflows.length, 1)];
        contexts.push({ id: `graph-perspective-${index + 1}`, persona: { role: 'graph-focused fallback reviewer', goals: ['Find structural incoherence without inventing user preference'], constraints: ['No additional user evidence'] }, contractText: JSON.stringify(scopeRun(run, workflow ? [`workflow.${workflow.id}`] : []), null, 2) });
      }
    }
    for (const context of contexts) {
      const reviewerWorkspace = path.join(config.output, 'isolated-reviewers', context.id, 'workspace');
      fs.mkdirSync(reviewerWorkspace, { recursive: true });
      const reviewerHome = prepareRuntimeHome(config.provider, path.join(config.output, 'isolated-reviewers', context.id, '.runtime-home'));
      const reviewerIsolation = auditIsolation(reviewerWorkspace, reviewerHome);
      if (!reviewerIsolation.passed) throw new Error(`Reviewer ${context.id} isolation failed`);
      try {
        const reviewer = invoke(adapter, null, `${reviewerPrompts[config.arm]}\n\nReturn the review in your final response; do not create files or seek outside context.\n\n## Reviewer context\n${JSON.stringify(context.persona || { independent_critic: context.id })}\n\n## Contract\n${context.contractText}`, reviewerWorkspace, timeout, { phase: `contract_reviewer:${context.id}`, evidenceDir, runtimeHome: reviewerHome });
        if (reviewer.normalized.final_text.trim().length < 20) throw new Error(`Reviewer ${context.id} returned no usable report`);
        if (indexTree(reviewerWorkspace).length) throw new Error(`Reviewer ${context.id} wrote files in its review-only workspace`);
        fs.writeFileSync(path.join(reviewerDir, `${context.id}.json`), `${JSON.stringify({ reviewer_id: context.id, review: reviewer.normalized.final_text }, null, 2)}\n`);
        telemetry.push(reviewer.telemetry);
        if (reviewer.normalized.subagent_calls > 0) throw new Error(`Reviewer ${context.id} attempted to spawn an uncounted subagent`);
        checks.reviewers.push({ id: context.id, isolated: true, routing: context.routing || 'graph_workflow_fallback', usable_final_text: true, final_text_bytes: Buffer.byteLength(reviewer.normalized.final_text) });
      } finally {
        scrubRuntimeCredentials(reviewerHome);
      }
      persist();
    }
    if (checks.reviewers.length !== 3) throw new Error(`Expected exactly three reviewer slots, received ${checks.reviewers.length}`);
  }

  runPhase('contract_finalize', config.arm === 'raw' ? 'No harness reviewer slots are assigned to the raw arm.' : `Reviewer reports are under ${path.relative(config.workspace, reviewerDir)}.`);
  assertNoEarlyImplementation('contract-finalize');
  const finalArtifact = artifactFor(config.arm, config.workspace);
  checks.contract_final = validateContractArtifact(config.arm, finalArtifact, { final: true });
  assertValid('Final contract validation failed', checks.contract_final);
  const snapshotName = config.arm === 'raw' ? 'product-contract.md' : config.arm === 'structured' ? 'benchmark-contract.json' : 'run.json';
  const frozenContract = path.join(config.output, snapshotName);
  fs.copyFileSync(finalArtifact, frozenContract);
  const frozenHash = hashFile(frozenContract);

  const assertContractFrozen = () => {
    const current = artifactFor(config.arm, config.workspace);
    if (!current || hashFile(current) !== frozenHash) {
      checks.contract_immutable = false;
      throw new Error('Frozen contract changed after contract finalization');
    }
  };

  runPhase('implement');
  assertContractFrozen();
  const afterImplement = path.join(config.output, 'product-stages', 'after-implement');
  const implementValidation = validateProductWorkspace(config.workspace, runtimeHome, path.join(config.output, 'validation', 'after-implement'), { timeout: Number(config['validation-timeout'] || 900) * 1000, testReplays: Number(config['validation-test-replays'] || 3) });
  const implementProofs = config.arm === 'lamina' ? validateProductProofManifest(config.workspace, loadRunJson(finalArtifact)) : { ok: true, not_applicable: true };
  snapshotWorkspace(config.workspace, afterImplement);
  const implementReceipt = writeProductValidationReceipt(afterImplement, implementValidation, implementProofs, config.workspace);
  const implementAudit = auditSnapshot(afterImplement);
  checks.product_stages.after_implement = { snapshot: implementAudit, validation: implementValidation, proof_manifest: implementProofs, validation_receipt: implementReceipt };
  if (!implementAudit.ok || !implementValidation.passed || !implementProofs.ok || implementReceipt.status !== 'passed') throw new Error(`After-implement product stage failed independent validation${implementProofs.ok ? '' : `: ${implementProofs.errors.join('; ')}`}`);

  const reviewWorkspace = path.join(config.output, 'review-copy', 'workspace');
  if (fs.existsSync(reviewWorkspace)) throw new Error('Review-copy workspace already exists; refusing to overwrite evidence');
  fs.mkdirSync(path.dirname(reviewWorkspace), { recursive: true });
  fs.cpSync(config.workspace, reviewWorkspace, { recursive: true, dereference: false });
  const reviewHome = prepareRuntimeHome(config.provider, path.join(config.output, 'review-copy', '.runtime-home'));
  checks.review_isolation = auditIsolation(reviewWorkspace, reviewHome);
  if (!checks.review_isolation.passed) throw new Error(`Review-copy isolation failed: ${checks.review_isolation.stderr}`);
  const beforeReview = path.join(config.output, 'phase-guards', 'review-copy-before');
  const afterReview = path.join(config.output, 'phase-guards', 'review-copy-after');
  snapshotWorkspace(reviewWorkspace, beforeReview);
  let reviewResult;
  try {
    reviewResult = runPhase('review', 'You are in an isolated review copy. Treat application source as read-only. The authoritative contract is frozen outside this copy; record review and fix artifacts here without claiming that this copy is authoritative.', reviewWorkspace, { sessionId: null, runtimeHome: reviewHome, adoptSession: false });
  } finally {
    scrubRuntimeCredentials(reviewHome);
  }
  assertContractFrozen();
  snapshotWorkspace(reviewWorkspace, afterReview);
  if (!sameProductSnapshot(beforeReview, afterReview)) throw new Error('Review phase edited product source despite review-only protocol');
  copyReviewArtifacts(config.arm, reviewWorkspace, config.workspace, reviewResult.normalized.final_text);
  assertContractFrozen();

  runPhase('fix', 'Use the review handoff under .benchmark-review. For Lamina, the promoted canonical report.md and fix.md are also beside the frozen run.json. Do not edit the frozen contract.');
  assertContractFrozen();
  const afterFix = path.join(config.output, 'product-stages', 'after-fix');
  const fixValidation = validateProductWorkspace(config.workspace, runtimeHome, path.join(config.output, 'validation', 'after-fix'), { timeout: Number(config['validation-timeout'] || 900) * 1000, testReplays: Number(config['validation-test-replays'] || 3) });
  const fixProofs = config.arm === 'lamina' ? validateProductProofManifest(config.workspace, loadRunJson(finalArtifact)) : { ok: true, not_applicable: true };
  snapshotWorkspace(config.workspace, afterFix);
  const fixReceipt = writeProductValidationReceipt(afterFix, fixValidation, fixProofs, config.workspace);
  const fixAudit = auditSnapshot(afterFix);
  checks.product_stages.after_fix = { snapshot: fixAudit, validation: fixValidation, proof_manifest: fixProofs, validation_receipt: fixReceipt };
  if (!fixAudit.ok || !fixValidation.passed || !fixProofs.ok || fixReceipt.status !== 'passed') throw new Error(`After-fix product stage failed independent validation${fixProofs.ok ? '' : `: ${fixProofs.errors.join('; ')}`}`);

  const expectedTelemetry = ['discover', 'initialize', 'contract', ...checks.reviewers.map((reviewer) => `contract_reviewer:${reviewer.id}`), 'contract_finalize', 'implement', 'review', 'fix'];
  checks.telemetry = validateTelemetry(telemetry, expectedTelemetry);
  assertValid('Telemetry validation failed', checks.telemetry);
  persist();
  fs.writeFileSync(path.join(config.output, 'artifact-index.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), files: indexTree(config.output).filter((item) => !item.path.includes('.runtime-home/')) }, null, 2)}\n`);
  fs.writeFileSync(path.join(config.output, 'trial.json'), `${JSON.stringify({ status: 'complete', arm: config.arm, track: config.track, provider: config.provider, model: config.model, resolved_model: telemetry.find((item) => item.resolved_model)?.resolved_model || null, session_id: sessionId, contract_snapshot: snapshotName, contract_sha256: frozenHash, reviewer_slots: checks.reviewers.length, product_stages: ['after-implement', 'after-fix'], telemetry_phases: telemetry.map((item) => item.phase) }, null, 2)}\n`);
} catch (error) {
  trialError = error;
  fs.writeFileSync(path.join(config.output, 'trial.json'), `${JSON.stringify({ status: 'failed', arm: config.arm, track: config.track, provider: config.provider, model: config.model, session_id: sessionId, error: error.message, telemetry_phases: telemetry.map((item) => item.phase) }, null, 2)}\n`);
} finally {
  persist();
  scrubRuntimeCredentials(runtimeHome);
}

if (trialError) throw trialError;
