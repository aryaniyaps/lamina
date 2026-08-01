import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DEFAULTS, ENVELOPE_SCHEMA } from './constants.mjs';

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

function availableMemoryBytes() {
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

export function deriveLimits(overrides = {}, { totalMemoryBytes = os.totalmem() } = {}) {
  validateLimitOverrides(overrides);
  if (!Number.isFinite(totalMemoryBytes) || totalMemoryBytes <= 0) {
    throw new TypeError('totalMemoryBytes must be finite and positive');
  }
  const derivedHard = Math.min(
    DEFAULTS.memoryHardMaxBytes,
    Math.floor(totalMemoryBytes * DEFAULTS.memoryFraction),
  );
  const memoryMaxBytes = Math.min(overrides.memoryMaxBytes ?? derivedHard, derivedHard);
  const defaultHigh = Math.floor(memoryMaxBytes * DEFAULTS.memoryHighFraction);
  const memoryHighBytes = Math.min(overrides.memoryHighBytes ?? defaultHigh, defaultHigh);
  if (memoryHighBytes > memoryMaxBytes) throw new TypeError('memoryHighBytes cannot exceed memoryMaxBytes');
  const pidsMax = Math.min(overrides.pidsMax ?? DEFAULTS.pidsMax, DEFAULTS.pidsMax);
  const tempMaxBytes = Math.min(overrides.tempMaxBytes ?? DEFAULTS.tempMaxBytes, DEFAULTS.tempMaxBytes);
  return {
    memory_max_bytes: memoryMaxBytes,
    memory_high_bytes: memoryHighBytes,
    os_reserve_bytes: DEFAULTS.osReserveBytes,
    pids_max: pidsMax,
    timeout_ms: Math.min(overrides.timeoutMs ?? DEFAULTS.timeoutMs, DEFAULTS.timeoutMs),
    output_max_bytes: Math.min(overrides.outputMaxBytes ?? DEFAULTS.outputMaxBytes, DEFAULTS.outputMaxBytes),
    temporary_max_bytes: tempMaxBytes,
    temporary_max_inodes: Math.max(256, Math.min(8_192, Math.floor(tempMaxBytes / 4096))),
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

export function hostEnvelope({ cwd = process.cwd(), overrides = {} } = {}) {
  const limits = deriveLimits(overrides);
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
