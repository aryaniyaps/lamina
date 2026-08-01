import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPORT_SCHEMA, REPORT_SCHEMA_VERSION } from './constants.mjs';
import { redactCommand, redactEvidence } from './redaction.mjs';

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
    command: redactCommand(command),
    cwd,
    started_at: new Date().toISOString(),
    finished_at: null,
    duration_ms: 0,
    adapter: null,
    limits: null,
    preflight: null,
    samples: [],
    peaks: {
      aggregate_rss_bytes: 0,
      cgroup_memory_bytes: 0,
      pids: 0,
      temporary_bytes: 0,
      temporary_inodes: 0,
    },
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
      managed_paths_remaining: [],
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
  if (errors.length === 0) {
    const launchedOutcome = ['success', 'command_failed', 'safety_limit_exceeded', 'interrupted']
      .includes(report.outcome);
    if (launchedOutcome) {
      if (!report.adapter?.id || !report.limits || report.preflight?.ok !== true) {
        errors.push('$.outcome requires a concrete adapter, limits, and successful preflight');
      }
      if (!Array.isArray(report.samples) || report.samples.length === 0) {
        errors.push('$.outcome requires at least one measurement sample');
      }
      if (report.cleanup?.attempted !== true
        || report.cleanup?.descendants_remaining?.length !== 0
        || report.cleanup?.managed_paths_remaining?.length !== 0
        || report.cleanup?.scope_removed !== true
        || report.cleanup?.temporary_directory_removed !== true
        || report.cleanup?.errors?.length !== 0) {
        errors.push('$.outcome requires complete verified cleanup');
      }
    }
    if (report.outcome === 'success' && report.termination?.reason !== 'completed') {
      errors.push('$.termination.reason must be completed for success');
    }
    if (report.outcome === 'command_failed'
      && (report.termination?.reason !== 'command_failed'
        || !Number.isInteger(report.termination?.child_exit_code)
        || report.termination.child_exit_code === 0)) {
      errors.push('$.command_failed requires a concrete nonzero child exit code');
    }
    if (report.outcome === 'safety_limit_exceeded'
      && (report.termination?.reason !== 'safety_limit_exceeded'
        || typeof report.termination?.limit !== 'string'
        || report.termination.limit.length === 0)) {
      errors.push('$.safety_limit_exceeded requires a concrete limit and reason');
    }
    if (report.outcome === 'interrupted'
      && (report.termination?.reason !== 'interrupted' || report.termination?.limit !== 'signal')) {
      errors.push('$.interrupted requires the signal limit and reason');
    }
    if (report.outcome === 'preflight_refused' && report.preflight?.ok !== false) {
      errors.push('$.preflight must explicitly refuse a preflight_refused outcome');
    }
    if (report.error?.code === 'LAMINA_SAFE_RUN_IN_PROGRESS'
      && (report.outcome !== 'internal_error' || report.termination?.reason !== 'run_in_progress')) {
      errors.push('$.LAMINA_SAFE_RUN_IN_PROGRESS must be a non-success run_in_progress record');
    }
    if (report.output?.total_bytes !== report.output?.stdout_bytes + report.output?.stderr_bytes) {
      errors.push('$.output.total_bytes must equal stdout_bytes plus stderr_bytes');
    }
    const sampleMemoryPeak = Math.max(0, ...(report.samples || []).map((item) => item.aggregate_rss_bytes));
    const sampleCgroupPeak = Math.max(0, ...(report.samples || []).map((item) => item.cgroup_memory_bytes));
    const samplePidPeak = Math.max(0, ...(report.samples || []).map((item) => item.pids));
    const sampleTempPeak = Math.max(0, ...(report.samples || []).map((item) => item.temporary_bytes));
    const sampleInodePeak = Math.max(0, ...(report.samples || []).map((item) => item.temporary_inodes));
    if (report.peaks.aggregate_rss_bytes < sampleMemoryPeak
      || report.peaks.cgroup_memory_bytes < sampleCgroupPeak
      || report.peaks.pids < samplePidPeak
      || report.peaks.temporary_bytes < sampleTempPeak
      || report.peaks.temporary_inodes < sampleInodePeak) {
      errors.push('$.peaks must cover every retained measurement sample');
    }
  }
  return { valid: errors.length === 0, errors, schema: BUNDLED_SCHEMA.$id };
}

function fileIdentity(candidate) {
  const stat = fs.lstatSync(candidate, { bigint: true });
  return {
    dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), nlink: Number(stat.nlink),
  };
}

const sameFileIdentity = (left, right) => left?.dev === right?.dev
  && left?.ino === right?.ino && left?.uid === right?.uid && left?.nlink === right?.nlink;

function reportAuthoritySnapshot(authority) {
  return {
    file: authority.file,
    parent: authority.parent,
    parent_identity: authority.parent_identity,
    run_id: authority.run_id,
    generation: authority.generation,
    file_identity: authority.file_identity,
    pending_generation: authority.pending_generation || null,
  };
}

export function persistReportAuthorityWith(authority, persist) {
  if (!authority || typeof persist !== 'function') return;
  Object.defineProperty(authority, 'persist_transition', {
    configurable: true, enumerable: false, writable: true, value: persist,
  });
}

function fsyncFileAndParent(file) {
  const descriptor = fs.openSync(file, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  const parentDescriptor = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(parentDescriptor); } finally { fs.closeSync(parentDescriptor); }
}

function assertReportAuthority(resolved, authority) {
  if (!authority) return;
  if (resolved !== authority.file || path.dirname(resolved) !== authority.parent) {
    throw Object.assign(new Error('report authority path changed'), { code: 'LAMINA_SAFE_REPORT_AUTHORITY' });
  }
  const parent = fileIdentity(authority.parent);
  const named = fileIdentity(authority.file);
  const accepted = [authority.file_identity, authority.pending_generation?.file_identity];
  if (parent.dev !== authority.parent_identity.dev || parent.ino !== authority.parent_identity.ino
    || parent.uid !== authority.parent_identity.uid
    || named.nlink !== 1 || !accepted.some((identity) => sameFileIdentity(named, identity))) {
    throw Object.assign(new Error('report authority identity changed'), { code: 'LAMINA_SAFE_REPORT_AUTHORITY' });
  }
}

export function writeReport(file, report, authority = null) {
  const sanitized = redactEvidence(report);
  const validation = validateReport(sanitized);
  if (!validation.valid) {
    const error = new Error(`Refusing invalid safe-runner report: ${validation.errors.join('; ')}`);
    error.code = 'LAMINA_SAFE_REPORT_INVALID';
    throw error;
  }
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  assertReportAuthority(resolved, authority);
  const temporary = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.tmp-${crypto.randomBytes(16).toString('hex')}`,
  );
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(sanitized, null, 2)}\n`, {
      flag: 'wx', mode: 0o600,
    });
    fsyncFileAndParent(temporary);
    const nextIdentity = fileIdentity(temporary);
    if (nextIdentity.nlink !== 1
      || (typeof process.getuid === 'function' && nextIdentity.uid !== process.getuid())) {
      throw Object.assign(new Error('report publication temporary file lost exclusive authority'), {
        code: 'LAMINA_SAFE_REPORT_AUTHORITY',
      });
    }
    assertReportAuthority(resolved, authority);
    if (authority) {
      authority.pending_generation = {
        generation: Number(authority.generation || 0) + 1,
        file_identity: nextIdentity,
      };
      authority.persist_transition?.(reportAuthoritySnapshot(authority));
      // Persistence may be asynchronous in another process. Recheck the named
      // generation immediately before the atomic replacement.
      assertReportAuthority(resolved, authority);
    }
    fs.renameSync(temporary, resolved);
    fsyncFileAndParent(resolved);
    if (authority) {
      authority.generation = authority.pending_generation.generation;
      authority.file_identity = authority.pending_generation.file_identity;
      authority.pending_generation = null;
      authority.persist_transition?.(reportAuthoritySnapshot(authority));
    }
  } finally { fs.rmSync(temporary, { force: true }); }
  return resolved;
}

export function prepareReportAuthority(file, provisionalReport) {
  const resolved = path.resolve(file);
  const parent = path.dirname(resolved);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()
    || fs.realpathSync.native(parent) !== parent
    || (typeof process.getuid === 'function' && parentStat.uid !== process.getuid())) {
    throw Object.assign(new Error('report authority parent must be a physical same-user directory'), {
      code: 'LAMINA_SAFE_REPORT_AUTHORITY',
    });
  }
  let existing = null;
  try {
    try { existing = fs.lstatSync(resolved, { bigint: true }); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    if (existing && existing.isDirectory()) {
      const error = new Error('report authority path must not be a directory');
      error.code = 'LAMINA_SAFE_REPORT_AUTHORITY';
      throw error;
    }
    if (typeof provisionalReport?.run_id !== 'string' || !provisionalReport.run_id) {
      throw Object.assign(new Error('report authority requires a run-bound provisional report'), {
        code: 'LAMINA_SAFE_REPORT_AUTHORITY',
      });
    }
    const temporary = path.join(parent,
      `.${path.basename(resolved)}.acquire-${crypto.randomBytes(16).toString('hex')}`);
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(redactEvidence(provisionalReport), null, 2)}\n`, {
        flag: 'wx', mode: 0o600,
      });
      fsyncFileAndParent(temporary);
      const acquiredIdentity = fileIdentity(temporary);
      if (acquiredIdentity.nlink !== 1) throw new Error('report authority temporary file is linked');
      if (existing) {
        const current = fs.lstatSync(resolved, { bigint: true });
        if (current.dev !== existing.dev || current.ino !== existing.ino
          || current.mode !== existing.mode) {
          throw Object.assign(new Error('report authority path changed during acquisition'), {
            code: 'LAMINA_SAFE_REPORT_AUTHORITY',
          });
        }
      }
      fs.renameSync(temporary, resolved);
      fsyncFileAndParent(resolved);
    } finally { fs.rmSync(temporary, { force: true }); }
    const authority = {
      file: resolved, parent, parent_identity: fileIdentity(parent),
      run_id: provisionalReport.run_id, generation: 0, file_identity: fileIdentity(resolved),
      pending_generation: null,
    };
    const validation = validateReport(JSON.parse(fs.readFileSync(resolved, 'utf8')));
    if (!validation.valid) {
      throw Object.assign(new Error(`invalid provisional report: ${validation.errors.join('; ')}`), {
        code: 'LAMINA_SAFE_REPORT_INVALID',
      });
    }
    return authority;
  } catch (cause) {
    if (String(cause?.code || '').startsWith('LAMINA_SAFE_')) throw cause;
    const error = new Error(`report authority path must be a same-user physical file (${cause?.code || 'unknown'})`);
    error.code = 'LAMINA_SAFE_REPORT_AUTHORITY';
    throw error;
  }
}

export function writeReportWithFallback(file, report, authority = null) {
  const requested = file ? path.resolve(file) : null;
  const fallback = path.join(os.tmpdir(), `lamina-safe-runner-report-${process.pid}-${Date.now()}.json`);
  report.report_file = requested || fallback;
  try {
    return { path: writeReport(report.report_file, report, authority), fallback: !requested, write_error: null };
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
