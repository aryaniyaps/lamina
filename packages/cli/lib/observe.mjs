import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGraphd, graphRequest } from './graph-runtime/client.mjs';
import { digest, graphSocketPath } from './graph-runtime/util.mjs';

const ignore = [
  '**/.git/**',
  '**/.lamina/runs/**',
  '**/node_modules/**',
  '**/.venv*/**',
  '**/__pycache__/**',
  '**/.next/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/benchmarks/results/**',
  '**/evals/fixtures/.vendor-tmp*/**',
];
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function runObservation({
  cwd = process.cwd(),
  live = false,
  invalidate = false,
  discover = false,
} = {}) {
  const requiredAssets = [
    path.join(packageRoot, 'pyproject.toml'),
    path.join(packageRoot, 'uv.lock'),
    path.join(packageRoot, 'cocoindex_app.py'),
  ];
  const missingAsset = requiredAssets.find((asset) => !fs.existsSync(asset));
  if (missingAsset) {
    const error = new Error(`Installed CLI is missing observation asset: ${missingAsset}`);
    error.code = 'LAMINA_OBSERVATION_UNAVAILABLE';
    throw error;
  }
  const uv = spawnSync('uv', ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (uv.error || uv.status !== 0) {
    const error = new Error('Source observation requires uv on PATH.');
    error.code = 'LAMINA_OBSERVATION_UNAVAILABLE';
    throw error;
  }
  const paths = await ensureGraphd(cwd);
  let invalidation = null;
  if (invalidate) {
    invalidation = await graphRequest('observation.invalidate', {
      product: paths.product,
    }, cwd);
  }
  const targetGenerationFile = path.join(paths.cocoindex, 'target-generation');
  if (!fs.existsSync(targetGenerationFile)) {
    fs.writeFileSync(
      targetGenerationFile,
      `${digest('generation', { database: paths.database, initialized: Date.now() })}\n`,
    );
  }
  let generation = fs.readFileSync(targetGenerationFile, 'utf8').trim();
  const environment = {
    ...process.env,
    COCOINDEX_DB: path.join(paths.cocoindex, 'state.db'),
    UV_PROJECT_ENVIRONMENT: path.join(paths.cocoindex, 'python-env'),
    PYTHONDONTWRITEBYTECODE: '1',
    LAMINA_SOURCE_ROOT: paths.root,
    LAMINA_GRAPHD_ENDPOINT: graphSocketPath(paths),
    LAMINA_GRAPHD_TOKEN: paths.auth_token,
    LAMINA_PRODUCT: paths.product,
    LAMINA_SOURCE_REVISION: paths.source_revision,
    LAMINA_IGNORE_DIGEST: digest('ignore', ignore),
    LAMINA_EXTRACTOR_DIGEST: digest('extractors', ['lamina.source-file.v2']),
    LAMINA_OBSERVATION_GENERATION: generation,
  };
  const args = [
    'run',
    '--project',
    packageRoot,
    '--python',
    '3.13',
    'cocoindex',
    'update',
  ];
  if (live) args.push('--live');
  args.push('cocoindex_app.py');
  const runCocoindex = () => {
    const result = spawnSync('uv', args, {
      cwd: packageRoot,
      env: environment,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) {
      const error = new Error(`Source observation requires uv: ${result.error.message}`);
      error.code = 'LAMINA_OBSERVATION_UNAVAILABLE';
      throw error;
    }
    if ((result.status ?? 1) !== 0) {
      const error = new Error(`CocoIndex observation exited with status ${result.status ?? 1}.`);
      error.code = 'LAMINA_OBSERVATION_FAILED';
      error.details = {
        status: result.status ?? 1,
        signal: result.signal || null,
        stderr: String(result.stderr || '').slice(-4_000),
        stdout: String(result.stdout || '').slice(-4_000),
      };
      throw error;
    }
  };
  runCocoindex();

  // CocoIndex can return after committing its target-state transaction while
  // graphd is still applying the final sink batch. Wait briefly for that
  // committed view instead of treating a successful first pass as incomplete.
  const observationDeadline = Date.now() + 10_000;
  let observed;
  do {
    observed = await graphRequest('observation.status', {
      product: environment.LAMINA_PRODUCT,
      generation,
    }, cwd);
    if (observed.exists) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < observationDeadline);
  if (!observed.exists) {
    // A successful CocoIndex process with no committed target is recoverable:
    // invalidate the target generation and force one complete reconciliation.
    const recovery = await graphRequest('observation.invalidate', { product: paths.product }, cwd);
    generation = recovery.generation;
    environment.LAMINA_OBSERVATION_GENERATION = generation;
    runCocoindex();
    const recoveryDeadline = Date.now() + 10_000;
    do {
      observed = await graphRequest('observation.status', {
        product: environment.LAMINA_PRODUCT,
        generation,
      }, cwd);
      if (observed.exists) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < recoveryDeadline);
  }
  if (!observed.exists || observed.count !== observed.source_key_count ||
      (observed.count > 0 && !observed.source_revisions.includes(paths.source_revision))) {
    const error = new Error('CocoIndex exited without a complete committed graphd target state.');
    error.code = 'LAMINA_OBSERVATION_INCOMPLETE';
    error.details = { expected_source_revision: paths.source_revision, observed };
    throw error;
  }
  return {
    ok: true,
    mode: live ? 'live' : invalidate ? 'rebuild' : discover ? 'discover' : 'observe',
    invalidation,
    generation,
    expected: observed.source_key_count,
    observed,
    discovery_report: discover ? {
      source_roots: observed.source_roots,
      ignored_patterns: ignore,
      extractor_coverage: observed.coverage,
      unsupported_sources: observed.unsupported,
      stale_snapshots: observed.source_revisions.filter((item) => item !== paths.source_revision),
      limitations: observed.limitations,
    } : undefined,
  };
}
