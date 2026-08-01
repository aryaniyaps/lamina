import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { adapterProbe, assertAdapterShape } from './adapter.mjs';
import { createContext } from './context.mjs';
import { DEFAULTS, PRODUCTION_TIERS } from './constants.mjs';
import { boundedDirectorySize, removeOwnedDirectory } from './filesystem.mjs';
import { LinuxSystemdAdapter } from './linux-systemd.mjs';
import { classifyRemainingDescendants } from './managed-descendants.mjs';
import { PortableProcessGroupAdapter } from './portable-process-group.mjs';
import { preflightRun } from './preflight.mjs';
import { existingLaminaProcesses, signalIdentity } from './processes.mjs';
import { baseReport, finishReport, writeReportWithFallback } from './report.mjs';
import { acquireConcurrencyLock, recordPromotion } from './state.mjs';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function errorDetails(error, fallback = 'LAMINA_SAFE_INTERNAL') {
  return {
    code: error?.code || fallback,
    message: String(error?.message || error).slice(0, 2_000),
  };
}

function appendTail(previous, chunk, maximum) {
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
      command: record.command,
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
  adapter = null,
  probe = adapterProbe(),
  mode = 'run',
  selfTestCaseId = null,
  promote = false,
} = {}) {
  const startedMs = Date.now();
  const normalizedCommand = Array.isArray(command) ? command : [];
  const report = baseReport({ tier, command: normalizedCommand, cwd: path.resolve(cwd) });
  let lock = null;
  let temporaryDirectory = null;
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
  let managedDescendantsFile = null;
  const outputStreams = [];
  const childStreams = [];
  const signalHandlers = new Map();

  const requestStop = (reason, limit = null) => {
    if (stopping) return;
    stopping = true;
    report.termination.reason = reason;
    report.termination.limit = limit;
    report.outcome = reason === 'interrupted' ? 'interrupted' : 'safety_limit_exceeded';
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
    const temporary = boundedDirectorySize(temporaryDirectory, report.limits.temporary_max_bytes);
    const rss = Math.max(measured.aggregateRssBytes || 0, measured.aggregatePeakBytes || 0);
    report.peaks.aggregate_rss_bytes = Math.max(report.peaks.aggregate_rss_bytes, rss);
    const taskCount = measured.taskCount ?? measured.pids?.length ?? 0;
    report.peaks.pids = Math.max(report.peaks.pids, taskCount);
    report.peaks.temporary_bytes = Math.max(report.peaks.temporary_bytes, temporary.bytes);
    rememberDescendants(report, measured.records, elapsed);
    report.termination.cgroup_events = measured.events || {};
    report.samples.push({
      elapsed_ms: elapsed,
      aggregate_rss_bytes: measured.aggregateRssBytes || 0,
      pids: taskCount,
      temporary_bytes: temporary.bytes,
    });
    if (report.samples.length > DEFAULTS.maxSamples) report.samples.shift();
    if ((measured.events?.memory?.oom_kill || 0) > 0
      || (measured.events?.memory?.max || 0) > 0
      || (measured.aggregateRssBytes || 0) >= report.limits.memory_max_bytes) {
      requestStop('safety_limit_exceeded', 'memory');
    }
    if ((measured.events?.pids?.max || 0) > 0 || taskCount > report.limits.pids_max) {
      requestStop('safety_limit_exceeded', 'pids');
    }
    if (temporary.exceeded) requestStop('safety_limit_exceeded', 'temporary_disk');
    const highEvents = measured.events?.memory?.high || 0;
    const newHighEvents = Math.max(0, highEvents - previousHighEvents);
    previousHighEvents = highEvents;
    if ((measured.aggregateRssBytes || 0) >= report.limits.memory_high_bytes) {
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
    });
    report.adapter = probe;
    report.limits = preflight.envelope.limits;
    report.preflight = preflight;
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

    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-'));
    fs.chmodSync(temporaryDirectory, 0o700);
    activeAdapter = assertAdapterShape(adapter || adapterFor(probe, report.run_id, report.limits));
    const context = createContext(temporaryDirectory, {
      runId: report.run_id,
      tier,
      adapter: activeAdapter.id,
      unit: activeAdapter.unit || null,
    });
    const readyFile = path.join(temporaryDirectory, 'scope.ready');
    const releaseFile = path.join(temporaryDirectory, 'scope.release');
    const payloadExitFile = path.join(temporaryDirectory, 'payload.exit');
    managedDescendantsFile = path.join(temporaryDirectory, 'managed-descendants.jsonl');

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
      env: {
        ...process.env,
        ...env,
        ...context.environment,
        TMPDIR: temporaryDirectory,
        TMP: temporaryDirectory,
        TEMP: temporaryDirectory,
        LAMINA_SAFE_RUNNER: '1',
        LAMINA_SAFE_RUNNER_TEMP: temporaryDirectory,
        LAMINA_SAFE_RUNNER_TEMP_DIR: temporaryDirectory,
        LAMINA_SAFE_RUNNER_CONTROLLER_PID: String(process.pid),
      },
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
        if (retained.length > 0 && !stopping) {
          retainedOutputBytes += retained.length;
          report.output[`${key}_tail`] = appendTail(
            report.output[`${key}_tail`], retained, DEFAULTS.diagnosticTailBytes,
          );
          if (!sink.write(retained)) {
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
      while (Date.now() < deadline && !childEnded) {
        if (fs.existsSync(readyFile) && activeAdapter.resolveCgroup()) {
          const proof = activeAdapter.sample();
          let gatePid = null;
          try { gatePid = Number(JSON.parse(fs.readFileSync(readyFile, 'utf8')).pid); } catch {}
          if (gatePid && proof.pids.includes(gatePid)) {
            report.preflight.scope_proof = {
              cgroup: activeAdapter.cgroupPath,
              gate_pids: proof.pids,
              gate_pid: gatePid,
              aggregate_rss_bytes: proof.aggregateRssBytes,
              production_enforcement: true,
            };
            rememberDescendants(report, proof.records, Date.now() - startedMs);
            break;
          }
        }
        await wait(20);
      }
      if (!report.preflight.scope_proof) {
        requestStop('safety_limit_exceeded', 'enforcement_handshake');
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
            managedDescendantsFile,
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
    } else {
      report.preflight.scope_proof = {
        production_enforcement: false,
        deliberately_tiny_self_test: true,
        adapter: activeAdapter.id,
      };
      monitor = setInterval(sample, report.limits.sample_interval_ms);
    }
    sample();
    const ended = await childResult;
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
        managedDescendantsFile,
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
      if (report.outcome === 'internal_error' || !stopping) report.outcome = 'internal_error';
      report.termination.reason ||= 'internal_error';
      report.error ||= errorDetails(error);
    }
  } finally {
    if (monitor) clearInterval(monitor);
    if (forceTimer) clearTimeout(forceTimer);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
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
        report.cleanup.descendants_remaining = cleanup.pids || [];
        report.cleanup.scope_removed = cleanup.removed === true;
      } catch (error) {
        report.cleanup.errors.push(`adapter cleanup: ${error.message}`);
        report.cleanup.scope_removed = false;
      }
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
  if (report.outcome === 'success' && promote) {
    try { recordPromotion(cwd, tier, report); } catch (error) {
      report.outcome = 'internal_error';
      report.termination.reason = 'promotion_failed';
      report.error = errorDetails(error, 'LAMINA_SAFE_PROMOTION');
    }
  }
  const written = writeReportWithFallback(reportFile, report);
  Object.defineProperty(report, 'writtenReport', { value: written, enumerable: false });
  return report;
}
