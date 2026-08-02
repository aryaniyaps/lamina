#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseReport, validateReport } from '../scripts/safe-runner/report.mjs';
import { parseCgroupCpuStat, parseCgroupIoStat } from '../scripts/safe-runner/linux-systemd.mjs';
import {
  DEFAULT_LIMITS, LIFECYCLE_PHASES, RESULT_SCHEMA, RESULT_SCHEMA_VERSION,
  WARM_MEASURED_PHASES,
} from '../benchmarks/runtime-v1/constants.mjs';
import {
  cleanupHarnessRoot, initializeHarnessRoot, invokeRuntimeBenchmarkCli,
} from '../benchmarks/runtime-v1/harness.mjs';
import { fixtureMetadata } from '../benchmarks/runtime-v1/fixture-metadata.mjs';
import { benchmarkIdentity } from '../benchmarks/runtime-v1/identity.mjs';
import { readBoundedPhysicalFile } from '../benchmarks/runtime-v1/physical-files.mjs';
import { median, nearestRank, summarizeLatency } from '../benchmarks/runtime-v1/statistics.mjs';
import { classifySafeRunnerOutcome, validateResult } from '../benchmarks/runtime-v1/validate.mjs';

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const clone = (value) => structuredClone(value);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-runtime-benchmark-test-'));
const trackedRepositorySymlink = fileURLToPath(
  new URL('../evals/fixtures/_base/outline/CLAUDE.md', import.meta.url),
);

function successfulSafeReport(index) {
  const report = baseReport({ tier: 'small', command: ['node', 'tiny-runtime.mjs'], cwd: '/fixture' });
  report.run_id = `safe-test-${index}`;
  report.finished_at = new Date().toISOString();
  report.duration_ms = 10 + index;
  report.outcome = 'success';
  report.adapter = { id: 'test-cgroup' };
  report.limits = { memory_max_bytes: 1 };
  report.preflight = { ok: true };
  report.samples = [{
    elapsed_ms: 1,
    aggregate_rss_bytes: 123 + index,
    cgroup_memory_bytes: 456 + index,
    pids: 2,
    temporary_bytes: 32,
    temporary_inodes: 2,
  }];
  report.peaks = {
    aggregate_rss_bytes: 123 + index,
    cgroup_memory_bytes: 456 + index,
    pids: 2,
    temporary_bytes: 32,
    temporary_inodes: 2,
  };
  report.termination.reason = 'completed';
  report.termination.child_exit_code = 0;
  report.cleanup = {
    attempted: true,
    descendants_remaining: [],
    managed_paths_remaining: [],
    scope_removed: true,
    temporary_directory_removed: true,
    lock_released: true,
    errors: [],
  };
  assert.equal(validateReport(report).valid, true);
  return report;
}

function writeExecutionArtifacts(outputRoot, name, index, fixtureRecord) {
  const raw = successfulSafeReport(index);
  const fixtureLine = `${JSON.stringify(fixtureRecord)}\n`;
  raw.output.stdout_bytes = Buffer.byteLength(fixtureLine);
  raw.output.total_bytes = raw.output.stdout_bytes;
  raw.output.stdout_tail = fixtureLine;
  const telemetry = {
    schema: 'lamina.runtime-benchmark-telemetry/v1',
    samples: [{
      elapsed_ms: 1,
      accounting: {
        cpu: {
          available: true, usage_usec: 1000, user_usec: 700, system_usec: 300,
          nr_periods: null, nr_throttled: null, throttled_usec: null, reason: null,
        },
        io: {
          available: false, devices: 0, read_bytes: null, write_bytes: null,
          read_operations: null, write_operations: null,
        },
      },
    }],
  };
  const rawPath = `raw/${name}.json`;
  const telemetryPath = `telemetry/${name}.json`;
  const rawBytes = Buffer.from(`${JSON.stringify(raw)}\n`);
  const telemetryBytes = Buffer.from(`${JSON.stringify(telemetry)}\n`);
  fs.writeFileSync(path.join(outputRoot, rawPath), rawBytes);
  fs.writeFileSync(path.join(outputRoot, telemetryPath), telemetryBytes);
  return {
    execution: {
      run_index: index,
      outcome: 'success',
      measurement_valid: true,
      termination_reason: 'completed',
      limit: null,
      wall_time_ms: raw.duration_ms,
      exit_status: 0,
      exit_signal: null,
      aggregate_peak_rss_bytes: raw.peaks.aggregate_rss_bytes,
      cgroup_peak_memory_bytes: raw.peaks.cgroup_memory_bytes,
      runner_peak_rss_bytes: raw.peaks.aggregate_rss_bytes,
      memory_difference_bytes: 0,
      memory_tolerance_bytes: 0,
      memory_agrees: true,
      per_process_peak_rss: [],
      cpu_time_ms: 1,
      io: {
        available: false, read_bytes: null, write_bytes: null,
        read_operations: null, write_operations: null,
        reason: 'cgroup io.stat was unavailable for this adapter or scope',
      },
      derived_state: { before_bytes: 0, peak_bytes: 32, after_bytes: 0 },
      remaining_descendants: [],
      scope_phase_time_ns: null,
      raw_report: rawPath,
      raw_report_sha256: digest(rawBytes),
      telemetry: telemetryPath,
      telemetry_sha256: digest(telemetryBytes),
    },
    artifacts: [
      { path: rawPath, sha256: digest(rawBytes), bytes: rawBytes.length },
      { path: telemetryPath, sha256: digest(telemetryBytes), bytes: telemetryBytes.length },
    ],
  };
}

function completeResult(outputRoot) {
  const coldValues = [101, 102, 103];
  const warmValues = Array.from({ length: 30 }, (_, index) => 200 + index);
  const warmIndexes = new Set(WARM_MEASURED_PHASES.map((name) => LIFECYCLE_PHASES.indexOf(name)));
  const coldPhaseTimes = LIFECYCLE_PHASES.map((_, index) => index + 1);
  const warmPhaseTimes = LIFECYCLE_PHASES.map((_, index) => warmIndexes.has(index) ? index + 1 : null);
  const warmScopeTimes = LIFECYCLE_PHASES.map((_, index) => warmIndexes.has(index) ? null : index + 1);
  const fixture = fixtureMetadata();
  const fixtureRecord = (mode, observations, outer) => ({
    schema: 'lamina.runtime-benchmark-fixture/v1',
    mode,
    fixture_metadata: fixture,
    phase_order: LIFECYCLE_PHASES,
    observations,
    lifecycle_outer_phase_time_ns: outer,
    persistent_state_reused: mode === 'warm',
    persistent_state_identity: mode === 'warm' ? { dev: '1', ino: '2' } : null,
    child_processes: 1,
    state_removed: true,
  });
  const coldArtifacts = coldValues.map((wall_time_ns, index) => writeExecutionArtifacts(
    outputRoot,
    `cold-${index}`,
    index,
    fixtureRecord('cold', [{
      index: 0, classification: 'cold', wall_time_ns, phase_time_ns: coldPhaseTimes,
    }], LIFECYCLE_PHASES.map(() => null)),
  ));
  const warmObservations = [
    { index: 0, classification: 'warmup', wall_time_ns: 199, phase_time_ns: warmPhaseTimes },
    ...warmValues.map((wall_time_ns, index) => ({
      index, classification: 'measured_warm', wall_time_ns, phase_time_ns: warmPhaseTimes,
    })),
  ];
  const warmArtifact = writeExecutionArtifacts(
    outputRoot, 'warm', 0, fixtureRecord('warm', warmObservations, warmScopeTimes),
  );
  coldArtifacts.forEach(({ execution }) => { execution.scope_phase_time_ns = LIFECYCLE_PHASES.map(() => null); });
  warmArtifact.execution.scope_phase_time_ns = warmScopeTimes;
  const result = {
    schema: RESULT_SCHEMA,
    schema_version: RESULT_SCHEMA_VERSION,
    result_id: '',
    generated_at: new Date().toISOString(),
    status: 'valid',
    input_digest: '',
    source: { commit: 'b'.repeat(40), dirty: false, dirty_digest: 'c'.repeat(64) },
    host: {
      platform: 'linux', release: 'test', architecture: 'x64', cpu_model: 'test',
      logical_cores: 2, total_memory_bytes: 1024, available_memory_bytes: 512,
    },
    runtimes: {
      node: process.version, lamina_cli: '0.0.0', graph_protocol: 1,
      safe_runner_report: 'lamina.safe-runner-report/v1', harness: '1',
    },
    fixture,
    configuration: {
      tier: 'small', cold_runs: 3, warmups: 1, warm_samples: 30, limits: DEFAULT_LIMITS,
    },
    lifecycle_phases: LIFECYCLE_PHASES,
    series: [
      {
        id: 'tiny-cold', kind: 'cold', warmup_count: 0, measured_count: 3,
        warmup_wall_time_ns: [],
        samples: coldValues.map((wall_time_ns, index) => ({
          index, classification: 'cold', wall_time_ns, phase_time_ns: coldPhaseTimes,
        })),
        statistics: summarizeLatency(coldValues, 'cold'),
        executions: coldArtifacts.map(({ execution }) => execution),
      },
      {
        id: 'tiny-warm', kind: 'warm', warmup_count: 1, measured_count: 30,
        warmup_wall_time_ns: [199],
        samples: warmValues.map((wall_time_ns, index) => ({
          index, classification: 'measured_warm', wall_time_ns, phase_time_ns: warmPhaseTimes,
        })),
        statistics: summarizeLatency(warmValues, 'warm'),
        executions: [warmArtifact.execution],
      },
    ],
    artifacts: [...coldArtifacts, warmArtifact].flatMap(({ artifacts }) => artifacts),
    cleanup: {
      scoped: true, marker: '.lamina-runtime-benchmark-root.json',
      remaining_descendants: 0, unexpected_paths: [],
    },
    errors: [],
  };
  Object.assign(result, benchmarkIdentity(result.source, result.fixture, result.configuration));
  return result;
}

function resultWithArtifactMutation(result, outputRoot, relative, mutate) {
  const file = path.join(outputRoot, relative);
  const original = fs.readFileSync(file);
  const value = JSON.parse(original.toString('utf8'));
  mutate(value);
  const changed = Buffer.from(`${JSON.stringify(value)}\n`);
  fs.writeFileSync(file, changed);
  const candidate = clone(result);
  const artifact = candidate.artifacts.find((item) => item.path === relative);
  artifact.bytes = changed.length;
  artifact.sha256 = digest(changed);
  for (const series of candidate.series) {
    for (const execution of series.executions) {
      if (execution.raw_report === relative) execution.raw_report_sha256 = artifact.sha256;
      if (execution.telemetry === relative) execution.telemetry_sha256 = artifact.sha256;
    }
  }
  return { candidate, restore: () => fs.writeFileSync(file, original) };
}

function mutateFixtureRecord(raw, mutate) {
  const record = JSON.parse(raw.output.stdout_tail.trim());
  mutate(record);
  const fixtureLine = `${JSON.stringify(record)}\n`;
  raw.output.stdout_tail = fixtureLine;
  raw.output.stdout_bytes = Buffer.byteLength(fixtureLine);
  raw.output.total_bytes = raw.output.stdout_bytes;
}

try {
  assert.equal(fs.lstatSync(trackedRepositorySymlink).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(trackedRepositorySymlink), 'AGENTS.md');
  assert.equal(fs.statSync(trackedRepositorySymlink).isFile(), true);

  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(nearestRank([1, 2, 3, 4, 5], 0.95), 5);
  assert.deepEqual(summarizeLatency([3, 1, 2], 'cold'), {
    samples: [3, 1, 2], median: 2, p90: null, p95: null, maximum: 3,
  });
  assert.throws(() => summarizeLatency(Array(29).fill(1), 'warm'), /exactly 30/);
  assert.throws(() => summarizeLatency(Array(31).fill(1), 'warm'), /exactly 30/);
  assert.equal(summarizeLatency(Array.from({ length: 30 }, (_, index) => index), 'warm').p95, 28);

  const cpu = parseCgroupCpuStat('usage_usec 100\nuser_usec 70\nsystem_usec 30\nnr_throttled 2\n');
  assert.equal(cpu.available, true);
  assert.equal(cpu.nr_throttled, 2);
  assert.equal(parseCgroupCpuStat('usage_usec nope').available, false);
  assert.equal(parseCgroupCpuStat('usage_usec 1.5\nuser_usec 1\nsystem_usec 0').available, false);
  assert.equal(parseCgroupCpuStat(`usage_usec ${Number.MAX_SAFE_INTEGER + 1}\nuser_usec 1\nsystem_usec 0`).available, false);
  assert.deepEqual(parseCgroupIoStat('8:0 rbytes=10 wbytes=20 rios=2 wios=3\n8:1 rbytes=5 wbytes=7 rios=1 wios=1'), {
    available: true, devices: 2, read_bytes: 15, write_bytes: 27,
    read_operations: 3, write_operations: 4,
  });
  assert.equal(parseCgroupIoStat('malformed').available, false);
  assert.equal(parseCgroupIoStat('8:0 rbytes=0.5 wbytes=1 rios=1 wios=1').available, false);
  assert.equal(parseCgroupIoStat(`8:0 rbytes=${Number.MAX_SAFE_INTEGER} wbytes=1 rios=1 wios=1\n8:1 rbytes=1 wbytes=1 rios=1 wios=1`).available, false);

  for (const [outcome, limit, expected] of [
    ['success', null, 'success'], ['preflight_refused', null, 'safe_refusal'],
    ['interrupted', 'signal', 'cancellation'], ['command_failed', null, 'command_failure'],
    ['safety_limit_exceeded', 'timeout', 'timeout'], ['safety_limit_exceeded', 'memory', 'limit_hit'],
    ['internal_error', null, 'internal_error'],
  ]) assert.equal(classifySafeRunnerOutcome({ outcome, termination: { limit } }), expected);

  const owned = initializeHarnessRoot(path.join(root, 'valid'));
  const result = completeResult(owned.root);
  assert.deepEqual(validateResult(result, { artifactRoot: owned.root }).errors, []);
  assert.match(validateResult(result).errors.join('; '), /artifactRoot is required/);
  const malformed = clone(result);
  malformed.unexpected = true;
  assert.equal(validateResult(malformed, { artifactRoot: owned.root }).valid, false);

  const coldP95 = clone(result);
  coldP95.series[0].statistics.p95 = 103;
  assert.equal(validateResult(coldP95, { artifactRoot: owned.root }).valid, false);
  const missingTelemetry = clone(result);
  missingTelemetry.artifacts = missingTelemetry.artifacts.filter((item) => item.path !== 'telemetry/warm.json');
  assert.equal(validateResult(missingTelemetry, { artifactRoot: owned.root }).valid, false);
  const memoryConflation = clone(result);
  memoryConflation.series[0].executions[0].cgroup_peak_memory_bytes = 123;
  assert.equal(validateResult(memoryConflation, { artifactRoot: owned.root }).valid, false);
  const warmOverlap = clone(result);
  warmOverlap.series[1].samples[0].phase_time_ns[LIFECYCLE_PHASES.indexOf('startup')] = 1;
  assert.equal(validateResult(warmOverlap, { artifactRoot: owned.root }).valid, false);
  const digestMismatch = clone(result);
  digestMismatch.series[1].executions[0].telemetry_sha256 = 'd'.repeat(64);
  assert.equal(validateResult(digestMismatch, { artifactRoot: owned.root }).valid, false);
  const cpuContradiction = clone(result);
  cpuContradiction.series[1].executions[0].cpu_time_ms = 999;
  assert.equal(validateResult(cpuContradiction, { artifactRoot: owned.root }).valid, false);
  const exitContradiction = clone(result);
  exitContradiction.series[0].executions[0].exit_status = 1;
  assert.equal(validateResult(exitContradiction, { artifactRoot: owned.root }).valid, false);
  const hardlink = path.join(root, 'telemetry-hardlink.json');
  fs.linkSync(path.join(owned.root, 'telemetry', 'warm.json'), hardlink);
  assert.match(
    validateResult(result, { artifactRoot: owned.root }).errors.join('; '),
    /single-link physical file/,
  );
  fs.unlinkSync(hardlink);
  assert.throws(
    () => readBoundedPhysicalFile(trackedRepositorySymlink, 128 * 1024),
    /physical file|ELOOP/,
  );
  const partial = clone(result);
  partial.series[1].samples.pop();
  partial.series[1].measured_count = 29;
  partial.series[1].statistics = {
    samples: partial.series[1].samples.map((sample) => sample.wall_time_ns),
    median: 0, p90: null, p95: null, maximum: 0,
  };
  assert.equal(validateResult(partial, { artifactRoot: owned.root }).valid, false);
  const incompatible = clone(result);
  incompatible.schema_version = 2;
  assert.equal(validateResult(incompatible, { artifactRoot: owned.root }).valid, false);
  const mislabeled = clone(result);
  mislabeled.series[0].samples[0].classification = 'measured_warm';
  assert.equal(validateResult(mislabeled, { artifactRoot: owned.root }).valid, false);

  const wrongInputDigest = clone(result);
  wrongInputDigest.input_digest = 'd'.repeat(64);
  assert.match(validateResult(wrongInputDigest, { artifactRoot: owned.root }).errors.join('; '), /must be derived/);
  const wrongResultId = clone(result);
  wrongResultId.result_id = 'runtime-v1-forged-identity';
  assert.match(validateResult(wrongResultId, { artifactRoot: owned.root }).errors.join('; '), /must be derived/);
  for (const field of ['tracked_files', 'indexed_files', 'source_bytes', 'indexed_bytes', 'source_loc']) {
    const metadataContradiction = clone(result);
    metadataContradiction.fixture[field] += 1;
    Object.assign(metadataContradiction, benchmarkIdentity(
      metadataContradiction.source,
      metadataContradiction.fixture,
      metadataContradiction.configuration,
    ));
    assert.match(
      validateResult(metadataContradiction, { artifactRoot: owned.root }).errors.join('; '),
      /fixture metadata contradicts/,
    );
  }
  const digestContradiction = clone(result);
  digestContradiction.fixture.digest = 'd'.repeat(64);
  Object.assign(digestContradiction, benchmarkIdentity(
    digestContradiction.source, digestContradiction.fixture, digestContradiction.configuration,
  ));
  assert.match(
    validateResult(digestContradiction, { artifactRoot: owned.root }).errors.join('; '),
    /fixture metadata contradicts/,
  );

  for (const mutate of [
    (record) => { record.persistent_state_reused = false; },
    (record) => { record.persistent_state_identity = null; },
    (record) => { record.observations[2].index = 99; },
    (record) => { record.child_processes = 2; },
  ]) {
    const changed = resultWithArtifactMutation(result, owned.root, 'raw/warm.json', (raw) =>
      mutateFixtureRecord(raw, mutate));
    try {
      assert.match(
        validateResult(changed.candidate, { artifactRoot: owned.root }).errors.join('; '),
        /invalid fixture record/,
      );
    } finally { changed.restore(); }
  }

  for (const mutate of [
    (telemetry) => { telemetry.samples[0].elapsed_ms = 0.5; },
    (telemetry) => { telemetry.samples[0].elapsed_ms = Number.MAX_SAFE_INTEGER + 1; },
    (telemetry) => { telemetry.samples[0].accounting.cpu.usage_usec = 0.5; },
    (telemetry) => { telemetry.samples[0].accounting.cpu.usage_usec = Number.MAX_SAFE_INTEGER + 1; },
    (telemetry) => { telemetry.samples[0].accounting.extra = true; },
    (telemetry) => {
      const second = clone(telemetry.samples[0]);
      second.elapsed_ms = 2;
      second.accounting.cpu.usage_usec -= 1;
      telemetry.samples.push(second);
    },
  ]) {
    const changed = resultWithArtifactMutation(result, owned.root, 'telemetry/warm.json', mutate);
    try {
      assert.match(
        validateResult(changed.candidate, { artifactRoot: owned.root }).errors.join('; '),
        /invalid bounded telemetry sidecar/,
      );
    } finally { changed.restore(); }
  }

  const malformedJson = path.join(root, 'malformed-result.json');
  fs.writeFileSync(malformedJson, '{not-json\n', { mode: 0o600 });
  let malformedStdout = '';
  let malformedStderr = '';
  const malformedStatus = await invokeRuntimeBenchmarkCli([
    'validate', '--file', malformedJson,
  ], {
    stdout: { write: (value) => { malformedStdout += value; } },
    stderr: { write: (value) => { malformedStderr += value; } },
  });
  assert.equal(malformedStatus, 2);
  assert.equal(malformedStdout, '');
  assert.equal(JSON.parse(malformedStderr).schema, 'lamina.runtime-benchmark-cli-error/v1');

  const refusedResult = clone(result);
  refusedResult.status = 'refused';
  refusedResult.errors = ['safe runner preflight refused the bounded fixture'];
  const refusedRestores = [];
  for (const series of refusedResult.series) {
    for (const execution of series.executions) {
      execution.outcome = 'safe_refusal';
      execution.measurement_valid = false;
      execution.termination_reason = 'preflight_refused';
      execution.exit_status = null;
      const file = path.join(owned.root, execution.raw_report);
      const original = fs.readFileSync(file);
      refusedRestores.push(() => fs.writeFileSync(file, original));
      const raw = JSON.parse(original.toString('utf8'));
      raw.outcome = 'preflight_refused';
      raw.preflight = { ok: false };
      raw.termination.reason = 'preflight_refused';
      raw.termination.child_exit_code = null;
      const changed = Buffer.from(`${JSON.stringify(raw)}\n`);
      fs.writeFileSync(file, changed);
      const artifact = refusedResult.artifacts.find((item) => item.path === execution.raw_report);
      artifact.bytes = changed.length;
      artifact.sha256 = digest(changed);
      execution.raw_report_sha256 = artifact.sha256;
    }
  }
  try {
    assert.deepEqual(validateResult(refusedResult, { artifactRoot: owned.root }).errors, []);
  } finally { refusedRestores.forEach((restore) => restore()); }

  assert.throws(() => cleanupHarnessRoot(owned.root), /unexpected paths/);
  for (const directory of ['raw', 'telemetry']) {
    for (const file of fs.readdirSync(path.join(owned.root, directory))) {
      fs.unlinkSync(path.join(owned.root, directory, file));
    }
  }
  assert.equal(cleanupHarnessRoot(owned.root).removed, true);
  assert.equal(cleanupHarnessRoot(owned.root).already_absent, true);

  const foreign = initializeHarnessRoot(path.join(root, 'foreign'));
  fs.writeFileSync(path.join(foreign.root, 'foreign.txt'), 'not-owned');
  assert.throws(() => cleanupHarnessRoot(foreign.root), /unexpected paths/);
  fs.rmSync(path.join(foreign.root, 'foreign.txt'));
  fs.mkdirSync(path.join(foreign.root, 'raw', 'foreign-empty-directory'));
  assert.throws(() => cleanupHarnessRoot(foreign.root), /unexpected paths/);
  fs.rmdirSync(path.join(foreign.root, 'raw', 'foreign-empty-directory'));
  fs.writeFileSync(path.join(foreign.root, 'raw', 'foreign.json'), '{}\n');
  assert.throws(() => cleanupHarnessRoot(foreign.root), /raw\/foreign\.json/);
  fs.unlinkSync(path.join(foreign.root, 'raw', 'foreign.json'));
  fs.writeFileSync(path.join(foreign.root, 'telemetry', 'foreign.json'), '{}\n');
  assert.throws(() => cleanupHarnessRoot(foreign.root), /telemetry\/foreign\.json/);
  fs.unlinkSync(path.join(foreign.root, 'telemetry', 'foreign.json'));
  cleanupHarnessRoot(foreign.root);

  assert.throws(
    () => cleanupHarnessRoot(trackedRepositorySymlink),
    /physical directory|symlink indirection/,
  );

  assert.throws(() => initializeHarnessRoot(path.resolve('.runtime-benchmark-forbidden')), /outside/);
  process.stdout.write('runtime benchmark unit tests passed\n');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
