import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPORT_SCHEMA, REPORT_SCHEMA_VERSION } from './constants.mjs';

const SCHEMA_FILE = fileURLToPath(new URL('./schema/report.schema.json', import.meta.url));
const BUNDLED_SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));

export function baseReport({ tier = null, command = [], cwd = process.cwd() } = {}) {
  return {
    schema: REPORT_SCHEMA,
    schema_version: REPORT_SCHEMA_VERSION,
    run_id: `safe-${Date.now()}-${process.pid}`,
    report_file: null,
    outcome: 'internal_error',
    tier,
    command,
    cwd,
    started_at: new Date().toISOString(),
    finished_at: null,
    duration_ms: 0,
    adapter: null,
    limits: null,
    preflight: null,
    samples: [],
    peaks: { aggregate_rss_bytes: 0, pids: 0, temporary_bytes: 0 },
    descendants: [],
    output: {
      stdout_bytes: 0,
      stderr_bytes: 0,
      total_bytes: 0,
      stdout_tail: '',
      stderr_tail: '',
      truncated: false,
    },
    termination: {
      reason: null,
      limit: null,
      requested_signals: [],
      child_exit_code: null,
      child_signal: null,
      cgroup_events: {},
    },
    cleanup: {
      attempted: false,
      descendants_remaining: [],
      scope_removed: null,
      temporary_directory_removed: null,
      lock_released: null,
      errors: [],
    },
    error: null,
  };
}

export function finishReport(report, startedMs) {
  report.finished_at = new Date().toISOString();
  report.duration_ms = Math.max(0, Date.now() - startedMs);
  return report;
}

function matchesType(value, expected) {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expected;
}

function validateNode(value, schema, location, errors) {
  if (Array.isArray(schema.oneOf)) {
    const alternatives = schema.oneOf.filter((candidate) => {
      const candidateErrors = [];
      validateNode(value, candidate, location, candidateErrors);
      return candidateErrors.length === 0;
    });
    if (alternatives.length !== 1) errors.push(`${location} must match exactly one schema alternative`);
    return;
  }
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
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
      errors.push(`${location} must be an ISO date-time`);
    }
  }
  if (typeof value === 'number' && schema.minimum != null && value < schema.minimum) {
    errors.push(`${location} must be at least ${schema.minimum}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validateNode(item, schema.items, `${location}[${index}]`, errors));
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
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) validateNode(value[key], childSchema, `${location}.${key}`, errors);
    }
  }
}

export function validateReport(report) {
  const errors = [];
  validateNode(report, BUNDLED_SCHEMA, '$', errors);
  return { valid: errors.length === 0, errors, schema: BUNDLED_SCHEMA.$id };
}

export function writeReport(file, report) {
  const validation = validateReport(report);
  if (!validation.valid) {
    const error = new Error(`Refusing invalid safe-runner report: ${validation.errors.join('; ')}`);
    error.code = 'LAMINA_SAFE_REPORT_INVALID';
    throw error;
  }
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, resolved);
  return resolved;
}

export function writeReportWithFallback(file, report) {
  const requested = file ? path.resolve(file) : null;
  const fallback = path.join(os.tmpdir(), `lamina-safe-runner-report-${process.pid}-${Date.now()}.json`);
  report.report_file = requested || fallback;
  try {
    return { path: writeReport(report.report_file, report), fallback: !requested, write_error: null };
  } catch (error) {
    report.outcome = 'internal_error';
    report.termination.reason = 'report_write_failed';
    report.error = {
      code: 'LAMINA_SAFE_REPORT_WRITE_FAILED',
      message: String(error.message || error).slice(0, 2_000),
    };
    report.cleanup.errors.push(`requested report write failed: ${String(error.message || error).slice(0, 1_000)}`);
    report.report_file = fallback;
    return { path: writeReport(fallback, report), fallback: true, write_error: error };
  }
}
