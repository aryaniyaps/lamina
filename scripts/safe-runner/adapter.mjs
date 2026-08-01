import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  assertTrustedBinaryIdentity, infrastructureBinaries, sanitizedEnvironment,
} from './infrastructure.mjs';

let quotaCapability = null;

export function boundedProbeFailure(result) {
  const parts = [];
  if (result?.error) parts.push(`error=${String(result.error.code || result.error.message || result.error)}`);
  if (result?.status !== null && result?.status !== undefined) parts.push(`exit=${result.status}`);
  if (result?.signal) parts.push(`signal=${result.signal}`);
  const output = String(result?.stderr || result?.stdout || '').replace(/\s+/g, ' ').trim();
  if (output) parts.push(`output=${output.slice(0, 500)}`);
  return parts.join('; ') || 'no process result';
}

function commandAvailable(command, args = ['--version'], identity = null) {
  if (identity) assertTrustedBinaryIdentity(identity);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 3_000,
    maxBuffer: 64 * 1024, env: sanitizedEnvironment(process.env),
  });
  return !result.error && result.status === 0;
}

function temporaryQuotaAvailable(binaries) {
  if (quotaCapability !== null) return quotaCapability;
  assertTrustedBinaryIdentity(binaries.identities.bwrap);
  const version = spawnSync(binaries.bwrap, ['--version'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000, maxBuffer: 64 * 1024,
    env: sanitizedEnvironment(process.env),
  });
  if (version.error || version.status !== 0) {
    return (quotaCapability = {
      available: false,
      reason: `bwrap command is unavailable (${boundedProbeFailure(version)})`,
    });
  }
  assertTrustedBinaryIdentity(binaries.identities.bwrap);
  const result = spawnSync(binaries.bwrap, [
    '--unshare-user', '--uid', '0', '--gid', '0', '--ro-bind', '/', '/',
    '--dev-bind', '/dev', '/dev', '--proc', '/proc', '--size', '1048576', '--tmpfs', '/tmp',
    '/bin/sh', '-c',
    'dd if=/dev/zero of=/tmp/first bs=262144 count=2 status=none && ! dd if=/dev/zero of=/tmp/second bs=262144 count=4 status=none 2>/dev/null',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000, maxBuffer: 64 * 1024,
    env: sanitizedEnvironment(process.env) });
  const available = !result.error && result.status === 0;
  quotaCapability = {
    available,
    reason: available ? null
      : `unprivileged bwrap size-limited tmpfs probe failed (${boundedProbeFailure(result)})`,
  };
  return quotaCapability;
}

export function probeLinuxSystemd(platform = process.platform) {
  const reasons = [];
  let binaries = null;
  try { binaries = infrastructureBinaries(); } catch (error) { reasons.push(error.message); }
  if (platform !== 'linux') reasons.push(`platform ${platform} is unsupported`);
  let controllers = [];
  try {
    controllers = fs.readFileSync('/sys/fs/cgroup/cgroup.controllers', 'utf8').trim().split(/\s+/);
  } catch {
    reasons.push('the host does not expose a unified cgroup v2 hierarchy');
  }
  for (const controller of ['memory', 'pids']) {
    if (!controllers.includes(controller)) reasons.push(`cgroup v2 ${controller} controller is unavailable`);
  }
  if (binaries && !commandAvailable(
    binaries.systemdRun, ['--version'], binaries.identities.systemdRun,
  )) reasons.push('systemd-run is unavailable');
  const temporaryQuota = binaries ? temporaryQuotaAvailable(binaries)
    : { available: false, reason: 'trusted bwrap identity is unavailable' };
  if (!temporaryQuota.available) reasons.push(temporaryQuota.reason);
  const userManager = spawnSync(binaries?.systemctl || '/nonexistent', ['--user', 'is-system-running'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 3_000,
    maxBuffer: 64 * 1024, env: sanitizedEnvironment(process.env),
  });
  if (userManager.error || !['running', 'degraded'].includes(String(userManager.stdout || '').trim())) {
    reasons.push('the systemd user manager is unavailable');
  }
  return {
    id: 'linux-systemd-cgroup-v2',
    platform,
    production_enforcement: reasons.length === 0,
    aggregate_memory: reasons.length === 0,
    aggregate_pids: reasons.length === 0,
    complete_descendant_ownership: reasons.length === 0,
    temporary_quota: temporaryQuota.available,
    controllers,
    infrastructure: binaries,
    reasons,
  };
}

export function adapterProbe(platform = process.platform) {
  if (platform === 'linux') return probeLinuxSystemd(platform);
  return {
    id: 'portable-process-group-small-only',
    platform,
    production_enforcement: false,
    aggregate_memory: false,
    aggregate_pids: false,
    complete_descendant_ownership: false,
    controllers: [],
    reasons: [
      `production enforcement is not implemented for ${platform}`,
      'macOS and Windows adapters are deferred to issue #57; medium/large execution is refused',
    ],
  };
}

export function assertAdapterShape(adapter) {
  for (const method of ['launch', 'sample', 'signal', 'cleanup']) {
    if (typeof adapter?.[method] !== 'function') {
      throw new TypeError(`safe-runner adapter must implement ${method}()`);
    }
  }
  if (typeof adapter.id !== 'string' || !adapter.id) {
    throw new TypeError('safe-runner adapter must expose a non-empty id');
  }
  return adapter;
}
