import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DEFAULTS, ENVELOPE_SCHEMA, temporaryMaxInodesForBytes,
} from './constants.mjs';

const OVERRIDE_RULES = Object.freeze({
  memoryMaxBytes: { integer: true },
  memoryHighBytes: { integer: true },
  pidsMax: { integer: true },
  timeoutMs: { integer: true },
  outputMaxBytes: { integer: true },
  tempMaxBytes: { integer: true },
  sampleIntervalMs: { integer: true },
  sustainedHighSamples: { integer: true },
  gracefulStopMs: { integer: true },
});

export function validateLimitOverrides(overrides = {}) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('safe-runner limit overrides must be an object');
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(OVERRIDE_RULES, name)) throw new TypeError(`unknown safe-runner limit override: ${name}`);
    if (!Number.isFinite(value) || value <= 0 || (OVERRIDE_RULES[name].integer && !Number.isInteger(value))) {
      throw new TypeError(`${name} must be a finite positive integer`);
    }
  }
  return overrides;
}

export function availableMemoryBytes() {
  if (process.platform === 'linux') {
    try {
      const kib = Number(fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB$/m)?.[1]);
      if (Number.isFinite(kib)) return kib * 1024;
    } catch {}
  }
  return os.freemem();
}

function availableDiskBytes(target) {
  if (typeof fs.statfsSync === 'function') {
    const value = fs.statfsSync(target);
    return Number(value.bavail) * Number(value.bsize);
  }
  if (process.platform === 'win32') return null;
  const output = execFileSync('df', ['-Pk', target], { encoding: 'utf8' }).trim().split('\n').at(-1);
  return Number(output.trim().split(/\s+/)[3]) * 1024;
}

function validPageSize(value) {
  return Number.isSafeInteger(value)
    && value >= 4_096
    && value <= 1024 * 1024
    && (value & (value - 1)) === 0;
}

export function parseHostPageSize(text, { productionEnforcement = false } = {}) {
  if (!productionEnforcement) return null;
  const kib = Number(String(text || '').match(/^KernelPageSize:\s+(\d+)\s+kB$/m)?.[1]);
  const value = kib * 1024;
  if (!Number.isSafeInteger(kib) || !validPageSize(value)) {
    const error = new Error('cannot prove the Linux host page size from /proc/self/smaps');
    error.code = 'LAMINA_SAFE_PAGE_SIZE_UNPROVEN';
    throw error;
  }
  return value;
}

export function hostPageSizeBytes({
  platform = process.platform,
  productionEnforcement = false,
} = {}) {
  if (platform !== 'linux' || !productionEnforcement) return null;
  let descriptor = null;
  try {
    descriptor = fs.openSync('/proc/self/smaps', 'r');
    const buffer = Buffer.alloc(64 * 1024);
    const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return parseHostPageSize(buffer.subarray(0, bytes).toString('utf8'), {
      productionEnforcement,
    });
  } catch (cause) {
    if (cause?.code === 'LAMINA_SAFE_PAGE_SIZE_UNPROVEN') throw cause;
    const error = new Error(`cannot read the Linux host page size: ${cause?.code || 'unknown error'}`);
    error.code = 'LAMINA_SAFE_PAGE_SIZE_UNPROVEN';
    throw error;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function alignDown(value, pageSizeBytes) {
  return pageSizeBytes === null ? value : Math.floor(value / pageSizeBytes) * pageSizeBytes;
}

export function deriveLimits(overrides = {}, {
  totalMemoryBytes = os.totalmem(),
  pageSizeBytes = null,
} = {}) {
  validateLimitOverrides(overrides);
  if (!Number.isFinite(totalMemoryBytes) || totalMemoryBytes <= 0) {
    throw new TypeError('totalMemoryBytes must be finite and positive');
  }
  if (pageSizeBytes !== null && !validPageSize(pageSizeBytes)) {
    throw new TypeError('pageSizeBytes must be a proven power of two between 4096 and 1048576');
  }
  const derivedHard = Math.min(
    DEFAULTS.memoryHardMaxBytes,
    Math.floor(totalMemoryBytes * DEFAULTS.memoryFraction),
  );
  const memoryMaxBytes = alignDown(
    Math.min(overrides.memoryMaxBytes ?? derivedHard, derivedHard),
    pageSizeBytes,
  );
  const defaultHigh = Math.floor(memoryMaxBytes * DEFAULTS.memoryHighFraction);
  const memoryHighBytes = alignDown(
    Math.min(overrides.memoryHighBytes ?? defaultHigh, defaultHigh),
    pageSizeBytes,
  );
  if (memoryHighBytes <= 0 || memoryMaxBytes <= 0 || memoryHighBytes >= memoryMaxBytes) {
    throw new TypeError('effective memoryHighBytes must be positive and lower than memoryMaxBytes');
  }
  const pidsMax = Math.min(overrides.pidsMax ?? DEFAULTS.pidsMax, DEFAULTS.pidsMax);
  const tempMaxBytes = Math.min(overrides.tempMaxBytes ?? DEFAULTS.tempMaxBytes, DEFAULTS.tempMaxBytes);
  return {
    memory_max_bytes: memoryMaxBytes,
    memory_high_bytes: memoryHighBytes,
    memory_page_bytes: pageSizeBytes,
    os_reserve_bytes: DEFAULTS.osReserveBytes,
    pids_max: pidsMax,
    timeout_ms: Math.min(overrides.timeoutMs ?? DEFAULTS.timeoutMs, DEFAULTS.timeoutMs),
    output_max_bytes: Math.min(overrides.outputMaxBytes ?? DEFAULTS.outputMaxBytes, DEFAULTS.outputMaxBytes),
    temporary_max_bytes: tempMaxBytes,
    temporary_max_inodes: temporaryMaxInodesForBytes(tempMaxBytes),
    minimum_free_disk_bytes: Math.max(DEFAULTS.minFreeDiskBytes, tempMaxBytes * 2),
    sample_interval_ms: Math.min(
      DEFAULTS.sampleIntervalMs,
      Math.max(25, overrides.sampleIntervalMs ?? DEFAULTS.sampleIntervalMs),
    ),
    sustained_high_samples: Math.min(
      overrides.sustainedHighSamples ?? DEFAULTS.sustainedHighSamples,
      DEFAULTS.sustainedHighSamples,
    ),
    graceful_stop_ms: Math.min(
      overrides.gracefulStopMs ?? DEFAULTS.gracefulStopMs,
      DEFAULTS.gracefulStopMs,
    ),
    concurrency: 1,
  };
}

export function hostEnvelope({
  cwd = process.cwd(),
  overrides = {},
  productionEnforcement = false,
} = {}) {
  const pageSizeBytes = hostPageSizeBytes({ productionEnforcement });
  const limits = deriveLimits(overrides, { pageSizeBytes });
  const diskTarget = fs.existsSync(cwd) ? cwd : path.dirname(cwd);
  const temporaryDiskTarget = os.tmpdir();
  return {
    schema: ENVELOPE_SCHEMA,
    inspected_at: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    hostname: os.hostname(),
    total_memory_bytes: os.totalmem(),
    available_memory_bytes: availableMemoryBytes(),
    free_disk_bytes: availableDiskBytes(diskTarget),
    disk_target: path.resolve(diskTarget),
    temporary_free_disk_bytes: availableDiskBytes(temporaryDiskTarget),
    temporary_disk_target: path.resolve(temporaryDiskTarget),
    limits,
  };
}
