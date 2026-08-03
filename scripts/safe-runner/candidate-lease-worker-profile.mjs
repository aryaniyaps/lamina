import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const CANDIDATE_LEASE_WORKER_COMMAND = 'lease-candidate-worker';
export const CANDIDATE_LEASE_WORKER_WORKLOAD_ID =
  'real-repository-oracle-v1:candidate-lease-worker';
export const CANDIDATE_LEASE_WORKER_LAUNCH_PROFILE =
  'candidate-lease-worker-v1';
export const CANDIDATE_LEASE_WORKER_LIMITS = Object.freeze({
  memory_max_bytes: 512 * 1024 ** 2,
  memory_high_bytes: 384 * 1024 ** 2,
  pids_max: 32,
  timeout_ms: 180_000,
  temporary_max_bytes: 512 * 1024 ** 2,
  output_max_bytes: 256 * 1024,
});
export const CANDIDATE_LEASE_WORKER_OVERRIDES = Object.freeze({
  memoryMaxBytes: CANDIDATE_LEASE_WORKER_LIMITS.memory_max_bytes,
  memoryHighBytes: CANDIDATE_LEASE_WORKER_LIMITS.memory_high_bytes,
  pidsMax: CANDIDATE_LEASE_WORKER_LIMITS.pids_max,
  timeoutMs: CANDIDATE_LEASE_WORKER_LIMITS.timeout_ms,
  tempMaxBytes: CANDIDATE_LEASE_WORKER_LIMITS.temporary_max_bytes,
  outputMaxBytes: CANDIDATE_LEASE_WORKER_LIMITS.output_max_bytes,
});

const TIERS = new Set(['small', 'medium', 'large']);
const PHASES = new Set(['first', 'replay']);
const SLOT = /^slot-[1-9]\d*$/;

export function exactCandidateLeaseWorkerCommand(command) {
  if (!Array.isArray(command) || command.length !== 6
    || command[2] !== CANDIDATE_LEASE_WORKER_COMMAND) return false;
  if (!TIERS.has(command[3]) || !SLOT.test(command[4] || '') || !PHASES.has(command[5])) {
    return false;
  }
  try {
    const expected = path.join(ROOT, 'benchmarks/real-repository-oracle-v1/workload.mjs');
    const stat = fs.lstatSync(expected);
    return stat.isFile() && !stat.isSymbolicLink()
      && fs.realpathSync.native(command[0]) === fs.realpathSync.native(process.execPath)
      && fs.realpathSync.native(command[1]) === fs.realpathSync.native(expected);
  } catch {
    return false;
  }
}

export function exactCandidateLeaseWorkerLimits(limits) {
  return Boolean(limits && Object.entries(CANDIDATE_LEASE_WORKER_LIMITS)
    .every(([key, expected]) => limits[key] === expected));
}
