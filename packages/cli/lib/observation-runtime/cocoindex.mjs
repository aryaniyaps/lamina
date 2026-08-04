import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, graphSocketChildPath } from '../graph-runtime/util.mjs';
import { workerThreadEnvironment, observationWorkerThreadEnvironment } from '../runtime-budget.mjs';

export const OBSERVATION_BACKEND = 'cocoindex';
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function managedWorker() {
  if (process.env.LAMINA_OBSERVATION_WORKER) {
    const configured = path.resolve(process.env.LAMINA_OBSERVATION_WORKER);
    try {
      fs.accessSync(configured, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      return configured;
    } catch {
      return null;
    }
  }
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

function observationFailure(status, signal, stderr, stdout) {
  const error = new Error(`CocoIndex observation exited with status ${status ?? 1}.`);
  error.code = 'LAMINA_OBSERVATION_FAILED';
  error.details = {
    backend: OBSERVATION_BACKEND,
    status: status ?? 1,
    signal: signal || null,
    stderr: String(stderr || '').slice(-4_000),
    stdout: String(stdout || '').slice(-4_000),
  };
  return error;
}

export function runLiveObservationProcess({ command, args, cwd, environment, cancellation }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    let settled = false;
    const finish = (handler) => {
      if (settled) return;
      settled = true;
      handler();
    };
    const stopChild = (signal = 'SIGTERM') => {
      try { process.kill(-child.pid, signal); } catch {
        try { child.kill(signal); } catch {}
      }
    };
    const onCancel = () => {
      stopChild('SIGTERM');
    };
    cancellation?.onCleanup?.(onCancel);
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-4_000); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
    child.on('error', (error) => finish(() => reject(unavailable(
      'CocoIndex worker is unavailable. Reinstall this Lamina release to restore its private worker.',
      { backend: OBSERVATION_BACKEND, cause: error.message },
    ))));
    child.on('exit', (status, signal) => finish(() => {
      if (cancellation?.cancelled) {
        const error = new Error('Observation was cancelled before completion.');
        error.code = 'LAMINA_OBSERVATION_CANCELLED';
        error.details = { backend: OBSERVATION_BACKEND, status, signal, stderr, stdout };
        reject(error);
        return;
      }
      if ((status ?? 1) !== 0) reject(observationFailure(status, signal, stderr, stdout));
      else resolve({ status, stderr, stdout, cancelled: false });
    }));
  });
}

export function runObservationProcess({ command, args, cwd, environment }) {
  // CocoIndex can emit more than Node's 1 MiB spawnSync default while syncing
  // dependencies or reporting a large source scan. We retain only the final
  // diagnostic tail below, but the child must be allowed to finish first.
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw unavailable('CocoIndex worker is unavailable. Reinstall this Lamina release to restore its private worker.', { backend: OBSERVATION_BACKEND, cause: result.error.message });
  if ((result.status ?? 1) !== 0) {
    throw observationFailure(result.status, result.signal, result.stderr, result.stdout);
  }
  return {
    status: result.status,
    stderr: String(result.stderr || '').slice(-4_000),
    stdout: String(result.stdout || '').slice(-4_000),
  };
}

/** Run CocoIndex without exposing a Python/uv prerequisite to release users. */
export async function runCocoIndex({
  paths, generation, live, ignore, extractorDigest, cancellation = null,
}) {
  const worker = managedWorker();
  const environment = {
    ...process.env,
    ...observationWorkerThreadEnvironment(),
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
    LAMINA_OBSERVATION_LIVE: live ? '1' : '0',
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
  if (live) {
    return runLiveObservationProcess({
      command,
      args,
      cwd: packageRoot,
      environment,
      cancellation,
    });
  }
  return runObservationProcess({
    command,
    args,
    cwd: packageRoot,
    environment,
  });
}
