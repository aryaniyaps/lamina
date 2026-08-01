#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { identityAlive, processIdentity } from '../scripts/safe-runner/processes.mjs';
import {
  proveExternalControllerCleanup,
  SUPERVISOR_CRASH_PREPARATION_TIMEOUT_MS,
  SUPERVISOR_CRASH_REPORT_TIMEOUT_MS,
} from '../scripts/safe-runner/self-test.mjs';
import { runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const POST_PAYLOAD_TIMEOUT_MS = 15_000;
const DELAYED_PREPARATION_MS = 15_100;
const DELAYED_PREPARATION_TIMEOUT_MS = SUPERVISOR_CRASH_PREPARATION_TIMEOUT_MS
  + DELAYED_PREPARATION_MS;
assert.equal(DELAYED_PREPARATION_TIMEOUT_MS - DELAYED_PREPARATION_MS,
  SUPERVISOR_CRASH_PREPARATION_TIMEOUT_MS,
  'delayed preparation must retain the complete shared preparation budget');
const artifactBase = process.env.LAMINA_SAFE_RUNNER_TEST_ARTIFACT_DIR
  ? path.resolve(process.env.LAMINA_SAFE_RUNNER_TEST_ARTIFACT_DIR)
  : os.tmpdir();
fs.mkdirSync(artifactBase, { recursive: true });
const root = fs.mkdtempSync(path.join(artifactBase, 'lamina-safe-limit-cleanup-'));
const workspaceScratchRoot = runtimePaths(process.cwd()).work;
fs.mkdirSync(workspaceScratchRoot, { recursive: true, mode: 0o700 });
const scratch = fs.mkdtempSync(path.join(workspaceScratchRoot, 'safe-runner-limit-cleanup-'));
const reportFile = path.join(root, 'report.json');
const phases = path.join(root, 'phases.txt');
const progressFile = path.join(root, 'crash-progress.json');
const stateDirectory = path.join(root, 'state');
const graphRepository = path.join(scratch, 'graph-repository');
fs.mkdirSync(graphRepository);
assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: graphRepository }).status, 0);
const child = spawn(process.execPath, [
  'tests/fixtures/safe-runner-limit-controller.mjs', process.cwd(), reportFile,
  graphRepository, phases, progressFile, String(DELAYED_PREPARATION_MS),
], {
  cwd: process.cwd(), stdio: 'ignore',
  env: { ...process.env, LAMINA_SAFE_RUNNER_STATE_DIR: stateDirectory },
});

let controllerIdentity = null;
const identityDeadline = Date.now() + 250;
while (Date.now() < identityDeadline && !controllerIdentity
  && child.exitCode === null && child.signalCode === null) {
  controllerIdentity = processIdentity(child.pid);
  if (!controllerIdentity) await wait(10);
}
if (!controllerIdentity) {
  child.kill('SIGKILL');
  const exitDeadline = Date.now() + SUPERVISOR_CRASH_REPORT_TIMEOUT_MS;
  while (Date.now() < exitDeadline && child.exitCode === null && child.signalCode === null) {
    await wait(20);
  }
  throw new Error('could not establish exact killed-wrapper controller identity');
}

let exactCleanupProven = false;
let testPassed = false;
let timeoutPhase = null;
let progress = null;
let evidence = null;
const trace = () => fs.existsSync(phases) ? fs.readFileSync(phases, 'utf8') : '';
try {
  const preparationStartedMs = Date.now();
  const preparationDeadline = preparationStartedMs + DELAYED_PREPARATION_TIMEOUT_MS;
  let payloadReleased = false;
  while (Date.now() < preparationDeadline && identityAlive(controllerIdentity)) {
    try { progress = JSON.parse(fs.readFileSync(progressFile, 'utf8')); } catch {}
    payloadReleased = /launch:payload-released/.test(trace());
    if (payloadReleased) break;
    await wait(20);
  }
  if (identityAlive(controllerIdentity) && !payloadReleased) {
    timeoutPhase = 'preparation';
    child.kill('SIGKILL');
  } else if (payloadReleased && identityAlive(controllerIdentity)) {
    const postPayloadDeadline = Date.now() + POST_PAYLOAD_TIMEOUT_MS;
    while (Date.now() < postPayloadDeadline && identityAlive(controllerIdentity)) await wait(20);
    if (identityAlive(controllerIdentity)) {
      timeoutPhase = 'post_payload_cleanup';
      child.kill('SIGKILL');
    }
  }

  if (!progress) {
    try { progress = JSON.parse(fs.readFileSync(progressFile, 'utf8')); } catch {}
  }
  const validProgress = progress?.controller_pid === child.pid
    && typeof progress?.unit === 'string'
    && Number.isSafeInteger(progress?.watchdog_process?.pid)
    && typeof progress?.watchdog_process?.start_ticks === 'string';
  let claimAttempted = false;
  let cleanupEvidence = null;
  const refreshCleanupEvidence = () => {
    cleanupEvidence = proveExternalControllerCleanup({
      controllerIdentity,
      resourceState: progress,
      report: evidence,
      claimDirectory: path.join(stateDirectory, 'production-locks'),
      claimUnit: 'lamina-safe-post-limit-cleanup-proof.scope',
      attemptClaim: !claimAttempted,
    });
    if (cleanupEvidence.base_cleanup_proven) claimAttempted = true;
  };
  refreshCleanupEvidence();
  const cleanupDeadline = Date.now() + SUPERVISOR_CRASH_REPORT_TIMEOUT_MS;
  while (Date.now() < cleanupDeadline) {
    try {
      const candidate = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      if (candidate?.error?.code !== 'LAMINA_SAFE_RUN_IN_PROGRESS') evidence = candidate;
    } catch {}
    refreshCleanupEvidence();
    if (cleanupEvidence.exact_cleanup_proven) break;
    await wait(20);
  }
  exactCleanupProven = cleanupEvidence.exact_cleanup_proven;
  if (!exactCleanupProven) {
    const error = new Error(
      `killed-wrapper exact watchdog cleanup was not proven; artifacts retained at ${root}`,
    );
    error.code = 'LAMINA_SAFE_SELF_TEST_CLEANUP_UNPROVEN';
    error.diagnostic = {
      timeout_phase: timeoutPhase,
      artifact_root: root,
      scratch_root: scratch,
      trace: trace(),
      progress_observed: progress !== null,
      report_observed: evidence !== null,
      valid_progress: validProgress,
      ...cleanupEvidence,
    };
    throw error;
  }

  const missingLockAuthority = { ...progress };
  delete missingLockAuthority.lock_file;
  const missingLockProof = proveExternalControllerCleanup({
    controllerIdentity,
    resourceState: missingLockAuthority,
    report: evidence,
    claimDirectory: path.join(stateDirectory, 'production-locks'),
    attemptClaim: false,
  });
  assert.equal(missingLockProof.authoritative_cleanup_proven, false,
    'a missing lock_file field must never inherit the explicit no-lock cleanup rule');
  assert.equal(missingLockProof.exact_cleanup_proven, false);
  for (const [field, value] of [
    ['lock_file', 42],
    ['temporary_directory', { path: progress.temporary_directory }],
    ['watchdog_directory', { path: progress.watchdog_directory }],
  ]) {
    const malformedProof = proveExternalControllerCleanup({
      controllerIdentity,
      resourceState: { ...progress, [field]: value },
      report: evidence,
      claimDirectory: path.join(stateDirectory, 'production-locks'),
      attemptClaim: false,
    });
    assert.equal(malformedProof.authoritative_cleanup_proven, false,
      `malformed ${field} authority must fail closed without throwing`);
    assert.equal(malformedProof.exact_cleanup_proven, false);
  }
  const finalTrace = trace();
  const artifactHint = `artifacts retained at ${root}`;
  assert.equal(timeoutPhase, null,
    `killed-wrapper cleanup hung; ${artifactHint}; phases:\n${finalTrace}`);
  assert.ok(Date.now() - preparationStartedMs >= DELAYED_PREPARATION_MS,
    `preparation delay must exceed the removed total-run timeout; ${artifactHint}`);
  assert.match(finalTrace, /finally:broker-closed/, artifactHint);
  assert.match(finalTrace, /finally:output-(?:closed|close-timeout)/, artifactHint);
  assert.match(finalTrace, /finally:complete/, artifactHint);
  assert.match(finalTrace, /report:write-start/, artifactHint);
  assert.ok(['safety_limit_exceeded', 'internal_error'].includes(evidence.outcome), artifactHint);
  assert.doesNotMatch(evidence.output?.stderr_tail || '', /spawnSync git ENOENT/,
    `the sealed graph repository cwd must remain visible to Git; ${artifactHint}`);
  if (payloadReleased) {
    assert.equal(evidence.outcome, 'safety_limit_exceeded', artifactHint);
    assert.equal(evidence.termination?.reason, 'safety_limit_exceeded', artifactHint);
    assert.equal(evidence.termination?.limit, 'timeout', artifactHint);
    assert.deepEqual(evidence.termination?.requested_signals, ['SIGTERM', 'SIGKILL'], artifactHint);
    assert.deepEqual(evidence.cleanup?.managed_paths_remaining, [], artifactHint);
    assert.match(finalTrace, /launch:payload-released/, artifactHint);
    const sandboxProbe = String(evidence.output?.stdout_tail || '').split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .find((item) => item?.schema === 'lamina.safe-runner-sealed-sandbox-probe/v1');
    assert.ok(sandboxProbe, `sealed sandbox Git probe evidence is missing; ${artifactHint}`);
    assert.equal(sandboxProbe.path, sandboxProbe.expected_path, artifactHint);
    assert.equal(sandboxProbe.git?.named_request, 'git', artifactHint);
    assert.equal(sandboxProbe.git?.requested_path, sandboxProbe.git?.path, artifactHint);
    assert.equal(path.isAbsolute(sandboxProbe.git?.path || ''), true, artifactHint);
    assert.match(sandboxProbe.git?.digest || '', /^[a-f0-9]{64}$/, artifactHint);
    assert.equal(Number.isInteger(sandboxProbe.git?.controller_uid), true, artifactHint);
    assert.equal(Number.isInteger(sandboxProbe.git?.namespace_uid), true, artifactHint);
    assert.equal(sandboxProbe.repository?.path, graphRepository, artifactHint);
    assert.equal(sandboxProbe.repository?.writable, true, artifactHint);
    assert.equal(sandboxProbe.named_git_root, graphRepository, artifactHint);
    assert.equal(sandboxProbe.absolute_git_root, graphRepository, artifactHint);
  } else {
    assert.ok([
      'LAMINA_SAFE_TEMP_QUOTA_UNPROVEN', 'LAMINA_SAFE_SANDBOX_LAUNCH',
    ].includes(evidence.error?.code),
    `only an exact private-tmpfs refusal or bounded sandbox launch failure may end local preparation; ${artifactHint}`);
    assert.equal(evidence.termination?.limit,
      evidence.error?.code === 'LAMINA_SAFE_SANDBOX_LAUNCH'
        ? 'sandbox_launch' : 'temporary_quota_handshake', artifactHint);
    assert.doesNotMatch(evidence.output?.stderr_tail || '',
      /bwrap:.*(?:mkdir parents|read-only file system)/i,
      `a missing sealed bind target must never pass as a local quota refusal; ${artifactHint}`);
  }
  testPassed = true;
} catch (error) {
  if (error && typeof error === 'object') {
    error.artifact_root ||= root;
    if (!exactCleanupProven) error.scratch_root ||= scratch;
  }
  throw error;
} finally {
  if (identityAlive(controllerIdentity)) {
    try { child.kill('SIGKILL'); } catch {}
  }
  if (exactCleanupProven) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  if (testPassed) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

assert.equal(fs.existsSync(scratch), false,
  'exact killed-wrapper cleanup proof must remove its workspace scratch');
process.stdout.write('safe-runner killed-wrapper cleanup regression passed\n');
