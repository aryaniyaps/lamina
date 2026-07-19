import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BWRAP = '/usr/bin/bwrap';
const CODEX_BINARY = fs.realpathSync('/home/aryan/.local/bin/codex');
const NODE_ROOT = path.resolve(path.dirname(fs.realpathSync(process.execPath)), '..');
const HOST_HOME = os.homedir();

function copyCredential(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Missing authentication material: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o600);
}

export function prepareRuntimeHome(provider, runtimeHome) {
  const root = path.resolve(runtimeHome);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  if (provider === 'codex') copyCredential(path.join(HOST_HOME, '.codex', 'auth.json'), path.join(root, '.codex', 'auth.json'));
  else if (provider === 'claude-code') copyCredential(path.join(HOST_HOME, '.claude', '.credentials.json'), path.join(root, '.claude', '.credentials.json'));
  else throw new Error(`Unsupported isolated provider: ${provider}`);
  return root;
}

export function scrubRuntimeCredentials(runtimeHome) {
  for (const relative of [path.join('.codex', 'auth.json'), path.join('.claude', '.credentials.json')]) {
    const file = path.join(runtimeHome, relative);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function baseArgs(workspace, runtimeHome, command) {
  const resolvedWorkspace = path.resolve(workspace);
  const resolvedHome = path.resolve(runtimeHome);
  if (!fs.existsSync(resolvedWorkspace)) throw new Error(`Isolation workspace missing: ${resolvedWorkspace}`);
  fs.mkdirSync(resolvedHome, { recursive: true, mode: 0o700 });
  const toolBind = command === 'codex'
    ? ['--ro-bind', CODEX_BINARY, '/opt/bin/codex']
    : command === 'claude'
      ? ['--ro-bind', fs.realpathSync('/home/aryan/.local/bin/claude'), '/opt/bin/claude']
      : [];
  return [
    '--die-with-parent',
    '--new-session',
    '--unshare-all',
    '--share-net',
    '--clearenv',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/etc', '/etc',
    '--ro-bind', NODE_ROOT, '/opt/node',
    ...toolBind,
    '--dev', '/dev',
    '--proc', '/proc',
    '--tmpfs', '/tmp',
    '--dir', '/run',
    '--dir', '/run/systemd',
    '--ro-bind', '/run/systemd/resolve', '/run/systemd/resolve',
    '--dir', '/home',
    '--dir', '/home/runner',
    '--bind', resolvedHome, '/home/runner',
    '--bind', resolvedWorkspace, '/workspace',
    '--chdir', '/workspace',
    '--setenv', 'HOME', '/home/runner',
    '--setenv', 'CODEX_HOME', '/home/runner/.codex',
    '--setenv', 'XDG_CACHE_HOME', '/home/runner/.cache',
    '--setenv', 'XDG_CONFIG_HOME', '/home/runner/.config',
    '--setenv', 'PATH', '/opt/bin:/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    '--setenv', 'LANG', 'C.UTF-8',
    '--setenv', 'LC_ALL', 'C.UTF-8',
    '--setenv', 'CI', '1',
    '--setenv', 'NO_COLOR', '1',
  ];
}

export function isolatedCommand({ workspace, runtimeHome, command, args = [] }) {
  const mapped = command === 'codex' ? '/opt/bin/codex' : command === 'claude' ? '/opt/bin/claude' : command;
  return { command: BWRAP, args: [...baseArgs(workspace, runtimeHome, command), '--', mapped, ...args] };
}

export function auditIsolation(workspace, runtimeHome) {
  const probe = isolatedCommand({
    workspace,
    runtimeHome,
    command: '/bin/sh',
    args: ['-c', [
      'test -d /workspace',
      'test -d /home/runner',
      'test ! -e /home/aryan/ai-projects/lamina',
      'test ! -e /home/aryan/.codex/attachments',
      'test ! -e /home/aryan/.codex/memories',
      'test ! -e /corpus',
    ].join(' && ')],
  });
  const result = spawnSync(probe.command, probe.args, { encoding: 'utf8', timeout: 30000 });
  return {
    version: 1,
    mechanism: 'bubblewrap-user-namespace',
    workspace_mount: '/workspace',
    runtime_home_mount: '/home/runner',
    network: 'shared-for-model-api-and-package-validation',
    host_repository_visible: false,
    host_codex_attachments_visible: false,
    host_codex_memories_visible: false,
    passed: result.status === 0,
    exit_code: result.status,
    stderr: `${result.stderr || ''}`.trim(),
  };
}
