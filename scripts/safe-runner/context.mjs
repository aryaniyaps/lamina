import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTEXT_SCHEMA, TIER_ORDER } from './constants.mjs';

export function createContext(directory, { runId, tier, adapter, unit }) {
  const token = crypto.randomBytes(32).toString('hex');
  const file = path.join(directory, 'context.json');
  const value = {
    schema: CONTEXT_SCHEMA,
    run_id: runId,
    tier,
    adapter,
    unit,
    token,
  };
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  const managedDescendants = path.join(directory, 'managed-descendants.jsonl');
  fs.writeFileSync(managedDescendants, '', { mode: 0o600 });
  return {
    value,
    environment: {
      LAMINA_SAFE_RUNNER_CONTEXT: file,
      LAMINA_SAFE_RUNNER_TOKEN: token,
      LAMINA_SAFE_RUNNER_TIER: tier,
      LAMINA_SAFE_RUNNER_MANAGED_DESCENDANTS: managedDescendants,
    },
  };
}

export function safeRunnerContext({ minimumTier = 'small' } = {}) {
  const file = process.env.LAMINA_SAFE_RUNNER_CONTEXT;
  const token = process.env.LAMINA_SAFE_RUNNER_TOKEN;
  if (!file || !token) return null;
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (value.schema !== CONTEXT_SCHEMA || value.token !== token) return null;
  if (TIER_ORDER.indexOf(value.tier) < TIER_ORDER.indexOf(minimumTier)) return null;
  if (process.platform === 'linux' && value.adapter === 'linux-systemd-cgroup-v2') {
    try {
      const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
      if (!cgroup.includes(value.unit.replace(/\.scope$/, ''))) return null;
    } catch {
      return null;
    }
  }
  return value;
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
