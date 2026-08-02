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
  normal_cleanup: Object.freeze(['success', 'scope-escape']),
  direct_memory_limit: 'direct-memory',
  aggregate_child_memory_limit: 'aggregate-memory',
  ignored_graceful_termination: 'ignore-term',
  timeout_hang: 'hang',
  rapid_process_spawning: 'spawn-storm',
  stdout_stderr_flood: 'output-flood',
  runner_temporary_disk_growth: 'temp-growth',
  parent_signal: Object.freeze(['hang', 'success']),
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
export const GENERIC_TEMPORARY_MAX_INODES = 8_192;
export const CASE_DISCOVERY_WORKLOAD_ID = 'real-repository-oracle-v1:case-discovery';
export const SCENARIO_VERIFICATION_WORKLOAD_ID = 'real-repository-oracle-v1:scenario-verification';
export const SCENARIO_VERIFICATION_RETAINED_TAIL_BYTES = 8 * 1024;

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
  executionAuthorityMaxBytes: 512 * MIB,
  executionAuthorityMaxFiles: 16_384,
  sampleIntervalMs: 250,
  sustainedHighSamples: 4,
  gracefulStopMs: 2_000,
  diagnosticTailBytes: 8 * 1024,
  maxSamples: 64,
  maxDescendants: 256,
  scopeHandshakeMs: 3_000,
});

export const SCENARIO_VERIFICATION_LARGE_TEMPORARY_INODE_RESERVATION = Object.freeze({
  tier: 'large',
  tracked_count: 5_405,
  occupied_destination_count: 6_569,
  simultaneous_surfaces: 2,
  control_reserve: 1_024,
  requested_max_inodes: 16_384,
  hard_ceiling: DEFAULTS.executionAuthorityMaxFiles,
});

const SCENARIO_INODE_RESERVATION_KEYS = Object.freeze([
  'tier', 'tracked_count', 'occupied_destination_count', 'simultaneous_surfaces',
  'control_reserve', 'requested_max_inodes', 'hard_ceiling',
]);

export function temporaryMaxInodesForBytes(
  temporaryMaxBytes,
  ceiling = GENERIC_TEMPORARY_MAX_INODES,
) {
  if (!Number.isSafeInteger(temporaryMaxBytes) || temporaryMaxBytes <= 0
    || !Number.isSafeInteger(ceiling) || ceiling < 256
    || ceiling > DEFAULTS.executionAuthorityMaxFiles) {
    throw new TypeError('temporary inode derivation requires bounded byte and ceiling integers');
  }
  return Math.max(256, Math.min(ceiling, Math.floor(temporaryMaxBytes / 4096)));
}

export function validateScenarioVerificationLargeInodeReservation(reservation) {
  const exactKeys = reservation && typeof reservation === 'object' && !Array.isArray(reservation)
    && JSON.stringify(Object.keys(reservation).sort())
      === JSON.stringify([...SCENARIO_INODE_RESERVATION_KEYS].sort());
  const integers = exactKeys && SCENARIO_INODE_RESERVATION_KEYS.slice(1)
    .every((key) => Number.isSafeInteger(reservation[key]) && reservation[key] > 0);
  const requiredInodes = integers
    ? reservation.occupied_destination_count * reservation.simultaneous_surfaces
      + reservation.control_reserve
    : null;
  const valid = integers && reservation.tier === 'large'
    && reservation.tracked_count <= reservation.occupied_destination_count
    && reservation.requested_max_inodes <= reservation.hard_ceiling
    && reservation.hard_ceiling === DEFAULTS.executionAuthorityMaxFiles
    && Number.isSafeInteger(requiredInodes)
    && requiredInodes <= reservation.requested_max_inodes
    && requiredInodes <= reservation.hard_ceiling;
  return Object.freeze({ valid: Boolean(valid), required_inodes: requiredInodes });
}

export function retainedOutputTailBytes(workloadId, stream) {
  if (!['stdout', 'stderr'].includes(stream)) {
    throw new TypeError('safe-runner retained output stream must be stdout or stderr');
  }
  if (stream === 'stdout' && workloadId === CASE_DISCOVERY_WORKLOAD_ID) return MIB;
  if (workloadId === SCENARIO_VERIFICATION_WORKLOAD_ID) {
    return SCENARIO_VERIFICATION_RETAINED_TAIL_BYTES;
  }
  return DEFAULTS.diagnosticTailBytes;
}

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
