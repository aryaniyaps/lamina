import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isolatedCommand } from './isolation.mjs';

const TRANSIENT_PROVIDER_FAILURES = [
  /selected model is at capacity/i,
  /model(?: is)? (?:currently )?overloaded/i,
  /service (?:is )?temporarily unavailable/i,
  /temporarily unable to serve/i,
  /rate limit(?:ed| exceeded)?/i,
  /too many requests/i,
];

const CONTINUATION_PROMPT = `The previous turn for this same phase ended only because the model provider reported transient capacity or availability. Continue the same phase from the current workspace state. Do not restart completed work. Re-run the authoritative validation, finish every remaining requirement, and return only when this phase is complete.`;

const REVIEW_SAFETY_CONTINUATION_PROMPT = `The previous review turn was interrupted by a provider safety false positive while validating product authorization or privacy behavior. Continue the same review from the current read-only workspace without adversarial cybersecurity framing. Use ordinary named product roles and normal user journeys; do not label people attacker, victim, or target, and do not perform exploit, penetration, evasion, or credential-abuse testing. Still verify every declared authorization, identity, revocation, privacy, and replay boundary through safe product-level requests or existing tests. Preserve any evidence already gathered, finish the required review and fix artifacts, and return only when the review is complete.`;

const REVIEW_SAFETY_FAILURES = [
  /flagged for possible cybersecurity risk/i,
  /trusted access for cyber/i,
];

function safePhaseName(phase) {
  return phase.replace(/[^A-Za-z0-9_-]+/g, '-');
}

export function isTransientProviderFailure(raw, { timedOut = false } = {}) {
  return !timedOut && TRANSIENT_PROVIDER_FAILURES.some((pattern) => pattern.test(String(raw || '')));
}

export function transientContinuationPrompt() {
  return CONTINUATION_PROMPT;
}

export function isReviewSafetyInterruption(raw, { timedOut = false, phase = '' } = {}) {
  return !timedOut
    && /(?:^|_)review$/.test(String(phase))
    && REVIEW_SAFETY_FAILURES.some((pattern) => pattern.test(String(raw || '')));
}

export function reviewSafetyContinuationPrompt() {
  return REVIEW_SAFETY_CONTINUATION_PROMPT;
}

function waitForRetry(retryNumber) {
  const delayMs = Math.min(15_000 * (2 ** Math.max(0, retryNumber - 1)), 30_000);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function addUsage(total, normalized) {
  for (const key of ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens']) {
    if (Number.isInteger(normalized[key])) total[key] = Number(total[key] || 0) + normalized[key];
  }
}

export function isolatedCliVersion(adapter, workspace, runtimeHome) {
  const invocation = adapter.version();
  const isolated = isolatedCommand({ workspace, runtimeHome, command: invocation.command, args: invocation.args });
  const result = spawnSync(isolated.command, isolated.args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) return null;
  return `${result.stdout || result.stderr || ''}`.trim().split('\n')[0] || null;
}

export function invokeAgent({ adapter, sessionId, prompt, workspace, timeout, phase, evidenceRoot, evidenceBase, runtimeHome, maxTransientRetries = 0 }) {
  const phaseDir = path.join(evidenceRoot, safePhaseName(phase));
  fs.mkdirSync(phaseDir, { recursive: true });
  fs.writeFileSync(path.join(phaseDir, 'prompt.txt'), prompt);

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const combinedEvents = [];
  const stdoutParts = [];
  const stderrParts = [];
  const usage = { input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_output_tokens: null };
  let activeSessionId = sessionId;
  let retries = 0;
  let toolCalls = 0;
  let subagentCalls = 0;
  let last = null;
  let retryPrompt = CONTINUATION_PROMPT;

  while (true) {
    const attemptNumber = retries + 1;
    const attemptPrompt = attemptNumber === 1 ? prompt : retryPrompt;
    const invocation = activeSessionId ? adapter.resume(activeSessionId, attemptPrompt) : adapter.start(attemptPrompt);
    const isolated = isolatedCommand({ workspace, runtimeHome, command: invocation.command, args: invocation.args });
    const attemptDir = path.join(phaseDir, `attempt-${attemptNumber}`);
    fs.mkdirSync(attemptDir, { recursive: true });
    fs.writeFileSync(path.join(attemptDir, 'prompt.txt'), attemptPrompt);

    const child = spawnSync(isolated.command, isolated.args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
    const stdout = child.stdout || '';
    const stderr = child.stderr || '';
    fs.writeFileSync(path.join(attemptDir, 'stdout.jsonl'), stdout);
    fs.writeFileSync(path.join(attemptDir, 'stderr.log'), stderr);
    const normalized = adapter.normalize(`${stdout}\n${stderr}`);
    fs.writeFileSync(path.join(attemptDir, 'events.json'), `${JSON.stringify(normalized.events, null, 2)}\n`);
    if (normalized.final_text) fs.writeFileSync(path.join(attemptDir, 'final.txt'), normalized.final_text);

    const timedOut = child.error?.code === 'ETIMEDOUT';
    const exitCode = Number.isInteger(child.status) ? child.status : timedOut ? 124 : 1;
    activeSessionId = normalized.session_id || activeSessionId || invocation.sessionId || null;
    combinedEvents.push(...normalized.events);
    stdoutParts.push(stdout);
    stderrParts.push(stderr);
    addUsage(usage, normalized);
    toolCalls += Number(normalized.tool_calls || 0);
    subagentCalls += Number(normalized.subagent_calls || 0);
    last = { child, normalized, timedOut, exitCode };

    const rawFailure = `${stderr}\n${stdout}\n${child.error?.message || ''}`;
    const retryReason = isTransientProviderFailure(rawFailure, { timedOut })
      ? 'transient_provider_availability'
      : isReviewSafetyInterruption(rawFailure, { timedOut, phase })
        ? 'review_product_safety_restatement'
        : null;
    if (exitCode === 0 || retries >= maxTransientRetries || !retryReason) break;
    retries += 1;
    retryPrompt = retryReason === 'review_product_safety_restatement' ? REVIEW_SAFETY_CONTINUATION_PROMPT : CONTINUATION_PROMPT;
    fs.writeFileSync(path.join(attemptDir, 'retry.json'), `${JSON.stringify({ retry: retries, reason: retryReason, next_session_id: activeSessionId }, null, 2)}\n`);
    waitForRetry(retries);
  }

  fs.writeFileSync(path.join(phaseDir, 'stdout.jsonl'), stdoutParts.join('\n'));
  fs.writeFileSync(path.join(phaseDir, 'stderr.log'), stderrParts.join('\n'));
  fs.writeFileSync(path.join(phaseDir, 'events.json'), `${JSON.stringify(combinedEvents, null, 2)}\n`);
  if (last.normalized.final_text) fs.writeFileSync(path.join(phaseDir, 'final.txt'), last.normalized.final_text);

  const telemetry = {
    phase,
    provider: adapter.provider,
    model: adapter.model,
    resolved_model: last.normalized.resolved_model,
    cli_version: isolatedCliVersion(adapter, workspace, runtimeHome),
    session_id: activeSessionId || `missing-${safePhaseName(phase)}`,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    duration_ms: Date.now() - startedMs,
    exit_code: last.exitCode,
    signal: last.child.signal || null,
    timed_out: last.timedOut,
    usage_accounting: last.normalized.usage_accounting,
    ...usage,
    cumulative_input_tokens: last.normalized.cumulative_input_tokens,
    cumulative_cached_input_tokens: last.normalized.cumulative_cached_input_tokens,
    cumulative_output_tokens: last.normalized.cumulative_output_tokens,
    cumulative_reasoning_output_tokens: last.normalized.cumulative_reasoning_output_tokens,
    tool_calls: toolCalls,
    subagent_calls: subagentCalls,
    retries,
    evidence_path: path.relative(evidenceBase, phaseDir),
  };
  if (last.exitCode !== 0) {
    const detail = `${last.child.stderr || last.child.stdout || last.child.error?.message || 'no process output'}`.slice(-8000);
    throw Object.assign(new Error(`${adapter.provider} phase ${phase} failed with ${last.exitCode}: ${detail}`), { phaseTelemetry: telemetry });
  }
  return { sessionId: activeSessionId, normalized: last.normalized, telemetry };
}
