#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AUTHORITY_SCHEMA = 'lamina.safe-runner-oracle-host-launch-authority/v1';
const ALLOWED_PROFILES = new Set([
  'oracle-host-probe-v1',
  'candidate-lease-worker-v1',
]);
const MAX_AUTHORITY_BYTES = 64 * 1024;
const EXACT_BOOTSTRAP_ENVIRONMENT = Object.freeze({
  LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC',
});

function fail(message) {
  const error = new Error(message);
  error.code = 'LAMINA_SAFE_ORACLE_HOST_AUTHORITY';
  throw error;
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function decodeAuthority(encoded) {
  if (typeof encoded !== 'string' || encoded.length < 1
    || encoded.length > Math.ceil(MAX_AUTHORITY_BYTES * 4 / 3)
    || !/^[A-Za-z0-9_-]+$/.test(encoded)) fail('oracle-host launch authority encoding is invalid');
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.length > MAX_AUTHORITY_BYTES || bytes.toString('base64url') !== encoded) {
    fail('oracle-host launch authority exceeds its bounded canonical encoding');
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return fail('oracle-host launch authority is not JSON');
  }
}

function assertPhysicalFile(file, expected, { executable = false } = {}) {
  if (!path.isAbsolute(file) || !exactKeys(expected,
    ['path', 'dev', 'ino', 'uid', 'mode', 'size', 'digest']) || expected.path !== file) {
    fail('oracle-host launch file authority is malformed');
  }
  const named = fs.lstatSync(file, { bigint: true });
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n || opened.nlink !== 1n
      || named.dev !== opened.dev
      || named.ino !== opened.ino || named.uid !== opened.uid || named.mode !== opened.mode
      || named.size !== opened.size || String(opened.dev) !== expected.dev
      || String(opened.ino) !== expected.ino || Number(opened.uid) !== expected.uid
      || Number(opened.mode & 0o7777n) !== expected.mode || String(opened.size) !== expected.size
      || (executable && (opened.mode & 0o111n) === 0n)
      || (opened.mode & 0o22n) !== 0n || fs.realpathSync.native(file) !== file) {
      fail('oracle-host launch file identity changed');
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || crypto.createHash('sha256').update(bytes).digest('hex') !== expected.digest) {
      fail('oracle-host launch file content changed');
    }
  } finally { fs.closeSync(descriptor); }
}

export function validateOracleHostLaunchAuthority(encoded, {
  argv = process.argv,
  execPath = process.execPath,
  launcherPath = fileURLToPath(import.meta.url),
  cwd = process.cwd(),
  environment = process.env,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 3 || argv[2] !== encoded) {
    fail('oracle-host launcher argv is not exact');
  }
  const authority = decodeAuthority(encoded);
  if (!exactKeys(authority, [
    'schema', 'profile', 'node', 'launcher', 'host', 'cwd', 'argv',
    'profile_argument_sha256', 'non_gradeable',
  ]) || !['node', 'launcher', 'host'].every((name) =>
    exactKeys(authority[name], ['path', 'identity']))
    || authority.schema !== AUTHORITY_SCHEMA || !ALLOWED_PROFILES.has(authority.profile)
    || authority.non_gradeable !== true || !path.isAbsolute(authority.cwd)
    || fs.realpathSync.native(authority.cwd) !== authority.cwd || fs.realpathSync.native(cwd) !== authority.cwd
    || !Array.isArray(authority.argv) || authority.argv.length !== 5
    || authority.argv[0] !== authority.node?.path || authority.argv[1] !== authority.host?.path
    || authority.host?.path !== authority.host?.identity?.path
    || !authority.host.path.startsWith(`${authority.cwd}${path.sep}`)
    || !path.isAbsolute(authority.argv[2]) || !path.isAbsolute(authority.argv[3])
    || authority.argv[2] === authority.argv[3]
    || typeof authority.argv[4] !== 'string' || authority.argv[4].length > MAX_AUTHORITY_BYTES
    || crypto.createHash('sha256').update(authority.argv[4]).digest('hex')
      !== authority.profile_argument_sha256) {
    fail('oracle-host sealed launch translation is invalid');
  }
  if (fs.realpathSync.native(execPath) !== authority.node.path
    || fs.realpathSync.native(launcherPath) !== authority.launcher.path) {
    fail('oracle-host launcher did not start from sealed authority');
  }
  if (JSON.stringify(Object.keys(environment).sort())
      !== JSON.stringify(Object.keys(EXACT_BOOTSTRAP_ENVIRONMENT).sort())
    || Object.entries(EXACT_BOOTSTRAP_ENVIRONMENT)
      .some(([name, value]) => environment[name] !== value)) {
    fail('oracle-host launcher environment is not exact');
  }
  assertPhysicalFile(authority.node.path, authority.node.identity, { executable: true });
  assertPhysicalFile(authority.launcher.path, authority.launcher.identity);
  assertPhysicalFile(authority.host.path, authority.host.identity);
  return Object.freeze(authority);
}

export async function main() {
  const authority = validateOracleHostLaunchAuthority(process.argv[2]);
  process.chdir(authority.cwd);
  const hostModule = await import(pathToFileURL(authority.host.path).href);
  if (typeof hostModule.main !== 'function') fail('sealed oracle-host main export is unavailable');
  await hostModule.main(Object.freeze(authority.argv.slice(2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
