#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  parseOracleBwrapInfo,
} from '../../scripts/safe-runner/oracle-host-profile.mjs';
import {
  CANDIDATE_LEASE_WORKER_HOST_LAUNCH_PROFILE,
  candidateLeaseWorkerKeeperArgumentsFromWireProfile,
} from '../../scripts/safe-runner/candidate-lease-worker-host-profile.mjs';
import {
  ORACLE_CACHE_CAPABILITY_FD, ORACLE_CACHE_CAPABILITY_TRANSFER,
  oracleCacheCapabilityAuthority,
} from '../../scripts/safe-runner/oracle-cache-capability.mjs';
import { waitForOracleKeeperMountTopology } from
  '../../scripts/safe-runner/oracle-quota-broker.mjs';
import {
  anonymizeCacheCapability, createCacheCapabilitySource,
} from './oracle-host.mjs';
import {
  candidateLeaseWorkerAuthority,
  candidateLeaseWorkerRecord,
} from './candidate-lease-worker.mjs';

export const CANDIDATE_LEASE_ORACLE_HOST_RESULT_SCHEMA =
  'lamina.real-repository-oracle-candidate-lease-oracle-host/v1';
const MAX_PROFILE_BYTES = 64 * 1024;
const MAX_BROKER_RESPONSE_BYTES = 256 * 1024;
const EXACT_ENVIRONMENT = Object.freeze({ LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' });

function invocationError(message) {
  const error = new Error(`candidate-lease-oracle-host invocation ${message}`);
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

function loadSealedCacheCapabilityFile(sealedRelativePath, repositoryRoot, expectedDigest) {
  if (!sealedRelativePath || sealedRelativePath.includes('..')
    || path.isAbsolute(sealedRelativePath) || !/^[a-f0-9]{64}$/.test(expectedDigest || '')) {
    invocationError('cache capability sealed relative path is invalid');
  }
  const sealedPath = path.join(repositoryRoot, sealedRelativePath);
  const physical = fs.realpathSync.native(sealedPath);
  if (physical !== path.resolve(sealedPath)) invocationError('cache capability seal path is not physical');
  const stat = fs.lstatSync(sealedPath, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) {
    invocationError('cache capability sealed source is invalid');
  }
  const bytes = fs.readFileSync(sealedPath);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (digest !== expectedDigest || bytes.length < 1) {
    invocationError('cache capability sealed source digest is invalid');
  }
  return bytes;
}

function authorityFromSealedCacheCapabilityBytes(bytes) {
  const newline = bytes.indexOf('\n');
  if (newline < 1) invocationError('cache capability sealed manifest is invalid');
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8', 0, newline)); }
  catch { invocationError('cache capability sealed manifest is invalid'); }
  return oracleCacheCapabilityAuthority({
    bytes,
    digest: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    manifest,
    pack_closure_digest: manifest.pack_closure_digest,
  });
}

function fileIdentityKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && ['path', 'dev', 'ino', 'uid', 'mode', 'size', 'digest'].every((field) =>
      Object.prototype.hasOwnProperty.call(value, field));
}

function loadSealedGitIdentityFile(sealedRelativePath, repositoryRoot, expectedDigest) {
  if (!sealedRelativePath || sealedRelativePath.includes('..')
    || path.isAbsolute(sealedRelativePath) || !/^[a-f0-9]{64}$/.test(expectedDigest || '')) {
    invocationError('sealed git identity relative path is invalid');
  }
  const sealedPath = path.join(repositoryRoot, sealedRelativePath);
  const physical = fs.realpathSync.native(sealedPath);
  if (physical !== path.resolve(sealedPath)) invocationError('sealed git identity path is not physical');
  const stat = fs.lstatSync(sealedPath, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) {
    invocationError('sealed git identity source is invalid');
  }
  const encoded = fs.readFileSync(sealedPath, 'utf8');
  const digest = crypto.createHash('sha256').update(encoded).digest('hex');
  if (digest !== expectedDigest || encoded.length < 1
    || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    invocationError('sealed git identity digest is invalid');
  }
  return encoded;
}

export function validateCandidateLeaseOracleHostInvocation(args, environment = process.env) {
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
  if (!exactKeys(profile, [
    'schema', 'id', 'bwrap', 'bwrap_identity', 'bwrap_capabilities',
    'launcher', 'launcher_identity', 'bootstrap_environment', 'host', 'host_identity',
    'non_gradeable', 'quota_bytes', 'broker_socket',
    'private_tmp_root', 'cache_capability_sha256', 'cache_capability_sealed_relative',
    'snapshot_repository', 'worker_runner', 'worker_args',
    'execution_authority_root', 'node_executable', 'node_executable_identity',
    'sealed_git_identity_relative', 'sealed_git_identity_sha256',
  ]) || profile.schema !== 'lamina.safe-runner-oracle-host-launch-profile/v1'
    || profile.id !== CANDIDATE_LEASE_WORKER_HOST_LAUNCH_PROFILE || profile.non_gradeable !== true
    || !path.isAbsolute(profile.bwrap || '') || !path.isAbsolute(profile.broker_socket || '')
    || !path.isAbsolute(profile.snapshot_repository || '')
    || !path.isAbsolute(profile.worker_runner || '')
    || !path.isAbsolute(profile.execution_authority_root || '')
    || !path.isAbsolute(profile.node_executable || '')
    || path.dirname(profile.snapshot_repository) !== profile.execution_authority_root
    || !profile.node_executable.startsWith(`${profile.execution_authority_root}${path.sep}`)
    || !fileIdentityKeys(profile.node_executable_identity)
    || profile.node_executable !== profile.node_executable_identity.path
    || typeof profile.sealed_git_identity_relative !== 'string'
    || profile.sealed_git_identity_relative.includes('..')
    || path.isAbsolute(profile.sealed_git_identity_relative)
    || typeof profile.sealed_git_identity_sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(profile.sealed_git_identity_sha256)
    || !Array.isArray(profile.worker_args) || profile.worker_args.length !== 3
    || typeof profile.cache_capability_sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(profile.cache_capability_sha256)) {
    invocationError('profile authority is invalid');
  }
  const sealedGitIdentity = loadSealedGitIdentityFile(
    profile.sealed_git_identity_relative,
    profile.snapshot_repository,
    profile.sealed_git_identity_sha256,
  );
  const keeper_arguments = candidateLeaseWorkerKeeperArgumentsFromWireProfile(
    profile, sealedGitIdentity,
  );
  return {
    quota_ready: quotaReady,
    quota_release: quotaRelease,
    profile: { ...profile, keeper_arguments },
  };
}

async function brokerRequest(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let response = '';
    const timeout = setTimeout(() => socket.destroy(new Error('oracle proof broker timeout')), 5_000);
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

async function waitForChild(child, timeoutMs = 180_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close').then(() => true);
  let timeout = null;
  try {
    const exited = await Promise.race([closed, new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    })]);
    if (!exited) throw new Error('candidate lease worker keeper did not exit before deadline');
  } finally { clearTimeout(timeout); }
}

export async function main(exactArguments = []) {
  const invocation = validateCandidateLeaseOracleHostInvocation(exactArguments);
  const sealedBytes = loadSealedCacheCapabilityFile(
    invocation.profile.cache_capability_sealed_relative,
    invocation.profile.snapshot_repository,
    invocation.profile.cache_capability_sha256,
  );
  const authority = authorityFromSealedCacheCapabilityBytes(sealedBytes);
  const requester = processIdentity(process.pid);
  const capability = createCacheCapabilitySource(
    invocation.profile.private_tmp_root, authority, sealedBytes,
  );
  let capabilityDescriptor = capability.descriptor;
  let child;
  try {
    child = spawn(invocation.profile.bwrap, invocation.profile.keeper_arguments, {
      cwd: invocation.profile.snapshot_repository, env: process.env,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', capabilityDescriptor],
    });
  } catch (error) {
    fs.closeSync(capabilityDescriptor);
    try { fs.unlinkSync(capability.claim.source_path); } catch {}
    throw error;
  }
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-MAX_BROKER_RESPONSE_BYTES); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4096); });
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
    const capabilityClaim = anonymizeCacheCapability(capability, authority);
    capabilityDescriptor = null;
    const keeper = processIdentity(bwrapInfo.child_pid);
    const registration = await brokerRequest(invocation.profile.broker_socket, {
      operation: 'register_oracle_quota', requester, outer, keeper, bwrap_info: bwrapInfo,
      quota_bytes: invocation.profile.quota_bytes,
      cache_capability: capabilityClaim,
    });
    writeQuotaReady(invocation.quota_ready, registration.proof);
    waitForRelease(invocation.quota_release);
    await waitForChild(child);
    if (child.exitCode !== 0) {
      throw new Error(`candidate lease worker keeper failed: ${stderr || stdout}`);
    }
    const release = (await brokerRequest(invocation.profile.broker_socket, {
      operation: 'release_oracle_quota', requester,
    })).release;
    const finish = (await brokerRequest(invocation.profile.broker_socket, {
      operation: 'finish_oracle_quota', requester,
    })).finish;
    const workerLine = stdout.trim().split('\n').filter(Boolean).at(-1);
    if (!workerLine) throw new Error('candidate lease worker output is missing');
    let workerParsed;
    try { workerParsed = JSON.parse(workerLine); }
    catch { throw new Error('candidate lease worker output is not JSON'); }
    const workerAuthority = candidateLeaseWorkerAuthority({
      tier: invocation.profile.worker_args[0],
      slot_id: invocation.profile.worker_args[1],
      phase: invocation.profile.worker_args[2],
    });
    const workerRecord = candidateLeaseWorkerRecord({
      authority: workerAuthority,
      candidate_result_sha256: workerParsed.candidate_result_sha256,
      lease: workerParsed.lease,
      release: {
        end_digest: workerParsed.lease.end_digest,
        cleanup_verified: workerParsed.materializer.cleanup_verified,
        terminal_disposition: workerParsed.materializer.terminal_disposition,
      },
      repository_unchanged: workerParsed.repository_unchanged,
      oracle_worker: {
        keeper_mount_proven: true,
        broker_finish_verified: finish?.proc_anchor_released === true
          && finish?.identities_dead === true,
      },
    });
    const result = {
      schema: CANDIDATE_LEASE_ORACLE_HOST_RESULT_SCHEMA,
      non_gradeable: true,
      cleanup_proof_issued: false,
      grading_reachable: false,
      candidate_executed: true,
      keeper_mount_proven: true,
      broker_finish_verified: finish?.proc_anchor_released === true
        && finish?.identities_dead === true,
      mount_fds_released: release?.mount_fds_released === true,
      cache_capability_fd_released: release?.cache_capability_fd_released === true,
      worker_record: workerRecord,
      cache_capability: registration.proof.cache_capability,
    };
    if (!result.broker_finish_verified || !result.mount_fds_released) {
      throw new Error('candidate lease oracle-host broker lifecycle is incomplete');
    }
    const line = `${JSON.stringify(result)}\n`;
    if (Buffer.byteLength(line) > MAX_BROKER_RESPONSE_BYTES) {
      throw new Error('candidate lease oracle-host result exceeds bound');
    }
    process.stdout.write(line);
  } catch (error) {
    if (capabilityDescriptor !== null) {
      try { fs.closeSync(capabilityDescriptor); } catch {}
      capabilityDescriptor = null;
    }
    try { fs.unlinkSync(capability.claim.source_path); } catch {}
    try { child.kill('SIGTERM'); } catch {}
    throw Object.assign(new Error(`${error.message}${stderr ? `: ${stderr.trim()}` : ''}`), {
      code: error.code || 'LAMINA_SAFE_ORACLE_HOST',
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
