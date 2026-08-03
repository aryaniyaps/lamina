import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const LANDLOCK_CANDIDATE_PROBE_ENTRYPOINT =
  'tests/fixtures/safe-runner-landlock-probe.mjs';
export const LANDLOCK_CANDIDATE_PROBE_WORKLOAD_ID =
  'real-repository-oracle-v1:landlock-candidate-probe';
export const LANDLOCK_CANDIDATE_PROBE_LAUNCH_PROFILE =
  'landlock-candidate-probe-v1';
export const LANDLOCK_CANDIDATE_PROBE_LIMITS = Object.freeze({
  memory_max_bytes: 256 * 1024 ** 2,
  memory_high_bytes: 192 * 1024 ** 2,
  pids_max: 32,
  timeout_ms: 10_000,
  temporary_max_bytes: 64 * 1024 ** 2,
  output_max_bytes: 1024 * 1024,
});

export function exactLandlockCandidateProbeCommand(command) {
  if (!Array.isArray(command) || command.length !== 2) return false;
  try {
    const expected = path.join(ROOT, LANDLOCK_CANDIDATE_PROBE_ENTRYPOINT);
    const stat = fs.lstatSync(expected);
    return fs.realpathSync.native(command[0]) === fs.realpathSync.native(process.execPath)
      && fs.realpathSync.native(command[1]) === fs.realpathSync.native(expected)
      && stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export function exactLandlockCandidateProbeLimits(limits) {
  return Boolean(limits && Object.entries(LANDLOCK_CANDIDATE_PROBE_LIMITS)
    .every(([name, value]) => limits[name] === value));
}
