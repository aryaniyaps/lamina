import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

let quotaCapability = null;

function commandAvailable(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 3_000,
    maxBuffer: 64 * 1024,
  });
  return !result.error && result.status === 0;
}

function temporaryQuotaAvailable() {
  if (quotaCapability !== null) return quotaCapability;
  if (!commandAvailable('bwrap')) return (quotaCapability = false);
  const result = spawnSync('bwrap', [
    '--unshare-user', '--uid', '0', '--gid', '0', '--ro-bind', '/', '/',
    '--dev-bind', '/dev', '/dev', '--proc', '/proc', '--size', '1048576', '--tmpfs', '/tmp',
    '/bin/sh', '-c',
    'dd if=/dev/zero of=/tmp/first bs=262144 count=2 status=none && ! dd if=/dev/zero of=/tmp/second bs=262144 count=4 status=none 2>/dev/null',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000, maxBuffer: 64 * 1024 });
  quotaCapability = !result.error && result.status === 0;
  return quotaCapability;
}

export function probeLinuxSystemd(platform = process.platform) {
  const reasons = [];
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
  if (!commandAvailable('systemd-run')) reasons.push('systemd-run is unavailable');
  const temporaryQuota = temporaryQuotaAvailable();
  if (!temporaryQuota) reasons.push('unprivileged bwrap size-limited tmpfs enforcement is unavailable');
  const userManager = spawnSync('systemctl', ['--user', 'is-system-running'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 3_000,
    maxBuffer: 64 * 1024,
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
    temporary_quota: temporaryQuota,
    controllers,
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
