#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GRAPH_PROTOCOL_VERSION } from '../../packages/cli/lib/graph-runtime/constants.mjs';
import { availableMemoryBytes } from '../../scripts/safe-runner/envelope.mjs';
import { spawnTrustedGit } from '../../scripts/safe-runner/git.mjs';
import { validateReport as validateSafeRunnerReport } from '../../scripts/safe-runner/report.mjs';
import { runSafely } from '../../scripts/safe-runner/runner.mjs';
import {
  DEFAULT_LIMITS,
  FIXTURE_SCHEMA,
  LIFECYCLE_PHASES,
  MAX_COLD_RUNS,
  MAX_WARM_SAMPLES,
  MAX_WARMUPS,
  MIN_COLD_RUNS,
  MIN_WARM_SAMPLES,
  MIN_WARMUPS,
  RESULT_SCHEMA,
  RESULT_SCHEMA_VERSION,
  ROOT_MARKER_SCHEMA,
} from './constants.mjs';
import { assertValidFixtureRecord } from './fixture-contract.mjs';
import { fixtureMetadata } from './fixture-metadata.mjs';
import { benchmarkIdentity } from './identity.mjs';
import {
  assertDirectoryIdentity,
  assertPhysicalDirectoryAncestry,
  physicalIdentity,
  readBoundedPhysicalFile,
  samePhysicalIdentity,
} from './physical-files.mjs';
import { summarizeLatency } from './statistics.mjs';
import { assertValidResult, classifySafeRunnerOutcome, validateResult } from './validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.resolve(HERE, '../..');
const FIXTURE = path.join(HERE, 'fixture/tiny-runtime.mjs');
const ROOT_MARKER = '.lamina-runtime-benchmark-root.json';
const RESULT_FILE = 'result.json';
const SUMMARY_FILE = 'summary.md';
const MAX_FIXTURE_OUTPUT_BYTES = 7 * 1024;
const MAX_TELEMETRY_SAMPLES = 64;
const MAX_RAW_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_TELEMETRY_ARTIFACT_BYTES = 128 * 1024;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function pathLexicallyExists(candidate) {
  try { fs.lstatSync(candidate); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function atomicWrite(file, bytes, { root = null, rootIdentity = null } = {}) {
  const destination = path.resolve(file);
  if (rootIdentity) assertDirectoryIdentity(root, rootIdentity);
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
    0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    // link(2) gives this fresh output root a no-replace publication primitive;
    // a same-user replacement at a reserved name is refused, never overwritten.
    fs.linkSync(temporary, destination);
  } finally {
    fs.unlinkSync(temporary);
  }
  if (rootIdentity) assertDirectoryIdentity(root, rootIdentity);
}

function markerFile(root) {
  return path.join(root, ROOT_MARKER);
}

function readMarker(root, rootIdentity) {
  return JSON.parse(readBoundedPhysicalFile(markerFile(root), 128 * 1024, {
    root, rootIdentity,
  }).toString('utf8'));
}

function assertOwnershipMarker(marker) {
  const keys = Object.keys(marker || {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify([
    'generation', 'nonce', 'owned_entries', 'parent_identity', 'root', 'root_identity', 'schema',
  ].sort()) || marker.schema !== ROOT_MARKER_SCHEMA || typeof marker.nonce !== 'string'
    || marker.nonce.length < 16 || !Number.isSafeInteger(marker.generation) || marker.generation < 0
    || !marker.owned_entries || typeof marker.owned_entries !== 'object'
    || Array.isArray(marker.owned_entries)) {
    throw new Error('benchmark ownership marker is malformed');
  }
  return marker;
}

function replaceMarker(root, previous, next) {
  assertDirectoryIdentity(root, previous.root_identity);
  const current = assertOwnershipMarker(readMarker(root, previous.root_identity));
  if (JSON.stringify(current) !== JSON.stringify(previous)) {
    throw new Error('benchmark ownership marker changed before registration');
  }
  const temporary = path.join(root, `.${ROOT_MARKER}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
    0o600);
  try {
    fs.writeFileSync(descriptor, stableJson(next));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, markerFile(root));
  assertDirectoryIdentity(root, previous.root_identity);
  Object.assign(previous, next);
}

function registerOwnedFile(root, marker, relative, maximumBytes) {
  if (!/^(?:raw|telemetry)\/[a-z0-9_-]+\.json$/.test(relative)
    && ![RESULT_FILE, SUMMARY_FILE].includes(relative)) {
    throw new Error(`cannot register unexpected benchmark path: ${relative}`);
  }
  const file = path.join(root, relative);
  const bytes = readBoundedPhysicalFile(file, maximumBytes, {
    root, rootIdentity: marker.root_identity,
  });
  const next = structuredClone(marker);
  next.generation += 1;
  next.owned_entries[relative] = {
    type: 'file',
    identity: physicalIdentity(file, 'file'),
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
  replaceMarker(root, marker, next);
  return next.owned_entries[relative];
}

export function initializeHarnessRoot(requested) {
  const root = path.resolve(requested);
  if (root === REPOSITORY || root.startsWith(`${REPOSITORY}${path.sep}`)) {
    throw new Error('benchmark output must be outside the source repository');
  }
  const parent = path.dirname(root);
  const parentIdentity = assertPhysicalDirectoryAncestry(parent);
  if (pathLexicallyExists(root)) throw new Error('benchmark output root must not already exist');
  fs.mkdirSync(root, { mode: 0o700 });
  assertDirectoryIdentity(parent, parentIdentity);
  fs.mkdirSync(path.join(root, 'raw'), { mode: 0o700 });
  fs.mkdirSync(path.join(root, 'telemetry'), { mode: 0o700 });
  const rootIdentity = physicalIdentity(root, 'directory');
  const marker = {
    schema: ROOT_MARKER_SCHEMA,
    nonce: crypto.randomUUID(),
    root,
    root_identity: rootIdentity,
    parent_identity: parentIdentity,
    generation: 0,
    owned_entries: {
      raw: { type: 'directory', identity: physicalIdentity(path.join(root, 'raw'), 'directory') },
      telemetry: {
        type: 'directory', identity: physicalIdentity(path.join(root, 'telemetry'), 'directory'),
      },
    },
  };
  atomicWrite(path.join(root, ROOT_MARKER), stableJson(marker));
  assertDirectoryIdentity(parent, parentIdentity);
  assertDirectoryIdentity(root, rootIdentity);
  return { root, marker };
}

function ownedTreeEntries(root, marker) {
  const unexpected = [];
  const seen = new Set();
  const visit = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (childRelative === ROOT_MARKER) continue;
      const expected = marker.owned_entries?.[childRelative];
      let matches = Boolean(expected) && !entry.isSymbolicLink()
        && ((expected.type === 'directory' && entry.isDirectory())
          || (expected.type === 'file' && entry.isFile()));
      try {
        if (matches) {
          const identity = physicalIdentity(path.join(root, childRelative), expected.type);
          matches = samePhysicalIdentity(identity, expected.identity)
            && (expected.type !== 'file' || identity.nlink === 1);
          if (matches && expected.type === 'file') {
            const bytes = readBoundedPhysicalFile(path.join(root, childRelative), MAX_RESULT_BYTES, {
              root, rootIdentity: marker.root_identity,
            });
            matches = bytes.length === expected.bytes && sha256(bytes) === expected.sha256;
          }
        }
      } catch { matches = false; }
      if (!matches) {
        unexpected.push(childRelative);
        continue;
      }
      seen.add(childRelative);
      if (entry.isDirectory()) visit(path.join(directory, entry.name), childRelative);
    }
  };
  visit(root);
  for (const relative of Object.keys(marker.owned_entries || {})) {
    if (!seen.has(relative)) unexpected.push(`missing:${relative}`);
  }
  return unexpected.sort();
}

export function cleanupHarnessRoot(requested) {
  const root = path.resolve(requested);
  if (!pathLexicallyExists(root)) return { removed: false, already_absent: true };
  const actualRootIdentity = assertPhysicalDirectoryAncestry(root);
  let marker = null;
  try { marker = assertOwnershipMarker(readMarker(root, actualRootIdentity)); } catch {
    throw new Error('benchmark cleanup requires its exact ownership marker');
  }
  if (marker?.schema !== ROOT_MARKER_SCHEMA || marker.root !== root
    || !samePhysicalIdentity(marker.root_identity, actualRootIdentity)
    || !samePhysicalIdentity(marker.parent_identity, assertPhysicalDirectoryAncestry(path.dirname(root)))) {
    throw new Error('benchmark cleanup marker does not own the current directory identity');
  }
  const unexpected = ownedTreeEntries(root, marker);
  if (unexpected.length) throw new Error(`benchmark cleanup refuses unexpected paths: ${unexpected.join(', ')}`);
  const quarantine = path.join(path.dirname(root), `.lamina-runtime-benchmark-quarantine-${crypto.randomUUID()}`);
  assertDirectoryIdentity(path.dirname(root), marker.parent_identity);
  fs.renameSync(root, quarantine);
  try {
    assertDirectoryIdentity(path.dirname(root), marker.parent_identity);
    const quarantineIdentity = assertPhysicalDirectoryAncestry(quarantine);
    if (!samePhysicalIdentity(quarantineIdentity, marker.root_identity) || pathLexicallyExists(root)) {
      throw new Error('benchmark quarantine did not preserve the owned root identity');
    }
    const quarantinedUnexpected = ownedTreeEntries(quarantine, marker);
    if (quarantinedUnexpected.length) {
      throw new Error(`benchmark quarantine contains unexpected paths: ${quarantinedUnexpected.join(', ')}`);
    }
    const quarantinedMarker = assertOwnershipMarker(
      readMarker(quarantine, marker.root_identity),
    );
    if (JSON.stringify(quarantinedMarker) !== JSON.stringify(marker)) {
      throw new Error('benchmark ownership marker changed after quarantine');
    }
    assertDirectoryIdentity(quarantine, marker.root_identity);
    fs.rmSync(quarantine, { recursive: true, force: false });
  } catch (error) {
    if (!pathLexicallyExists(root) && pathLexicallyExists(quarantine)) {
      try {
        assertDirectoryIdentity(quarantine, marker.root_identity);
        fs.renameSync(quarantine, root);
      } catch {}
    }
    throw error;
  }
  if (pathLexicallyExists(quarantine) || pathLexicallyExists(root)) {
    throw new Error('benchmark quarantine removal was incomplete');
  }
  return { removed: true, already_absent: false };
}

function checkedGit(args) {
  const result = spawnTrustedGit(REPOSITORY, args, { maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Git metadata failed: ${String(result.stderr || '').trim()}`);
  return result.stdout;
}

export function sourceMetadata() {
  const commit = checkedGit(['rev-parse', 'HEAD']).trim();
  const status = checkedGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  return {
    commit,
    dirty: status.length > 0,
    dirty_digest: sha256(status),
  };
}

export function hostMetadata() {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    release: os.release(),
    architecture: process.arch,
    cpu_model: cpus[0]?.model || 'unknown',
    logical_cores: Math.max(1, cpus.length),
    total_memory_bytes: os.totalmem(),
    available_memory_bytes: availableMemoryBytes(),
  };
}

function parseFixtureRecord(report, options) {
  const tail = String(report?.output?.stdout_tail || '');
  const lines = tail.trim().split('\n').filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value?.schema === FIXTURE_SCHEMA) {
        if (Buffer.byteLength(line) > MAX_FIXTURE_OUTPUT_BYTES) throw new Error('fixture record exceeds its retained-tail budget');
        return assertValidFixtureRecord(value, options);
      }
    } catch (error) {
      if (error.message.includes('fixture record')) throw error;
    }
  }
  throw new Error('safe-runner report does not contain a complete fixture record');
}

function latestAccounting(samples) {
  return [...samples].reverse().find((sample) => sample.accounting?.cpu?.available
    || sample.accounting?.io?.available)?.accounting || null;
}

function telemetrySummary(accounting) {
  return {
    cpu_time_ms: accounting?.cpu?.available ? accounting.cpu.usage_usec / 1000 : null,
    io: accounting?.io?.available ? {
      available: true,
      read_bytes: accounting.io.read_bytes,
      write_bytes: accounting.io.write_bytes,
      read_operations: accounting.io.read_operations,
      write_operations: accounting.io.write_operations,
      reason: null,
    } : {
      available: false,
      read_bytes: null,
      write_bytes: null,
      read_operations: null,
      write_operations: null,
      reason: 'cgroup io.stat was unavailable for this adapter or scope',
    },
  };
}

async function runFixtureExecution({
  root, marker, fixtureMetadata: fixtureSource, name, mode, runIndex, warmups, warmSamples,
}) {
  const rawRelative = `raw/${name}.json`;
  const telemetryRelative = `telemetry/${name}.json`;
  const rawFile = path.join(root, rawRelative);
  const telemetryFile = path.join(root, telemetryRelative);
  const telemetrySamples = [];
  const command = [process.execPath, FIXTURE, mode,
    String(mode === 'warm' ? warmups : 0), String(mode === 'warm' ? warmSamples : 1)];
  const report = await runSafely({
    command,
    tier: 'small',
    cwd: REPOSITORY,
    reportFile: rawFile,
    overrides: DEFAULT_LIMITS,
    workloadId: `runtime-v1:${mode}`,
    promote: false,
    measurementObserver(sample) {
      if (sample?.accounting) {
        telemetrySamples.push(sample);
        if (telemetrySamples.length > MAX_TELEMETRY_SAMPLES) telemetrySamples.shift();
      }
    },
  });
  const rawRegistration = registerOwnedFile(
    root, marker, rawRelative, MAX_RAW_ARTIFACT_BYTES,
  );
  const safeValidation = validateSafeRunnerReport(report);
  const outcome = classifySafeRunnerOutcome(report);
  let fixture = null;
  let fixtureError = null;
  if (outcome === 'success') {
    try {
      fixture = parseFixtureRecord(report, {
        mode,
        warmups: mode === 'warm' ? warmups : 0,
        warmSamples: mode === 'warm' ? warmSamples : 1,
        childProcesses: 1,
        fixtureMetadata: fixtureSource,
      });
    } catch (error) { fixtureError = error.message; }
  }
  const accounting = latestAccounting(telemetrySamples);
  const telemetry = {
    schema: 'lamina.runtime-benchmark-telemetry/v1',
    samples: telemetrySamples,
  };
  atomicWrite(telemetryFile, stableJson(telemetry), {
    root, rootIdentity: marker.root_identity,
  });
  const telemetryRegistration = registerOwnedFile(
    root, marker, telemetryRelative, MAX_TELEMETRY_ARTIFACT_BYTES,
  );
  const runnerPeak = report.peaks?.aggregate_rss_bytes || 0;
  const aggregatePeak = runnerPeak;
  const difference = Math.abs(aggregatePeak - runnerPeak);
  const telemetryValues = telemetrySummary(accounting);
  const measurementValid = outcome === 'success' && safeValidation.valid && fixture !== null
    && report.cleanup?.descendants_remaining?.length === 0
    && report.cleanup?.managed_paths_remaining?.length === 0
    && report.cleanup?.scope_removed === true
    && report.cleanup?.temporary_directory_removed === true
    && report.cleanup?.errors?.length === 0
    && accounting?.cpu?.available === true;
  return {
    execution: {
      run_index: runIndex,
      outcome,
      measurement_valid: measurementValid,
      termination_reason: report.termination?.reason || null,
      limit: report.termination?.limit || null,
      wall_time_ms: report.duration_ms || 0,
      exit_status: report.termination?.child_exit_code ?? null,
      exit_signal: report.termination?.child_signal || null,
      aggregate_peak_rss_bytes: aggregatePeak,
      cgroup_peak_memory_bytes: report.peaks?.cgroup_memory_bytes || 0,
      runner_peak_rss_bytes: runnerPeak,
      memory_difference_bytes: difference,
      memory_tolerance_bytes: 0,
      memory_agrees: difference === 0,
      per_process_peak_rss: (report.descendants || []).map((item) => ({
        pid: item.pid,
        ppid: item.ppid ?? null,
        command: item.command || '',
        peak_rss_bytes: item.peak_rss_bytes || 0,
      })),
      cpu_time_ms: telemetryValues.cpu_time_ms,
      io: telemetryValues.io,
      derived_state: {
        before_bytes: 0,
        peak_bytes: report.peaks?.temporary_bytes || 0,
        after_bytes: report.cleanup?.temporary_directory_removed === true ? 0
          : report.peaks?.temporary_bytes || 0,
      },
      remaining_descendants: report.cleanup?.descendants_remaining || [],
      scope_phase_time_ns: fixture?.lifecycle_outer_phase_time_ns
        || new Array(LIFECYCLE_PHASES.length).fill(null),
      raw_report: rawRelative,
      raw_report_sha256: rawRegistration.sha256,
      telemetry: telemetryRelative,
      telemetry_sha256: telemetryRegistration.sha256,
    },
    fixture,
    errors: [
      ...(!safeValidation.valid ? safeValidation.errors : []),
      ...(fixtureError ? [fixtureError] : []),
      ...(!accounting?.cpu?.available ? ['cgroup CPU accounting was unavailable'] : []),
    ],
    artifacts: [
      { path: rawRelative, sha256: rawRegistration.sha256, bytes: rawRegistration.bytes },
      {
        path: telemetryRelative,
        sha256: telemetryRegistration.sha256,
        bytes: telemetryRegistration.bytes,
      },
    ],
  };
}

function buildSeries(coldRuns, warmRun, configuration) {
  const coldSamples = coldRuns.flatMap((run, runIndex) =>
    (run.fixture?.observations || [])
      .filter((sample) => sample.classification === 'cold')
      .map((sample) => ({ ...sample, index: runIndex })));
  const warmObservations = warmRun.fixture?.observations || [];
  const warmups = warmObservations.filter((sample) => sample.classification === 'warmup');
  const warmSamples = warmObservations.filter((sample) => sample.classification === 'measured_warm');
  const placeholderStatistics = { samples: [], median: 0, p90: null, p95: null, maximum: 0 };
  return [
    {
      id: 'tiny-cold',
      kind: 'cold',
      warmup_count: 0,
      measured_count: coldSamples.length,
      warmup_wall_time_ns: [],
      samples: coldSamples,
      statistics: coldSamples.length === configuration.cold_runs
        ? summarizeLatency(coldSamples.map((sample) => sample.wall_time_ns), 'cold')
        : placeholderStatistics,
      executions: coldRuns.map((run) => run.execution),
    },
    {
      id: 'tiny-warm',
      kind: 'warm',
      warmup_count: warmups.length,
      measured_count: warmSamples.length,
      warmup_wall_time_ns: warmups.map((sample) => sample.wall_time_ns),
      samples: warmSamples,
      statistics: warmSamples.length === configuration.warm_samples
        ? summarizeLatency(warmSamples.map((sample) => sample.wall_time_ns), 'warm')
        : placeholderStatistics,
      executions: [warmRun.execution],
    },
  ];
}

export function summarizeResult(result) {
  const cold = result.series.find((series) => series.kind === 'cold');
  const warm = result.series.find((series) => series.kind === 'warm');
  const peakMemory = Math.max(0, ...result.series.flatMap((series) =>
    series.executions.map((execution) => execution.cgroup_peak_memory_bytes)));
  return [
    '# Lamina runtime benchmark v1',
    '',
    `- Status: \`${result.status}\``,
    `- Fixture: \`${result.fixture.id}@${result.fixture.version}\` (\`${result.fixture.digest.slice(0, 12)}\`)`,
    `- Cold: ${cold.measured_count} isolated runs; median ${cold.statistics.median} ns; max ${cold.statistics.maximum} ns; p95 not reported`,
    `- Warm: ${warm.warmup_count} excluded warm-up(s), ${warm.measured_count} measured; median ${warm.statistics.median} ns; p90 ${warm.statistics.p90} ns; p95 ${warm.statistics.p95} ns`,
    `- Complete-scope peak memory: ${peakMemory} bytes`,
    `- Raw artifacts: ${result.artifacts.length} referenced files`,
    `- Remaining descendants: ${result.cleanup.remaining_descendants}`,
    '',
    'This tiny-fixture result validates the measurement harness. It is not a Lamina product baseline.',
    '',
  ].join('\n');
}

function readResultFile(requested) {
  const file = path.resolve(requested);
  return JSON.parse(readBoundedPhysicalFile(file, MAX_RESULT_BYTES).toString('utf8'));
}

export async function runRuntimeBenchmark({
  output,
  coldRuns = MIN_COLD_RUNS,
  warmups = MIN_WARMUPS,
  warmSamples = MIN_WARM_SAMPLES,
} = {}) {
  if (!output) throw new Error('run requires an explicit new --output directory');
  if (!Number.isSafeInteger(coldRuns) || coldRuns < MIN_COLD_RUNS || coldRuns > MAX_COLD_RUNS) {
    throw new Error(`cold runs must be ${MIN_COLD_RUNS}-${MAX_COLD_RUNS}`);
  }
  if (!Number.isSafeInteger(warmups) || warmups < MIN_WARMUPS || warmups > MAX_WARMUPS) {
    throw new Error(`warmups must be ${MIN_WARMUPS}-${MAX_WARMUPS}`);
  }
  if (!Number.isSafeInteger(warmSamples)
    || warmSamples < MIN_WARM_SAMPLES || warmSamples > MAX_WARM_SAMPLES) {
    throw new Error(`warm samples must be ${MIN_WARM_SAMPLES}-${MAX_WARM_SAMPLES}`);
  }
  const { root, marker } = initializeHarnessRoot(output);
  const sourceBefore = sourceMetadata();
  const fixture = fixtureMetadata();
  const configuration = {
    tier: 'small', cold_runs: coldRuns, warmups, warm_samples: warmSamples,
    limits: DEFAULT_LIMITS,
  };
  const cold = [];
  for (let index = 0; index < coldRuns; index += 1) {
    cold.push(await runFixtureExecution({
      root, marker, fixtureMetadata: fixture, name: `cold-${index}`,
      mode: 'cold', runIndex: index, warmups, warmSamples,
    }));
  }
  const warm = await runFixtureExecution({
    root, marker, fixtureMetadata: fixture, name: 'warm',
    mode: 'warm', runIndex: 0, warmups, warmSamples,
  });
  const sourceAfter = sourceMetadata();
  const errors = [...cold, warm].flatMap((run) => run.errors);
  if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter)) {
    errors.push('repository source metadata changed during the benchmark');
  }
  const series = buildSeries(cold, warm, configuration);
  const executions = series.flatMap((item) => item.executions);
  const status = executions.every((execution) => execution.measurement_valid)
    ? 'valid' : executions.some((execution) => execution.outcome === 'safe_refusal')
      ? 'refused' : 'invalid';
  const identity = benchmarkIdentity(sourceBefore, fixture, configuration);
  const cliManifest = JSON.parse(fs.readFileSync(path.join(REPOSITORY, 'packages/cli/package.json'), 'utf8'));
  const result = {
    schema: RESULT_SCHEMA,
    schema_version: RESULT_SCHEMA_VERSION,
    result_id: identity.result_id,
    generated_at: new Date().toISOString(),
    status,
    input_digest: identity.input_digest,
    source: sourceBefore,
    host: hostMetadata(),
    runtimes: {
      node: process.version,
      lamina_cli: cliManifest.version,
      graph_protocol: GRAPH_PROTOCOL_VERSION,
      safe_runner_report: 'lamina.safe-runner-report/v1',
      harness: '1',
    },
    fixture,
    configuration,
    lifecycle_phases: LIFECYCLE_PHASES,
    series,
    artifacts: [...cold, warm].flatMap((run) => run.artifacts),
    cleanup: {
      scoped: true,
      marker: ROOT_MARKER,
      remaining_descendants: executions.reduce((sum, execution) =>
        sum + execution.remaining_descendants.length, 0),
      unexpected_paths: ownedTreeEntries(root, marker),
    },
    errors,
  };
  atomicWrite(path.join(root, RESULT_FILE), stableJson(result), {
    root, rootIdentity: marker.root_identity,
  });
  registerOwnedFile(root, marker, RESULT_FILE, MAX_RESULT_BYTES);
  const validation = validateResult(result, { artifactRoot: root });
  if (status === 'valid') assertValidResult(result, { artifactRoot: root });
  atomicWrite(path.join(root, SUMMARY_FILE), summarizeResult(result), {
    root, rootIdentity: marker.root_identity,
  });
  registerOwnedFile(root, marker, SUMMARY_FILE, MAX_RESULT_BYTES);
  return { result, validation, root };
}

function integer(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} requires an integer`);
  return parsed;
}

function option(args, name) {
  const indexes = args.flatMap((value, index) => value === name ? [index] : []);
  if (indexes.length > 1) throw new Error(`${name} cannot be repeated`);
  const [index = -1] = indexes;
  if (index === -1) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'run') {
    const output = option(args, '--output');
    const allowed = new Set(['--output', '--cold-runs', '--warmups', '--warm-samples']);
    for (let index = 0; index < args.length; index += 2) {
      if (!allowed.has(args[index])) throw new Error(`unknown run option: ${args[index]}`);
    }
    const run = await runRuntimeBenchmark({
      output,
      coldRuns: option(args, '--cold-runs') === null ? MIN_COLD_RUNS
        : integer(option(args, '--cold-runs'), '--cold-runs'),
      warmups: option(args, '--warmups') === null ? MIN_WARMUPS
        : integer(option(args, '--warmups'), '--warmups'),
      warmSamples: option(args, '--warm-samples') === null ? MIN_WARM_SAMPLES
        : integer(option(args, '--warm-samples'), '--warm-samples'),
    });
    process.stdout.write(stableJson({
      result: path.join(run.root, RESULT_FILE),
      summary: path.join(run.root, SUMMARY_FILE),
      status: run.result.status,
      valid: run.validation.valid,
    }));
    return run.result.status === 'valid' && run.validation.valid ? 0 : 2;
  }
  if (command === 'validate') {
    const file = option(args, '--file');
    if (!file || args.length !== 2) throw new Error('validate requires exactly --file <result.json>');
    const result = readResultFile(file);
    const validation = validateResult(result, { artifactRoot: path.dirname(path.resolve(file)) });
    process.stdout.write(stableJson(validation));
    return validation.valid ? 0 : 1;
  }
  if (command === 'summary') {
    const file = option(args, '--file');
    if (!file || args.length !== 2) throw new Error('summary requires exactly --file <result.json>');
    const result = readResultFile(file);
    assertValidResult(result, { artifactRoot: path.dirname(path.resolve(file)) });
    process.stdout.write(summarizeResult(result));
    return 0;
  }
  if (command === 'cleanup') {
    const root = option(args, '--root');
    if (!root || args.length !== 2) throw new Error('cleanup requires exactly --root <owned-directory>');
    process.stdout.write(stableJson(cleanupHarnessRoot(root)));
    return 0;
  }
  process.stdout.write('Usage: runtime-v1 <run|validate|summary|cleanup> [options]\n');
  return command ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(stableJson({
      schema: 'lamina.runtime-benchmark-cli-error/v1',
      error: { code: error.code || 'LAMINA_RUNTIME_BENCHMARK_USAGE', message: error.message },
    }));
    process.exitCode = 2;
  }
}
