import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, graphSocketChildPath } from '../graph-runtime/util.mjs';

export const OBSERVATION_BACKEND = 'cocoindex';
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function managedWorker() {
  const executable = process.platform === 'win32' ? 'cocoindex-worker.exe' : 'cocoindex-worker';
  const worker = path.join(packageRoot, 'observation-runtime', executable);
  try {
    fs.accessSync(worker, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return worker;
  } catch {
    return null;
  }
}

function unavailable(message, details = {}) {
  const error = new Error(message);
  error.code = 'LAMINA_OBSERVATION_UNAVAILABLE';
  error.details = details;
  return error;
}

/** Run CocoIndex without exposing a Python/uv prerequisite to release users. */
export function runCocoIndex({ paths, generation, live, ignore, extractorDigest }) {
  const worker = managedWorker();
  const environment = {
    ...process.env,
    COCOINDEX_DB: path.join(paths.cocoindex, 'state.db'),
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    LAMINA_SOURCE_ROOT: paths.root,
    LAMINA_GRAPHD_ENDPOINT: graphSocketChildPath(paths),
    LAMINA_GRAPHD_TOKEN: paths.auth_token,
    LAMINA_PRODUCT: paths.product,
    LAMINA_SOURCE_REVISION: paths.source_revision,
    LAMINA_IGNORE_DIGEST: digest('ignore', ignore),
    LAMINA_EXTRACTOR_DIGEST: extractorDigest,
    LAMINA_OBSERVATION_GENERATION: generation,
  };
  let command;
  let args;
  if (worker) {
    command = worker;
    args = ['update'];
    if (live) args.push('--live');
    args.push('cocoindex_app.py');
  } else if (process.env.LAMINA_STANDALONE === '1') {
    throw unavailable('The installed CocoIndex worker is missing or is not executable. Reinstall this Lamina release to restore its private worker.', {
      expected: path.join(packageRoot, 'observation-runtime', process.platform === 'win32' ? 'cocoindex-worker.exe' : 'cocoindex-worker'),
    });
  } else {
    // Source checkout convenience only. Published standalone binaries never
    // reach this branch: their locked runtime is bundled at build time.
    command = 'uv';
    args = ['run', '--project', packageRoot, '--python', '3.13', 'cocoindex', 'update'];
    if (live) args.push('--live');
    args.push('cocoindex_app.py');
    environment.UV_PROJECT_ENVIRONMENT = path.join(paths.cocoindex, 'python-env');
  }
  // CocoIndex can emit more than Node's 1 MiB spawnSync default while syncing
  // dependencies or reporting a large source scan. We retain only the final
  // diagnostic tail below, but the child must be allowed to finish first.
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw unavailable('CocoIndex worker is unavailable. Reinstall this Lamina release to restore its private worker.', { backend: OBSERVATION_BACKEND, cause: result.error.message });
  if ((result.status ?? 1) !== 0) {
    const error = new Error(`CocoIndex observation exited with status ${result.status ?? 1}.`);
    error.code = 'LAMINA_OBSERVATION_FAILED';
    error.details = { backend: OBSERVATION_BACKEND, status: result.status ?? 1, signal: result.signal || null, stderr: String(result.stderr || '').slice(-4_000), stdout: String(result.stdout || '').slice(-4_000) };
    throw error;
  }
  return {
    status: result.status,
    stderr: String(result.stderr || '').slice(-4_000),
    stdout: String(result.stdout || '').slice(-4_000),
  };
}
