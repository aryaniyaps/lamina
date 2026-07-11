/**
 * Docker isolation for LaminaBench — one ephemeral container per workflow job.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { BENCH_IMAGE, ensureBenchImage, isDockerAvailable } from './bench-image.mjs';

export { BENCH_IMAGE, ensureBenchImage, isDockerAvailable };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_MEMORY = process.env.BENCH_CONTAINER_MEMORY || '8g';
const DEFAULT_CPUS = process.env.BENCH_CONTAINER_CPUS || '4';

const ANTHROPIC_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'BENCH_PHASE_TIMEOUT_MS',
];

/** Inline task description/context so the container never needs benchmarks/tasks/. */
export function inlineTaskForContainer(task) {
  const descriptionPath = path.join(
    ROOT,
    task._paths?.description || `benchmarks/tasks/${task.id}/description.md`
  );
  const contextPath = path.join(
    ROOT,
    task._paths?.context || `benchmarks/tasks/${task.id}/context.md`
  );

  return {
    ...task,
    description: task.description ?? fs.readFileSync(descriptionPath, 'utf8').trim(),
    context: task.context ?? fs.readFileSync(contextPath, 'utf8').trim(),
  };
}

function resolveContainerUser() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
  if (uid === 0) return '1000:1000';
  return `${uid}:${gid}`;
}

function buildDockerEnv() {
  const env = ['-e', 'HOME=/workspace/.bench-home', '-e', 'IS_SANDBOX=1'];
  for (const key of ANTHROPIC_ENV_KEYS) {
    if (process.env[key] != null) {
      env.push('-e', `${key}=${process.env[key]}`);
    }
  }
  return env;
}

/**
 * Run a staged workflow job inside an ephemeral Docker container.
 * @returns {Promise<object>} workflow result (artifact, status, steps, ...)
 */
export function runJobInContainer({ workspace, metaDir, task, arm, agent }) {
  fs.mkdirSync(metaDir, { recursive: true });
  fs.mkdirSync(path.join(workspace, '.bench-home'), { recursive: true });

  const inlined = inlineTaskForContainer(task);
  fs.writeFileSync(path.join(metaDir, 'task.json'), JSON.stringify(inlined, null, 2));

  const resultPath = path.join(metaDir, 'result.json');
  if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);

  const args = [
    'run',
    '--rm',
    '--init',
    '-v',
    `${workspace}:/workspace:rw`,
    '-v',
    `${metaDir}:/meta:rw`,
    '-w',
    '/workspace',
    '--read-only',
    '--tmpfs',
    '/tmp:exec',
    '--network',
    'bridge',
    '--memory',
    DEFAULT_MEMORY,
    '--cpus',
    DEFAULT_CPUS,
    '-u',
    resolveContainerUser(),
    ...buildDockerEnv(),
    BENCH_IMAGE,
    '--arm',
    arm,
    '--agent',
    agent,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`docker run failed to start: ${err.message}`));
    });

    child.on('close', (code) => {
      if (!fs.existsSync(resultPath)) {
        reject(
          new Error(
            `Container exited ${code} without result.json.\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        );
        return;
      }

      let payload;
      try {
        payload = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      } catch (err) {
        reject(new Error(`Invalid result.json: ${err.message}`));
        return;
      }

      if (!payload.ok) {
        reject(
          new Error(
            payload.error ||
              `Container workflow failed (exit ${code}).\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        );
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `Container exited ${code}.\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        );
        return;
      }

      resolve(payload);
    });
  });
}
