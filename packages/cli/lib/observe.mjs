import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGraphd, graphRequest } from './graph-runtime/client.mjs';
import { digest, graphSocketPath } from './graph-runtime/util.mjs';

const ignore = ['.git', '.lamina', 'node_modules', '.venv', '__pycache__'];
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const excluded = new Set(['.git', '.lamina', 'node_modules', '.venv', '__pycache__']);
function countSourceFiles(directory) {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) count += countSourceFiles(full);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

export async function runObservation({
  cwd = process.cwd(),
  live = false,
  invalidate = false,
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
  const generation = fs.readFileSync(targetGenerationFile, 'utf8').trim();
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
    LAMINA_EXTRACTOR_DIGEST: digest('extractors', ['lamina.source-file.v1']),
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
  args.push(path.join(packageRoot, 'cocoindex_app.py'));
  const result = spawnSync('uv', args, {
    cwd: paths.root,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) {
    const error = new Error(`Source observation requires uv: ${result.error.message}`);
    error.code = 'LAMINA_OBSERVATION_UNAVAILABLE';
    throw error;
  }
  if ((result.status ?? 1) !== 0) {
    const error = new Error(`CocoIndex observation exited with status ${result.status ?? 1}.`);
    error.code = 'LAMINA_OBSERVATION_FAILED';
    error.details = { status: result.status ?? 1, signal: result.signal || null };
    throw error;
  }

  const expected = countSourceFiles(paths.root);
  const observed = await graphRequest('observation.status', {
    product: environment.LAMINA_PRODUCT,
    generation,
  }, cwd);
  if (!observed.exists || observed.count !== expected ||
      (expected > 0 && !observed.source_revisions.includes(paths.source_revision))) {
    const error = new Error('CocoIndex exited without a complete committed graphd target state.');
    error.code = 'LAMINA_OBSERVATION_INCOMPLETE';
    error.details = { expected, observed };
    throw error;
  }
  return {
    ok: true,
    mode: live ? 'live' : invalidate ? 'rebuild' : 'observe',
    invalidation,
    generation,
    expected,
    observed,
  };
}
