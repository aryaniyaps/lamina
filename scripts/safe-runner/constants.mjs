export const REPORT_SCHEMA = 'lamina.safe-runner-report/v1';
export const REPORT_SCHEMA_VERSION = 1;
export const ATTESTATION_SCHEMA = 'lamina.safe-runner-attestation/v1';
export const CONTEXT_SCHEMA = 'lamina.safe-runner-context/v1';
export const ENVELOPE_SCHEMA = 'lamina.safe-runner-envelope/v1';
export const PROMOTION_SCHEMA = 'lamina.safe-runner-promotion/v1';

export const TIER_ORDER = Object.freeze(['small', 'medium', 'large']);
export const PRODUCTION_TIERS = new Set(['medium', 'large']);
export const SELF_TEST_CASE_IDS = Object.freeze([
  'normal_cleanup',
  'direct_memory_limit',
  'aggregate_child_memory_limit',
  'ignored_graceful_termination',
  'timeout_hang',
  'rapid_process_spawning',
  'stdout_stderr_flood',
  'runner_temporary_disk_growth',
  'parent_signal',
  'stale_process_record',
  'detached_descendant',
]);
export const SELF_TEST_FIXTURE_MODES = Object.freeze({
  normal_cleanup: 'success',
  direct_memory_limit: 'direct-memory',
  aggregate_child_memory_limit: 'aggregate-memory',
  ignored_graceful_termination: 'ignore-term',
  timeout_hang: 'hang',
  rapid_process_spawning: 'spawn-storm',
  stdout_stderr_flood: 'output-flood',
  runner_temporary_disk_growth: 'temp-growth',
  parent_signal: 'signal-controller',
  detached_descendant: 'detached-child',
});
export const PORTABLE_SELF_TEST_CASE_IDS = Object.freeze([
  'normal_cleanup',
]);
export const SELF_TEST_LIMIT_MAXIMA = Object.freeze({
  memoryMaxBytes: 256 * 1024 ** 2,
  timeoutMs: 5_000,
  pidsMax: 32,
  outputMaxBytes: 2 * 1024 ** 2,
  tempMaxBytes: 16 * 1024 ** 2,
});

export const GIB = 1024 ** 3;
export const MIB = 1024 ** 2;

export const DEFAULTS = Object.freeze({
  memoryHardMaxBytes: 3 * GIB,
  memoryFraction: 0.25,
  memoryHighFraction: 0.8,
  osReserveBytes: 2 * GIB,
  pidsMax: 64,
  minFreeDiskBytes: 5 * GIB,
  timeoutMs: 30 * 60 * 1000,
  outputMaxBytes: 32 * MIB,
  tempMaxBytes: 2 * GIB,
  sampleIntervalMs: 250,
  sustainedHighSamples: 4,
  gracefulStopMs: 2_000,
  diagnosticTailBytes: 8 * 1024,
  maxSamples: 64,
  maxDescendants: 256,
  scopeHandshakeMs: 3_000,
});

export function bytesForMib(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return Math.floor(number * MIB);
}

export function integer(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return number;
}
