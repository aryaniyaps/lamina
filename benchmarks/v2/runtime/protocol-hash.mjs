import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fixtureFingerprint } from '../../scripts/stage-bench-fixture.mjs';
import { hashTree } from './freeze-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const V2 = path.join(ROOT, 'benchmarks', 'v2');

const PROTOCOL_INPUTS = [
  'package.json',
  'pnpm-lock.yaml',
  'scripts/check_lamina_init.mjs',
  'benchmarks/scripts/stage-bench-fixture.mjs',
  'benchmarks/v2/release.json',
  'benchmarks/v2/corpus/manifest.json',
  'benchmarks/v2/METHODOLOGY.md',
  'benchmarks/v2/EXECUTION_CUSTODY.md',
  'benchmarks/v2/JUDGING.md',
  'benchmarks/v2/HUMAN_STUDY.md',
  'benchmarks/v2/protocol',
  'benchmarks/v2/schemas',
  'benchmarks/v2/runtime',
  'benchmarks/v2/scoring',
  'skills',
];

export function protocolBaseHash() {
  return hashTree(ROOT, PROTOCOL_INPUTS).sha256;
}

export function taskPackageHash(taskPackage) {
  return hashTree(ROOT, [path.join('benchmarks', 'v2', 'corpus', taskPackage)]).sha256;
}

export function cellProtocolHash(cell, baseHash = protocolBaseHash()) {
  const digest = createHash('sha256');
  const fixture = cell.fixture_ref ? fixtureFingerprint(cell.fixture_ref) : null;
  const document = {
    base_hash: baseHash,
    task_package_hash: taskPackageHash(cell.task_package),
    fixture_hash: fixture,
    protocol_version: JSON.parse(fs.readFileSync(path.join(V2, 'release.json'), 'utf8')).protocol_version,
    arm: cell.arm,
    track: cell.track,
    provider: cell.provider,
    model: cell.model,
    cohort_id: cell.cohort_id,
    repeat: cell.repeat,
  };
  digest.update(JSON.stringify(document));
  return { sha256: baseHash, cell_input_sha256: digest.digest('hex'), inputs: document };
}
