import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReport as validateSafeRunnerReport } from '../../scripts/safe-runner/report.mjs';
import {
  LIFECYCLE_PHASES,
  MEASUREMENT_OUTCOMES,
  RESULT_SCHEMA,
  RESULT_SCHEMA_VERSION,
  WARM_MEASURED_PHASES,
} from './constants.mjs';
import { validateFixtureRecord } from './fixture-contract.mjs';
import { benchmarkIdentity } from './identity.mjs';
import {
  assertPhysicalDirectoryAncestry, readBoundedPhysicalFile,
} from './physical-files.mjs';
import { summarizeLatency } from './statistics.mjs';

const SCHEMA_FILE = fileURLToPath(new URL('./schema/result.schema.json', import.meta.url));
const BUNDLED_SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
const MAX_RAW_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_TELEMETRY_ARTIFACT_BYTES = 128 * 1024;

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function matchesType(value, expected) {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'integer') return Number.isSafeInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expected;
}

function validateNode(value, schema, location, errors) {
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${location} must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    errors.push(`${location} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`${location} must have type ${types.join('|')}`);
      return;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${location} is too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${location} has an invalid format`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
      errors.push(`${location} must be an ISO date-time`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${location} must be at least ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${location} must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${location} has too few items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${location} has too many items`);
    if (schema.items) value.forEach((item, index) => validateNode(item, schema.items, `${location}[${index}]`, errors));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) errors.push(`${location}.${required} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties || {}, key)) errors.push(`${location}.${key} is not allowed`);
      }
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) validateNode(value[key], child, `${location}.${key}`, errors);
    }
  }
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...keys].sort());
const nonNegativeSafeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

export function classifySafeRunnerOutcome(report) {
  if (report?.outcome === 'success') return 'success';
  if (report?.outcome === 'preflight_refused') return 'safe_refusal';
  if (report?.outcome === 'interrupted') return 'cancellation';
  if (report?.outcome === 'command_failed') return 'command_failure';
  if (report?.outcome === 'safety_limit_exceeded') {
    return report?.termination?.limit === 'timeout' ? 'timeout' : 'limit_hit';
  }
  return 'internal_error';
}

function validateSeries(result, errors) {
  if (!Array.isArray(result.series)) return;
  const byKind = new Map(result.series.map((series) => [series.kind, series]));
  if (byKind.size !== 2 || !byKind.has('cold') || !byKind.has('warm')) {
    errors.push('$.series must contain exactly one cold and one warm series');
    return;
  }
  const cold = byKind.get('cold');
  const warm = byKind.get('warm');
  const complete = result.status === 'valid';
  if (cold.id !== 'tiny-cold' || cold.warmup_count !== 0
    || cold.measured_count !== cold.samples?.length
    || cold.samples?.length > result.configuration?.cold_runs
    || cold.executions?.length !== result.configuration?.cold_runs
    || cold.warmup_wall_time_ns?.length !== 0
    || cold.samples?.some((sample, index) => sample.classification !== 'cold' || sample.index !== index)
    || cold.executions?.some((execution, index) => execution.run_index !== index)
    || (complete && cold.samples?.length !== result.configuration?.cold_runs)) {
    errors.push('$.series cold runs must be separately executed, measured, and never labeled warm');
  }
  if (warm.id !== 'tiny-warm'
    || warm.warmup_count !== warm.warmup_wall_time_ns?.length
    || warm.warmup_count > result.configuration?.warmups
    || warm.measured_count !== warm.samples?.length
    || warm.samples?.length > result.configuration?.warm_samples
    || warm.executions?.length !== 1
    || warm.samples?.some((sample, index) => sample.classification !== 'measured_warm'
      || sample.index !== index)
    || warm.executions?.[0]?.run_index !== 0
    || (complete && (warm.warmup_count !== result.configuration?.warmups
      || warm.samples?.length !== result.configuration?.warm_samples))) {
    errors.push('$.series warm statistics must exclude explicit warm-ups and contain the configured measurements');
  }
  for (const series of [cold, warm]) {
    if (!Array.isArray(series.samples) || !series.statistics) continue;
    const values = series.samples.map((sample) => sample.wall_time_ns);
    try {
      const expected = values.length === 0
        ? { samples: [], median: 0, p90: null, p95: null, maximum: 0 }
        : summarizeLatency(values, series.kind);
      if (!same(expected, series.statistics)) {
        errors.push(`$.series ${series.kind} statistics contradict their raw samples`);
      }
    } catch (error) {
      errors.push(`$.series ${series.kind}: ${error.message}`);
    }
    for (const sample of series.samples) {
      if (sample.phase_time_ns?.length !== LIFECYCLE_PHASES.length) {
        errors.push(`$.series ${series.kind} sample ${sample.index} has incomplete lifecycle phases`);
      }
    }
  }
  const warmIndexes = new Set(WARM_MEASURED_PHASES.map((name) => LIFECYCLE_PHASES.indexOf(name)));
  if (cold.samples?.some((sample) => sample.phase_time_ns.some((value) => value === null))
    || cold.executions?.some((execution) => execution.scope_phase_time_ns.some((value) => value !== null))) {
    errors.push('$.series cold samples must measure every phase inside each isolated scope');
  }
  if (warm.samples?.some((sample) => sample.phase_time_ns.some((value, index) =>
    warmIndexes.has(index) ? value === null : value !== null))
    || warm.executions?.some((execution) => execution.scope_phase_time_ns.some((value, index) =>
      warmIndexes.has(index) ? value !== null : value === null))) {
    errors.push('$.series warm samples and scope lifecycle measurements overlap or leave a phase unmeasured');
  }
}

function validAccounting(accounting) {
  if (!exactKeys(accounting, ['cpu', 'io'])) return false;
  const { cpu, io } = accounting;
  if (!exactKeys(cpu, [
    'available', 'usage_usec', 'user_usec', 'system_usec', 'nr_periods',
    'nr_throttled', 'throttled_usec', 'reason',
  ]) || typeof cpu.available !== 'boolean') return false;
  const cpuUsage = [cpu.usage_usec, cpu.user_usec, cpu.system_usec];
  const cpuOptional = [cpu.nr_periods, cpu.nr_throttled, cpu.throttled_usec];
  const cpuValid = cpu.available
    ? cpuUsage.every(nonNegativeSafeInteger)
      && cpuOptional.every((value) => value === null || nonNegativeSafeInteger(value))
      && cpu.reason === null
    : cpuUsage.every((value) => value === null)
      && cpuOptional.every((value) => value === null || nonNegativeSafeInteger(value))
      && typeof cpu.reason === 'string' && cpu.reason.length > 0;
  if (!cpuValid || !exactKeys(io, [
    'available', 'devices', 'read_bytes', 'write_bytes', 'read_operations', 'write_operations',
  ]) || typeof io.available !== 'boolean' || !nonNegativeSafeInteger(io.devices)) return false;
  const ioValues = [io.read_bytes, io.write_bytes, io.read_operations, io.write_operations];
  return io.available
    ? io.devices > 0 && ioValues.every(nonNegativeSafeInteger)
    : io.devices === 0 && ioValues.every((value) => value === null);
}

function monotonicAccounting(previous, current) {
  if (!previous) return true;
  const monotonic = (left, right, keys) => keys.every((key) =>
    left[key] === null || right[key] === null || right[key] >= left[key]);
  if (previous.cpu.available && current.cpu.available
    && !monotonic(previous.cpu, current.cpu, [
      'usage_usec', 'user_usec', 'system_usec', 'nr_periods', 'nr_throttled', 'throttled_usec',
    ])) return false;
  if (previous.io.available && current.io.available
    && !monotonic(previous.io, current.io, [
      'read_bytes', 'write_bytes', 'read_operations', 'write_operations',
    ])) return false;
  return true;
}

function validateTelemetrySidecar(telemetry) {
  if (!exactKeys(telemetry, ['schema', 'samples'])
    || telemetry.schema !== 'lamina.runtime-benchmark-telemetry/v1'
    || !Array.isArray(telemetry.samples) || telemetry.samples.length > 64) return false;
  return telemetry.samples.every((sample, index) => exactKeys(sample, ['elapsed_ms', 'accounting'])
    && nonNegativeSafeInteger(sample.elapsed_ms)
    && validAccounting(sample.accounting)
    && (index === 0 || sample.elapsed_ms >= telemetry.samples[index - 1].elapsed_ms)
    && monotonicAccounting(telemetry.samples[index - 1]?.accounting, sample.accounting));
}

function validateArtifacts(result, artifactRoot, errors) {
  const contexts = (result.series || []).flatMap((series) =>
    (series.executions || []).map((execution, executionIndex) => ({
      execution, executionIndex, series,
    })));
  const executions = contexts.map(({ execution }) => execution);
  const artifacts = new Map((result.artifacts || []).map((item) => [item.path, item]));
  if (artifacts.size !== executions.length * 2 || artifacts.size !== (result.artifacts || []).length) {
    errors.push('$.artifacts must reference one raw report and one telemetry sidecar per execution');
  }
  if (!artifactRoot) {
    errors.push('artifactRoot is required to validate referenced execution evidence');
    return;
  }
  const root = path.resolve(artifactRoot);
  let rootIdentity = null;
  try { rootIdentity = assertPhysicalDirectoryAncestry(root); } catch (error) {
    errors.push(`artifactRoot: ${error.message}`);
    return;
  }
  for (const { execution, executionIndex, series } of contexts) {
    if (!MEASUREMENT_OUTCOMES.includes(execution.outcome)) continue;
    const artifact = artifacts.get(execution.raw_report);
    const telemetryArtifact = artifacts.get(execution.telemetry);
    if (!artifact || artifact.sha256 !== execution.raw_report_sha256) {
      errors.push(`$.artifacts is missing or contradicts ${execution.raw_report}`);
      continue;
    }
    if (!telemetryArtifact || telemetryArtifact.sha256 !== execution.telemetry_sha256) {
      errors.push(`$.artifacts is missing or contradicts ${execution.telemetry}`);
      continue;
    }
    if (execution.memory_difference_bytes
      !== Math.abs(execution.aggregate_peak_rss_bytes - execution.runner_peak_rss_bytes)
      || execution.memory_tolerance_bytes !== 0
      || execution.memory_agrees
        !== (execution.memory_difference_bytes <= execution.memory_tolerance_bytes)) {
      errors.push(`${execution.raw_report} has contradictory aggregate-memory agreement`);
    }
    if (execution.measurement_valid && (execution.outcome !== 'success'
      || execution.remaining_descendants.length !== 0 || !execution.memory_agrees)) {
      errors.push(`${execution.raw_report} cannot be a valid measurement`);
    }
    const readArtifact = (relative, expected, maximumBytes) => {
      const normalized = relative.replaceAll('\\', '/');
      if (path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
        throw new Error('is not a bounded relative artifact path');
      }
      const candidate = path.resolve(root, normalized);
      if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error('escapes the artifact root');
      const bytes = readBoundedPhysicalFile(candidate, maximumBytes, { root, rootIdentity });
      if (expected.bytes !== bytes.length || expected.sha256 !== digest(bytes)) {
        throw new Error('artifact size or digest mismatch');
      }
      return bytes;
    };
    let report = null;
    let fixtureRecord = null;
    try {
      const bytes = readArtifact(execution.raw_report, artifact, MAX_RAW_ARTIFACT_BYTES);
      report = JSON.parse(bytes.toString('utf8'));
      const safeValidation = validateSafeRunnerReport(report);
      if (!safeValidation.valid) throw new Error(`invalid safe-runner report: ${safeValidation.errors.join('; ')}`);
      const processPeaks = (report.descendants || []).map((item) => ({
        pid: item.pid,
        ppid: item.ppid ?? null,
        command: item.command || '',
        peak_rss_bytes: item.peak_rss_bytes || 0,
      }));
      const derivedState = {
        before_bytes: 0,
        peak_bytes: report.peaks.temporary_bytes,
        after_bytes: report.cleanup.temporary_directory_removed === true
          ? 0 : report.peaks.temporary_bytes,
      };
      if (classifySafeRunnerOutcome(report) !== execution.outcome
        || report.duration_ms !== execution.wall_time_ms
        || report.peaks.aggregate_rss_bytes !== execution.runner_peak_rss_bytes
        || report.peaks.cgroup_memory_bytes !== execution.cgroup_peak_memory_bytes
        || report.termination.reason !== execution.termination_reason
        || report.termination.limit !== execution.limit
        || (report.termination.child_exit_code ?? null) !== execution.exit_status
        || (report.termination.child_signal || null) !== execution.exit_signal
        || !same(processPeaks, execution.per_process_peak_rss)
        || !same(derivedState, execution.derived_state)
        || !same(report.cleanup.descendants_remaining, execution.remaining_descendants)) {
        throw new Error('raw safe-runner report contradicts the summarized execution');
      }
      const fixtureLines = String(report.output.stdout_tail || '').trim().split('\n').filter(Boolean);
      for (const line of fixtureLines.reverse()) {
        try {
          const parsed = JSON.parse(line);
          if (parsed?.schema === 'lamina.runtime-benchmark-fixture/v1') {
            if (Buffer.byteLength(line) > 7 * 1024) {
              throw new Error('fixture record exceeds its retained-tail budget');
            }
            fixtureRecord = parsed;
            break;
          }
        } catch (error) {
          if (error.message.includes('fixture record')) throw error;
        }
      }
      if (execution.outcome === 'success' && !fixtureRecord) {
        throw new Error('successful raw report lacks fixture evidence');
      }
      if (fixtureRecord) {
        const fixtureValidation = validateFixtureRecord(fixtureRecord, {
          mode: series.kind,
          warmups: series.kind === 'warm' ? result.configuration.warmups : 0,
          warmSamples: series.kind === 'warm' ? result.configuration.warm_samples : 1,
          childProcesses: result.fixture.child_processes,
          fixtureMetadata: result.fixture,
        });
        if (!fixtureValidation.valid) {
          throw new Error(`invalid fixture record: ${fixtureValidation.errors.join('; ')}`);
        }
        const observations = fixtureRecord.observations || [];
        const measured = observations.filter((sample) => sample.classification !== 'warmup');
        const normalizedMeasured = series.kind === 'cold'
          ? measured.map((sample) => ({ ...sample, index: execution.run_index })) : measured;
        const expectedSamples = series.kind === 'cold'
          ? [series.samples[executionIndex]] : series.samples;
        const warmupTimes = observations.filter((sample) => sample.classification === 'warmup')
          .map((sample) => sample.wall_time_ns);
        if (fixtureRecord.mode !== series.kind
          || !same(fixtureRecord.phase_order, LIFECYCLE_PHASES)
          || fixtureRecord.state_removed !== true
          || fixtureRecord.child_processes !== result.fixture.child_processes
          || !same(normalizedMeasured, expectedSamples)
          || !same(fixtureRecord.lifecycle_outer_phase_time_ns, execution.scope_phase_time_ns)
          || (series.kind === 'warm' && !same(warmupTimes, series.warmup_wall_time_ns))) {
          throw new Error('raw fixture evidence contradicts the summarized lifecycle');
        }
      }
    } catch (error) {
      errors.push(`${execution.raw_report}: ${error.message}`);
    }
    let telemetry = null;
    try {
      const bytes = readArtifact(
        execution.telemetry, telemetryArtifact, MAX_TELEMETRY_ARTIFACT_BYTES,
      );
      telemetry = JSON.parse(bytes.toString('utf8'));
      if (!validateTelemetrySidecar(telemetry)) {
        throw new Error('invalid bounded telemetry sidecar');
      }
    } catch (error) {
      errors.push(`${execution.telemetry}: ${error.message}`);
      telemetry = null;
    }
    if (telemetry) {
      const accounting = [...telemetry.samples].reverse().find((sample) =>
        sample.accounting?.cpu?.available || sample.accounting?.io?.available)?.accounting || null;
      const expectedCpu = accounting?.cpu?.available ? accounting.cpu.usage_usec / 1000 : null;
      const expectedIo = accounting?.io?.available ? {
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
      };
      if (execution.cpu_time_ms !== expectedCpu || !same(execution.io, expectedIo)) {
        errors.push(`${execution.telemetry} contradicts summarized CPU or I/O accounting`);
      }
      const rawCleanup = report?.cleanup;
      const expectedMeasurementValid = execution.outcome === 'success'
        && fixtureRecord !== null
        && rawCleanup?.descendants_remaining?.length === 0
        && rawCleanup?.managed_paths_remaining?.length === 0
        && rawCleanup?.scope_removed === true
        && rawCleanup?.temporary_directory_removed === true
        && rawCleanup?.errors?.length === 0
        && accounting?.cpu?.available === true
        && execution.memory_agrees === true;
      if (execution.measurement_valid !== expectedMeasurementValid) {
        errors.push(`${execution.raw_report} has contradictory measurement validity`);
      }
    }
  }
}

export function validateResult(result, { artifactRoot = null } = {}) {
  const errors = [];
  validateNode(result, BUNDLED_SCHEMA, '$', errors);
  if (errors.length === 0) {
    if (result.schema !== RESULT_SCHEMA || result.schema_version !== RESULT_SCHEMA_VERSION) {
      errors.push('$.schema version is unsupported');
    }
    if (!same(result.lifecycle_phases, LIFECYCLE_PHASES)) {
      errors.push('$.lifecycle_phases must contain the complete canonical phase order');
    }
    const identity = benchmarkIdentity(result.source, result.fixture, result.configuration);
    if (result.input_digest !== identity.input_digest || result.result_id !== identity.result_id) {
      errors.push('$.input_digest and $.result_id must be derived from source, fixture, and configuration');
    }
    validateSeries(result, errors);
    validateArtifacts(result, artifactRoot, errors);
    const executions = result.series.flatMap((series) => series.executions);
    const allValid = executions.length > 0
      && executions.every((execution) => execution.measurement_valid === true);
    const refused = executions.some((execution) => execution.outcome === 'safe_refusal');
    const expectedStatus = allValid ? 'valid' : refused ? 'refused' : 'invalid';
    if (result.status !== expectedStatus) errors.push(`$.status must be ${expectedStatus}`);
    if (result.status !== 'valid' && executions.some((execution) => execution.measurement_valid)) {
      errors.push('$.status non-valid cannot mix publishable measurements into an incomplete result');
    }
    if (result.status === 'valid' && (result.errors.length !== 0
      || result.cleanup.remaining_descendants !== 0
      || result.cleanup.unexpected_paths.length !== 0)) {
      errors.push('$.status valid requires no errors, descendants, or unexpected paths');
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    schema: BUNDLED_SCHEMA.$id,
  };
}

export function assertValidResult(result, options) {
  const validation = validateResult(result, options);
  if (!validation.valid) {
    const error = new Error(`runtime benchmark result is invalid: ${validation.errors.join('; ')}`);
    error.code = 'LAMINA_RUNTIME_BENCHMARK_INVALID';
    error.validation = validation;
    throw error;
  }
  return result;
}
