export const RESULT_SCHEMA = 'lamina.runtime-benchmark-result/v1';
export const RESULT_SCHEMA_VERSION = 1;
export const FIXTURE_SCHEMA = 'lamina.runtime-benchmark-fixture/v1';
export const ROOT_MARKER_SCHEMA = 'lamina.runtime-benchmark-root/v1';

export const LIFECYCLE_PHASES = Object.freeze([
  'doctor',
  'status',
  'startup',
  'observation',
  'retrieval_readiness',
  'preparation',
  'noop_sync',
  'incremental_change',
  'rebuild',
  'idle',
  'shutdown',
  'cleanup',
]);

export const WARM_MEASURED_PHASES = Object.freeze([
  'doctor',
  'status',
  'retrieval_readiness',
  'preparation',
  'noop_sync',
]);

export const MIN_WARM_SAMPLES = 30;
export const MAX_WARM_SAMPLES = 30;
export const MIN_WARMUPS = 1;
export const MAX_WARMUPS = 5;
export const MIN_COLD_RUNS = 3;
export const MAX_COLD_RUNS = 5;

export const MEASUREMENT_OUTCOMES = Object.freeze([
  'success',
  'safe_refusal',
  'timeout',
  'cancellation',
  'limit_hit',
  'command_failure',
  'internal_error',
]);

export const DEFAULT_LIMITS = Object.freeze({
  memoryMaxBytes: 256 * 1024 ** 2,
  memoryHighBytes: 224 * 1024 ** 2,
  pidsMax: 32,
  timeoutMs: 15_000,
  outputMaxBytes: 256 * 1024,
  tempMaxBytes: 4 * 1024 ** 2,
  sampleIntervalMs: 25,
  sustainedHighSamples: 2,
  gracefulStopMs: 100,
});
