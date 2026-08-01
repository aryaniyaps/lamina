import {
  MAX_COLD_RUNS,
  MAX_WARM_SAMPLES,
  MIN_COLD_RUNS,
  MIN_WARM_SAMPLES,
} from './constants.mjs';

function numeric(values) {
  if (!Array.isArray(values) || values.length === 0
    || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('statistics require a non-empty array of finite non-negative values');
  }
  return [...values].sort((left, right) => left - right);
}

export function median(values) {
  const sorted = numeric(values);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function nearestRank(values, percentile) {
  const sorted = numeric(values);
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new Error('percentile must be greater than zero and at most one');
  }
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

export function summarizeLatency(values, kind) {
  const sorted = numeric(values);
  if (kind === 'warm') {
    if (sorted.length < MIN_WARM_SAMPLES || sorted.length > MAX_WARM_SAMPLES) {
      throw new Error(`warm statistics require ${MIN_WARM_SAMPLES}-${MAX_WARM_SAMPLES} measured samples`);
    }
    return {
      samples: [...values],
      median: median(sorted),
      p90: nearestRank(sorted, 0.90),
      p95: nearestRank(sorted, 0.95),
      maximum: Math.max(...sorted),
    };
  }
  if (kind === 'cold') {
    if (sorted.length < MIN_COLD_RUNS || sorted.length > MAX_COLD_RUNS) {
      throw new Error(`cold statistics require ${MIN_COLD_RUNS}-${MAX_COLD_RUNS} isolated runs`);
    }
    return {
      samples: [...values],
      median: median(sorted),
      p90: null,
      p95: null,
      maximum: Math.max(...sorted),
    };
  }
  throw new Error(`unknown latency series kind: ${kind}`);
}
