#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadRunJson } from '../../../skills/lamina-orchestrator/lib/run.mjs';
import { createAdapter } from './agent-adapters.mjs';
import { invokeAgent } from './agent-invocation.mjs';
import { isReviewSourcePath, snapshotWorkspace } from './workspace-snapshot.mjs';
import { auditIsolation, prepareRuntimeHome, scrubRuntimeCredentials } from './isolation.mjs';
import { auditSnapshot, hashFile, indexTree, validateProductProofManifest, validateProductWorkspace, validateTelemetry, writeProductValidationReceipt } from './trial-validation.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index].startsWith('--')) result[argv[index].slice(2)] = argv[++index];
  }
  return result;
}

function run(adapter, sessionId, prompt, workspace, timeout, { phase, output, runtimeHome }) {
  return invokeAgent({
    adapter,
    sessionId,
    prompt,
    workspace,
    timeout,
    phase,
    evidenceRoot: path.join(output, 'agent-evidence'),
    evidenceBase: output,
    runtimeHome,
    maxTransientRetries: Number(config['transient-retries'] || 0),
  });
}

function sameSnapshot(left, right) {
  const sourceIndex = (root) => indexTree(root).filter((item) => isReviewSourcePath(item.path));
  return JSON.stringify(sourceIndex(left)) === JSON.stringify(sourceIndex(right));
}

const SYSTEM_BOUNDARY_INSTRUCTION = `Treat every declared authority, privacy, persistence, transactional, time, and safety rule as an implementation boundary, not presentation guidance. Never replace an explicit trusted, durable, atomic, or server-enforced boundary with browser-only state, a demo identity switcher, seeded credentials, or local-storage assumptions. If the assigned environment cannot support a required boundary, expose that limitation explicitly and fail the relevant validation instead of silently weakening the contract. Keep application source, tests, generated assets, and product documentation method-neutral: do not mention the benchmark, oracle, reviewers, harness-owned directories, method names, or any contract artifact filename supplied by the harness. Product documentation may describe the implemented requirements generically without naming its input artifact.`;

const REVIEW_SAFETY_INSTRUCTION = `Validate authorization, identity, revocation, privacy, and replay boundaries through ordinary role-based product scenarios and existing tests. Use neutral named roles; do not frame the work as adversarial cybersecurity, label people attacker or victim, or perform exploit, penetration, evasion, or credential-abuse testing. This wording constraint must not weaken product-safety or correctness coverage.`;

const PROOF_PACKET_INSTRUCTION = `The frozen contract is proof-carrying. Implement only its proof-budgeted current slice before supporting breadth. Turn every proofs[] entry into automated checks containing the exact [proof:<id>] marker. Create a method-neutral root product-proof-manifest.json with version 1.0 and proofs[] entries containing proof_id, test_files, evidence_levels, and test_requirements. Include package.json with a declared scripts.test command that exercises every mapped test file. After actually running the proof suite, create root proof-execution-summary.json with result:"passed", non-empty requirements[] whose entries all have result:"passed", and runtime_state containing node, browser_executable when required, isolated_temporary_databases, test_concurrency, nested_timeout_ms, nested_timed_out:false, and skipped_tests_observed:false. Report actual executions, not planned or prose-only checks. Every mapped file must exist, be exercised by the declared test suite, and observe the authoritative post-action state plus the visible journey. Every test must have a finite per-test timeout and release every server, worker, database, browser, context, listener, timer, and temporary resource in finally blocks. Run the complete declared suite at least three times; any timeout, open-handle delay, skip, or nonzero exit is a proof failure. Run check, build, tests, responsive, and accessibility validation; no critical proof may remain prose-only.`;

function copyTransferReview(reviewWorkspace, workspace, finalText) {
  const handoff = path.join(workspace, '.benchmark-review');
  fs.mkdirSync(handoff, { recursive: true });
  fs.writeFileSync(path.join(handoff, 'review-final.txt'), finalText || 'No final review text was returned.\n');
  for (const name of ['transfer-review.md', 'transfer-fix-list.md']) {
    const source = path.join(reviewWorkspace, name);
    if (!fs.existsSync(source)) throw new Error(`Transfer review did not produce ${name}`);
    fs.copyFileSync(source, path.join(workspace, name));
    fs.copyFileSync(source, path.join(handoff, name));
  }
}

const config = parseArgs(process.argv);
for (const key of ['contract', 'brief', 'workspace', 'output', 'arm', 'provider', 'model']) if (!config[key]) throw new Error(`Missing --${key}`);
if (!['raw', 'structured', 'lamina'].includes(config.arm)) throw new Error('Invalid --arm');
fs.mkdirSync(config.output, { recursive: true });
const extension = path.extname(config.contract) || '.txt';
const destination = path.join(config.workspace, `product-spec${extension}`);
fs.copyFileSync(config.contract, destination);
const frozenHash = hashFile(destination);
const contractRun = config.arm === 'lamina' ? loadRunJson(destination) : null;
const brief = fs.readFileSync(config.brief, 'utf8');
const adapter = createAdapter({ provider: config.provider, model: config.model });
const timeout = Number(config.timeout || 7200) * 1000;
const runtimeHome = prepareRuntimeHome(config.provider, path.join(config.output, '.runtime-home'));
const isolation = auditIsolation(config.workspace, runtimeHome);
fs.writeFileSync(path.join(config.output, 'isolation.json'), `${JSON.stringify(isolation, null, 2)}\n`);
if (!isolation.passed) throw new Error(`Transfer isolation preflight failed: ${isolation.stderr}`);

const telemetry = [];
const checks = { isolation, review_isolation: null, contract_immutable: true, product_stages: {}, telemetry: null };
let sessionId = null;
let transferError = null;
const persist = () => {
  fs.writeFileSync(path.join(config.output, 'telemetry.json'), `${JSON.stringify(telemetry, null, 2)}\n`);
  fs.writeFileSync(path.join(config.output, 'checks.json'), `${JSON.stringify(checks, null, 2)}\n`);
};
const phase = (name, prompt) => {
  try {
    const proofPacket = config.arm === 'lamina' ? `\n\n## Proof packet discipline\n${PROOF_PACKET_INSTRUCTION}` : '';
    const result = run(adapter, sessionId, `${prompt}\n\n## Original brief\n${brief}\n\n## Frozen contract\nRead ${path.basename(destination)}. You cannot ask the contract author for missing decisions; make only labeled, coherent implementation assumptions.\n\n## Contract boundary discipline\n${SYSTEM_BOUNDARY_INSTRUCTION}${proofPacket}`, config.workspace, timeout, { phase: name, output: config.output, runtimeHome });
    sessionId = result.sessionId;
    telemetry.push(result.telemetry);
    persist();
    if (result.telemetry.subagent_calls > 0) throw new Error(`${name}: uncounted subagent opportunity is prohibited`);
    return result;
  } catch (error) {
    if (error.phaseTelemetry) telemetry.push(error.phaseTelemetry);
    persist();
    throw error;
  }
};
const assertContractFrozen = () => {
  if (hashFile(destination) !== frozenHash) {
    checks.contract_immutable = false;
    throw new Error('Transfer builder modified the frozen contract');
  }
};

try {
  phase('transfer_implement', 'Implement the product from the frozen contract completely. Run appropriate validation.');
  assertContractFrozen();
  const afterImplement = path.join(config.output, 'product-stages', 'after-implement');
  const implementValidation = validateProductWorkspace(config.workspace, runtimeHome, path.join(config.output, 'validation', 'after-implement'), { timeout: Number(config['validation-timeout'] || 900) * 1000, testReplays: Number(config['validation-test-replays'] || 3) });
  const implementProofs = config.arm === 'lamina' ? validateProductProofManifest(config.workspace, contractRun) : { ok: true, not_applicable: true };
  snapshotWorkspace(config.workspace, afterImplement);
  const implementReceipt = writeProductValidationReceipt(afterImplement, implementValidation, implementProofs, config.workspace);
  const implementAudit = auditSnapshot(afterImplement);
  checks.product_stages.after_implement = { snapshot: implementAudit, validation: implementValidation, proof_manifest: implementProofs, validation_receipt: implementReceipt };
  if (!implementAudit.ok || !implementValidation.passed || !implementProofs.ok || implementReceipt.status !== 'passed') throw new Error(`Transfer after-implement stage failed independent validation${implementProofs.ok ? '' : `: ${implementProofs.errors.join('; ')}`}`);

  const reviewWorkspace = path.join(config.output, 'review-copy', 'workspace');
  if (fs.existsSync(reviewWorkspace)) throw new Error('Transfer review-copy workspace already exists; refusing to overwrite evidence');
  fs.mkdirSync(path.dirname(reviewWorkspace), { recursive: true });
  fs.cpSync(config.workspace, reviewWorkspace, { recursive: true, dereference: false });
  const reviewHome = prepareRuntimeHome(config.provider, path.join(config.output, 'review-copy', '.runtime-home'));
  checks.review_isolation = auditIsolation(reviewWorkspace, reviewHome);
  if (!checks.review_isolation.passed) throw new Error(`Transfer review-copy isolation failed: ${checks.review_isolation.stderr}`);
  const reviewBefore = path.join(config.output, 'phase-guards', 'review-copy-before');
  const reviewAfter = path.join(config.output, 'phase-guards', 'review-copy-after');
  snapshotWorkspace(reviewWorkspace, reviewBefore);
  let reviewResult;
  try {
    reviewResult = run(adapter, null, `Review the implementation against the frozen contract and brief. You are in an isolated review copy. Write transfer-review.md and transfer-fix-list.md without editing application source.${config.arm === 'lamina' ? ' Execute and inspect every proof mapped by product-proof-manifest.json; treat missing, unmapped, stale-state, prose-only, unexercised, failing, non-repeatable, or open-handle-leaking proofs as concrete fix items. Require finite per-test timeouts and finally-block cleanup for all test-owned resources.' : ''}\n\n## Safe product-validation language\n${REVIEW_SAFETY_INSTRUCTION}\n\n## Original brief\n${brief}\n\n## Frozen contract\nRead ${path.basename(destination)}.\n\n## Contract boundary discipline\n${SYSTEM_BOUNDARY_INSTRUCTION}`, reviewWorkspace, timeout, { phase: 'transfer_review', output: config.output, runtimeHome: reviewHome });
    telemetry.push(reviewResult.telemetry);
    persist();
    if (reviewResult.telemetry.subagent_calls > 0) throw new Error('transfer_review: uncounted subagent opportunity is prohibited');
  } catch (error) {
    if (error.phaseTelemetry) telemetry.push(error.phaseTelemetry);
    persist();
    throw error;
  } finally {
    scrubRuntimeCredentials(reviewHome);
  }
  assertContractFrozen();
  snapshotWorkspace(reviewWorkspace, reviewAfter);
  if (!sameSnapshot(reviewBefore, reviewAfter)) throw new Error('Transfer review phase edited product source despite review-only protocol');
  copyTransferReview(reviewWorkspace, config.workspace, reviewResult.normalized.final_text);
  assertContractFrozen();

  phase('transfer_fix', 'Implement transfer-fix-list.md completely, use the preserved handoff under .benchmark-review, and run appropriate validation.');
  assertContractFrozen();
  const afterFix = path.join(config.output, 'product-stages', 'after-fix');
  const fixValidation = validateProductWorkspace(config.workspace, runtimeHome, path.join(config.output, 'validation', 'after-fix'), { timeout: Number(config['validation-timeout'] || 900) * 1000, testReplays: Number(config['validation-test-replays'] || 3) });
  const fixProofs = config.arm === 'lamina' ? validateProductProofManifest(config.workspace, contractRun) : { ok: true, not_applicable: true };
  snapshotWorkspace(config.workspace, afterFix);
  const fixReceipt = writeProductValidationReceipt(afterFix, fixValidation, fixProofs, config.workspace);
  const fixAudit = auditSnapshot(afterFix);
  checks.product_stages.after_fix = { snapshot: fixAudit, validation: fixValidation, proof_manifest: fixProofs, validation_receipt: fixReceipt };
  if (!fixAudit.ok || !fixValidation.passed || !fixProofs.ok || fixReceipt.status !== 'passed') throw new Error(`Transfer after-fix stage failed independent validation${fixProofs.ok ? '' : `: ${fixProofs.errors.join('; ')}`}`);

  checks.telemetry = validateTelemetry(telemetry, ['transfer_implement', 'transfer_review', 'transfer_fix']);
  if (!checks.telemetry.ok) throw new Error(`Transfer telemetry validation failed: ${checks.telemetry.errors.join('; ')}`);
  persist();
  fs.writeFileSync(path.join(config.output, 'artifact-index.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), files: indexTree(config.output).filter((item) => !item.path.includes('.runtime-home/')) }, null, 2)}\n`);
  fs.writeFileSync(path.join(config.output, 'transfer.json'), `${JSON.stringify({ status: 'complete', provider: config.provider, model: config.model, resolved_model: telemetry.find((item) => item.resolved_model)?.resolved_model || null, session_id: sessionId, contract_file: path.basename(destination), contract_sha256: frozenHash, product_stages: ['after-implement', 'after-fix'], telemetry_phases: telemetry.map((item) => item.phase) }, null, 2)}\n`);
} catch (error) {
  transferError = error;
  fs.writeFileSync(path.join(config.output, 'transfer.json'), `${JSON.stringify({ status: 'failed', provider: config.provider, model: config.model, session_id: sessionId, contract_sha256: frozenHash, error: error.message, telemetry_phases: telemetry.map((item) => item.phase) }, null, 2)}\n`);
} finally {
  persist();
  scrubRuntimeCredentials(runtimeHome);
}

if (transferError) throw transferError;
