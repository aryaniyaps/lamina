/**
 * Content-hash based Docker image rebuild for LaminaBench runner.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const BENCH_IMAGE = process.env.BENCH_IMAGE || 'lamina-bench-runner';
const HASH_LABEL = 'lamina.bench.runner_hash';
const HASH_STAMP = path.join(ROOT, 'benchmarks/tmp/runner-image-hash.txt');

/** Files baked into the runner image — any change forces rebuild. */
export const RUNNER_HASH_SOURCES = [
  'benchmarks/Dockerfile',
  'benchmarks/scripts/bench-workflow.mjs',
  'benchmarks/scripts/bench-clarify.mjs',
  'benchmarks/scripts/lamina-run-layout.mjs',
  'benchmarks/scripts/phase-gates.mjs',
  'benchmarks/scripts/artifact-contract.mjs',
  'benchmarks/scripts/run-job-in-container.mjs',
  'evals/scripts/invoke-agent.mjs',
];

export function computeRunnerSourceHash() {
  const hash = crypto.createHash('sha256');
  for (const rel of RUNNER_HASH_SOURCES) {
    const abs = path.join(ROOT, rel);
    hash.update(rel);
    hash.update('\0');
    if (fs.existsSync(abs)) {
      hash.update(fs.readFileSync(abs));
    } else {
      hash.update('MISSING');
    }
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function imageLabelHash(image) {
  const result = spawnSync(
    'docker',
    ['image', 'inspect', image, '--format', `{{index .Config.Labels "${HASH_LABEL}"}}`],
    { encoding: 'utf8', stdio: 'pipe' }
  );
  if (result.status !== 0) return null;
  const label = (result.stdout || '').trim();
  return label && label !== '<no value>' ? label : null;
}

export function isDockerAvailable() {
  const result = spawnSync('docker', ['info'], { encoding: 'utf8', stdio: 'pipe' });
  return result.status === 0;
}

/**
 * Ensure runner image exists and matches current script hash.
 * Rebuilds when missing or hash mismatch.
 */
export function ensureBenchImage({ force = false } = {}) {
  const expected = computeRunnerSourceHash();
  const inspect = spawnSync('docker', ['image', 'inspect', BENCH_IMAGE], { stdio: 'pipe' });
  const exists = inspect.status === 0;
  const current = exists ? imageLabelHash(BENCH_IMAGE) : null;

  if (!force && exists && current === expected) {
    fs.mkdirSync(path.dirname(HASH_STAMP), { recursive: true });
    fs.writeFileSync(HASH_STAMP, expected + '\n');
    return { rebuilt: false, hash: expected };
  }

  const reason = force
    ? 'forced'
    : !exists
      ? 'missing'
      : `hash mismatch (image=${current || 'none'}, source=${expected})`;
  console.log(`Building benchmark runner image (${BENCH_IMAGE}) — ${reason}...`);

  const build = spawnSync(
    'docker',
    [
      'build',
      '-f',
      'benchmarks/Dockerfile',
      '--label',
      `${HASH_LABEL}=${expected}`,
      '-t',
      BENCH_IMAGE,
      '.',
    ],
    { cwd: ROOT, stdio: 'inherit' }
  );
  if (build.status !== 0) {
    throw new Error(`Failed to build ${BENCH_IMAGE}. Run: npm run bench:image`);
  }

  fs.mkdirSync(path.dirname(HASH_STAMP), { recursive: true });
  fs.writeFileSync(HASH_STAMP, expected + '\n');
  return { rebuilt: true, hash: expected };
}
