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
import { summarizeLatency } from './statistics.mjs';

const SCHEMA_FILE = fileURLToPath(new URL('./schema/result.schema.json', import.meta.url));
const BUNDLED_SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function matchesType(value, expected) {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'integer') return Number.isInteger(value);
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
    || cold.samples?.some((sample) => sample.classification !== 'cold')
    || (complete && cold.samples?.length !== result.configuration?.cold_runs)) {
    errors.push('$.series cold runs must be separately executed, measured, and never labeled warm');
  }
  if (warm.id !== 'tiny-warm'
    || warm.warmup_count !== warm.warmup_wall_time_ns?.length
    || warm.warmup_count > result.configuration?.warmups
    || warm.measured_count !== warm.samples?.length
    || warm.samples?.length > result.configuration?.warm_samples
    || warm.executions?.length !== 1
    || warm.samples?.some((sample) => sample.classification !== 'measured_warm')
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

function validateArtifacts(result, artifactRoot, errors) {
  const executions = (result.series || []).flatMap((series) => series.executions || []);
  const artifacts = new Map((result.artifacts || []).map((item) => [item.path, item]));
  if (artifacts.size !== executions.length * 2 || artifacts.size !== (result.artifacts || []).length) {
    errors.push('$.artifacts must reference one raw report and one telemetry sidecar per execution');
  }
  for (const execution of executions) {
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
      || execution.memory_agrees
        !== (execution.memory_difference_bytes <= execution.memory_tolerance_bytes)) {
      errors.push(`${execution.raw_report} has contradictory aggregate-memory agreement`);
    }
    if (execution.measurement_valid && (execution.outcome !== 'success'
      || execution.remaining_descendants.length !== 0 || !execution.memory_agrees)) {
      errors.push(`${execution.raw_report} cannot be a valid measurement`);
    }
    if (!artifactRoot) continue;
    const root = path.resolve(artifactRoot);
    const readArtifact = (relative, expected) => {
      const normalized = relative.replaceAll('\\', '/');
      if (path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
        throw new Error('is not a bounded relative artifact path');
      }
      const candidate = path.resolve(root, normalized);
      if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error('escapes the artifact root');
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('artifact is not a physical file');
      const bytes = fs.readFileSync(candidate);
      if (expected.bytes !== bytes.length || expected.sha256 !== digest(bytes)) {
        throw new Error('artifact size or digest mismatch');
      }
      return bytes;
    };
    try {
      const bytes = readArtifact(execution.raw_report, artifact);
      const report = JSON.parse(bytes.toString('utf8'));
      const safeValidation = validateSafeRunnerReport(report);
      if (!safeValidation.valid) throw new Error(`invalid safe-runner report: ${safeValidation.errors.join('; ')}`);
      if (classifySafeRunnerOutcome(report) !== execution.outcome
        || report.duration_ms !== execution.wall_time_ms
        || report.peaks.aggregate_rss_bytes !== execution.runner_peak_rss_bytes
        || report.peaks.cgroup_memory_bytes !== execution.cgroup_peak_memory_bytes
        || !same(report.cleanup.descendants_remaining, execution.remaining_descendants)) {
        throw new Error('raw safe-runner report contradicts the summarized execution');
      }
    } catch (error) {
      errors.push(`${execution.raw_report}: ${error.message}`);
    }
    try {
      const bytes = readArtifact(execution.telemetry, telemetryArtifact);
      const telemetry = JSON.parse(bytes.toString('utf8'));
      if (telemetry?.schema !== 'lamina.runtime-benchmark-telemetry/v1'
        || !Array.isArray(telemetry.samples) || telemetry.samples.length > 64
        || telemetry.samples.some((sample) => !Number.isFinite(sample?.elapsed_ms)
          || sample.elapsed_ms < 0 || sample.accounting === null
          || typeof sample.accounting !== 'object')) {
        throw new Error('invalid bounded telemetry sidecar');
      }
    } catch (error) {
      errors.push(`${execution.telemetry}: ${error.message}`);
    }
  }
}

export function validateResult(result, { artifactRoot = null } = {}) {
  const errors = [];
  validateNode(result, BUNDLED_SCHEMA, '$', errors);
  if (result?.schema !== RESULT_SCHEMA || result?.schema_version !== RESULT_SCHEMA_VERSION) {
    errors.push('$.schema version is unsupported');
  }
  if (!same(result?.lifecycle_phases, LIFECYCLE_PHASES)) {
    errors.push('$.lifecycle_phases must contain the complete canonical phase order');
  }
  validateSeries(result, errors);
  validateArtifacts(result, artifactRoot, errors);
  const executions = (result?.series || []).flatMap((series) => series.executions || []);
  const allValid = executions.length > 0
    && executions.every((execution) => execution.measurement_valid === true);
  const refused = executions.some((execution) => execution.outcome === 'safe_refusal');
  const expectedStatus = allValid ? 'valid' : refused ? 'refused' : 'invalid';
  if (result?.status !== expectedStatus) errors.push(`$.status must be ${expectedStatus}`);
  if (result?.status !== 'valid' && executions.some((execution) => execution.measurement_valid)) {
    errors.push('$.status non-valid cannot mix publishable measurements into an incomplete result');
  }
  if (result?.status === 'valid' && (result.errors?.length !== 0
    || result.cleanup?.remaining_descendants !== 0
    || result.cleanup?.unexpected_paths?.length !== 0)) {
    errors.push('$.status valid requires no errors, descendants, or unexpected paths');
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
