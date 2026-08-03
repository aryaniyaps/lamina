#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  ORACLE_HOST_LAUNCH_PROFILE,
  ORACLE_HOST_PROBE_MAX_QUOTA_BYTES,
  TMPFS_MAGIC,
  oracleKeeperBwrapArguments,
  parseOracleBwrapInfo,
} from '../../scripts/safe-runner/oracle-host-profile.mjs';
import {
  ORACLE_CACHE_CAPABILITY_AUTHORITY, ORACLE_CACHE_CAPABILITY_CONTENT,
  ORACLE_CACHE_CAPABILITY_SOURCE_NAME,
} from '../../scripts/safe-runner/oracle-cache-capability.mjs';
import { waitForOracleKeeperMountTopology } from
  '../../scripts/safe-runner/oracle-quota-broker.mjs';

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

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function processIdentity(pid) {
  const text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const close = text.lastIndexOf(')');
  const fields = close > 0 ? text.slice(close + 2).trim().split(/\s+/) : [];
  const startTicks = fields[19];
  if (!/^\d+$/.test(startTicks || '')) invocationError('cannot bind a process identity');
  return { pid: Number(pid), start_ticks: startTicks };
}

function cacheCapabilityIdentity(stat, bytes) {
  return {
    dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
    mode: Number(stat.mode & 0o7777n), size: Number(stat.size),
    digest: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function readCacheCapability(descriptor) {
  const bytes = Buffer.alloc(ORACLE_CACHE_CAPABILITY_AUTHORITY.size);
  const count = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
  if (count !== bytes.length) invocationError('cache capability content is incomplete');
  return bytes;
}

export function createCacheCapabilitySource(privateTmpRoot) {
  if (!path.isAbsolute(privateTmpRoot || '')
    || fs.realpathSync.native(privateTmpRoot) !== privateTmpRoot) {
    invocationError('private tmpfs authority is not canonical');
  }
  const root = fs.lstatSync(privateTmpRoot, { bigint: true });
  const rootFilesystem = fs.statfsSync(privateTmpRoot);
  if (!root.isDirectory() || root.isSymbolicLink()
    || Number(root.uid) !== process.getuid() || Number(root.gid) !== process.getgid()
    || Number(root.mode & 0o777n) !== 0o700 || Number(rootFilesystem.type) !== TMPFS_MAGIC) {
    invocationError('private tmpfs authority is not exact runner-owned tmpfs');
  }
  const sourcePath = path.join(privateTmpRoot, ORACLE_CACHE_CAPABILITY_SOURCE_NAME);
  const content = Buffer.from(ORACLE_CACHE_CAPABILITY_CONTENT);
  let writer = null;
  let descriptor = null;
  try {
    writer = fs.openSync(sourcePath, fs.constants.O_CREAT | fs.constants.O_EXCL
      | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o400);
    fs.writeFileSync(writer, content);
    fs.fchmodSync(writer, 0o400);
    fs.fsyncSync(writer);
    fs.closeSync(writer);
    writer = null;
    descriptor = fs.openSync(sourcePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const observed = readCacheCapability(descriptor);
    const identity = cacheCapabilityIdentity(opened, observed);
    if (!opened.isFile() || opened.nlink !== 1n || !observed.equals(content)
      || identity.mode !== 0o400 || identity.size !== ORACLE_CACHE_CAPABILITY_AUTHORITY.size
      || identity.digest !== ORACLE_CACHE_CAPABILITY_AUTHORITY.digest) {
      invocationError('cache capability source identity is invalid');
    }
    return {
      descriptor,
      claim: {
        schema: 'lamina.safe-runner-oracle-cache-capability-claim/v1',
        transfer: ORACLE_CACHE_CAPABILITY_AUTHORITY.transfer,
        descriptor: ORACLE_CACHE_CAPABILITY_AUTHORITY.descriptor,
        source_path: sourcePath,
        pathname_absent: false,
        source_fd_closed: false,
        identity,
      },
    };
  } catch (error) {
    if (writer !== null) fs.closeSync(writer);
    if (descriptor !== null) fs.closeSync(descriptor);
    try { fs.unlinkSync(sourcePath); } catch {}
    throw error;
  }
}

export function anonymizeCacheCapability(capability) {
  const descriptor = capability?.descriptor;
  const claim = capability?.claim;
  if (!Number.isSafeInteger(descriptor) || claim?.pathname_absent !== false
    || claim?.source_fd_closed !== false) invocationError('cache capability is not releasable');
  fs.unlinkSync(claim.source_path);
  if (fs.existsSync(claim.source_path)) invocationError('cache capability source path survived unlink');
  const after = fs.fstatSync(descriptor, { bigint: true });
  const stable = readCacheCapability(descriptor);
  const observed = cacheCapabilityIdentity(after, stable);
  if (after.nlink !== 0n || JSON.stringify(observed) !== JSON.stringify(claim.identity)
    || !stable.equals(Buffer.from(ORACLE_CACHE_CAPABILITY_CONTENT))) {
    invocationError('cache capability changed after unlink');
  }
  fs.closeSync(descriptor);
  assertDescriptorClosed(descriptor);
  return { ...claim, pathname_absent: true, source_fd_closed: true };
}

function assertDescriptorClosed(descriptor) {
  try { fs.fstatSync(descriptor); }
  catch (error) {
    if (error?.code === 'EBADF') return;
    throw error;
  }
  invocationError('cache capability source descriptor remained open');
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
  if (!exactKeys(profile, [
    'schema', 'id', 'bwrap', 'bwrap_identity', 'bwrap_capabilities',
    'launcher', 'launcher_identity', 'bootstrap_environment', 'host', 'host_identity',
    'non_gradeable', 'quota_bytes', 'keeper_arguments', 'broker_socket',
    'private_tmp_root', 'cache_capability',
  ]) || profile.schema !== 'lamina.safe-runner-oracle-host-launch-profile/v1'
    || profile.id !== ORACLE_HOST_LAUNCH_PROFILE || profile.non_gradeable !== true
    || !path.isAbsolute(profile.bwrap || '') || !path.isAbsolute(profile.broker_socket || '')
    || path.dirname(profile.broker_socket) !== path.dirname(quotaReady)
    || !path.isAbsolute(profile.private_tmp_root || '')
    || path.dirname(profile.private_tmp_root) !== path.dirname(quotaReady)
    || path.basename(profile.private_tmp_root) !== 'payload-tmp'
    || !Number.isSafeInteger(profile.quota_bytes) || profile.quota_bytes < 4096
    || profile.quota_bytes > ORACLE_HOST_PROBE_MAX_QUOTA_BYTES
    || JSON.stringify(profile.cache_capability)
      !== JSON.stringify(ORACLE_CACHE_CAPABILITY_AUTHORITY)
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
  const cacheCapability = proof?.cache_capability;
  const anonymousTransferProven = cacheCapability?.schema
      === 'lamina.safe-runner-oracle-cache-capability-proof/v1'
    && cacheCapability.non_gradeable === true
    && cacheCapability.transfer === ORACLE_CACHE_CAPABILITY_AUTHORITY.transfer
    && cacheCapability.descriptor === ORACLE_CACHE_CAPABILITY_AUTHORITY.descriptor
    && cacheCapability.source?.pathname_absent === true
    && cacheCapability.source?.fd_closed === true
    && cacheCapability.retained_fds?.requester === false
    && cacheCapability.retained_fds?.outer === false
    && cacheCapability.retained_fds?.keeper === false
    && cacheCapability.write_refused === true
    && cacheCapability.open_for_write_refused === true
    && release?.mount_fds_released === true
    && release?.cache_capability_fd_released === true
    && release?.root_fd_released === true && release?.state_fd_released === true
    && finish?.identities_dead === true && finish?.proc_anchor_released === true;
  if (!anonymousTransferProven) {
    throw new Error('oracle-host anonymous cache capability lifecycle is incomplete');
  }
  return {
    schema: ORACLE_HOST_RESULT_SCHEMA,
    non_gradeable: true,
    cleanup_proof_issued: false,
    grading_reachable: false,
    candidate_executed: false,
    anonymous_cache_capability_transfer_proven: true,
    cache_capability: cacheCapability,
    keeper: proof.keeper,
    filesystem: proof.filesystem,
    enospc_proven: usage.enospc_proven === true,
    mount_fds_released: release.mount_fds_released === true,
    cache_capability_fd_released: true,
    root_fd_released: true,
    state_fd_released: true,
    identities_dead: finish.identities_dead === true,
    proc_anchor_released: finish.proc_anchor_released === true,
    limitations: [
      'untrusted candidate execution and grading are unreachable in this probe',
      'this proves only fixed-FD anonymous cache-capability transfer with post-setup anonymization; bwrap 0.11.1 cannot ingest an already-unlinked regular-file FD',
      'a same-UID concurrent attacker during the transient trusted mount-setup pathname is outside the threat model',
      'same-UID ambient pathname replacement and proof-broker requester impersonation remain unsupported denial-of-service or state-race surfaces; the runner terminal tuple prevents false success',
      'Git realpath cannot consume the proc-acquired quota descriptor as a repository path',
      'bwrap 0.11.1 sibling --bind-fd cannot consume the proc-acquired quota descriptor',
    ],
  };
}

export async function main(exactArguments = []) {
  const invocation = validateOracleHostInvocation(exactArguments);
  const requester = processIdentity(process.pid);
  const capability = createCacheCapabilitySource(invocation.profile.private_tmp_root);
  let capabilityDescriptor = capability.descriptor;
  let child;
  try {
    child = spawn(invocation.profile.bwrap, invocation.profile.keeper_arguments, {
      cwd: process.cwd(), env: process.env,
      stdio: ['pipe', 'ignore', 'pipe', 'pipe', capabilityDescriptor],
    });
  } catch (error) {
    fs.closeSync(capabilityDescriptor);
    try { fs.unlinkSync(capability.claim.source_path); } catch {}
    throw error;
  }
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
    await waitForOracleKeeperMountTopology(bwrapInfo.child_pid);
    const capabilityClaim = anonymizeCacheCapability(capability);
    capabilityDescriptor = null;
    keeper = processIdentity(bwrapInfo.child_pid);
    const registration = await brokerRequest(invocation.profile.broker_socket, {
      operation: 'register_oracle_quota', requester, outer, keeper, bwrap_info: bwrapInfo,
      quota_bytes: invocation.profile.quota_bytes,
      cache_capability: capabilityClaim,
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
    if (capabilityDescriptor !== null) {
      try { fs.closeSync(capabilityDescriptor); } catch {}
      capabilityDescriptor = null;
    }
    try { fs.unlinkSync(capability.claim.source_path); } catch {}
    try { releaseKeeperGate(child); } catch {}
    throw Object.assign(new Error(`${error.message}${stderr ? `: ${stderr.trim()}` : ''}`), {
      code: error.code || 'LAMINA_SAFE_ORACLE_HOST',
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
