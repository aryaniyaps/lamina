import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { checkLaminaInit } from '../../../scripts/check_lamina_init.mjs';
import { validateRunFields, loadRunJson } from '../../../skills/lamina-orchestrator/lib/run.mjs';
import { TOPICS } from './oracle.mjs';
import { isolatedCommand } from './isolation.mjs';

const HARNESS_DIRS = new Set(['.agents', '.claude', '.codex', '.benchmark', '.benchmark-reviewers', '.lamina', '.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.cache', '.turbo']);
const HARNESS_FILES = new Set(['questions.json', 'oracle-answers.json', 'product-discovery.md', 'product-contract.md', 'benchmark-contract.json', 'implementation-contract.json', 'implementation-contract.md', 'product-spec.json', 'product-spec.md', 'product-spec.txt', 'product-review.md', 'product-fix-list.md', 'transfer-review.md', 'transfer-fix-list.md']);
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.py', '.sh', '.ts', '.tsx', '.txt', '.yaml', '.yml']);
const HARNESS_CONTENT = /(\.lamina\/|\.benchmark-reviewers|oracle-answers\.json|benchmark-contract\.json|implementation-contract\.(?:json|md))/i;

export function validateQuestions(document) {
  const errors = [];
  if (!document || typeof document !== 'object' || !Array.isArray(document.questions)) return { ok: false, errors: ['questions.json requires questions[]'] };
  if (document.questions.length > 3) errors.push('questions.json may contain at most three questions');
  const ids = new Set();
  for (const [index, question] of document.questions.entries()) {
    const label = `questions[${index}]`;
    if (!question?.id || typeof question.id !== 'string') errors.push(`${label}.id is required`);
    else if (ids.has(question.id)) errors.push(`${label}.id is duplicated`);
    else ids.add(question.id);
    if (!Array.isArray(question?.topics) || question.topics.length < 1 || question.topics.length > 3 || question.topics.some((topic) => !TOPICS.has(topic)) || new Set(question.topics).size !== question.topics.length) errors.push(`${label}.topics must contain one to three unique valid topics`);
    if (!question?.question || typeof question.question !== 'string') errors.push(`${label}.question is required`);
    if (!Array.isArray(question?.impact_refs)) errors.push(`${label}.impact_refs[] is required`);
    if (!question?.reason || typeof question.reason !== 'string') errors.push(`${label}.reason is required`);
  }
  return { ok: errors.length === 0, errors };
}

export function validatePersonas(workspace) {
  const file = path.join(workspace, '.lamina', 'personas.json');
  const errors = [];
  if (!fs.existsSync(file)) return { ok: false, errors: ['Missing .lamina/personas.json'] };
  let document;
  try { document = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { return { ok: false, errors: [`personas.json is invalid JSON: ${error.message}`] }; }
  if (document.contract_version !== '2.0') errors.push('personas.json contract_version must be 2.0');
  if (!Array.isArray(document.personas) || !document.personas.length) errors.push('personas.json requires at least one persona');
  const ids = new Set();
  for (const [index, persona] of (document.personas || []).entries()) {
    const label = `personas[${index}]`;
    if (!persona?.id || ids.has(persona.id)) errors.push(`${label}.id is missing or duplicated`);
    else ids.add(persona.id);
    for (const key of ['role', 'confidence']) if (!persona?.[key]) errors.push(`${label}.${key} is required`);
    for (const key of ['goals', 'constraints', 'evidence']) if (!Array.isArray(persona?.[key]) || !persona[key].length) errors.push(`${label}.${key}[] must be non-empty`);
    if (!['low', 'medium', 'high'].includes(persona?.confidence)) errors.push(`${label}.confidence is invalid`);
  }
  return { ok: errors.length === 0, errors, count: document.personas?.length || 0 };
}

const rewriteRef = (value) => typeof value === 'string' ? value.replace(/^rule\./, 'invariant.') : value;

function normalizeReviewSources(value) {
  if (Array.isArray(value)) return value.map(normalizeReviewSources);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'source' && item === 'review_hypothesis' ? 'persona_hypothesis' : normalizeReviewSources(item)]));
}

function validateNeutralShape(contract) {
  const errors = [];
  const requiredTop = ['id', 'status', 'intent', 'decisions', 'actors', 'entities', 'operations', 'workflows', 'rules', 'dependencies', 'surfaces', 'scenarios', 'traceability'];
  const allowedTop = new Set(requiredTop);
  for (const key of requiredTop) if (!(key in (contract || {}))) errors.push(`benchmark-contract.json missing ${key}`);
  for (const key of Object.keys(contract || {})) if (!allowedTop.has(key)) errors.push(`benchmark-contract.json has unexpected property ${key}`);
  for (const key of ['actors', 'entities', 'operations', 'workflows', 'rules', 'dependencies', 'surfaces', 'scenarios', 'traceability']) if (!Array.isArray(contract?.[key])) errors.push(`benchmark-contract.json ${key} must be an array`);
  for (const key of ['problem', 'outcome', 'users', 'critical_promises', 'success_signals', 'constraints', 'scope']) if (!(key in (contract?.intent || {}))) errors.push(`benchmark-contract.json intent.${key} is required`);
  if (!Array.isArray(contract?.intent?.users) || !contract.intent.users.length) errors.push('benchmark-contract.json intent.users[] must be non-empty');
  if (!Array.isArray(contract?.decisions?.assumptions) || !Array.isArray(contract?.decisions?.forks)) errors.push('benchmark-contract.json decisions requires assumptions[] and forks[]');
  const metadataCollections = [contract?.intent?.critical_promises, contract?.actors, contract?.entities, contract?.operations, contract?.workflows, contract?.rules, contract?.dependencies, contract?.surfaces, contract?.scenarios];
  for (const collection of metadataCollections) for (const item of collection || []) for (const key of ['id', 'criticality', 'source', 'confidence', 'relevance_reason']) if (!item?.[key]) errors.push(`benchmark-contract.json node ${item?.id || '?'} missing ${key}`);
  for (const actor of contract?.actors || []) {
    if (!actor?.authority) errors.push(`actor ${actor?.id || '?'} requires authority`);
    if (actor?.criticality === 'critical' && !actor?.entry_path) errors.push(`critical actor ${actor?.id || '?'} requires entry_path`);
  }
  for (const entity of contract?.entities || []) {
    if (!entity?.identity) errors.push(`entity ${entity?.id || '?'} requires identity`);
    for (const key of ['states', 'relationships', 'lifecycle_consequences']) if (!Array.isArray(entity?.[key])) errors.push(`entity ${entity?.id || '?'} requires ${key}[]`);
    if (entity?.criticality === 'critical' && (!Array.isArray(entity?.attributes) || !entity.attributes.length)) errors.push(`critical entity ${entity?.id || '?'} requires attributes[]`);
  }
  for (const operation of contract?.operations || []) {
    for (const key of ['actor_refs', 'preconditions', 'transitions', 'enforces', 'failures']) if (!Array.isArray(operation?.[key])) errors.push(`operation ${operation?.id || '?'} requires ${key}[]`);
    if (!operation?.outcome) errors.push(`operation ${operation?.id || '?'} requires outcome`);
    if (!operation?.recovery) errors.push(`operation ${operation?.id || '?'} requires recovery`);
  }
  for (const workflow of contract?.workflows || []) {
    if (!workflow?.actor_ref) errors.push(`workflow ${workflow?.id || '?'} requires actor_ref`);
    for (const key of ['steps', 'dependency_refs', 'terminal_outcomes']) if (!Array.isArray(workflow?.[key])) errors.push(`workflow ${workflow?.id || '?'} requires ${key}[]`);
  }
  for (const dependency of contract?.dependencies || []) {
    if (dependency?.criticality === 'critical') for (const key of ['condition', 'fulfillment', 'verification']) if (!dependency?.[key]) errors.push(`critical dependency ${dependency?.id || '?'} requires ${key}`);
  }
  for (const surface of contract?.surfaces || []) {
    if (!surface?.purpose) errors.push(`surface ${surface?.id || '?'} requires purpose`);
    for (const key of ['primary_actor_refs', 'graph_refs', 'workflow_refs', 'operation_refs', 'contract']) if (!Array.isArray(surface?.[key])) errors.push(`surface ${surface?.id || '?'} requires ${key}[]`);
  }
  return errors;
}

function neutralAsLamina(contract) {
  contract = normalizeReviewSources(contract);
  const mapRefs = (items, keys) => (items || []).map((item) => {
    const next = structuredClone(item);
    for (const key of keys) {
      if (Array.isArray(next[key])) next[key] = next[key].map(rewriteRef);
      else if (next[key]) next[key] = rewriteRef(next[key]);
    }
    if (next.source === 'review_hypothesis') next.source = 'persona_hypothesis';
    return next;
  });
  const decisions = structuredClone(contract.decisions || { assumptions: [], forks: [] });
  for (const decision of [...(decisions.assumptions || []), ...(decisions.forks || [])]) if (decision.source === 'review_hypothesis') decision.source = 'persona_hypothesis';
  return {
    contract_version: '2.0',
    id: contract.id,
    status: contract.status,
    stage: 'shape',
    hook: 'design',
    intent: contract.intent,
    decisions,
    actors: mapRefs(contract.actors, []),
    entities: mapRefs(contract.entities, []),
    operations: mapRefs(contract.operations, ['actor_refs', 'enforces']),
    workflows: mapRefs(contract.workflows, ['actor_ref', 'dependency_refs']).map((workflow) => ({ ...workflow, steps: (workflow.steps || []).map((step) => ({ ...step, operation_ref: rewriteRef(step.operation_ref) })) })),
    invariants: mapRefs(contract.rules, []),
    dependencies: mapRefs(contract.dependencies, ['from', 'to']),
    surfaces: mapRefs(contract.surfaces, ['primary_actor_refs', 'graph_refs', 'workflow_refs', 'operation_refs']),
    scenarios: mapRefs(contract.scenarios, ['covers']).map((scenario) => ({ ...scenario, when: { ...(scenario.when || {}), operation_ref: rewriteRef(scenario.when?.operation_ref) } })),
    persona_findings: [],
    traceability: (contract.traceability || []).map((item) => ({ ...item, promise_ref: rewriteRef(item.promise_ref), graph_refs: (item.graph_refs || []).map(rewriteRef) })),
    findings: [],
    evidence: [],
  };
}

export function validateContractArtifact(arm, artifact, { final = false } = {}) {
  if (!artifact || !fs.existsSync(artifact)) return { ok: false, errors: [`Missing ${arm} contract artifact`] };
  if (arm === 'raw') {
    const length = fs.readFileSync(artifact, 'utf8').trim().length;
    return { ok: length >= 80, errors: length >= 80 ? [] : ['Raw contract is empty or implausibly short'] };
  }
  try {
    const source = arm === 'lamina' ? null : JSON.parse(fs.readFileSync(artifact, 'utf8'));
    const run = arm === 'lamina' ? loadRunJson(artifact) : neutralAsLamina(source);
    const errors = [...(arm === 'structured' ? validateNeutralShape(source) : []), ...validateRunFields(run, path.basename(artifact), { requireProofPacket: arm === 'lamina' })];
    if (final && run.status !== 'ready_to_build') errors.push('Final contract must be ready_to_build');
    return { ok: errors.length === 0, errors, status: run.status };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}

function findPackage(workspace) {
  const root = path.join(workspace, 'package.json');
  return fs.existsSync(root) ? root : null;
}

function packageRunner(workspace, document) {
  const declared = String(document.packageManager || '');
  if (declared.startsWith('pnpm@') || fs.existsSync(path.join(workspace, 'pnpm-lock.yaml'))) return 'pnpm';
  if (declared.startsWith('yarn@') || fs.existsSync(path.join(workspace, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function formattingOnlyCheckFailure(command, log) {
  if (command.kind !== 'check' || command.exit_code === 0) return false;
  const text = String(log || '').toLowerCase();
  if (!text) return false;
  const formatterSignals = ['format', 'oxfmt', 'prettier', 'biome'];
  const nonFormattingSignals = ['type error', 'typescript', 'oxlint', 'eslint', 'lint error', 'error ts', 'test failed', 'build failed'];
  return formatterSignals.some((signal) => text.includes(signal))
    && !nonFormattingSignals.some((signal) => text.includes(signal));
}

function productFileCount(workspace) {
  let count = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (HARNESS_DIRS.has(entry.name) || HARNESS_FILES.has(entry.name)) continue;
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) count += 1;
    }
  };
  walk(workspace);
  return count;
}

export function validateProductWorkspace(workspace, runtimeHome, outputDir, { timeout = 900000, testReplays = 3 } = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const packagePath = findPackage(workspace);
  const result = { product_file_count: productFileCount(workspace), package_json: packagePath ? path.relative(workspace, packagePath) : null, commands: [], passed: true };
  if (!result.product_file_count) return { ...result, passed: false, errors: ['No product files exist'] };
  if (!packagePath) return { ...result, build: 'not_applicable', tests: 'not_declared', note: 'Static or non-Node product with no package.json' };
  const document = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const runner = packageRunner(workspace, document);
  const requested = [];
  if (document.scripts?.check) requested.push({ kind: 'check', args: ['run', 'check'] });
  if (document.scripts?.build) requested.push({ kind: 'build', args: runner === 'npm' ? ['run', 'build'] : ['run', 'build'] });
  if (!Number.isInteger(testReplays) || testReplays < 1) throw new Error('testReplays must be a positive integer');
  if (document.scripts?.test) {
    for (let replay = 1; replay <= testReplays; replay += 1) requested.push({ kind: 'test', replay, args: runner === 'npm' ? ['test'] : ['test'] });
  }
  for (const command of requested) {
    const invocation = isolatedCommand({ workspace, runtimeHome, command: runner, args: command.args });
    const started = Date.now();
    const child = spawnSync(invocation.command, invocation.args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
    const log = `${child.stdout || ''}${child.stderr || ''}`;
    const logPath = path.join(outputDir, command.kind === 'test' ? `test-replay-${command.replay}.log` : `${command.kind}.log`);
    fs.writeFileSync(logPath, log);
    const tolerated = formattingOnlyCheckFailure(command, log);
    const record = { kind: command.kind, replay: command.replay || null, runner, args: command.args, exit_code: child.status, signal: child.signal, duration_ms: Date.now() - started, timed_out: child.error?.code === 'ETIMEDOUT', tolerated, tolerance_reason: tolerated ? 'formatting_only' : null, log: path.basename(logPath) };
    result.commands.push(record);
    if (child.status !== 0 && !tolerated) result.passed = false;
  }
  const checkCommand = result.commands.find((item) => item.kind === 'check');
  result.check = document.scripts?.check
    ? (checkCommand?.exit_code === 0 ? 'passed' : checkCommand?.tolerated ? 'passed_formatting_only' : 'failed')
    : 'not_declared';
  result.build = document.scripts?.build ? (result.commands.find((item) => item.kind === 'build')?.exit_code === 0 ? 'passed' : 'failed') : 'not_declared';
  const testCommands = result.commands.filter((item) => item.kind === 'test');
  result.test_replays = document.scripts?.test ? testCommands.length : 0;
  result.tests = document.scripts?.test ? (testCommands.length === testReplays && testCommands.every((item) => item.exit_code === 0) ? 'passed_stable' : 'failed') : 'not_declared';
  return result;
}

export function validateProductProofManifest(workspace, run) {
  const errors = [];
  const manifestPath = path.join(workspace, 'product-proof-manifest.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, errors: ['Missing product-proof-manifest.json'] };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (error) { return { ok: false, errors: [`product-proof-manifest.json is invalid JSON: ${error.message}`] }; }
  if (manifest.version !== '1.0') errors.push('product-proof-manifest.json version must be 1.0');
  const proofEntries = Array.isArray(manifest.proofs)
    ? manifest.proofs
    : manifest.proofs && typeof manifest.proofs === 'object'
      ? Object.entries(manifest.proofs).map(([proof_id, value]) => ({ proof_id, ...value }))
      : [];
  if (!Array.isArray(manifest.proofs) && !(manifest.proofs && typeof manifest.proofs === 'object')) {
    errors.push('product-proof-manifest.json requires proofs[] or an id-keyed proofs object');
  }

  const packagePath = path.join(workspace, 'package.json');
  if (!fs.existsSync(packagePath)) errors.push('Proof-carrying products require package.json with a test script');
  else {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (!packageJson.scripts?.test) errors.push('Proof-carrying products require a declared test script');
  }

  const expected = new Map((run?.proofs || []).map((proof) => [proof.id, proof]));
  const seen = new Set();
  for (const [index, item] of proofEntries.entries()) {
    const label = `product-proof-manifest.json proofs[${index}]`;
    if (!item?.proof_id || seen.has(item.proof_id)) errors.push(`${label}.proof_id is missing or duplicated`);
    else seen.add(item.proof_id);
    const contractProof = expected.get(item?.proof_id);
    if (!contractProof) errors.push(`${label} references unknown proof ${item?.proof_id || '?'}`);
    if (!Array.isArray(item?.test_files) || !item.test_files.length) errors.push(`${label}.test_files[] must be non-empty`);
    for (const relative of item?.test_files || []) {
      if (typeof relative !== 'string' || path.isAbsolute(relative)) {
        errors.push(`${label} has invalid test file ${relative}`);
        continue;
      }
      const absolute = path.resolve(workspace, relative);
      if (!absolute.startsWith(path.resolve(workspace) + path.sep)) {
        errors.push(`${label} test file resolves outside the product workspace: ${relative}`);
        continue;
      }
      if (!/(^|\/)(test|tests|spec|e2e)(\/|$)|\.(test|spec)\.[^.]+$/i.test(relative.replaceAll('\\', '/'))) {
        errors.push(`${label} file is not recognizably an automated test: ${relative}`);
      } else if (!fs.existsSync(absolute)) errors.push(`${label} test file does not exist: ${relative}`);
      else if (!fs.readFileSync(absolute, 'utf8').includes(`[proof:${item.proof_id}]`)) errors.push(`${label} test file lacks [proof:${item.proof_id}] marker: ${relative}`);
    }
    for (const level of contractProof?.evidence_levels || []) if (!(item?.evidence_levels || []).includes(level)) errors.push(`${label} omits required evidence level ${level}`);
    for (const requirement of contractProof?.test_requirements || []) if (!(item?.test_requirements || []).includes(requirement)) errors.push(`${label} omits required test requirement ${requirement}`);
  }
  for (const proofId of expected.keys()) if (!seen.has(proofId)) errors.push(`product-proof-manifest.json does not map proof ${proofId}`);
  return { ok: errors.length === 0, errors, proof_count: seen.size, expected_proof_count: expected.size, manifest: path.basename(manifestPath) };
}

function readProofExecution(workspace, required) {
  const summaryPath = path.join(workspace, 'proof-execution-summary.json');
  if (!fs.existsSync(summaryPath)) {
    return required
      ? { ok: false, error: 'proof execution summary is missing' }
      : { ok: true, not_applicable: true };
  }

  let summary;
  try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); }
  catch (error) { return { ok: false, error: `proof execution summary is invalid JSON: ${error.message}` }; }

  const requirements = Array.isArray(summary.requirements) ? summary.requirements : [];
  const passed = requirements.filter((item) => item?.result === 'passed');
  const failed = requirements.filter((item) => item?.result !== 'passed');
  const runtime = summary.runtime_state || {};
  const ok = summary.result === 'passed'
    && requirements.length > 0
    && failed.length === 0
    && runtime.nested_timed_out === false
    && runtime.skipped_tests_observed === false;
  const requirementCounts = {};
  for (const item of requirements) requirementCounts[item.requirement] = (requirementCounts[item.requirement] || 0) + 1;

  return {
    ok,
    status: ok ? 'passed' : 'failed',
    duration_ms: Number.isFinite(summary.duration_ms) ? Math.round(summary.duration_ms) : null,
    requirements_total: requirements.length,
    requirements_passed: passed.length,
    requirements_failed: failed.length,
    requirement_counts: requirementCounts,
    runtime: {
      node: typeof runtime.node === 'string' ? runtime.node : null,
      browser_available: Boolean(runtime.browser_executable),
      isolated_temporary_databases: runtime.isolated_temporary_databases === true,
      test_concurrency: Number.isInteger(runtime.test_concurrency) ? runtime.test_concurrency : null,
      nested_timeout_ms: Number.isFinite(runtime.nested_timeout_ms) ? runtime.nested_timeout_ms : null,
      nested_timed_out: runtime.nested_timed_out === true,
      skipped_tests_observed: runtime.skipped_tests_observed === true,
    },
    proofs: Object.values(requirements.reduce((groups, item) => {
      const proofId = item?.proof_id || 'unidentified-proof';
      groups[proofId] ||= { proof_id: proofId, requirements: [], all_passed: true };
      groups[proofId].requirements.push({
        requirement: item?.requirement || null,
        scenario: item?.scenario || null,
        result: item?.result || 'missing',
        duration_ms: Number.isFinite(item?.duration_ms) ? Math.round(item.duration_ms) : null,
      });
      if (item?.result !== 'passed') groups[proofId].all_passed = false;
      return groups;
    }, {})),
  };
}

export function writeProductValidationReceipt(snapshot, validation, proofManifest, workspace) {
  fs.mkdirSync(snapshot, { recursive: true });
  const proofRequired = proofManifest?.not_applicable !== true;
  const proofExecution = readProofExecution(workspace, proofRequired);
  const commands = (validation?.commands || []).map((command) => ({
    kind: command.kind,
    replay: command.replay || null,
    exit_code: command.exit_code,
    signal: command.signal || null,
    duration_ms: command.duration_ms,
    timed_out: command.timed_out === true,
    tolerated: command.tolerated === true,
    tolerance_reason: command.tolerance_reason || null,
  }));
  const allCommandsPassed = commands.every((command) => (command.exit_code === 0 || command.tolerated === true) && command.signal === null && command.timed_out === false);
  const status = validation?.passed === true
    && allCommandsPassed
    && proofManifest?.ok === true
    && proofExecution.ok === true
      ? 'passed'
      : 'failed';
  const receipt = {
    version: '1.0',
    status,
    scope: 'frozen product snapshot',
    producer: 'independent execution gate',
    validation: {
      check: validation?.check || 'not_declared',
      build: validation?.build || 'not_declared',
      tests: validation?.tests || 'not_declared',
      completed_test_replays: validation?.test_replays || 0,
      all_commands_clean_exit: allCommandsPassed,
      commands,
    },
    proof_coverage: proofRequired
      ? {
          status: proofManifest?.ok && proofExecution.ok ? 'passed' : 'failed',
          manifest: proofManifest?.manifest || 'product-proof-manifest.json',
          proofs_mapped: proofManifest?.proof_count || 0,
          proofs_expected: proofManifest?.expected_proof_count || 0,
          execution: proofExecution,
        }
      : { status: 'not_applicable' },
  };
  fs.writeFileSync(path.join(snapshot, 'product-validation-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function hashFile(file) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

export function indexTree(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push({ path: path.relative(root, absolute).split(path.sep).join('/'), bytes: fs.statSync(absolute).size, sha256: hashFile(absolute) });
    }
  };
  visit(root);
  return files;
}

export function auditSnapshot(snapshot) {
  const files = indexTree(snapshot);
  const forbidden = files.filter((item) => item.path.split('/').some((part) => HARNESS_DIRS.has(part)) || HARNESS_FILES.has(path.basename(item.path)));
  const contentLeaks = [];
  for (const item of files) {
    const file = path.join(snapshot, item.path);
    if (item.bytes <= 2 * 1024 * 1024 && TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) && HARNESS_CONTENT.test(fs.readFileSync(file, 'utf8'))) contentLeaks.push(item.path);
  }
  return { ok: forbidden.length === 0 && contentLeaks.length === 0, file_count: files.length, forbidden, content_leaks: contentLeaks, files };
}

export function validateLaminaInitialization(workspace) {
  const business = checkLaminaInit(workspace);
  const personas = validatePersonas(workspace);
  return { ok: business.ok && personas.ok, errors: [...business.errors, ...personas.errors], business_context: business, personas };
}

export function validateTelemetry(telemetry, expectedPhases) {
  const errors = [];
  const actual = telemetry.map((item) => item.phase);
  if (JSON.stringify(actual) !== JSON.stringify(expectedPhases)) errors.push(`telemetry phases differ: expected ${expectedPhases.join(', ')}, received ${actual.join(', ')}`);
  for (const item of telemetry) {
    for (const key of ['provider', 'model', 'resolved_model', 'cli_version', 'session_id', 'phase', 'started_at', 'ended_at', 'evidence_path', 'usage_accounting']) if (!item?.[key]) errors.push(`${item?.phase || '?'} telemetry missing ${key}`);
    for (const key of ['duration_ms', 'exit_code', 'tool_calls', 'subagent_calls', 'retries']) if (!Number.isInteger(item?.[key]) || item[key] < 0) errors.push(`${item?.phase || '?'} telemetry has invalid ${key}`);
    if (item.exit_code !== 0) errors.push(`${item.phase} did not exit successfully`);
    if (item.timed_out !== false) errors.push(`${item.phase} timed out`);
    if (item.subagent_calls !== 0) errors.push(`${item.phase} used uncounted subagents`);
    if (Number.isNaN(Date.parse(item.started_at)) || Number.isNaN(Date.parse(item.ended_at)) || Date.parse(item.ended_at) < Date.parse(item.started_at)) errors.push(`${item.phase} timestamps are invalid`);
    if (!['session_delta', 'phase_total'].includes(item.usage_accounting)) errors.push(`${item.phase} has invalid usage_accounting`);
    for (const key of ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'cumulative_input_tokens', 'cumulative_cached_input_tokens', 'cumulative_output_tokens', 'cumulative_reasoning_output_tokens']) {
      if (item[key] !== null && (!Number.isInteger(item[key]) || item[key] < 0)) errors.push(`${item.phase} has invalid ${key}`);
    }
    if (item.input_tokens !== null && item.cached_input_tokens !== null && item.cached_input_tokens > item.input_tokens) errors.push(`${item.phase} cached_input_tokens exceeds input_tokens`);
    if (item.output_tokens !== null && item.reasoning_output_tokens !== null && item.reasoning_output_tokens > item.output_tokens) errors.push(`${item.phase} reasoning_output_tokens exceeds output_tokens`);
    const cumulativeFields = ['cumulative_input_tokens', 'cumulative_cached_input_tokens', 'cumulative_output_tokens', 'cumulative_reasoning_output_tokens'];
    if (item.usage_accounting === 'session_delta' && [item.input_tokens, item.output_tokens].some((value) => value !== null) && cumulativeFields.some((key) => item[key] === null)) {
      errors.push(`${item.phase} session_delta usage requires cumulative checkpoints`);
    }
    if (item.usage_accounting === 'phase_total' && cumulativeFields.some((key) => item[key] !== null)) errors.push(`${item.phase} phase_total usage must not declare cumulative checkpoints`);
  }
  return { ok: errors.length === 0, errors, expected_phases: expectedPhases, actual_phases: actual };
}
