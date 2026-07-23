import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  loadBenchEnv,
  resolveCursorCredential,
  resolveHarborCredential,
} from '../../lib/load-env.mjs';
import { credentialPresence, redactObject, redactString } from './redact.mjs';

export const EXPECTED_HARBOR_VERSION = '0.18.0';
export const EXPECTED_COMPOSER_MODEL = 'composer-2.5';
export const REQUIRED_PERSONA_CHILDREN = 2;

const COMPOSER_MODEL_RE = /composer[\s._-]?2[\s._-]?5/i;

function runCommand(command, args, { env = process.env, timeoutMs = 120_000, cwd } = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    env,
    timeout: timeoutMs,
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
}

function gate(name, status, details = {}) {
  return { name, status, ...details };
}

function failGate(name, reason, details = {}) {
  return gate(name, 'failed', { reason, ...details });
}

function passGate(name, details = {}) {
  return gate(name, 'passed', details);
}

function blockedGate(name, reason, details = {}) {
  return gate(name, 'blocked', { reason, ...details });
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function isCursorAgentVersionOutput(text) {
  const value = (text || '').trim();
  if (!value) return false;
  if (/^grok\b/i.test(value)) return false;
  return /^\d{4}\.\d{2}\.\d{2}-[0-9a-f]+/i.test(value) || /cursor/i.test(value);
}

export function resolveCursorAgentCandidates() {
  const home = os.homedir();
  const candidates = [];
  const versionsDir = path.join(home, '.local/share/cursor-agent/versions');
  if (fs.existsSync(versionsDir)) {
    for (const version of fs.readdirSync(versionsDir).sort().reverse()) {
      candidates.push(path.join(versionsDir, version, 'cursor-agent'));
    }
  }
  candidates.push(path.join(home, '.local/bin/cursor-agent'));
  candidates.push('cursor-agent');
  return candidates;
}

export function locateCursorCli() {
  for (const candidate of resolveCursorAgentCandidates()) {
    let resolved = candidate;
    try {
      if (fs.existsSync(candidate)) {
        resolved = fs.realpathSync(candidate);
      }
    } catch {
      continue;
    }

    const probe = runCommand(resolved, ['--version'], { timeoutMs: 10_000 });
    const combined = `${probe.stdout || ''}${probe.stderr || ''}`.trim();
    if (probe.status !== 0 || !isCursorAgentVersionOutput(combined)) continue;

    const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
    return {
      ok: true,
      path: resolved,
      version: combined.split('\n')[0],
      sha256: stat ? sha256File(resolved) : null,
    };
  }

  return {
    ok: false,
    reason: 'cursor-agent binary not found or not identifiable as Cursor Agent CLI',
    searched: resolveCursorAgentCandidates(),
  };
}

export function checkHarborVersion() {
  const probe = runCommand('harbor', ['--version'], { timeoutMs: 10_000 });
  const version = `${probe.stdout || ''}${probe.stderr || ''}`.trim().split('\n')[0];
  if (probe.status !== 0 || !version) {
    return failGate('harbor_version', 'harbor CLI is unavailable');
  }
  if (!version.startsWith(EXPECTED_HARBOR_VERSION)) {
    return failGate('harbor_version', `expected Harbor ${EXPECTED_HARBOR_VERSION}, got ${version}`, {
      version,
    });
  }
  return passGate('harbor_version', { version });
}

export function checkDockerCapacity() {
  const version = runCommand('docker', ['--version'], { timeoutMs: 10_000 });
  if (version.status !== 0) {
    return failGate('docker_capacity', 'docker CLI is unavailable');
  }

  const info = runCommand('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 20_000 });
  if (info.status !== 0) {
    return failGate('docker_capacity', 'docker daemon is not reachable', {
      detail: redactString(`${info.stderr || ''}${info.stdout || ''}`.trim()),
    });
  }

  return passGate('docker_capacity', {
    version: `${version.stdout || ''}`.trim(),
    serverVersion: `${info.stdout || ''}`.trim(),
  });
}

export function loadPilotEnv(root) {
  return loadBenchEnv(root);
}

export function checkCursorLocalAuth({ fileEnv }) {
  const apiKey = resolveCursorCredential(fileEnv);
  const presence = credentialPresence(apiKey);
  if (!apiKey) {
    return blockedGate(
      'cursor_local_auth',
      'CURSOR_API_KEY is absent from repo root .env; unattended Cursor execution is blocked',
      {
        credentialSource: 'repo_root_env',
        cursorApiKey: presence,
      },
    );
  }

  return passGate('cursor_local_auth', {
    credentialSource: 'repo_root_env',
    cursorApiKey: presence,
    transport: 'process_env_only',
  });
}

export function checkHarborPublicationAuth({ fileEnv }) {
  const harborApiKey = resolveHarborCredential(fileEnv);
  const status = runCommand('harbor', ['auth', 'status'], { timeoutMs: 15_000 });
  const output = `${status.stdout || ''}${status.stderr || ''}`.trim();
  const authenticated = /authenticated/i.test(output) && !/not authenticated/i.test(output);

  if (authenticated || harborApiKey) {
    return passGate('harbor_publication_auth', {
      credentialSource: harborApiKey ? 'repo_root_env' : 'harbor_session',
      harborApiKey: credentialPresence(harborApiKey),
      detail: redactString(output.split('\n')[0] || 'authenticated'),
    });
  }

  return blockedGate(
    'harbor_publication_auth',
    'Harbor registry authentication is not configured; publication remains blocked by operator choice',
    {
      credentialSource: 'none',
      harborApiKey: credentialPresence(harborApiKey),
      detail: redactString(output.split('\n')[0] || 'not authenticated'),
      distinctFrom: 'cursor_local_auth',
    },
  );
}

export function buildCursorProbeEnv(baseEnv, fileEnv) {
  const env = { ...baseEnv };
  for (const [key, value] of Object.entries(fileEnv)) {
    if (value !== undefined && value !== '') env[key] = value;
  }
  return env;
}

export function parseStreamJson(text) {
  const events = [];
  for (const line of `${text || ''}`.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Ignore malformed lines; validation will fail closed if required events are missing.
    }
  }
  return events;
}

function getSessionId(event) {
  return event?.session_id || event?.sessionId || null;
}

function modelMatchesComposer25(model) {
  return COMPOSER_MODEL_RE.test(`${model || ''}`);
}

function readTaskToolCall(event) {
  const payload = event?.tool_call;
  if (!payload || typeof payload !== 'object') return null;
  return payload.taskToolCall || payload.TaskToolCall || null;
}

function pickTaskSuccess(taskCall) {
  return taskCall?.result?.success || taskCall?.result?.Success || null;
}

export function extractTaskToolLaunch(event, parentSessionId) {
  const taskCall = readTaskToolCall(event);
  if (!taskCall) return null;

  const args = taskCall.args || {};
  const success = pickTaskSuccess(taskCall) || {};
  const eventSessionId = getSessionId(event);

  return {
    callId: event.call_id,
    eventSessionId,
    parentSessionId: parentSessionId || eventSessionId,
    argsAgentId: args.agentId || args.agent_id || null,
    requestedModel: args.model || args.modelId || null,
    description: args.description || args.prompt || null,
    subagentType: args.subagentType || args.subagent_type || args.subagent || null,
    resultAgentId: success.agentId || success.agent_id || null,
    resultSuccess: success.success ?? null,
    durationMs: success.durationMs || success.duration_ms || null,
    conversationSteps: success.conversationSteps || success.conversation_steps || null,
    resultText: success.result || null,
    launchEvent: event,
    providerFieldsObserved: {
      args: Object.keys(args),
      success: Object.keys(success),
    },
  };
}

export function analyzeStreamProvenance(events) {
  const inits = new Map();
  const terminals = new Map();
  const taskLaunches = [];
  const sessionIds = new Set();

  let parentSessionId = null;

  for (const event of events) {
    const sessionId = getSessionId(event);
    if (sessionId) sessionIds.add(sessionId);

    if (event?.type === 'system' && event?.subtype === 'init' && sessionId) {
      inits.set(sessionId, event);
      if (!parentSessionId) parentSessionId = sessionId;
    }
    if (event?.type === 'result' && sessionId) {
      terminals.set(sessionId, event);
    }
    if (event?.type === 'tool_call') {
      const launch = extractTaskToolLaunch(event, parentSessionId);
      if (launch) taskLaunches.push(launch);
    }
  }

  const parentInit = parentSessionId ? inits.get(parentSessionId) : null;
  const completedLaunches = taskLaunches.filter((launch) => launch.launchEvent?.subtype === 'completed');

  const children = completedLaunches.map((launch) => {
    const childSessionId = launch.resultAgentId || launch.argsAgentId;
    const childInit = childSessionId ? inits.get(childSessionId) || null : null;
    const childTerminal = childSessionId ? terminals.get(childSessionId) || null : null;
    const explicitParentLink =
      childInit?.parent_session_id
      || childInit?.parentSessionId
      || launch.launchEvent?.parent_session_id
      || launch.launchEvent?.parentSessionId
      || null;

    return {
      childSessionId,
      parentSessionId: explicitParentLink || launch.parentSessionId || parentSessionId,
      role: launch.description,
      requestedModel: launch.requestedModel,
      init: childInit,
      terminal: childTerminal,
      launch: launch.launchEvent,
      initModel: childInit?.model || null,
      actualSelectedModelObserved: childInit?.model || null,
      terminalStatus: childTerminal?.subtype || (launch.resultSuccess === true ? 'success' : null),
      terminalOk: childTerminal ? childTerminal.is_error === false : launch.resultSuccess === true,
      inParentSessionStreamOnly: launch.eventSessionId === parentSessionId,
      hasIndependentChildSessionStream: Boolean(childSessionId && inits.has(childSessionId)),
      hasExplicitParentSessionField: Boolean(explicitParentLink),
      hasChildInitEvent: Boolean(childInit),
      hasChildSelectedModelEvent: Boolean(childInit && modelMatchesComposer25(childInit.model)),
      hasChildUsage: Boolean(childTerminal?.usage),
      conversationSteps: launch.conversationSteps,
      durationMs: launch.durationMs,
      providerFieldsObserved: launch.providerFieldsObserved,
    };
  });

  return {
    parentSessionId,
    parentInit,
    parentModel: parentInit?.model || null,
    parentApiKeySource: parentInit?.apiKeySource || null,
    sessionIds: [...sessionIds],
    singleSessionStream: sessionIds.size <= 1,
    inits,
    terminals,
    taskLaunches,
    completedTaskLaunches: completedLaunches,
    children,
    eventCount: events.length,
  };
}

export function validateComposerProbe(analysis) {
  const failures = [];
  if (!analysis.parentInit) {
    failures.push('missing parent system.init event');
  } else if (!modelMatchesComposer25(analysis.parentModel)) {
    failures.push(`parent init model mismatch: ${analysis.parentModel || 'unknown'}`);
  }
  if (analysis.parentApiKeySource && analysis.parentApiKeySource !== 'env') {
    failures.push(`expected apiKeySource=env, got ${analysis.parentApiKeySource}`);
  }
  return failures;
}

export function buildPersonaProvenanceFailureRecord(analysis, { required = REQUIRED_PERSONA_CHILDREN } = {}) {
  const completed = analysis.completedTaskLaunches || [];
  const children = analysis.children || [];

  const missingEvidence = {
    childSystemInit: children.filter((child) => !child.hasChildInitEvent).length,
    childSelectedModelInit: children.filter((child) => !child.hasChildSelectedModelEvent).length,
    independentChildSessionStream: children.filter((child) => !child.hasIndependentChildSessionStream).length,
    explicitParentSessionField: children.filter((child) => !child.hasExplicitParentSessionField).length,
    childUsageOrCost: children.filter((child) => !child.hasChildUsage).length,
  };

  return {
    gate: 'persona_child_provenance',
    verdict: 'failed',
    parentSessionId: analysis.parentSessionId,
    singleSessionStream: analysis.singleSessionStream,
    taskToolCallsCompleted: completed.length,
    requiredPersonaChildren: required,
    attributableChildren: children.filter((child) =>
      child.hasChildInitEvent
      && child.hasChildSelectedModelEvent
      && child.hasIndependentChildSessionStream
      && child.hasExplicitParentSessionField
      && child.terminalOk,
    ).length,
    missingEvidence,
    observedTaskToolFields: completed.map((launch) => ({
      callId: launch.callId,
      eventSessionId: launch.eventSessionId,
      argsAgentId: launch.argsAgentId,
      requestedModel: launch.requestedModel,
      resultAgentId: launch.resultAgentId,
      resultSuccess: launch.resultSuccess,
      durationMs: launch.durationMs,
      conversationSteps: launch.conversationSteps,
      providerFieldsObserved: launch.providerFieldsObserved,
    })),
    conclusion:
      'Cursor stream-json exposes taskToolCall execution metadata in the parent session, but not attributable native child init/selected-model/lifecycle evidence required by LaminaBench-6.',
  };
}

export function validatePersonaChildren(analysis, { required = REQUIRED_PERSONA_CHILDREN } = {}) {
  const failures = [];
  const completed = analysis.completedTaskLaunches || [];

  const valid = (analysis.children || []).filter((child) =>
    child.childSessionId
    && child.parentSessionId
    && child.parentSessionId !== child.childSessionId
    && child.hasChildInitEvent
    && child.hasChildSelectedModelEvent
    && child.hasIndependentChildSessionStream
    && child.hasExplicitParentSessionField
    && child.launch
    && child.terminalOk,
  );

  if (completed.length < required) {
    failures.push(
      `expected at least ${required} completed taskToolCall persona launches, observed ${completed.length}`,
    );
  } else if (valid.length < required) {
    failures.push(
      `taskToolCall launched ${completed.length} subagent(s) in parent session ${analysis.parentSessionId || 'unknown'}, but ${valid.length} attributable native child provenance record(s)`,
    );
    failures.push(
      'stream-json lacks child system.init with actual selected model, independent child session stream, child usage/cost, and explicit parent_session_id',
    );
    if (analysis.singleSessionStream) {
      failures.push('all events share a single parent session_id; no independent child session stream observed');
    }
  }

  return {
    failures,
    validChildren: valid,
    failureRecord: failures.length ? buildPersonaProvenanceFailureRecord(analysis, { required }) : null,
  };
}

function writeProbeAgents(probeDir) {
  const agentsDir = path.join(probeDir, '.cursor/agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  const template = (name, word) => `---
name: ${name}
description: Lamina pilot preflight disposable persona child ${name}. Use for provenance probe only.
model: inherit
readonly: true
---

Reply with exactly: ${word}
`;
  fs.writeFileSync(path.join(agentsDir, 'persona-alpha.md'), template('persona-alpha', 'ALPHA'));
  fs.writeFileSync(path.join(agentsDir, 'persona-beta.md'), template('persona-beta', 'BETA'));
}

export function runCursorProbes({ cursorCli, fileEnv, timeoutMs = 180_000 }) {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-lb6-preflight-'));
  writeProbeAgents(probeDir);

  const env = buildCursorProbeEnv(process.env, fileEnv);
  const args = [
    '-p',
    '--trust',
    '--force',
    '--output-format',
    'stream-json',
    '--model',
    EXPECTED_COMPOSER_MODEL,
    'Preflight probe only. Launch the persona-alpha and persona-beta subagents in parallel. Each child must answer with its exact one-word contract. Do not simulate children in parent text.',
  ];

  const result = runCommand(cursorCli.path, args, { env, cwd: probeDir, timeoutMs });
  const raw = `${result.stdout || ''}${result.stderr || ''}`;
  const events = parseStreamJson(result.stdout || '');
  const analysis = analyzeStreamProvenance(events);
  const composerFailures = validateComposerProbe(analysis);
  const childValidation = validatePersonaChildren(analysis);

  try {
    fs.rmSync(probeDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup only.
  }

  return {
    exitCode: result.status ?? 1,
    timedOut: result.error?.code === 'ETIMEDOUT',
    eventCount: events.length,
    analysis,
    composerFailures,
    childFailures: childValidation.failures,
    validChildren: childValidation.validChildren,
    personaFailureRecord: childValidation.failureRecord,
    rawRedacted: redactString(raw.slice(0, 20_000)),
  };
}

export function writePreflightReports(root, report, { personaFailureRecord } = {}) {
  const reportDir = path.join(root, 'benchmarks/lb6/reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const latestPath = path.join(reportDir, 'latest.json');
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`);

  if (personaFailureRecord) {
    const failurePath = path.join(reportDir, 'persona-provenance-gate-failure.json');
    fs.writeFileSync(failurePath, `${JSON.stringify(redactObject(personaFailureRecord), null, 2)}\n`);
    return { latestPath, failurePath };
  }

  return { latestPath };
}

export function runPilotPreflight({
  root,
  skipLiveProbes = false,
  cursorCli = locateCursorCli(),
  fileEnv = loadPilotEnv(root),
} = {}) {
  const gates = [];

  if (!cursorCli.ok) {
    gates.push(failGate('cursor_cli', cursorCli.reason, { searched: cursorCli.searched }));
  } else {
    gates.push(passGate('cursor_cli', {
      path: cursorCli.path,
      version: cursorCli.version,
      sha256: cursorCli.sha256,
    }));
  }

  gates.push(checkHarborVersion());
  gates.push(checkDockerCapacity());
  gates.push(checkCursorLocalAuth({ fileEnv }));
  gates.push(checkHarborPublicationAuth({ fileEnv }));

  const localAuth = gates.find((item) => item.name === 'cursor_local_auth');
  const canRunLive = cursorCli.ok && localAuth?.status === 'passed' && !skipLiveProbes;

  let composerProbe = null;
  let personaFailureRecord = null;

  if (skipLiveProbes) {
    gates.push(blockedGate('composer_stream_probe', 'live probe skipped (--static-only)', {}));
    gates.push(blockedGate('persona_child_provenance', 'live probe skipped (--static-only)', {}));
  } else if (localAuth?.status !== 'passed') {
    gates.push(blockedGate(
      'composer_stream_probe',
      'blocked until CURSOR_API_KEY is present in repo root .env',
      { cursorApiKey: localAuth?.cursorApiKey || 'absent' },
    ));
    gates.push(blockedGate(
      'persona_child_provenance',
      'blocked until CURSOR_API_KEY is present in repo root .env',
      { cursorApiKey: localAuth?.cursorApiKey || 'absent' },
    ));
  } else if (!cursorCli.ok) {
    gates.push(blockedGate('composer_stream_probe', 'blocked until cursor-agent is installed', {}));
    gates.push(blockedGate('persona_child_provenance', 'blocked until cursor-agent is installed', {}));
  } else if (canRunLive) {
    const probe = runCursorProbes({ cursorCli, fileEnv });
    composerProbe = probe;
    personaFailureRecord = probe.personaFailureRecord;

    if (probe.timedOut) {
      gates.push(failGate('composer_stream_probe', 'probe timed out'));
      gates.push(failGate('persona_child_provenance', 'probe timed out'));
    } else if (probe.composerFailures.length) {
      gates.push(failGate('composer_stream_probe', probe.composerFailures.join('; '), {
        parentModel: probe.analysis.parentModel,
        parentApiKeySource: probe.analysis.parentApiKeySource,
        eventCount: probe.eventCount,
      }));
      gates.push(failGate('persona_child_provenance', probe.childFailures.join('; ') || 'composer probe failed first', {
        observedChildren: probe.validChildren.length,
      }));
    } else {
      gates.push(passGate('composer_stream_probe', {
        parentSessionId: probe.analysis.parentSessionId,
        parentModel: probe.analysis.parentModel,
        parentApiKeySource: probe.analysis.parentApiKeySource,
        eventCount: probe.eventCount,
        completedTaskToolCalls: probe.analysis.completedTaskLaunches.length,
        singleSessionStream: probe.analysis.singleSessionStream,
      }));
      if (probe.childFailures.length) {
        gates.push(failGate('persona_child_provenance', probe.childFailures.join('; '), {
          observedChildren: probe.validChildren.length,
          parentSessionId: probe.analysis.parentSessionId,
          completedTaskToolCalls: probe.analysis.completedTaskLaunches.length,
          singleSessionStream: probe.analysis.singleSessionStream,
          failureRecordPath: 'benchmarks/lb6/reports/persona-provenance-gate-failure.json',
        }));
      } else {
        gates.push(passGate('persona_child_provenance', {
          requiredChildren: REQUIRED_PERSONA_CHILDREN,
          observedChildren: probe.validChildren.length,
          children: probe.validChildren.map((child) => ({
            childSessionId: child.childSessionId,
            parentSessionId: child.parentSessionId,
            initModel: child.initModel,
            terminalStatus: child.terminalStatus,
          })),
        }));
      }
    }
  }

  const failed = gates.filter((item) => item.status === 'failed');
  const blockingGateNames = skipLiveProbes
    ? ['cursor_cli', 'harbor_version', 'docker_capacity']
    : [
      'cursor_cli',
      'harbor_version',
      'docker_capacity',
      'cursor_local_auth',
      'composer_stream_probe',
      'persona_child_provenance',
    ];
  const blockingFailures = failed.filter((item) => blockingGateNames.includes(item.name));
  const blockingBlocked = skipLiveProbes
    ? []
    : gates.filter(
      (item) =>
        item.status === 'blocked'
        && ['cursor_local_auth', 'composer_stream_probe', 'persona_child_provenance'].includes(item.name),
    );

  const acceptancePassed =
    blockingFailures.length === 0
    && blockingBlocked.length === 0
    && blockingGateNames.every((name) => gates.some((item) => item.name === name && item.status === 'passed'));

  const ticketStatus = skipLiveProbes
    ? 'static_checks_only_not_ticket_complete'
    : acceptancePassed
      ? 'acceptance_criteria_met'
      : 'acceptance_criteria_not_met';

  const report = redactObject({
    kind: 'lb6_pilot_preflight',
    acceptancePassed,
    ticketStatus,
    summary: {
      passed: gates.filter((item) => item.status === 'passed').length,
      failed: failed.length,
      blocked: gates.filter((item) => item.status === 'blocked').length,
    },
    gates,
    binaries: cursorCli.ok
      ? { cursorCli: { path: cursorCli.path, version: cursorCli.version, sha256: cursorCli.sha256 } }
      : { cursorCli: { ok: false, reason: cursorCli.reason } },
    credentials: {
      cursorApiKey: credentialPresence(resolveCursorCredential(fileEnv)),
      harborApiKey: credentialPresence(resolveHarborCredential(fileEnv)),
      source: 'repo_root_env_only',
      workerProcessScrape: false,
    },
    liveProbes: {
      skipped: skipLiveProbes,
      composerProbe: composerProbe
        ? {
            exitCode: composerProbe.exitCode,
            eventCount: composerProbe.eventCount,
            parentModel: composerProbe.analysis.parentModel,
            completedTaskToolCalls: composerProbe.analysis.completedTaskLaunches.length,
            singleSessionStream: composerProbe.analysis.singleSessionStream,
            validChildren: composerProbe.validChildren.length,
          }
        : null,
      personaProvenanceFailure: personaFailureRecord,
    },
  });

  writePreflightReports(root, report, { personaFailureRecord });

  return {
    ok: acceptancePassed,
    report,
    personaFailureRecord,
    exitCode: acceptancePassed ? 0 : 1,
  };
}
