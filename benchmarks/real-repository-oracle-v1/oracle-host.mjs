#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  ORACLE_HOST_LAUNCH_PROFILE,
  ORACLE_HOST_PROBE_MAX_QUOTA_BYTES,
  oracleKeeperBwrapArguments,
  parseOracleBwrapInfo,
} from '../../scripts/safe-runner/oracle-host-profile.mjs';

export const ORACLE_HOST_RESULT_SCHEMA =
  'lamina.real-repository-oracle-host-probe/v1';
const MAX_PROFILE_BYTES = 64 * 1024;
const MAX_BROKER_RESPONSE_BYTES = 16 * 1024;
const EXACT_ENVIRONMENT = Object.freeze({ LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' });

function invocationError(message) {
  const error = new Error(`oracle-host invocation ${message}`);
  error.code = 'LAMINA_SAFE_ORACLE_HOST_AUTHORITY';
  throw error;
}

function processIdentity(pid) {
  const text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const close = text.lastIndexOf(')');
  const fields = close > 0 ? text.slice(close + 2).trim().split(/\s+/) : [];
  const startTicks = fields[19];
  if (!/^\d+$/.test(startTicks || '')) invocationError('cannot bind a process identity');
  return { pid: Number(pid), start_ticks: startTicks };
}

export function validateOracleHostInvocation(args, environment = process.env) {
  if (!Array.isArray(args) || args.length !== 3
    || JSON.stringify(Object.keys(environment).sort())
      !== JSON.stringify(Object.keys(EXACT_ENVIRONMENT).sort())
    || Object.entries(EXACT_ENVIRONMENT).some(([name, value]) => environment[name] !== value)) {
    invocationError('or bootstrap environment is not exact');
  }
  const [quotaReady, quotaRelease, encodedProfile] = args;
  if (![quotaReady, quotaRelease].every((value) => typeof value === 'string' && path.isAbsolute(value))
    || path.dirname(quotaReady) !== path.dirname(quotaRelease)
    || path.basename(quotaReady) !== 'quota.ready'
    || path.basename(quotaRelease) !== 'quota.release'
    || typeof encodedProfile !== 'string' || !/^[A-Za-z0-9_-]+$/.test(encodedProfile)
    || encodedProfile.length > Math.ceil(MAX_PROFILE_BYTES * 4 / 3)) {
    invocationError('paths or profile encoding are invalid');
  }
  const bytes = Buffer.from(encodedProfile, 'base64url');
  if (bytes.length > MAX_PROFILE_BYTES || bytes.toString('base64url') !== encodedProfile) {
    invocationError('profile encoding is not canonical');
  }
  let profile;
  try { profile = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { invocationError('profile is not exact JSON'); }
  const expectedArguments = oracleKeeperBwrapArguments(profile?.quota_bytes);
  if (profile?.schema !== 'lamina.safe-runner-oracle-host-launch-profile/v1'
    || profile.id !== ORACLE_HOST_LAUNCH_PROFILE || profile.non_gradeable !== true
    || !path.isAbsolute(profile.bwrap || '') || !path.isAbsolute(profile.broker_socket || '')
    || path.dirname(profile.broker_socket) !== path.dirname(quotaReady)
    || !Number.isSafeInteger(profile.quota_bytes) || profile.quota_bytes < 4096
    || profile.quota_bytes > ORACLE_HOST_PROBE_MAX_QUOTA_BYTES
    || JSON.stringify(profile.keeper_arguments) !== JSON.stringify(expectedArguments)) {
    invocationError('profile authority is invalid');
  }
  return { quota_ready: quotaReady, quota_release: quotaRelease, profile };
}

async function brokerRequest(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let response = '';
    const timeout = setTimeout(() => socket.destroy(new Error('oracle proof broker timeout')), 2_000);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      response += chunk;
      if (Buffer.byteLength(response, 'utf8') > MAX_BROKER_RESPONSE_BYTES) {
        socket.destroy(new Error('oracle proof broker response exceeded bound'));
        return;
      }
      const newline = response.indexOf('\n');
      if (newline === -1) return;
      clearTimeout(timeout);
      if (response.slice(newline + 1)) return reject(new Error('oracle proof broker response is not one record'));
      let parsed;
      try { parsed = JSON.parse(response.slice(0, newline)); }
      catch { return reject(new Error('oracle proof broker response is invalid')); }
      socket.end();
      return parsed?.ok === true ? resolve(parsed) : reject(new Error(
        `oracle proof broker refused: ${String(parsed?.error || 'unknown').slice(0, 500)}`,
      ));
    });
    socket.once('error', (error) => { clearTimeout(timeout); reject(error); });
  });
}

function writeQuotaReady(file, proof) {
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n
    || Number(stat.uid) !== process.getuid()) invocationError('quota.ready is not runner-owned');
  const value = `${JSON.stringify({
    ...proof,
    filesystem_type: 'tmpfs',
    block_size: proof.filesystem.block_size,
    blocks: proof.filesystem.blocks,
  })}\n`;
  if (Buffer.byteLength(value) > MAX_BROKER_RESPONSE_BYTES) invocationError('quota proof exceeds bound');
  fs.writeFileSync(file, value, { flag: 'w', mode: 0o600 });
}

function waitForRelease(file) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const byte = Buffer.alloc(1);
    if (fs.readSync(descriptor, byte, 0, 1, null) < 1) {
      throw new Error('oracle quota release gate closed without authorization');
    }
  } finally { fs.closeSync(descriptor); }
}

function releaseKeeperGate(child) {
  if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
}

export async function terminateKeeper(child, { timeoutMs = 1_500 } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close').then(() => true);
  releaseKeeperGate(child);
  let timeout = null;
  let exited;
  try {
    exited = await Promise.race([closed, new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    })]);
  } finally { clearTimeout(timeout); }
  if (!exited) {
    throw new Error('oracle keeper did not close after its owned block gate was released');
  }
}

export function oracleHostResult({ proof, usage, release, finish }) {
  return {
    schema: ORACLE_HOST_RESULT_SCHEMA,
    non_gradeable: true,
    cleanup_proof_issued: false,
    grading_reachable: false,
    candidate_executed: false,
    keeper: proof.keeper,
    filesystem: proof.filesystem,
    enospc_proven: usage.enospc_proven === true,
    mount_fds_released: release.mount_fds_released === true,
    identities_dead: finish.identities_dead === true,
    proc_anchor_released: finish.proc_anchor_released === true,
    limitations: [
      'untrusted candidate execution and grading are unreachable in this probe',
      'same-UID ambient pathname replacement and proof-broker requester impersonation remain unsupported denial-of-service or state-race surfaces; the runner terminal tuple prevents false success',
      'Git realpath cannot consume the proc-acquired quota descriptor as a repository path',
      'bwrap 0.11.1 sibling --bind-fd cannot consume the proc-acquired quota descriptor',
    ],
  };
}

export async function main(exactArguments = []) {
  const invocation = validateOracleHostInvocation(exactArguments);
  const requester = processIdentity(process.pid);
  const child = spawn(invocation.profile.bwrap, invocation.profile.keeper_arguments, {
    cwd: process.cwd(), env: process.env, stdio: ['pipe', 'ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4096); });
  let keeper = null;
  const outer = processIdentity(child.pid);
  try {
    let info = '';
    child.stdio[3].setEncoding('utf8');
    for await (const chunk of child.stdio[3]) {
      info += chunk;
      if (Buffer.byteLength(info) > 8 * 1024) throw new Error('bwrap info exceeded bound');
    }
    const bwrapInfo = parseOracleBwrapInfo(info);
    keeper = processIdentity(bwrapInfo.child_pid);
    const registration = await brokerRequest(invocation.profile.broker_socket, {
      operation: 'register_oracle_quota', requester, outer, keeper, bwrap_info: bwrapInfo,
      quota_bytes: invocation.profile.quota_bytes,
    });
    writeQuotaReady(invocation.quota_ready, registration.proof);
    waitForRelease(invocation.quota_release);
    const usage = (await brokerRequest(invocation.profile.broker_socket, {
      operation: 'probe_oracle_quota', requester, exercise_enospc: true,
    })).usage;
    const release = (await brokerRequest(invocation.profile.broker_socket, {
      operation: 'release_oracle_quota', requester,
    })).release;
    await terminateKeeper(child);
    const finish = (await brokerRequest(invocation.profile.broker_socket, {
      operation: 'finish_oracle_quota', requester,
    })).finish;
    const line = `${JSON.stringify(oracleHostResult({
      proof: registration.proof, usage, release, finish,
    }))}\n`;
    if (Buffer.byteLength(line) >= 8 * 1024) throw new Error('oracle-host result exceeds bound');
    process.stdout.write(line);
  } catch (error) {
    try { releaseKeeperGate(child); } catch {}
    throw Object.assign(new Error(`${error.message}${stderr ? `: ${stderr.trim()}` : ''}`), {
      code: error.code || 'LAMINA_SAFE_ORACLE_HOST',
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
