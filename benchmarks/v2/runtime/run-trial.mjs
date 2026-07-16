#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAdapter } from './agent-adapters.mjs';
import { answerQuestions } from './oracle.mjs';
import { loadRunJson } from '../../../skills/lamina-orchestrator/lib/run.mjs';
import { scopeRun } from '../../../skills/lamina-orchestrator/lib/graph.mjs';
import { snapshotWorkspace } from './workspace-snapshot.mjs';

function args(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    result[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function invoke(adapter, sessionId, prompt, cwd, timeout) {
  const invocation = sessionId ? adapter.resume(sessionId, prompt) : adapter.start(prompt);
  const startedAt = new Date().toISOString();
  const run = spawnSync(invocation.command, invocation.args, { cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const normalized = adapter.normalize(`${run.stdout || ''}\n${run.stderr || ''}`);
  if (run.status !== 0) throw new Error(`${adapter.provider} phase failed with ${run.status}: ${run.stderr || run.stdout}`);
  return { normalized, telemetry: { provider: adapter.provider, model: adapter.model, resolved_model: normalized.resolved_model, session_id: normalized.session_id || sessionId || invocation.sessionId, started_at: startedAt, ended_at: new Date().toISOString(), exit_code: run.status || 0, input_tokens: normalized.input_tokens, output_tokens: normalized.output_tokens, tool_calls: normalized.tool_calls, retries: 0 } };
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

function validateArtifact(arm, artifact, final = false) {
  if (arm === 'raw') {
    if (fs.readFileSync(artifact, 'utf8').trim().length < 80) throw new Error('Raw contract is empty or implausibly short');
    return;
  }
  if (arm === 'lamina') {
    const run = loadRunJson(artifact);
    if (final && run.status !== 'ready_to_build') throw new Error('Final Lamina contract must be ready_to_build');
    return;
  }
  const contract = JSON.parse(fs.readFileSync(artifact, 'utf8'));
  for (const key of ['id', 'status', 'intent', 'decisions', 'actors', 'entities', 'operations', 'workflows', 'rules', 'dependencies', 'scenarios', 'traceability']) {
    if (!(key in contract)) throw new Error(`Structured contract missing ${key}`);
  }
  for (const key of ['actors', 'entities', 'operations', 'workflows', 'rules', 'dependencies', 'scenarios', 'traceability']) if (!Array.isArray(contract[key])) throw new Error(`Structured contract ${key} must be an array`);
  if (final && contract.status !== 'ready_to_build') throw new Error('Final structured contract must be ready_to_build');
  if (final && (!contract.intent?.critical_promises?.length || !contract.operations.length || !contract.workflows.length || !contract.rules.length || !contract.scenarios.length)) throw new Error('Final structured contract lacks a critical graph dimension');
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
if (config.arm === 'structured') {
  const benchmarkDir = path.join(config.workspace, '.benchmark');
  fs.mkdirSync(benchmarkDir, { recursive: true });
  fs.copyFileSync(path.join(protocolRoot, 'schemas', 'benchmark-contract.schema.json'), path.join(benchmarkDir, 'benchmark-contract.schema.json'));
}
const telemetry = [];
let sessionId = null;

const providerPrompt = (prompt) => config.provider === 'claude-code'
  ? prompt.replaceAll('$lamina-init', '/lamina-init').replaceAll('$lamina-design', '/lamina-design').replaceAll('$lamina-verify', '/lamina-verify')
  : prompt;

const runPhase = (phase, extra = '') => {
  const result = invoke(adapter, sessionId, providerPrompt(`${prompts[phase]}\n\n## Authoritative brief\n\n${brief}\n\n${extra}`), config.workspace, timeout);
  sessionId = result.normalized.session_id || result.telemetry.session_id;
  result.telemetry.phase = phase;
  telemetry.push(result.telemetry);
};

runPhase('discover', config.track === 'autonomous' ? 'The founder cannot answer. Do not create questions.json; label assumptions.' : 'The founder oracle will answer questions.json after this turn.');

if (config.track === 'oracle') {
  const questionPath = path.join(config.workspace, 'questions.json');
  if (!fs.existsSync(questionPath)) throw new Error('Oracle track requires questions.json');
  const questions = JSON.parse(fs.readFileSync(questionPath, 'utf8'));
  const intent = JSON.parse(fs.readFileSync(path.join(config['task-dir'], 'founder-intent.json'), 'utf8'));
  fs.writeFileSync(path.join(config.workspace, 'oracle-answers.json'), `${JSON.stringify(answerQuestions(questions, intent), null, 2)}\n`);
}

runPhase('initialize', config.track === 'oracle' ? 'Read oracle-answers.json.' : 'No founder answers are available. Preserve labeled assumptions.');
runPhase('contract', config.track === 'oracle' ? 'Read oracle-answers.json.' : 'No founder answers are available.');
const artifact = artifactFor(config.arm, config.workspace);
if (!artifact || !fs.existsSync(artifact)) throw new Error(`Contract artifact missing for arm ${config.arm}`);
validateArtifact(config.arm, artifact);

const reviewerDir = path.join(config.workspace, '.benchmark-reviewers');
fs.mkdirSync(reviewerDir, { recursive: true });
if (config.arm !== 'raw') {
  const artifactText = fs.readFileSync(artifact, 'utf8');
  let contexts = [{ id: 'critic-1', contractText: artifactText }, { id: 'critic-2', contractText: artifactText }, { id: 'critic-3', contractText: artifactText }];
  if (config.arm === 'lamina') {
    const personasPath = path.join(config.workspace, '.lamina', 'personas.json');
    const personas = fs.existsSync(personasPath) ? JSON.parse(fs.readFileSync(personasPath, 'utf8')).personas || [] : [];
    if (!personas.length) throw new Error('Lamina arm requires at least one evidence-labeled persona');
    const run = loadRunJson(artifact);
    contexts = personas.slice(0, 3).map((persona) => {
      const explicitRefs = Array.isArray(persona.actor_refs) ? persona.actor_refs : [];
      const inferredRefs = run.actors.filter((actor) => (actor.persona_refs || []).includes(`persona.${persona.id}`) || actor.id === persona.id).map((actor) => `actor.${actor.id}`);
      const slice = scopeRun(run, [...explicitRefs, ...inferredRefs]);
      return { id: persona.id, persona, contractText: JSON.stringify(slice, null, 2) };
    });
    const criticalWorkflows = run.workflows.filter((workflow) => workflow.criticality === 'critical');
    while (contexts.length < 3) {
      const index = contexts.length;
      const workflow = criticalWorkflows[index % Math.max(criticalWorkflows.length, 1)];
      const refs = workflow ? [`workflow.${workflow.id}`] : [];
      contexts.push({ id: `graph-perspective-${index + 1}`, persona: { role: 'graph-focused fallback reviewer', goals: ['Find structural incoherence without inventing user preference'], constraints: ['No additional user evidence'] }, contractText: JSON.stringify(scopeRun(run, refs), null, 2) });
    }
  }
  for (const context of contexts) {
    const reviewerWorkspace = path.join(config.output, 'isolated-reviewers', context.id);
    fs.rmSync(reviewerWorkspace, { recursive: true, force: true });
    fs.mkdirSync(reviewerWorkspace, { recursive: true });
    const reviewer = invoke(adapter, null, `${reviewerPrompts[config.arm]}\n\nYou are in an empty isolated workspace. Return the review in your final response; do not create files or seek outside context.\n\n## Reviewer context\n${JSON.stringify(context.persona || { independent_critic: context.id })}\n\n## Contract\n${context.contractText}`, reviewerWorkspace, timeout);
    if (reviewer.normalized.final_text.trim().length < 20) throw new Error(`Reviewer ${context.id} returned no usable report`);
    fs.writeFileSync(path.join(reviewerDir, `${context.id}.json`), `${JSON.stringify({ reviewer_id: context.id, review: reviewer.normalized.final_text }, null, 2)}\n`);
    telemetry.push({ ...reviewer.telemetry, phase: `contract_reviewer:${context.id}` });
  }
}

runPhase('contract_finalize', `Reviewer reports are under ${path.relative(config.workspace, reviewerDir)}.`);
const finalArtifact = artifactFor(config.arm, config.workspace);
if (!finalArtifact || !fs.existsSync(finalArtifact)) throw new Error('Final contract artifact missing');
validateArtifact(config.arm, finalArtifact, true);
const snapshotName = config.arm === 'raw' ? 'product-contract.md' : config.arm === 'structured' ? 'benchmark-contract.json' : 'run.json';
fs.copyFileSync(finalArtifact, path.join(config.output, snapshotName));

runPhase('implement');
snapshotWorkspace(config.workspace, path.join(config.output, 'product-stages', 'after-implement'));
runPhase('review');
runPhase('fix');
snapshotWorkspace(config.workspace, path.join(config.output, 'product-stages', 'after-fix'));
fs.writeFileSync(path.join(config.output, 'telemetry.json'), `${JSON.stringify(telemetry, null, 2)}\n`);
fs.writeFileSync(path.join(config.output, 'trial.json'), `${JSON.stringify({ arm: config.arm, track: config.track, provider: config.provider, model: config.model, session_id: sessionId, contract_snapshot: snapshotName, product_stages: ['after-implement', 'after-fix'] }, null, 2)}\n`);
