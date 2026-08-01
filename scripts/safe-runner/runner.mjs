import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { adapterProbe, assertAdapterShape } from './adapter.mjs';
import { createProofBroker } from './broker.mjs';
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
import {
  existingLaminaProcesses, processArguments, processIdentity, processRecord, signalIdentity,
} from './processes.mjs';
import { baseReport, finishReport, writeReportWithFallback } from './report.mjs';
import { redactText } from './redaction.mjs';
import {
  acquireConcurrencyLock,
  clearRunAttempt,
  recordPromotion,
  recordRunAttempt,
  recordSafetyLimit,
} from './state.mjs';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function errorDetails(error, fallback = 'LAMINA_SAFE_INTERNAL') {
  return {
    code: error?.code || fallback,
    message: redactText(String(error?.message || error)).slice(0, 2_000),
  };
}

export function outcomeForStop(reason) {
  if (reason === 'interrupted') return 'interrupted';
  if (reason === 'internal_error') return 'internal_error';
  return 'safety_limit_exceeded';
}

function appendTail(previous, chunk, maximum) {
  const combined = Buffer.concat([Buffer.from(previous), Buffer.from(chunk)]);
  return redactText(combined.subarray(Math.max(0, combined.length - maximum)).toString('utf8'));
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
} = {}) {
  const startedMs = Date.now();
  // Enforcement is selected exclusively from the current host.  Callers may
  // not attest one adapter and launch another through this public entrypoint.
  const probe = adapterProbe();
  const normalizedCommand = Array.isArray(command) ? command : [];
  const report = baseReport({ tier, command: normalizedCommand, cwd: path.resolve(cwd) });
  let lock = null;
  let temporaryDirectory = null;
  let payloadTemporaryDirectory = null;
  let temporaryDirectoryIdentity = null;
  let monitor = null;
  let forceTimer = null;
  let activeAdapter = null;
  let stopping = false;
  let highSamples = 0;
  let previousHighEvents = 0;
  let retainedOutputBytes = 0;
  let launched = false;
  let payloadExitObserved = false;
  let managedCleanupStartedMs = null;
  let proofBroker = null;
  let crashWatchdog = null;
  let quotaProven = false;
  let observedSafetyLimit = null;
  let runAttemptRecorded = false;
  let retryLedgerError = null;
  let retrySignature = null;
  let lastTemporary = { bytes: 0, entries: 0, exceeded: false };
  const managedRegistrations = [];
  const managedCleanupPaths = new Set();
  const outputStreams = [];
  const childStreams = [];
  const signalHandlers = new Map();

  const requestStop = (reason, limit = null) => {
    const firstSafetyLimit = reason === 'safety_limit_exceeded' && observedSafetyLimit === null;
    if (reason === 'safety_limit_exceeded' && observedSafetyLimit === null) {
      observedSafetyLimit = limit;
    }
    if (stopping) return;
    stopping = true;
    report.termination.reason = reason;
    report.termination.limit = limit;
    report.outcome = outcomeForStop(reason);
    if (firstSafetyLimit && mode !== 'self-test') {
      try {
        recordSafetyLimit(cwd, normalizedCommand, report.limits, report, retrySignature);
      } catch (error) {
        retryLedgerError = error;
      }
    }
    crashWatchdog?.update({
      observed_safety_limit: observedSafetyLimit,
      report_seed: structuredClone(report),
    });
    report.termination.requested_signals.push('SIGTERM');
    try { activeAdapter?.signal('SIGTERM'); } catch (error) {
      report.cleanup.errors.push(`SIGTERM: ${error.message}`);
    }
    forceTimer = setTimeout(() => {
      report.termination.requested_signals.push('SIGKILL');
      try { activeAdapter?.signal('SIGKILL'); } catch (error) {
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
    const elapsed = Date.now() - startedMs;
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
    if (elapsed >= report.limits.timeout_ms) requestStop('safety_limit_exceeded', 'timeout');
    return measured;
  };

  const finishAndWrite = () => {
    finishReport(report, startedMs);
    const written = writeReportWithFallback(reportFile, report);
    Object.defineProperty(report, 'writtenReport', { value: written, enumerable: false });
    return report;
  };

  try {
    if (!reportFile) {
      report.outcome = 'preflight_refused';
      report.termination.reason = 'preflight_refused';
      report.error = { code: 'LAMINA_SAFE_REPORT_REQUIRED', message: '--report is mandatory' };
      report.preflight = { ok: false, reasons: [report.error.message] };
      return finishAndWrite();
    }
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
    retrySignature = preflight.retry.signature;
    if (!preflight.ok) {
      report.outcome = 'preflight_refused';
      report.termination.reason = 'preflight_refused';
      report.error = { code: 'LAMINA_SAFE_PREFLIGHT', message: preflight.reasons.join('; ') };
      return finishAndWrite();
    }

    if (PRODUCTION_TIERS.has(tier)) {
      lock = acquireConcurrencyLock();
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

    if (mode !== 'self-test') {
      recordRunAttempt(cwd, normalizedCommand, report.limits, report, retrySignature);
      runAttemptRecorded = true;
    }

    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-'));
    fs.chmodSync(temporaryDirectory, 0o700);
    temporaryDirectoryIdentity = ownedDirectoryIdentity(temporaryDirectory);
    payloadTemporaryDirectory = path.join(temporaryDirectory, 'payload-tmp');
    fs.mkdirSync(payloadTemporaryDirectory, { mode: 0o700 });
    activeAdapter = assertAdapterShape(adapterFor(probe, report.run_id, report.limits));
    crashWatchdog = await startCrashWatchdog({
      report,
      reportFile,
      temporaryDirectory,
      temporaryDirectoryIdentity,
      adapter: activeAdapter,
      lock,
    });
    if (crashWatchdog) {
      report.preflight.crash_watchdog = {
        active: true,
        temporary_directory: crashWatchdog.directory,
      };
      crashWatchdog.update({ report_seed: structuredClone(report) });
    }
    const authority = {
      runId: report.run_id,
      tier,
      adapter: activeAdapter.id,
      unit: activeAdapter.unit || null,
      cgroup: null,
      enforcement: null,
      registrations: managedRegistrations,
      records: () => activeAdapter?.sample()?.records || [],
      arguments: (pid) => processArguments(pid),
      register(record) {
        managedCleanupPaths.add(record.socket);
        managedCleanupPaths.add(record.lock);
        crashWatchdog?.registerManagedPaths(record);
        if (!managedRegistrations.some((item) => item.pid === record.pid
          && item.start_ticks === record.start_ticks)) {
          managedRegistrations.push({
            pid: record.pid,
            start_ticks: record.start_ticks,
            role: 'graphd',
            socket: record.socket,
            lock: record.lock,
            root: record.root,
            runtime_dir: record.runtime_dir,
            runtime_identity: record.runtime_identity,
          });
        }
      },
    };
    proofBroker = activeAdapter.production_enforcement
      ? await createProofBroker(temporaryDirectory, authority)
      : { environment: {}, async close() {} };
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

    const child = activeAdapter.launch({
      command: normalizedCommand,
      cwd: path.resolve(cwd),
      readyFile,
      releaseFile,
      payloadExitFile,
      quotaReadyFile,
      quotaReleaseFile,
      temporaryDirectory: payloadTemporaryDirectory,
      env: {
        ...process.env,
        ...env,
        ...proofBroker.environment,
        TMPDIR: payloadTemporaryDirectory,
        TMP: payloadTemporaryDirectory,
        TEMP: payloadTemporaryDirectory,
        LAMINA_SAFE_RUNNER: '1',
        LAMINA_SAFE_RUNNER_TEMP: payloadTemporaryDirectory,
        LAMINA_SAFE_RUNNER_TEMP_DIR: payloadTemporaryDirectory,
        LAMINA_SAFE_RUNNER_CONTROLLER_PID: String(process.pid),
      },
    });
    const launchedRecord = processRecord(child.pid);
    crashWatchdog?.update({
      payload: processIdentity(child.pid),
      payload_process_group: activeAdapter.id === 'portable-process-group-small-only'
        && launchedRecord?.process_group === child.pid ? child.pid : null,
      report_seed: structuredClone(report),
    });
    launched = true;
    let childEnded = null;
    const childResult = new Promise((resolve) => {
      let settled = false;
      child.once('error', (error) => {
        if (!settled) resolve(childEnded = { error });
        settled = true;
      });
      child.once('close', (code, signal) => {
        if (!settled) resolve(childEnded = { code, signal });
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
        report.output[`${key}_bytes`] += value.length;
        report.output.total_bytes += value.length;
        const remaining = Math.max(0, report.limits.output_max_bytes - retainedOutputBytes);
        const retained = value.subarray(0, remaining);
        if (retained.length > 0) {
          retainedOutputBytes += retained.length;
          report.output[`${key}_tail`] = appendTail(
            report.output[`${key}_tail`], retained, DEFAULTS.diagnosticTailBytes,
          );
          if (!stopping && !sink.write(retained)) {
            stream.pause();
            sink.once('drain', () => { if (!stopping) stream.resume(); });
          }
        }
        if (retained.length < value.length || report.output.total_bytes > report.limits.output_max_bytes) {
          report.output.truncated = true;
          stream.pause();
          requestStop('safety_limit_exceeded', 'output');
        }
      });
    };
    attachOutput(child.stdout, path.join(temporaryDirectory, 'stdout.log'), 'stdout');
    attachOutput(child.stderr, path.join(temporaryDirectory, 'stderr.log'), 'stderr');

    if (activeAdapter.id === 'linux-systemd-cgroup-v2') {
      const deadline = Date.now() + DEFAULTS.scopeHandshakeMs;
      let handshakeDiagnostic = { ready_file: false, cgroup: null, gate_pid: null, pids: [] };
      while (Date.now() < deadline && !childEnded) {
        if (fs.existsSync(readyFile) && activeAdapter.resolveCgroup()) {
          const proof = activeAdapter.sample();
          const enforcement = activeAdapter.enforcementProof();
          let gatePid = null;
          try { gatePid = Number(JSON.parse(fs.readFileSync(readyFile, 'utf8')).pid); } catch {}
          handshakeDiagnostic = {
            ready_file: true,
            cgroup: activeAdapter.cgroupPath,
            gate_pid: gatePid,
            pids: proof.pids,
            enforcement,
          };
          if (gatePid && proof.pids.includes(gatePid) && enforcement.ok) {
            report.preflight.scope_proof = {
              cgroup: activeAdapter.cgroupPath,
              gate_pids: proof.pids,
              gate_pid: gatePid,
              aggregate_rss_bytes: proof.aggregateRssBytes,
              cgroup_memory_bytes: proof.cgroupMemoryCurrentBytes,
              production_enforcement: true,
              controller_readback: enforcement,
            };
            authority.cgroup = activeAdapter.cgroupPath;
            authority.enforcement = enforcement.actual;
            crashWatchdog?.update({
              cgroup: activeAdapter.cgroupPath,
              report_seed: structuredClone(report),
            });
            rememberDescendants(report, proof.records, Date.now() - startedMs);
            break;
          }
        }
        await wait(20);
      }
      if (!report.preflight.scope_proof) {
        report.preflight.enforcement_handshake_diagnostic = handshakeDiagnostic;
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
          const gatePid = report.preflight.scope_proof.gate_pid;
          const classification = classifyRemainingDescendants(
            managedRegistrations,
            measured.records,
            [gatePid],
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
          const gatePid = report.preflight.scope_proof.gate_pid;
          if (measured.pids.some((pid) => pid !== gatePid)) {
            requestStop('safety_limit_exceeded', 'managed_descendant_cleanup');
          }
        }
        sample();
      }, report.limits.sample_interval_ms);
      fs.writeFileSync(releaseFile, 'release\n', { mode: 0o600 });
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
        requestStop('internal_error', 'temporary_quota_handshake');
        throw Object.assign(new Error('size-limited private tmpfs handshake failed before payload release'), {
          code: 'LAMINA_SAFE_TEMP_QUOTA_UNPROVEN',
        });
      }
      report.preflight.temporary_quota_proof = quotaProof;
      quotaProven = true;
      fs.writeFileSync(quotaReleaseFile, 'release\n', { mode: 0o600 });
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
    const ended = await Promise.race([
      childResult,
      wait(controllerDeadlineMs).then(() => ({ controllerDeadline: true })),
    ]);
    if (ended.controllerDeadline) {
      requestStop('safety_limit_exceeded', 'controller_deadline');
      throw Object.assign(new Error('controller deadline elapsed before the child exit was observed'), {
        code: 'LAMINA_SAFE_CONTROLLER_DEADLINE',
      });
    }
    report.termination.child_exit_code = ended.code ?? null;
    report.termination.child_signal = ended.signal ?? null;
    if (ended.error) {
      report.outcome = 'internal_error';
      report.termination.reason = 'spawn_failed';
      report.error = errorDetails(ended.error, 'LAMINA_SAFE_SPAWN');
    } else if (!stopping) {
      const measured = sample();
      const gatePid = report.preflight?.scope_proof?.gate_pid;
      const classification = classifyRemainingDescendants(
        managedRegistrations,
        measured?.records || [],
        gatePid ? [gatePid] : [],
      );
      if (classification.kind === 'managed_graphd') {
        beginManagedCleanup(classification);
        const deadline = Date.now() + report.limits.graceful_stop_ms;
        let remaining = activeAdapter.sample();
        while (Date.now() < deadline
          && remaining.pids.some((pid) => pid !== gatePid)) {
          await wait(20);
          remaining = activeAdapter.sample();
        }
        if (remaining.pids.some((pid) => pid !== gatePid)) {
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
      if (report.outcome === 'internal_error' || !stopping || report.samples.length === 0) {
        report.outcome = 'internal_error';
        report.termination.reason = 'internal_error';
      }
      report.termination.reason ||= 'internal_error';
      report.error ||= errorDetails(error);
    }
  } finally {
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
        const cleanup = await activeAdapter.cleanup();
        for (const error of cleanup.errors || []) report.cleanup.errors.push(`adapter cleanup: ${error}`);
        report.cleanup.descendants_remaining = cleanup.pids || [];
        report.cleanup.scope_removed = cleanup.removed === true;
      } catch (error) {
        report.cleanup.errors.push(`adapter cleanup: ${error.message}`);
        report.cleanup.scope_removed = false;
      }
    }
    if (proofBroker) {
      try { await proofBroker.close(); } catch (error) {
        report.cleanup.errors.push(`proof broker cleanup: ${error.message}`);
      }
      proofBroker = null;
    }
    report.cleanup.managed_paths_remaining = [...managedCleanupPaths]
      .filter((candidate) => fs.existsSync(candidate));
    if (report.cleanup.managed_paths_remaining.length) {
      report.cleanup.errors.push(
        `managed graphd socket/lock remained: ${report.cleanup.managed_paths_remaining.join(', ')}`,
      );
    }
    for (const stream of childStreams) stream.resume();
    for (const stream of outputStreams) {
      try { stream.end(); } catch {}
    }
    await Promise.all(outputStreams.map((stream) => stream.closed
      ? null
      : once(stream, 'close').catch(() => null)));
    if (temporaryDirectory) {
      try {
        report.cleanup.temporary_directory_removed = removeOwnedDirectory(
          temporaryDirectory, 'lamina-safe-runner-',
          temporaryDirectoryIdentity,
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
  if (retryLedgerError) {
    report.outcome = 'internal_error';
    report.termination.reason = 'retry_ledger_failed';
    report.error = errorDetails(retryLedgerError, 'LAMINA_SAFE_RETRY_LEDGER');
  } else if (runAttemptRecorded && observedSafetyLimit === null && !cleanupFailed
    && ['success', 'command_failed', 'interrupted'].includes(report.outcome)) {
    try {
      clearRunAttempt(cwd, normalizedCommand, report.limits, report.run_id, retrySignature);
    } catch (error) {
      report.outcome = 'internal_error';
      report.termination.reason = 'retry_ledger_failed';
      report.error = errorDetails(error, 'LAMINA_SAFE_RETRY_LEDGER');
    }
  }
  try {
    const written = writeReportWithFallback(reportFile, report);
    Object.defineProperty(report, 'writtenReport', { value: written, enumerable: false });
    if (report.outcome === 'success' && promote && written.fallback === false
      && written.path === path.resolve(reportFile)) {
      try { recordPromotion(cwd, tier, report, workloadId); } catch (error) {
        report.outcome = 'internal_error';
        report.termination.reason = 'promotion_failed';
        report.error = errorDetails(error, 'LAMINA_SAFE_PROMOTION');
        writeReportWithFallback(reportFile, report);
      }
    }
    if (crashWatchdog) {
      try {
        await crashWatchdog.disarm();
      } catch (error) {
        report.outcome = 'internal_error';
        report.termination.reason = 'watchdog_disarm_failed';
        report.error = errorDetails(error, 'LAMINA_SAFE_WATCHDOG_DISARM');
        writeReportWithFallback(reportFile, report);
      }
    }
    return report;
  } finally {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  }
}
