import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { adapterProbe, assertAdapterShape } from './adapter.mjs';
import { createProofBroker, exactGraphdLaunchAuthorized } from './broker.mjs';
import { startCrashWatchdog } from './crash-watchdog-controller.mjs';
import { DEFAULTS, PRODUCTION_TIERS } from './constants.mjs';
import {
  boundedDirectorySize,
  ownedDirectoryIdentity,
  quotaFilesystemUsage,
  removeOwnedDirectory,
} from './filesystem.mjs';
import { LinuxSystemdAdapter } from './linux-systemd.mjs';
import { classifyRemainingDescendants } from './managed-descendants.mjs';
import { PortableProcessGroupAdapter } from './portable-process-group.mjs';
import { preflightRun } from './preflight.mjs';
import { existingLaminaProcesses, signalIdentity } from './processes.mjs';
import {
  baseReport, finishReport, persistReportAuthorityWith, prepareReportAuthority, writeReportWithFallback,
} from './report.mjs';
import { redactEvidence, redactText } from './redaction.mjs';
import {
  assertFrozenWorkloadIdentity, beginSafetyAttempt,
  bindExecutionSnapshotIdentity, checkPromotion, clearSafetyAttempt, recordPromotion, recordSafetyLimit,
} from './state.mjs';
import { sanitizedPayloadEnvironment } from './infrastructure.mjs';
import { lstatPresence } from './managed-paths.mjs';
import { assertExecutionSnapshot, prepareExecutionSnapshot } from './execution-snapshot.mjs';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function errorDetails(error, fallback = 'LAMINA_SAFE_INTERNAL') {
  return {
    code: error?.code || fallback,
    message: redactText(String(error?.message || error)).slice(0, 2_000),
  };
}

function sanitizeReportInPlace(report) {
  const sanitized = redactEvidence(report);
  for (const key of Object.keys(report)) delete report[key];
  Object.assign(report, sanitized);
  return report;
}

export function outcomeForStop(reason) {
  if (reason === 'interrupted') return 'interrupted';
  if (reason === 'internal_error') return 'internal_error';
  return 'safety_limit_exceeded';
}

export function payloadRuntimeTimedOut(payloadStartedMs, nowMs, timeoutMs) {
  if (payloadStartedMs === null) return false;
  if (!Number.isFinite(payloadStartedMs) || !Number.isFinite(nowMs)
    || !Number.isFinite(timeoutMs) || timeoutMs < 0 || nowMs < payloadStartedMs) return true;
  return nowMs - payloadStartedMs >= timeoutMs;
}

export function boundedDiagnosticText(value) {
  return redactText(String(value || ''))
    .replace(/(^|[\s=:('"`])(?:\/[^\s,;'"`)]+|[A-Za-z]:\\[^\s,;'"`)]+)/g, '$1[REDACTED_PATH]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1_000);
}

export function temporaryQuotaHandshakeFailure(childEnded, launcherStderr = '') {
  if (!childEnded) {
    return {
      limit: 'temporary_quota_handshake',
      error: Object.assign(
        new Error('size-limited private tmpfs handshake failed before payload release'),
        { code: 'LAMINA_SAFE_TEMP_QUOTA_UNPROVEN' },
      ),
    };
  }
  const childReason = childEnded.error
    ? `spawn error: ${boundedDiagnosticText(childEnded.error?.message || childEnded.error)}`
    : childEnded.signal
      ? `signal ${boundedDiagnosticText(childEnded.signal)}`
      : `status ${Number.isInteger(childEnded.code) ? childEnded.code : 'unknown'}`;
  const diagnostic = boundedDiagnosticText(launcherStderr);
  return {
    limit: 'sandbox_launch',
    error: Object.assign(new Error(
      `sandbox launcher exited with ${childReason} before private tmpfs readiness${diagnostic ? `: ${diagnostic}` : ''}`,
    ), { code: 'LAMINA_SAFE_SANDBOX_LAUNCH' }),
  };
}

export function recordChildTermination(termination, childEnded) {
  termination.child_exit_code = Number.isInteger(childEnded?.code) ? childEnded.code : null;
  termination.child_signal = typeof childEnded?.signal === 'string' && childEnded.signal
    ? childEnded.signal : null;
  return termination;
}

export async function closeOutputStreams(childStreams, outputStreams, deadlineMs = 1_000) {
  for (const stream of childStreams) stream.resume();
  const closures = outputStreams.map((stream) => stream.closed
    ? Promise.resolve() : once(stream, 'close').catch(() => null));
  for (const stream of outputStreams) {
    try { stream.end(); } catch {}
  }
  const closed = await Promise.race([
    Promise.all(closures).then(() => true),
    wait(deadlineMs).then(() => false),
  ]);
  if (!closed) {
    for (const stream of [...childStreams, ...outputStreams]) {
      try { stream.destroy(); } catch {}
    }
  }
  return closed;
}

export async function waitForChildResult(childResult, deadlineMs, {
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let deadlineTimer = null;
  try {
    return await Promise.race([
      childResult,
      new Promise((resolve) => {
        deadlineTimer = schedule(() => resolve({ controllerDeadline: true }), deadlineMs);
      }),
    ]);
  } finally {
    if (deadlineTimer !== null) cancel(deadlineTimer);
  }
}

export async function releaseFifo(file, deadlineMs = 1_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    let descriptor = null;
    try {
      const named = fs.lstatSync(file, { bigint: true });
      if (!named.isFIFO() || named.isSymbolicLink()) throw new Error('release path is not a physical FIFO');
      descriptor = fs.openSync(file,
        fs.constants.O_WRONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
      const opened = fs.fstatSync(descriptor, { bigint: true });
      if (!opened.isFIFO() || opened.dev !== named.dev || opened.ino !== named.ino
        || opened.uid !== named.uid) throw new Error('release FIFO identity changed while opening');
      fs.writeSync(descriptor, 'release\n');
      return true;
    } catch (error) {
      if (error?.code !== 'ENXIO' && error?.code !== 'ENOENT') {
        const refused = new Error(`safe-runner release FIFO refused: ${error.message}`);
        refused.code = 'LAMINA_SAFE_RELEASE_FIFO';
        throw refused;
      }
    } finally { if (descriptor !== null) fs.closeSync(descriptor); }
    await wait(10);
  }
  const error = new Error('safe-runner release FIFO had no live reader before deadline');
  error.code = 'LAMINA_SAFE_RELEASE_FIFO';
  throw error;
}

function cgroupResolutionDiagnostic(value) {
  if (!value) return null;
  return {
    ok: value.ok === true,
    source: value.source || null,
    status: Number.isInteger(value.status) ? value.status : null,
    signal: value.signal || null,
    error_code: value.error_code || null,
    error_message: boundedDiagnosticText(value.error_message),
    stderr: boundedDiagnosticText(value.stderr),
    control_group_present: value.control_group_present === true,
    path_exists: value.path_exists === true,
  };
}

function controllerReadbackDiagnostic(value) {
  if (!value) return null;
  return {
    ok: value.ok === true,
    reason: value.reason || null,
    actual: value.actual || null,
    expected: value.expected || null,
  };
}

function appendTail(previous, chunk, maximum) {
  const combined = Buffer.concat([Buffer.from(previous), Buffer.from(chunk)]);
  return redactText(combined.subarray(Math.max(0, combined.length - maximum)).toString('utf8'));
}

function appendRawTail(previous, chunk, maximum) {
  const combined = Buffer.concat([Buffer.from(previous), Buffer.from(chunk)]);
  return combined.subarray(Math.max(0, combined.length - maximum)).toString('utf8');
}

function rememberDescendants(report, records, elapsedMs) {
  const known = new Map(report.descendants.map((item) => [
    `${item.pid}:${item.start_ticks || ''}`,
    item,
  ]));
  for (const record of records || []) {
    const key = `${record.pid}:${record.start_ticks || ''}`;
    const existing = known.get(key);
    known.set(key, {
      pid: record.pid,
      ppid: record.ppid,
      start_ticks: record.start_ticks,
      command: redactText(record.command),
      first_seen_ms: existing?.first_seen_ms ?? elapsedMs,
      last_seen_ms: elapsedMs,
      peak_rss_bytes: Math.max(existing?.peak_rss_bytes || 0, record.rss_bytes || 0),
    });
  }
  report.descendants = [...known.values()]
    .sort((left, right) => left.pid - right.pid)
    .slice(-DEFAULTS.maxDescendants);
}

function adapterFor(probe, runId, limits) {
  return probe.production_enforcement
    ? new LinuxSystemdAdapter({ runId, limits, probe })
    : new PortableProcessGroupAdapter();
}

export function reportExitCode(report) {
  if (report.outcome === 'success') return 0;
  if (report.outcome === 'command_failed') return report.termination.child_exit_code || 1;
  if (report.outcome === 'interrupted') return 130;
  return 2;
}

export async function runSafely({
  command,
  tier = 'small',
  cwd = process.cwd(),
  reportFile = null,
  overrides = {},
  env = {},
  mode = 'run',
  selfTestCaseId = null,
  promote = false,
  workloadId = null,
  _testCrashBoundary = null,
  _testCrashMarkerFile = null,
  _testBeforeQuotaRelease = null,
  _testAfterFinalIdentityCheck = null,
  _testPhaseFile = null,
  _testCrashProgressFile = null,
  _testAfterWatchdogStartedDelayMs = 0,
} = {}) {
  const startedMs = Date.now();
  const normalizedCommand = Array.isArray(command) ? command : [];
  const report = baseReport({ tier, command: normalizedCommand, cwd: path.resolve(cwd) });
  let probe = null;
  let lock = null;
  let temporaryDirectory = null;
  let temporaryDirectoryIdentity = null;
  let reportAuthority = null;
  let payloadTemporaryDirectory = null;
  let monitor = null;
  let forceTimer = null;
  let activeAdapter = null;
  let stopping = false;
  let highSamples = 0;
  let previousHighEvents = 0;
  let retainedOutputBytes = 0;
  let launched = false;
  let payloadExitObserved = false;
  let payloadStartedMs = null;
  let managedCleanupStartedMs = null;
  let proofBroker = null;
  let crashWatchdog = null;
  let quotaProven = false;
  let observedSafetyLimit = null;
  let activeAttempt = null;
  let executionCommand = normalizedCommand;
  let launchCommand = normalizedCommand;
  let executionSnapshot = null;
  let launcherStderrTail = '';
  let launchChildState = { ended: false, code: null, signal: null, error: null };
  let scopeHandshakeDiagnostic = null;
  let lastTemporary = { bytes: 0, entries: 0, exceeded: false };
  const managedRegistrations = [];
  const managedReservations = [];
  const managedCleanupPaths = new Set();
  const outputStreams = [];
  const childStreams = [];
  const signalHandlers = new Map();
  const infrastructureIdentities = () => report.preflight?.scope_proof?.infrastructure_identities || [];
  const tracePhase = (phase) => {
    if (!_testPhaseFile) return;
    try { fs.appendFileSync(_testPhaseFile, `${phase}\n`, { mode: 0o600 }); } catch {}
  };
  const crashBoundary = (name) => {
    if (_testCrashBoundary !== name || !_testCrashMarkerFile
      || (name !== 'report_slot_acquired' && !activeAdapter?.production_enforcement)) return;
    fs.writeFileSync(_testCrashMarkerFile, `${JSON.stringify({
      boundary: name, controller_pid: process.pid, unit: activeAdapter?.unit || null,
      cgroup: activeAdapter?.cgroupPath || null, temporary_directory: temporaryDirectory,
      watchdog_directory: crashWatchdog?.directory || null, lock_file: lock?.file || null,
      watchdog_process: crashWatchdog?.identity || null,
    })}\n`, { flag: 'wx', mode: 0o600 });
    if (name === 'payload_released') return;
    // Deterministic external-controller SIGKILL point. This cannot authorize,
    // weaken, or release a workload; it only pauses the controller test fixture.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
  };
  const workloadPids = (measured) => {
    const ignored = new Set(infrastructureIdentities().map((identity) =>
      `${identity.pid}:${identity.start_ticks}`));
    const records = new Map((measured?.records || []).map((record) => [record.pid, record]));
    return (measured?.pids || []).filter((pid) => {
      const record = records.get(pid);
      return !record || !ignored.has(`${record.pid}:${record.start_ticks}`);
    });
  };

  const requestStop = (reason, limit = null) => {
    if (reason === 'safety_limit_exceeded' && observedSafetyLimit === null) {
      observedSafetyLimit = limit;
      crashBoundary('after_limit_observed');
    }
    if (stopping) return;
    stopping = true;
    report.termination.reason = reason;
    report.termination.limit = limit;
    report.outcome = outcomeForStop(reason);
    report.termination.requested_signals.push('SIGTERM');
    try { activeAdapter?.signal('SIGTERM'); } catch (error) {
      report.cleanup.errors.push(`SIGTERM: ${error.message}`);
    }
    forceTimer = setTimeout(() => {
      try {
        if ((activeAdapter?.sample()?.pids || []).length === 0) return;
        report.termination.requested_signals.push('SIGKILL');
        activeAdapter?.signal('SIGKILL');
      } catch (error) {
        report.cleanup.errors.push(`SIGKILL: ${error.message}`);
      }
    }, report.limits?.graceful_stop_ms || DEFAULTS.gracefulStopMs);
  };

  const beginManagedCleanup = (classification) => {
    if (managedCleanupStartedMs !== null) return;
    managedCleanupStartedMs = Date.now();
    report.preflight.managed_descendant_cleanup = {
      role: 'graphd',
      registered_roots: classification.roots.map((record) => record.pid),
      descendants: classification.records.map((record) => record.pid),
      requested_signal: 'SIGTERM',
    };
    if (!report.termination.requested_signals.includes('SIGTERM')) {
      report.termination.requested_signals.push('SIGTERM');
    }
    for (const root of classification.roots) {
      if (root.managed_socket) managedCleanupPaths.add(root.managed_socket);
      if (root.managed_lock) managedCleanupPaths.add(root.managed_lock);
      try {
        signalIdentity({ pid: root.pid, start_ticks: root.start_ticks }, 'SIGTERM');
      } catch (error) {
        report.cleanup.errors.push(`managed graphd SIGTERM: ${error.message}`);
        requestStop('safety_limit_exceeded', 'managed_descendant_cleanup');
      }
    }
  };

  const sample = () => {
    if (!activeAdapter || !temporaryDirectory) return null;
    const nowMs = Date.now();
    const elapsed = nowMs - startedMs;
    const measured = activeAdapter.sample();
    let temporary = null;
    if (activeAdapter.production_enforcement && quotaProven) {
      temporary = quotaFilesystemUsage(
        measured.records,
        payloadTemporaryDirectory,
        report.limits.temporary_max_bytes,
        report.limits.temporary_max_inodes,
      );
    } else if (!activeAdapter.production_enforcement) {
      temporary = boundedDirectorySize(
        payloadTemporaryDirectory,
        report.limits.temporary_max_bytes,
        report.limits.temporary_max_inodes,
      );
    }
    if (temporary) lastTemporary = temporary;
    temporary = temporary || lastTemporary;
    const aggregateRss = measured.aggregateRssBytes ?? (measured.records || [])
      .reduce((sum, record) => sum + (record.rss_bytes || 0), 0);
    const cgroupMemory = measured.cgroupMemoryCurrentBytes ?? measured.aggregateRssBytes ?? 0;
    const cgroupPeak = Math.max(cgroupMemory, measured.cgroupMemoryPeakBytes || 0);
    report.peaks.aggregate_rss_bytes = Math.max(report.peaks.aggregate_rss_bytes, aggregateRss);
    report.peaks.cgroup_memory_bytes = Math.max(report.peaks.cgroup_memory_bytes, cgroupPeak);
    const taskCount = measured.taskCount ?? measured.pids?.length ?? 0;
    report.peaks.pids = Math.max(report.peaks.pids, taskCount);
    report.peaks.temporary_bytes = Math.max(report.peaks.temporary_bytes, temporary.bytes);
    report.peaks.temporary_inodes = Math.max(report.peaks.temporary_inodes, temporary.entries);
    rememberDescendants(report, measured.records, elapsed);
    report.termination.cgroup_events = measured.events || {};
    report.samples.push({
      elapsed_ms: elapsed,
      aggregate_rss_bytes: aggregateRss,
      cgroup_memory_bytes: cgroupMemory,
      pids: taskCount,
      temporary_bytes: temporary.bytes,
      temporary_inodes: temporary.entries,
    });
    if (report.samples.length > DEFAULTS.maxSamples) report.samples.shift();
    if ((measured.events?.memory?.oom_kill || 0) > 0
      || (measured.events?.memory?.max || 0) > 0
      || cgroupMemory >= report.limits.memory_max_bytes) {
      requestStop('safety_limit_exceeded', 'memory');
    }
    if ((measured.events?.pids?.max || 0) > 0 || taskCount > report.limits.pids_max) {
      requestStop('safety_limit_exceeded', 'pids');
    }
    if (temporary.exceeded) {
      const temporaryLimit = temporary.reason === 'inodes'
        ? 'temporary_inodes'
        : temporary.reason === 'symlink' ? 'temporary_symlink' : 'temporary_disk';
      requestStop('safety_limit_exceeded', temporaryLimit);
    }
    const highEvents = measured.events?.memory?.high || 0;
    const newHighEvents = Math.max(0, highEvents - previousHighEvents);
    previousHighEvents = highEvents;
    if (cgroupMemory >= report.limits.memory_high_bytes) {
      highSamples += 1;
    } else if (newHighEvents > 0) {
      // memory.events:high counts kernel throttling/reclaim attempts. Multiple
      // events are stronger evidence of sustained pressure than a point-in-time
      // userspace sample, which may observe memory.current after reclaim.
      highSamples += Math.min(newHighEvents, report.limits.sustained_high_samples);
    } else {
      highSamples = 0;
    }
    if (highSamples >= report.limits.sustained_high_samples) {
      requestStop('safety_limit_exceeded', 'sustained_high_memory');
    }
    if (payloadRuntimeTimedOut(payloadStartedMs, nowMs, report.limits.timeout_ms)) {
      requestStop('safety_limit_exceeded', 'timeout');
    }
    return measured;
  };

  const finishAndWrite = () => {
    finishReport(report, startedMs);
    const written = writeReportWithFallback(reportFile, report, reportAuthority);
    Object.defineProperty(report, 'writtenReport', { value: written, enumerable: false });
    return sanitizeReportInPlace(report);
  };

  try {
    if (!reportFile) {
      report.outcome = 'preflight_refused';
      report.termination.reason = 'preflight_refused';
      report.error = { code: 'LAMINA_SAFE_REPORT_REQUIRED', message: '--report is mandatory' };
      report.preflight = { ok: false, reasons: [report.error.message] };
      return finishAndWrite();
    }
    const provisional = structuredClone(report);
    provisional.report_file = path.resolve(reportFile);
    provisional.outcome = 'internal_error';
    provisional.termination.reason = 'run_in_progress';
    provisional.error = {
      code: 'LAMINA_SAFE_RUN_IN_PROGRESS',
      message: 'payload has not completed; this provisional report cannot be used as success evidence',
    };
    finishReport(provisional, startedMs);
    reportAuthority = prepareReportAuthority(reportFile, provisional);
    tracePhase('prepare:report-slot-acquired');
    crashBoundary('report_slot_acquired');
    const resolvedCwd = path.resolve(cwd);
    if (reportAuthority.parent === resolvedCwd
      || resolvedCwd.startsWith(`${reportAuthority.parent}${path.sep}`)) {
      throw Object.assign(new Error('report authority parent must not contain the writable payload cwd'), {
        code: 'LAMINA_SAFE_REPORT_AUTHORITY',
      });
    }
    // The reusable API is a safety boundary too: callers cannot attest one
    // adapter while launching another through injected objects.
    probe = adapterProbe();
    tracePhase('prepare:adapter-probed');
    const preflight = preflightRun({
      tier,
      command: normalizedCommand,
      cwd,
      overrides,
      adapterInfo: probe,
      mode,
      selfTestCaseId,
      workloadId,
      promotionRequested: promote,
    });
    report.adapter = probe;
    report.limits = preflight.envelope.limits;
    report.preflight = preflight;
    executionCommand = preflight.execution_command || normalizedCommand;
    tracePhase('prepare:preflight-complete');
    if (!preflight.ok) {
      report.outcome = 'preflight_refused';
      report.termination.reason = 'preflight_refused';
      report.error = { code: 'LAMINA_SAFE_PREFLIGHT', message: preflight.reasons.join('; ') };
      return finishAndWrite();
    }

    activeAdapter = assertAdapterShape(adapterFor(probe, report.run_id, report.limits));
    const crashLockSelfTest = activeAdapter.production_enforcement
      && ((mode === 'self-test' && selfTestCaseId === 'parent_signal')
        || Boolean(_testCrashBoundary));
    if (activeAdapter.production_enforcement) {
      crashWatchdog = await startCrashWatchdog({
        report,
        reportFile,
        adapter: activeAdapter,
        reportAuthority,
        acquireLock: PRODUCTION_TIERS.has(tier) || crashLockSelfTest,
        testCrashBoundary: _testCrashBoundary,
        testCrashMarkerFile: _testCrashMarkerFile,
      });
      temporaryDirectory = crashWatchdog.temporaryDirectory;
      temporaryDirectoryIdentity = crashWatchdog.temporaryDirectoryIdentity;
      payloadTemporaryDirectory = crashWatchdog.payloadTemporaryDirectory;
      lock = crashWatchdog.lock;
      persistReportAuthorityWith(reportAuthority, (nextAuthority) => {
        crashWatchdog?.update({ report_authority: nextAuthority });
      });
      if (_testCrashProgressFile) {
        fs.writeFileSync(_testCrashProgressFile, `${JSON.stringify({
          controller_pid: process.pid,
          watchdog_process: crashWatchdog.identity,
          unit: activeAdapter.unit,
          temporary_directory: crashWatchdog.temporaryDirectory,
          watchdog_directory: crashWatchdog.directory,
          lock_file: lock?.file || null,
        })}\n`, { flag: 'wx', mode: 0o600 });
      }
      if (Number.isSafeInteger(_testAfterWatchdogStartedDelayMs)
        && _testAfterWatchdogStartedDelayMs > 0) {
        await wait(Math.min(_testAfterWatchdogStartedDelayMs, 60_000));
      }
      tracePhase('prepare:watchdog-started');
    } else {
      temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-'));
      fs.chmodSync(temporaryDirectory, 0o700);
      temporaryDirectoryIdentity = ownedDirectoryIdentity(temporaryDirectory);
      payloadTemporaryDirectory = path.join(temporaryDirectory, 'payload-tmp');
      fs.mkdirSync(payloadTemporaryDirectory, { mode: 0o700 });
    }
    if (lock) {
      const rescanned = existingLaminaProcesses();
      report.preflight.post_lock_existing_lamina_processes = rescanned;
      if (rescanned.length) {
        report.outcome = 'preflight_refused';
        report.termination.reason = 'preflight_refused';
        report.error = {
          code: 'LAMINA_SAFE_EXISTING_PROCESS',
          message: `Lamina processes appeared after reservation: ${rescanned.map((item) => item.pid).join(', ')}`,
        };
        throw Object.assign(new Error(report.error.message), { safeEarly: true });
      }
    }
    if (activeAdapter.production_enforcement) {
      let snapshotProgressObserved = false;
      executionSnapshot = prepareExecutionSnapshot({
        cwd: path.resolve(cwd), command: executionCommand, temporaryDirectory,
        infrastructure: activeAdapter.infrastructure,
        environment: { ...process.env, ...env },
        expectedRetrievalAuthority: preflight.retrieval_authority,
        onProgress() {
          if (snapshotProgressObserved) return;
          snapshotProgressObserved = true;
          crashBoundary('snapshot_building');
        },
      });
      launchCommand = executionSnapshot.launch_command;
      if (preflight.source_identity) {
        assertFrozenWorkloadIdentity(preflight.source_identity, cwd, executionCommand);
      }
      report.preflight.execution_snapshot = {
        schema: 'lamina.safe-runner-execution-snapshot/v1',
        digest: executionSnapshot.digest,
        file_count: executionSnapshot.file_count,
        total_bytes: executionSnapshot.total_bytes,
        snapshot_roots: [executionSnapshot.snapshot_repository,
          ...(executionSnapshot.git_readonly_bindings || []).map((binding) => binding.source)],
        writable_roots: executionSnapshot.writable_bindings.map((binding) => binding.source),
      };
      if (preflight.source_identity) {
        report.preflight.execution_identity = bindExecutionSnapshotIdentity(
          preflight.source_identity, executionSnapshot.digest,
        );
        const sealedPromotion = checkPromotion(cwd, tier, workloadId, executionCommand,
          report.preflight.execution_identity);
        report.preflight.promotion = {
          ...sealedPromotion, deferred_to_execution_snapshot: false,
        };
        if (PRODUCTION_TIERS.has(tier) && !sealedPromotion.ok) {
          report.outcome = 'preflight_refused';
          report.termination.reason = 'preflight_refused';
          report.error = {
            code: 'LAMINA_SAFE_PROMOTION_IDENTITY',
            message: `tier promotion requires the same sealed launch authority for: ${sealedPromotion.missing.join(', ')}`,
          };
          throw Object.assign(new Error(report.error.message), { safeEarly: true });
        }
      }
    }
    const authority = {
      runId: report.run_id,
      tier,
      adapter: activeAdapter.id,
      unit: activeAdapter.unit || null,
      cgroup: null,
      enforcement: null,
      registrations: managedRegistrations,
      reservations: managedReservations,
      records: () => activeAdapter?.sample()?.records || [],
      graphdLaunchAuthorized(child, reservation) {
        return exactGraphdLaunchAuthorized(child, reservation,
          executionSnapshot?.graphd_launch_authority || []);
      },
      beforeBind() {
        // The graphd process exists but is still held behind its broker start
        // gate, so a controller crash cannot leave canonical runtime objects.
        crashBoundary('graphd_spawned');
      },
      reserve(record) {
        const paths = crashWatchdog?.reserveManagedPaths(record);
        if (!paths) return null;
        managedCleanupPaths.add(record.socket);
        managedCleanupPaths.add(record.lock);
        const reservation = { ...record, paths };
        managedReservations.push(reservation);
        crashBoundary('graphd_reserved');
        return reservation;
      },
      bind(record) {
        const reservation = managedReservations.find((item) => item.token === record.reservation);
        if (!reservation || !crashWatchdog?.bindManagedPaths(
          reservation.paths, [record.pid, record.namespace_pid],
        )) return false;
        reservation.bound = {
          pid: record.pid, namespace_pid: record.namespace_pid, start_ticks: record.start_ticks,
        };
        managedCleanupPaths.add(record.socket);
        managedCleanupPaths.add(record.lock);
        if (!managedRegistrations.some((item) => item.pid === record.pid
          && item.start_ticks === record.start_ticks)) {
          managedRegistrations.push({
            pid: record.pid,
            start_ticks: record.start_ticks,
            role: 'graphd',
            socket: record.socket,
            lock: record.lock,
          });
        }
        crashBoundary('graphd_bound');
        return true;
      },
      release(record) {
        const reservation = managedReservations.find((item) => item.token === record.reservation);
        if (!reservation?.bound) return false;
        if (!reservation.released) {
          if (!crashWatchdog?.authorizeManagedPaths(reservation.paths)) return false;
          reservation.released = true;
          crashBoundary('graphd_authorized');
        }
        return true;
      },
      lockReady(record) {
        const reservation = managedReservations.find((item) => item.token === record.reservation);
        if (!reservation?.released) return false;
        crashBoundary('graphd_lock_created');
        return true;
      },
      seal(record) {
        const reservation = managedReservations.find((item) => item.token === record.reservation);
        if (!reservation?.bound || !reservation.released) return false;
        crashBoundary('graphd_objects_ready');
        if (!crashWatchdog?.sealManagedPaths(reservation.paths)) return false;
        reservation.sealed = true;
        crashBoundary('graphd_sealed');
        return crashWatchdog.managedPaths()
          .filter((item) => reservation.paths.some((candidate) => candidate.path === item.path));
      },
    };
    proofBroker = activeAdapter.production_enforcement
      ? await createProofBroker(temporaryDirectory, authority)
      : { environment: {}, async close() {} };
    tracePhase('prepare:broker-started');
    const readyFile = path.join(temporaryDirectory, 'scope.ready');
    const releaseFile = path.join(temporaryDirectory, 'scope.release');
    const payloadExitFile = path.join(temporaryDirectory, 'payload.exit');
    const quotaReadyFile = path.join(temporaryDirectory, 'quota.ready');
    const quotaReleaseFile = path.join(temporaryDirectory, 'quota.release');

    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => requestStop('interrupted', 'signal');
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    if (!activeAdapter.production_enforcement) payloadStartedMs = Date.now();
    const child = activeAdapter.launch({
      command: launchCommand,
      cwd: path.resolve(cwd),
      readyFile,
      releaseFile,
      payloadExitFile,
      quotaReadyFile,
      quotaReleaseFile,
      temporaryDirectory: payloadTemporaryDirectory,
      executionAuthority: executionSnapshot,
      env: sanitizedPayloadEnvironment({
        sources: [process.env, env, {
          ...proofBroker.environment,
          TMPDIR: payloadTemporaryDirectory,
          TMP: payloadTemporaryDirectory,
          TEMP: payloadTemporaryDirectory,
          LAMINA_SAFE_RUNNER: '1',
          LAMINA_SAFE_RUNNER_TEMP: payloadTemporaryDirectory,
          LAMINA_SAFE_RUNNER_TEMP_DIR: payloadTemporaryDirectory,
          LAMINA_SAFE_RUNNER_ALLOW_NETWORK:
            preflight.ownership.network_access === 'audited-required' ? '1' : '0',
          LAMINA_SAFE_REPORT_FILE: path.resolve(reportFile),
          LAMINA_SAFE_REPORT_PARENT: reportAuthority?.parent || '',
        }],
        mode,
        auditedEntrypoint: preflight.ownership.audited_entrypoint,
        sealedOverrides: executionSnapshot?.environment_overrides || {},
      }),
    });
    launched = true;
    tracePhase('launch:wrapper-started');
    let childEnded = null;
    const childResult = new Promise((resolve) => {
      let settled = false;
      child.once('error', (error) => {
        if (!settled) {
          launchChildState = {
            ended: true,
            code: null,
            signal: null,
            error: boundedDiagnosticText(error?.message || error),
          };
          resolve(childEnded = { error });
        }
        settled = true;
      });
      child.once('close', (code, signal) => {
        if (!settled) {
          launchChildState = { ended: true, code: code ?? null, signal: signal || null, error: null };
          resolve(childEnded = { code, signal });
        }
        settled = true;
      });
    });

    const attachOutput = (stream, file, key) => {
      if (!stream) return;
      childStreams.push(stream);
      const sink = fs.createWriteStream(file, { flags: 'wx', mode: 0o600, highWaterMark: 32 * 1024 });
      outputStreams.push(sink);
      sink.on('error', (error) => {
        report.cleanup.errors.push(`${key} output: ${error.message}`);
        requestStop('safety_limit_exceeded', 'output_io');
      });
      stream.on('data', (chunk) => {
        const value = Buffer.from(chunk);
        if (key === 'stderr') {
          launcherStderrTail = appendRawTail(
            launcherStderrTail,
            value,
            DEFAULTS.diagnosticTailBytes,
          );
        }
        report.output[`${key}_bytes`] += value.length;
        report.output.total_bytes += value.length;
        const remaining = Math.max(0, report.limits.output_max_bytes - retainedOutputBytes);
        const retained = value.subarray(0, remaining);
        if (retained.length > 0 && !stopping) {
          retainedOutputBytes += retained.length;
          report.output[`${key}_tail`] = appendTail(
            report.output[`${key}_tail`], retained, DEFAULTS.diagnosticTailBytes,
          );
          if (!sink.write(retained)) {
            stream.pause();
            // Even after a stop request, the wrapper pipe must be drained so
            // Node can observe its close event. Excess bytes are discarded.
            sink.once('drain', () => stream.resume());
          }
        }
        if (retained.length < value.length || report.output.total_bytes > report.limits.output_max_bytes) {
          report.output.truncated = true;
          requestStop('safety_limit_exceeded', 'output');
        }
      });
    };
    attachOutput(child.stdout, path.join(temporaryDirectory, 'stdout.log'), 'stdout');
    attachOutput(child.stderr, path.join(temporaryDirectory, 'stderr.log'), 'stderr');

    if (activeAdapter.id === 'linux-systemd-cgroup-v2') {
      const deadline = Date.now() + DEFAULTS.scopeHandshakeMs;
      let attempts = 0;
      let lastEnforcement = null;
      while (Date.now() < deadline && !childEnded) {
        attempts += 1;
        const ready = fs.existsSync(readyFile);
        const cgroup = activeAdapter.resolveCgroup();
        if (ready && cgroup) {
          const proof = activeAdapter.sample();
          const enforcement = activeAdapter.enforcementProof();
          lastEnforcement = enforcement;
          let gatePid = null;
          try { gatePid = Number(JSON.parse(fs.readFileSync(readyFile, 'utf8')).pid); } catch {}
          if (gatePid && proof.pids.includes(gatePid) && enforcement.ok) {
            report.preflight.scope_proof = {
              cgroup: activeAdapter.cgroupPath,
              gate_pids: proof.pids,
              gate_pid: gatePid,
              infrastructure_identities: proof.records
                .map((record) => ({ pid: record.pid, start_ticks: record.start_ticks })),
              aggregate_rss_bytes: proof.aggregateRssBytes,
              cgroup_memory_bytes: proof.cgroupMemoryCurrentBytes,
              production_enforcement: true,
              controller_readback: enforcement,
            };
            authority.cgroup = activeAdapter.cgroupPath;
            authority.enforcement = enforcement.actual;
            lock?.updateScope({
              adapter: activeAdapter.id,
              unit: activeAdapter.unit,
              cgroup: activeAdapter.cgroupPath,
            });
            rememberDescendants(report, proof.records, Date.now() - startedMs);
            sample();
            crashWatchdog?.update({
              cgroup: activeAdapter.cgroupPath,
              lock_identity: lock?.identity?.() || null,
              report_seed: report,
              armed: false,
            });
            break;
          }
        }
        await wait(20);
      }
      if (!report.preflight.scope_proof) {
        lastEnforcement ||= activeAdapter.enforcementProof();
        scopeHandshakeDiagnostic = {
          attempts,
          elapsed_ms: Date.now() - (deadline - DEFAULTS.scopeHandshakeMs),
          ready_file: fs.existsSync(readyFile),
          child: launchChildState,
          resolve_cgroup: cgroupResolutionDiagnostic(activeAdapter.lastCgroupResolution),
          controller_readback: controllerReadbackDiagnostic(lastEnforcement),
          systemd_stderr: '',
        };
        report.preflight.enforcement_handshake_diagnostic = scopeHandshakeDiagnostic;
        requestStop('internal_error', 'enforcement_handshake');
        throw Object.assign(
          new Error(childEnded?.error?.message || 'systemd cgroup ownership handshake failed before payload release'),
          { code: 'LAMINA_SAFE_ENFORCEMENT_UNPROVEN' },
        );
      }
      monitor = setInterval(() => {
        if (!payloadExitObserved && fs.existsSync(payloadExitFile)) {
          payloadExitObserved = true;
          const measured = activeAdapter.sample();
          const classification = classifyRemainingDescendants(
            managedRegistrations,
            measured.records,
            infrastructureIdentities(),
          );
          if (classification.kind === 'managed_graphd') {
            beginManagedCleanup(classification);
          } else if (classification.kind === 'unmanaged') {
            report.preflight.detached_descendant_observation = {
              pids: classification.records.map((record) => record.pid),
              registered_roots: classification.roots.map((record) => record.pid),
              unmanaged: (classification.unmanaged || classification.records)
                .map((record) => ({
                  pid: record.pid,
                  ppid: record.ppid,
                  start_ticks: record.start_ticks,
                  command: record.command,
                })),
            };
            requestStop('safety_limit_exceeded', 'detached_descendant');
          }
        }
        if (!stopping && managedCleanupStartedMs !== null
          && Date.now() - managedCleanupStartedMs >= report.limits.graceful_stop_ms) {
          const measured = activeAdapter.sample();
          if (workloadPids(measured).length) {
            requestStop('safety_limit_exceeded', 'managed_descendant_cleanup');
          }
        }
        sample();
      }, report.limits.sample_interval_ms);
      if (preflight.source_identity) {
        assertFrozenWorkloadIdentity(preflight.source_identity, cwd, executionCommand);
      }
      if (mode !== 'self-test' && preflight.source_identity) {
        activeAttempt = beginSafetyAttempt(cwd, preflight.source_identity, report);
        crashWatchdog?.update({ active_attempt: activeAttempt, report_seed: report });
      }
      await releaseFifo(releaseFile);
      const quotaDeadline = Date.now() + DEFAULTS.scopeHandshakeMs;
      let quotaProof = null;
      while (Date.now() < quotaDeadline && !childEnded) {
        try {
          const value = JSON.parse(fs.readFileSync(quotaReadyFile, 'utf8'));
          const totalBytes = Number(value.block_size) * Number(value.blocks);
          if (value.filesystem_type === 'tmpfs'
            && Number.isSafeInteger(totalBytes)
            && totalBytes > 0
            && totalBytes <= report.limits.temporary_max_bytes + Number(value.block_size)) {
            quotaProof = { ...value, total_bytes: totalBytes, production_enforcement: true };
            break;
          }
        } catch {}
        await wait(20);
      }
      if (!quotaProof) {
        const failure = temporaryQuotaHandshakeFailure(childEnded, launcherStderrTail);
        recordChildTermination(report.termination, childEnded);
        requestStop('internal_error', failure.limit);
        throw failure.error;
      }
      report.preflight.temporary_quota_proof = quotaProof;
      quotaProven = true;
      tracePhase('launch:quota-proven');
      report.preflight.scope_proof.infrastructure_identities = activeAdapter.sample().records
        .map((record) => ({ pid: record.pid, start_ticks: record.start_ticks }));
      if (typeof _testBeforeQuotaRelease === 'function') await _testBeforeQuotaRelease();
      if (preflight.source_identity) {
        assertFrozenWorkloadIdentity(preflight.source_identity, cwd, executionCommand);
      }
      if (executionSnapshot) assertExecutionSnapshot(executionSnapshot);
      tracePhase('launch:final-identity-checked');
      if (typeof _testAfterFinalIdentityCheck === 'function') {
        await _testAfterFinalIdentityCheck();
      }
      crashBoundary('before_payload_release');
      payloadStartedMs = Date.now();
      await releaseFifo(quotaReleaseFile);
      crashWatchdog?.update({ report_seed: report, armed: true });
      crashBoundary('payload_released');
      tracePhase('launch:payload-released');
    } else {
      report.preflight.scope_proof = {
        production_enforcement: false,
        deliberately_tiny_self_test: true,
        adapter: activeAdapter.id,
      };
      monitor = setInterval(sample, report.limits.sample_interval_ms);
    }
    sample();
    const controllerDeadlineMs = report.limits.timeout_ms
      + report.limits.graceful_stop_ms + DEFAULTS.scopeHandshakeMs + 5_000;
    const ended = await waitForChildResult(childResult, controllerDeadlineMs);
    tracePhase('run:child-race-settled');
    if (ended.controllerDeadline) {
      requestStop('safety_limit_exceeded', 'controller_deadline');
      throw Object.assign(new Error('controller deadline elapsed before the child exit was observed'), {
        code: 'LAMINA_SAFE_CONTROLLER_DEADLINE',
      });
    }
    recordChildTermination(report.termination, ended);
    if (ended.error) {
      report.outcome = 'internal_error';
      report.termination.reason = 'spawn_failed';
      report.error = errorDetails(ended.error, 'LAMINA_SAFE_SPAWN');
    } else if (!stopping) {
      const measured = sample();
      const classification = classifyRemainingDescendants(
        managedRegistrations,
        measured?.records || [],
        infrastructureIdentities(),
      );
      if (classification.kind === 'managed_graphd') {
        beginManagedCleanup(classification);
        const deadline = Date.now() + report.limits.graceful_stop_ms;
        let remaining = activeAdapter.sample();
        while (Date.now() < deadline && workloadPids(remaining).length) {
          await wait(20);
          remaining = activeAdapter.sample();
        }
        if (workloadPids(remaining).length) {
          requestStop('safety_limit_exceeded', 'managed_descendant_cleanup');
        } else {
          report.outcome = ended.code === 0 ? 'success' : 'command_failed';
          report.termination.reason = ended.code === 0 ? 'completed' : 'command_failed';
          if (ended.code !== 0) {
            report.error = {
              code: 'LAMINA_SAFE_COMMAND_FAILED',
              message: `command exited with status ${ended.code ?? 'unknown'}`,
            };
          }
        }
      } else if (classification.kind !== 'empty') {
        requestStop('safety_limit_exceeded', 'detached_descendant');
      } else {
        report.outcome = ended.code === 0 ? 'success' : 'command_failed';
        report.termination.reason = ended.code === 0 ? 'completed' : 'command_failed';
        if (ended.code !== 0) {
          report.error = {
            code: 'LAMINA_SAFE_COMMAND_FAILED',
            message: `command exited with status ${ended.code ?? 'unknown'}`,
          };
        }
      }
    }
  } catch (error) {
    if (!error.safeEarly) {
      if (report.outcome === 'internal_error' || !stopping) report.outcome = 'internal_error';
      report.termination.reason ||= 'internal_error';
      report.error ||= errorDetails(error);
    }
  } finally {
    tracePhase('finally:start');
    if (monitor) clearInterval(monitor);
    if (forceTimer) clearTimeout(forceTimer);
    report.cleanup.attempted = true;
    if (activeAdapter) {
      try {
        if ((activeAdapter.sample().pids || []).length) {
          activeAdapter.signal('SIGTERM');
          await wait(report.limits?.graceful_stop_ms || DEFAULTS.gracefulStopMs);
          if ((activeAdapter.sample().pids || []).length) {
            if (!report.termination.requested_signals.includes('SIGKILL')) {
              report.termination.requested_signals.push('SIGKILL');
            }
            activeAdapter.signal('SIGKILL');
            await wait(100);
          }
        }
        const cleanup = activeAdapter.cleanup();
        for (const error of cleanup.errors || []) report.cleanup.errors.push(`adapter cleanup: ${error}`);
        report.cleanup.descendants_remaining = cleanup.pids || [];
        report.cleanup.scope_removed = cleanup.removed === true;
      } catch (error) {
        report.cleanup.errors.push(`adapter cleanup: ${error.message}`);
        report.cleanup.scope_removed = false;
      }
    }
    tracePhase('finally:adapter-clean');
    if (proofBroker) {
      try { await proofBroker.close(); } catch (error) {
        report.cleanup.errors.push(`proof broker cleanup: ${error.message}`);
      }
      proofBroker = null;
    }
    tracePhase('finally:broker-closed');
    if (crashWatchdog && report.cleanup.scope_removed === true) {
      try {
        for (const candidate of crashWatchdog.cleanupManagedPaths()) managedCleanupPaths.add(candidate);
      } catch (error) {
        report.cleanup.errors.push(`managed graphd cleanup: ${error.message}`);
      }
    }
    report.cleanup.managed_paths_remaining = [...managedCleanupPaths]
      .filter((candidate) => {
        try { return lstatPresence(candidate).exists; } catch { return true; }
      });
    if (report.cleanup.managed_paths_remaining.length) {
      report.cleanup.errors.push(
        `managed graphd socket/lock remained: ${report.cleanup.managed_paths_remaining.join(', ')}`,
      );
    }
    tracePhase('finally:output-end-requested');
    const outputClosed = await closeOutputStreams(childStreams, outputStreams);
    if (!outputClosed) {
      report.cleanup.errors.push('output cleanup: stream close deadline exceeded');
    }
    tracePhase(outputClosed ? 'finally:output-closed' : 'finally:output-close-timeout');
    if (scopeHandshakeDiagnostic) {
      scopeHandshakeDiagnostic.child = launchChildState;
      scopeHandshakeDiagnostic.systemd_stderr = boundedDiagnosticText(launcherStderrTail);
      if (scopeHandshakeDiagnostic.systemd_stderr
        && report.error?.code === 'LAMINA_SAFE_ENFORCEMENT_UNPROVEN') {
        report.error.message = `${report.error.message}; systemd-run: ${scopeHandshakeDiagnostic.systemd_stderr}`
          .slice(0, 2_000);
      }
    }
    if (temporaryDirectory) {
      try {
        report.cleanup.temporary_directory_removed = removeOwnedDirectory(
          temporaryDirectory, 'lamina-safe-runner-', temporaryDirectoryIdentity,
        );
      } catch (error) {
        report.cleanup.errors.push(`temporary cleanup: ${error.message}`);
        report.cleanup.temporary_directory_removed = false;
      }
    }
    if (lock) {
      try { report.cleanup.lock_released = lock.release(); } catch (error) {
        report.cleanup.errors.push(`lock cleanup: ${error.message}`);
        report.cleanup.lock_released = false;
      }
    }
    tracePhase('finally:complete');
  }

  const cleanupFailed = launched && (
    report.cleanup.descendants_remaining.length > 0
    || report.cleanup.managed_paths_remaining.length > 0
    || report.cleanup.scope_removed !== true
    || report.cleanup.temporary_directory_removed !== true
    || report.cleanup.errors.length > 0
  );
  if (cleanupFailed) {
    report.outcome = 'internal_error';
    report.termination.reason = 'cleanup_incomplete';
    report.error = {
      code: 'LAMINA_SAFE_CLEANUP_INCOMPLETE',
      message: 'runner cleanup was not fully verified; this result cannot be promoted or measured',
    };
  } else if (report.outcome === 'safety_limit_exceeded' && report.error === null) {
    report.error = {
      code: 'LAMINA_SAFE_LIMIT_EXCEEDED',
      message: `safe runner stopped the command at ${report.termination.limit || 'an enforced limit'}`,
    };
  } else if (report.outcome === 'interrupted' && report.error === null) {
    report.error = {
      code: 'LAMINA_SAFE_INTERRUPTED',
      message: 'safe runner received a parent signal and stopped the complete descendant tree',
    };
  }
  finishReport(report, startedMs);
  if (observedSafetyLimit !== null && mode !== 'self-test') {
    try {
      recordSafetyLimit(cwd, executionCommand, report.limits, {
        ...report,
        termination: { ...report.termination, limit: observedSafetyLimit },
      }, report.preflight.source_identity);
    } catch (error) {
      report.outcome = 'internal_error';
      report.termination.reason = 'retry_ledger_failed';
      report.error = errorDetails(error, 'LAMINA_SAFE_RETRY_LEDGER');
    }
  }
  try {
    tracePhase('report:write-start');
    const written = writeReportWithFallback(reportFile, report, reportAuthority);
    Object.defineProperty(report, 'writtenReport', { value: written, enumerable: false });
    if (report.outcome === 'success') crashBoundary('success_report_published');
    if (crashWatchdog) {
      try {
        crashWatchdog.update({ report_seed: report });
        await crashWatchdog.disarm();
        crashWatchdog = null;
      } catch (error) {
        report.outcome = 'internal_error';
        report.termination.reason = 'watchdog_disarm_failed';
        report.error = errorDetails(error, 'LAMINA_SAFE_WATCHDOG_DISARM');
        report.cleanup.errors.push(`watchdog cleanup: ${report.error.message}`);
        writeReportWithFallback(reportFile, report, reportAuthority);
      }
    }
    if (report.outcome === 'success' && promote && written.fallback === false
      && written.path === path.resolve(reportFile)) {
      try {
        recordPromotion(cwd, tier, report, workloadId, executionCommand,
          report.preflight.execution_identity || report.preflight.source_identity);
      } catch (error) {
        report.outcome = 'internal_error';
        report.termination.reason = 'promotion_failed';
        report.error = errorDetails(error, 'LAMINA_SAFE_PROMOTION');
        writeReportWithFallback(reportFile, report, reportAuthority);
      }
    }
    if (activeAttempt && crashWatchdog === null && observedSafetyLimit === null
      && ['success', 'command_failed'].includes(report.outcome)) {
      try { clearSafetyAttempt(cwd, activeAttempt); } catch (error) {
        report.outcome = 'internal_error';
        report.termination.reason = 'retry_ledger_failed';
        report.error = errorDetails(error, 'LAMINA_SAFE_RETRY_LEDGER');
        writeReportWithFallback(reportFile, report, reportAuthority);
      }
    }
    return sanitizeReportInPlace(report);
  } finally {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  }
}
