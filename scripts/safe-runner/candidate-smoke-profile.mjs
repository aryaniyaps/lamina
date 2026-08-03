import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const CANDIDATE_SMOKE_COMMAND = 'smoke-candidate-small';
export const CANDIDATE_SMOKE_WORKLOAD_ID =
  'real-repository-oracle-v1:candidate-smoke-small';
export const CANDIDATE_SMOKE_LAUNCH_PROFILE =
  'real-repository-candidate-smoke-v1';
export const CANDIDATE_SMOKE_LIMITS = Object.freeze({
  memory_max_bytes: 512 * 1024 ** 2,
  memory_high_bytes: 384 * 1024 ** 2,
  pids_max: 32,
  timeout_ms: 180_000,
  temporary_max_bytes: 512 * 1024 ** 2,
  output_max_bytes: 256 * 1024,
});
export const CANDIDATE_SMOKE_OVERRIDES = Object.freeze({
  memoryMaxBytes: CANDIDATE_SMOKE_LIMITS.memory_max_bytes,
  memoryHighBytes: CANDIDATE_SMOKE_LIMITS.memory_high_bytes,
  pidsMax: CANDIDATE_SMOKE_LIMITS.pids_max,
  timeoutMs: CANDIDATE_SMOKE_LIMITS.timeout_ms,
  tempMaxBytes: CANDIDATE_SMOKE_LIMITS.temporary_max_bytes,
  outputMaxBytes: CANDIDATE_SMOKE_LIMITS.output_max_bytes,
});

export function exactCandidateSmokeCommand(command) {
  if (!Array.isArray(command) || command.length !== 3
    || command[2] !== CANDIDATE_SMOKE_COMMAND) return false;
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

export function exactCandidateSmokeLimits(limits) {
  return Boolean(limits && Object.entries(CANDIDATE_SMOKE_LIMITS)
    .every(([key, expected]) => limits[key] === expected));
}
