import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processIdentity } from './processes.mjs';

const CLIENT = fileURLToPath(new URL('./broker-client.mjs', import.meta.url));

function brokerRequest(request) {
  const result = spawnSync(process.execPath, [CLIENT, JSON.stringify(request)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 2_000,
    maxBuffer: 16 * 1024,
  });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

export function safeRunnerContext({ minimumTier = 'small' } = {}) {
  if (process.platform !== 'linux') return null;
  if (!process.env.LAMINA_SAFE_RUNNER_BROKER) return null;
  const response = brokerRequest({
    operation: 'context',
    requester: processIdentity(process.pid),
    minimum_tier: minimumTier,
  });
  const context = response?.ok ? response.context : null;
  if (!context || context.adapter !== 'linux-systemd-cgroup-v2'
    || typeof context.unit !== 'string' || !context.unit.startsWith('lamina-safe-')
    || !context.unit.endsWith('.scope') || !context.enforcement) return null;
  try {
    const currentLine = fs.readFileSync('/proc/self/cgroup', 'utf8')
      .split('\n').find((line) => line.startsWith('0::'));
    if (!currentLine) return null;
    const current = fs.realpathSync(path.join(
      '/sys/fs/cgroup', currentLine.slice(3).replace(/^\/+/, ''),
    ));
    const declared = fs.realpathSync(context.cgroup);
    if (current !== declared || path.basename(declared) !== context.unit) return null;
    const readLimit = (name) => {
      const value = fs.readFileSync(path.join(declared, name), 'utf8').trim();
      return value === 'max' ? Number.POSITIVE_INFINITY : Number(value);
    };
    if (readLimit('memory.max') !== context.enforcement.memory_max_bytes
      || readLimit('memory.high') !== context.enforcement.memory_high_bytes
      || readLimit('pids.max') !== context.enforcement.pids_max) return null;
  } catch { return null; }
  return context;
}

export function assertSafeRunnerContext(operation, options = {}) {
  const context = safeRunnerContext(options);
  if (context) return context;
  const error = new Error(
    `${operation} is resource-intensive and must run through the canonical crash-safe command: `
      + 'npm run safe:run -- --tier <small|medium|large> --report <file> -- <command> [args].',
  );
  error.code = 'LAMINA_SAFE_RUNNER_REQUIRED';
  throw error;
}

export function registerManagedGraphdWithSupervisor(identity, paths) {
  if (!process.env.LAMINA_SAFE_RUNNER_BROKER) return null;
  return brokerRequest({
    operation: 'register_graphd',
    requester: processIdentity(process.pid),
    child: identity,
    socket: paths?.socket,
    lock: paths?.lock,
  });
}
