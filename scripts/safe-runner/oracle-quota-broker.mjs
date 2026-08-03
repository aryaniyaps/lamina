import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { boundedDirectorySize } from './filesystem.mjs';
import { identityAlive, processRecord } from './processes.mjs';
import {
  ORACLE_HOST_ROOT_BYTES, TMPFS_MAGIC, parseOracleBwrapInfo,
} from './oracle-host-profile.mjs';
import {
  ORACLE_CACHE_CAPABILITY_AUTHORITY, ORACLE_CACHE_CAPABILITY_CONTENT,
  ORACLE_CACHE_CAPABILITY_MOUNT, validateOracleCacheCapabilityEvidence,
} from './oracle-cache-capability.mjs';

export { parseOracleBwrapInfo };

const MAX_PROC_TEXT_BYTES = 64 * 1024;

function boundedText(value, maximum, label) {
  const text = String(value ?? '');
  if (!text || Buffer.byteLength(text, 'utf8') > maximum || text.includes('\0')) {
    throw new Error(`${label} is missing, malformed, or unbounded`);
  }
  return text;
}

export function procCgroupFromControlPath(controlPath) {
  const root = '/sys/fs/cgroup';
  const resolved = path.resolve(String(controlPath || ''));
  const relative = path.relative(root, resolved).replaceAll('\\', '/');
  if (!path.isAbsolute(controlPath || '') || resolved === root || !relative
    || relative.startsWith('../') || relative === '..' || path.posix.isAbsolute(relative)) {
    throw new Error('oracle control cgroup escapes exact /sys/fs/cgroup authority');
  }
  return `/${relative}`;
}

export function parseOracleProcStat(value) {
  const text = boundedText(value, MAX_PROC_TEXT_BYTES, 'proc stat');
  const close = text.lastIndexOf(')');
  const open = text.indexOf('(');
  if (open < 1 || close <= open) throw new Error('proc stat identity is malformed');
  const fields = text.slice(close + 2).trim().split(/\s+/);
  const ppid = Number(fields[1]);
  const startTicks = fields[19];
  if (fields.length < 20 || !/^[A-Z]$/.test(fields[0])
    || !Number.isSafeInteger(ppid) || ppid < 0 || !/^\d+$/.test(startTicks || '')) {
    throw new Error('proc stat identity is malformed');
  }
  return { state: fields[0], ppid, start_ticks: startTicks };
}

function exactStatusInteger(text, name) {
  const matches = [...text.matchAll(new RegExp(`^${name}:\\s+(\\d+)(?:\\s|$)`, 'gm'))];
  if (matches.length !== 1) throw new Error('oracle proc status field is missing or duplicated');
  const value = Number(matches[0][1]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('oracle proc status integer is invalid');
  return value;
}

export function parseOracleProcStatus(value) {
  const text = boundedText(value, MAX_PROC_TEXT_BYTES, 'proc status');
  const uidLine = text.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m);
  const gidLine = text.match(/^Gid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m);
  const namespaceLine = text.match(/^NSpid:\s+([\d\s]+)$/m);
  const capLine = text.match(/^CapEff:\s+([0-9a-fA-F]{16})\s*$/m);
  if (!uidLine || !gidLine || !namespaceLine || !capLine) {
    throw new Error('oracle proc status is incomplete');
  }
  const uids = uidLine.slice(1).map(Number);
  const gids = gidLine.slice(1).map(Number);
  const namespacePids = namespaceLine[1].trim().split(/\s+/).map(Number);
  const noNewPrivs = exactStatusInteger(text, 'NoNewPrivs');
  if (!uids.every((item) => item === uids[0]) || !gids.every((item) => item === gids[0])
    || namespacePids.length !== 2 || namespacePids[1] !== 1
    || namespacePids.some((item) => !Number.isSafeInteger(item) || item <= 0)
    || noNewPrivs !== 1 || capLine[1].toLowerCase() !== '0000000000000000') {
    throw new Error('oracle proc status violates keeper invariants');
  }
  return {
    uid: uids[0], gid: gids[0], namespace_pids: namespacePids,
    no_new_privs: noNewPrivs, effective_capabilities: capLine[1].toLowerCase(),
  };
}

export function parseOracleProcCgroup(value) {
  const text = boundedText(value, MAX_PROC_TEXT_BYTES, 'proc cgroup');
  const lines = text.trim().split('\n');
  if (lines.length !== 1) throw new Error('proc cgroup is not exact unified cgroup v2');
  const match = lines[0].match(/^0::(\/[^\n]*)$/);
  if (!match || path.posix.normalize(match[1]) !== match[1]) {
    throw new Error('proc cgroup is not an absolute canonical unified path');
  }
  return match[1];
}

function mountRecord(line) {
  const fields = line.split(' ');
  const separator = fields.indexOf('-');
  if (separator < 6 || fields.length < separator + 4) {
    throw new Error('oracle mountinfo record is malformed');
  }
  const mountId = Number(fields[0]);
  if (!Number.isSafeInteger(mountId) || mountId <= 0) {
    throw new Error('oracle mountinfo mount id is invalid');
  }
  return {
    mount_id: mountId,
    major_minor: fields[2],
    mount_point: fields[4],
    filesystem_type: fields[separator + 1],
    access: fields[5].split(',').includes('ro') ? 'ro'
      : fields[5].split(',').includes('rw') ? 'rw' : null,
  };
}

export function parseOracleMountInfo(value) {
  const text = boundedText(value, MAX_PROC_TEXT_BYTES, 'oracle mountinfo');
  const records = text.trim().split('\n').map(mountRecord);
  const root = records.filter((item) => item.mount_point === '/');
  const oracleState = records.filter((item) => item.mount_point === '/oracle-state');
  const oracleCacheCapability = records.filter((item) =>
    item.mount_point === ORACLE_CACHE_CAPABILITY_MOUNT);
  if (root.length !== 1 || oracleState.length !== 1 || oracleCacheCapability.length !== 1
    || root[0].filesystem_type !== 'tmpfs' || oracleState[0].filesystem_type !== 'tmpfs'
    || oracleCacheCapability[0].filesystem_type !== 'tmpfs'
    || root[0].access !== 'ro' || oracleState[0].access !== 'rw'
    || oracleCacheCapability[0].access !== 'ro'
    || new Set([root[0].mount_id, oracleState[0].mount_id,
      oracleCacheCapability[0].mount_id]).size !== 3) {
    throw new Error('oracle mountinfo lacks distinct exact tmpfs root, state, and cache-capability mounts');
  }
  return { root: root[0], oracle_state: oracleState[0],
    oracle_cache_capability: oracleCacheCapability[0] };
}

const ORACLE_KEEPER_MOUNT_TOPOLOGY_TIMEOUT_MS = 2_000;
const ORACLE_KEEPER_MOUNT_TOPOLOGY_POLL_MS = 10;

export async function waitForOracleKeeperMountTopology(keeperPid, {
  timeoutMs = ORACLE_KEEPER_MOUNT_TOPOLOGY_TIMEOUT_MS,
  pollMs = ORACLE_KEEPER_MOUNT_TOPOLOGY_POLL_MS,
} = {}) {
  if (!Number.isSafeInteger(keeperPid) || keeperPid <= 1) {
    throw new TypeError('oracle keeper pid is invalid');
  }
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return parseOracleMountInfo(fs.readFileSync(`/proc/${keeperPid}/mountinfo`, 'utf8'));
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
  throw lastError || new Error('oracle keeper mount topology did not become exact');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function exactOracleQuotaReadyProof(value, expected, cgroup) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !expected || value.filesystem_type !== 'tmpfs'
    || value.block_size !== expected.filesystem?.block_size
    || value.blocks !== expected.filesystem?.blocks
    || value.schema !== 'lamina.safe-runner-oracle-quota-proof/v1'
    || value.non_gradeable !== true || value.cgroup !== cgroup) return false;
  const { filesystem_type: _filesystemType, block_size: _blockSize,
    blocks: _blocks, ...core } = value;
  return crypto.createHash('sha256').update(canonicalJson(core)).digest('hex')
    === crypto.createHash('sha256').update(canonicalJson(expected)).digest('hex');
}

function exactIdentity(left, right) {
  return Number(left?.pid) === Number(right?.pid)
    && String(left?.start_ticks || '') === String(right?.start_ticks || '');
}

function exactExecutable(record, expected) {
  return ['dev', 'ino', 'uid'].every((field) =>
    record?.executable_identity?.[field] === expected?.[field]);
}

function exactArgv(record, executable, arguments_) {
  const expected = [executable, ...arguments_];
  return Array.isArray(record?.argv) && record.argv.length === expected.length
    && record.argv.every((value, index) => value === expected[index]);
}

function fdMountId(descriptor) {
  const value = fs.readFileSync(`/proc/self/fdinfo/${descriptor}`, 'utf8')
    .match(/^mnt_id:\s+(\d+)\s*$/m)?.[1];
  const mountId = Number(value);
  if (!Number.isSafeInteger(mountId) || mountId <= 0) {
    throw new Error('oracle quota descriptor has no stable mount id');
  }
  return mountId;
}

function statfsProof(descriptor, maximumBytes) {
  const stats = fs.statfsSync(`/proc/self/fd/${descriptor}`);
  const blockSize = Number(stats.bsize);
  const blocks = Number(stats.blocks);
  const freeBlocks = Number(stats.bfree);
  const totalBytes = blockSize * blocks;
  if (Number(stats.type) !== TMPFS_MAGIC || !Number.isSafeInteger(blockSize) || blockSize <= 0
    || !Number.isSafeInteger(totalBytes) || totalBytes <= 0
    || Math.abs(totalBytes - maximumBytes) >= blockSize) {
    throw new Error('oracle quota tmpfs magic or geometry is invalid');
  }
  return {
    type_magic: Number(stats.type), block_size: blockSize, blocks, free_blocks: freeBlocks,
    total_bytes: totalBytes,
    bytes: Math.max(0, (blocks - freeBlocks) * blockSize),
  };
}

function readNamespace(anchor, name) {
  const value = fs.readlinkSync(`${anchor}/ns/${name}`);
  if (!new RegExp(`^${name}:\\[\\d+\\]$`).test(value)) {
    throw new Error(`oracle keeper ${name} namespace is unavailable`);
  }
  return value;
}

function namespaceInode(value, name) {
  const inode = Number(String(value).match(new RegExp(`^${name}:\\[(\\d+)\\]$`))?.[1]);
  if (!Number.isSafeInteger(inode) || inode <= 1) throw new Error('oracle namespace inode is invalid');
  return inode;
}

function liveAnchoredIdentity(anchor) {
  return parseOracleProcStat(fs.readFileSync(`${anchor}/stat`, 'utf8'));
}

function readCgroup(pid) {
  return parseOracleProcCgroup(fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8'));
}

function assertRequester(registration, requester, cgroup) {
  if (!exactIdentity(registration.requester, requester) || !identityAlive(registration.requester)
    || readCgroup(registration.requester.pid) !== cgroup) {
    throw new Error('oracle quota requester identity or cgroup changed');
  }
}

function scanMountPins(mountIds) {
  const targets = new Set(mountIds.map(Number));
  const found = [];
  for (const name of fs.readdirSync('/proc/self/fdinfo')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const mountId = Number(fs.readFileSync(`/proc/self/fdinfo/${name}`, 'utf8')
        .match(/^mnt_id:\s+(\d+)\s*$/m)?.[1]);
      if (targets.has(mountId)) found.push(Number(name));
    } catch {}
  }
  return found.sort((left, right) => left - right);
}

function exactKeeperState(registration, cgroup) {
  const { anchor, keeper, namespaces, mounts } = registration;
  const stat = liveAnchoredIdentity(anchor);
  if (stat.start_ticks !== keeper.start_ticks || stat.state === 'Z'
    || readCgroup(keeper.pid) !== cgroup
    || [['mnt', 'mount'], ['user', 'user'], ['ipc', 'ipc'], ['net', 'network'],
      ['pid', 'pid'], ['uts', 'uts']].some(([procName, key]) =>
      readNamespace(anchor, procName) !== namespaces[key])) {
    throw new Error('oracle keeper identity, cgroup, or namespaces changed');
  }
  const currentMounts = parseOracleMountInfo(fs.readFileSync(`${anchor}/mountinfo`, 'utf8'));
  if (currentMounts.root.mount_id !== mounts.root.mount_id
    || currentMounts.oracle_state.mount_id !== mounts.oracle_state.mount_id
    || currentMounts.oracle_cache_capability.mount_id
      !== mounts.oracle_cache_capability.mount_id) {
    throw new Error('oracle keeper mount topology changed');
  }
  return true;
}

function capabilityIdentity(stat, bytes) {
  return {
    dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
    mode: Number(stat.mode & 0o7777n), size: Number(stat.size),
    digest: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function processRetainsCapabilityFd(procRoot, identity) {
  let names;
  try { names = fs.readdirSync(`${procRoot}/fd`); } catch {
    throw new Error('oracle cache capability descriptor audit is unavailable');
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = fs.statSync(`${procRoot}/fd/${name}`, { bigint: true });
      if (String(stat.dev) === identity.dev && String(stat.ino) === identity.ino) return true;
    } catch {}
  }
  return false;
}

function cacheCapabilityProof({
  claim, privateTmpRoot, requester, outer, keeperAnchor, rootFd, mounts,
}) {
  const requesterFdRetained = processRetainsCapabilityFd(`/proc/${requester.pid}`,
    claim?.identity || {});
  const outerFdRetained = processRetainsCapabilityFd(`/proc/${outer.pid}`,
    claim?.identity || {});
  const keeperFdRetained = processRetainsCapabilityFd(keeperAnchor, claim?.identity || {});
  const target = `/proc/self/fd/${rootFd}${ORACLE_CACHE_CAPABILITY_MOUNT}`;
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor, { bigint: true });
    const bytes = Buffer.alloc(Number(stat.size));
    const count = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    if (count !== bytes.length || !bytes.equals(Buffer.from(ORACLE_CACHE_CAPABILITY_CONTENT))) {
      throw new Error('oracle cache capability mounted content is invalid');
    }
    let readDescriptorWriteRefused = false;
    try { fs.writeSync(descriptor, Buffer.from('x'), 0, 1, 0); }
    catch (error) {
      readDescriptorWriteRefused = error?.code === 'EBADF';
      if (!readDescriptorWriteRefused) throw error;
    }
    let openForWriteRefused = false;
    try {
      const writable = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW);
      fs.closeSync(writable);
    } catch (error) {
      openForWriteRefused = ['EACCES', 'EROFS', 'EPERM'].includes(error?.code);
      if (!openForWriteRefused) throw error;
    }
    const identity = capabilityIdentity(stat, bytes);
    const evidence = validateOracleCacheCapabilityEvidence(claim, {
      identity,
      mount_id: mounts.oracle_cache_capability.mount_id,
      mount_access: mounts.oracle_cache_capability.access,
      pathname_exists: fs.existsSync(claim?.source_path || ''),
      requester_fd_retained: requesterFdRetained,
      outer_fd_retained: outerFdRetained,
      keeper_fd_retained: keeperFdRetained,
      read_descriptor_write_refused: readDescriptorWriteRefused,
      open_for_write_refused: openForWriteRefused,
    }, { privateTmpRoot, expectedUid: process.getuid() });
    if (fdMountId(descriptor) !== mounts.oracle_cache_capability.mount_id) {
      throw new Error('oracle cache capability descriptor mount identity is invalid');
    }
    return { descriptor, evidence };
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function nonceProof(stateFd) {
  const name = `.lamina-nonce-${crypto.randomBytes(16).toString('hex')}`;
  const target = `/proc/self/fd/${stateFd}/${name}`;
  const value = crypto.randomBytes(32);
  let descriptor = null;
  try {
    descriptor = fs.openSync(target, fs.constants.O_CREAT | fs.constants.O_EXCL
      | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
    const observed = Buffer.alloc(value.length);
    fs.readSync(descriptor, observed, 0, observed.length, 0);
    if (!observed.equals(value)) throw new Error('oracle quota nonce did not round-trip');
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    try { fs.unlinkSync(target); } catch {}
  }
  return { created_read_removed: !fs.existsSync(target), bytes: value.length };
}

function readOnlyRootProof(rootFd) {
  const target = `/proc/self/fd/${rootFd}/.lamina-root-write-${crypto.randomBytes(8).toString('hex')}`;
  let refused = false;
  try {
    const descriptor = fs.openSync(target, fs.constants.O_CREAT | fs.constants.O_EXCL
      | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    fs.closeSync(descriptor);
    try { fs.unlinkSync(target); } catch {}
  } catch (error) {
    refused = error?.code === 'EROFS';
    if (!refused) throw error;
  }
  if (!refused) throw new Error('oracle keeper root tmpfs remained writable');
  return true;
}

function enospcProof(stateFd, quotaBytes) {
  const name = `.lamina-enospc-${crypto.randomBytes(16).toString('hex')}`;
  const target = `/proc/self/fd/${stateFd}/${name}`;
  let descriptor = null;
  let written = 0;
  let proven = false;
  try {
    descriptor = fs.openSync(target, fs.constants.O_CREAT | fs.constants.O_EXCL
      | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    const block = Buffer.alloc(4096, 0x61);
    while (written <= quotaBytes + block.length) {
      try { written += fs.writeSync(descriptor, block); }
      catch (error) {
        if (error?.code === 'ENOSPC') { proven = true; break; }
        throw error;
      }
    }
    if (!proven) throw new Error('oracle quota did not produce bounded ENOSPC');
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    try { fs.unlinkSync(target); } catch {}
  }
  return { proven, bytes_before_enospc: written };
}

export function createOracleQuotaRegistry({
  cgroup, procCgroup = cgroup, quotaBytes, bwrap, bwrapIdentity, keeperArguments,
  privateTmpRoot, cacheCapabilityAuthority,
}) {
  if (typeof cgroup !== 'string' || !cgroup.startsWith('/')
    || typeof procCgroup !== 'string' || !procCgroup.startsWith('/')
    || !Number.isSafeInteger(quotaBytes) || quotaBytes < 4096
    || !path.isAbsolute(bwrap || '') || !bwrapIdentity
    || !Array.isArray(keeperArguments) || keeperArguments.length < 2
    || !path.isAbsolute(privateTmpRoot || '')
    || JSON.stringify(cacheCapabilityAuthority)
      !== JSON.stringify(ORACLE_CACHE_CAPABILITY_AUTHORITY)) {
    throw new TypeError('oracle quota registry authority is incomplete');
  }
  let registration = null;
  let terminal = null;
  return {
    register({ requester, outer, keeper, bwrap_info: bwrapInfo, quota_bytes: requestedBytes,
      cache_capability: cacheCapability }) {
      if (registration || requestedBytes !== quotaBytes
        || !exactIdentity(processRecord(requester?.pid), requester)
        || !exactIdentity(processRecord(outer?.pid), outer)
        || !exactIdentity(processRecord(keeper?.pid), keeper)
        || outer.ppid !== requester.pid || keeper.ppid !== outer.pid
        || !exactExecutable(outer, bwrapIdentity) || !exactExecutable(keeper, bwrapIdentity)
        || !exactArgv(outer, bwrap, keeperArguments)
        || !exactArgv(keeper, bwrap, keeperArguments)
        || readCgroup(requester.pid) !== procCgroup || readCgroup(outer.pid) !== procCgroup
        || readCgroup(keeper.pid) !== procCgroup) {
        throw new Error('oracle quota launch identity, ancestry, argv, executable, or cgroup is invalid');
      }
      const procFd = fs.openSync(`/proc/${keeper.pid}`,
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      const anchor = `/proc/self/fd/${procFd}`;
      let rootFd = null;
      let stateFd = null;
      let cacheFd = null;
      try {
        const anchoredStat = liveAnchoredIdentity(anchor);
        const status = parseOracleProcStatus(fs.readFileSync(`${anchor}/status`, 'utf8'));
        if (anchoredStat.start_ticks !== keeper.start_ticks
          || status.uid !== process.getuid() || status.gid !== process.getgid()
          || status.namespace_pids[0] !== keeper.pid) {
          throw new Error('oracle keeper anchored identity or ownership is invalid');
        }
        const namespaces = {
          mount: readNamespace(anchor, 'mnt'), user: readNamespace(anchor, 'user'),
          ipc: readNamespace(anchor, 'ipc'), network: readNamespace(anchor, 'net'),
          pid: readNamespace(anchor, 'pid'), uts: readNamespace(anchor, 'uts'),
        };
        if (bwrapInfo?.child_pid !== keeper.pid
          || namespaceInode(namespaces.mount, 'mnt') !== bwrapInfo?.namespaces?.mount
          || namespaceInode(namespaces.ipc, 'ipc') !== bwrapInfo?.namespaces?.ipc
          || namespaceInode(namespaces.network, 'net') !== bwrapInfo?.namespaces?.network
          || namespaceInode(namespaces.pid, 'pid') !== bwrapInfo?.namespaces?.pid
          || namespaceInode(namespaces.uts, 'uts') !== bwrapInfo?.namespaces?.uts) {
          throw new Error('bwrap info namespaces do not match anchored keeper namespaces');
        }
        const mounts = parseOracleMountInfo(fs.readFileSync(`${anchor}/mountinfo`, 'utf8'));
        rootFd = fs.openSync(`${anchor}/root`, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
        stateFd = fs.openSync(`/proc/self/fd/${rootFd}/oracle-state`,
          fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
        const rootStat = fs.fstatSync(rootFd, { bigint: true });
        const stateStat = fs.fstatSync(stateFd, { bigint: true });
        if (Number(rootStat.mode & 0o777n) !== 0o755
          || Number(stateStat.mode & 0o777n) !== 0o700
          || Number(rootStat.uid) !== process.getuid() || Number(rootStat.gid) !== process.getgid()
          || Number(stateStat.uid) !== process.getuid() || Number(stateStat.gid) !== process.getgid()) {
          throw new Error('oracle quota directory ownership or mode is invalid');
        }
        const rootFilesystem = {
          ...statfsProof(rootFd, ORACLE_HOST_ROOT_BYTES),
          read_only_write_refused: readOnlyRootProof(rootFd),
        };
        const filesystem = statfsProof(stateFd, quotaBytes);
        if (fdMountId(rootFd) !== mounts.root.mount_id
          || fdMountId(stateFd) !== mounts.oracle_state.mount_id) {
          throw new Error('oracle quota descriptor mount identity is invalid');
        }
        const cache = cacheCapabilityProof({
          claim: cacheCapability, privateTmpRoot, requester, outer,
          keeperAnchor: anchor, rootFd, mounts,
        });
        cacheFd = cache.descriptor;
        const nonce = nonceProof(stateFd);
        registration = {
          requester: { pid: requester.pid, start_ticks: requester.start_ticks },
          outer: { pid: outer.pid, start_ticks: outer.start_ticks },
          keeper: { pid: keeper.pid, start_ticks: keeper.start_ticks },
          procFd, rootFd, stateFd, cacheFd, anchor, namespaces, mounts, status,
          rootFilesystem, filesystem, cacheCapability: cache.evidence, nonce, released: false,
        };
        exactKeeperState(registration, procCgroup);
        return {
          schema: 'lamina.safe-runner-oracle-quota-proof/v1', non_gradeable: true,
          cgroup, control_cgroup: cgroup, proc_cgroup: procCgroup,
          requester: registration.requester,
          outer: registration.outer,
          keeper: { ...registration.keeper, ...status },
          namespaces, mounts, root_filesystem: rootFilesystem, filesystem,
          cache_capability: cache.evidence, nonce,
        };
      } catch (error) {
        if (cacheFd !== null) fs.closeSync(cacheFd);
        if (stateFd !== null) fs.closeSync(stateFd);
        if (rootFd !== null) fs.closeSync(rootFd);
        fs.closeSync(procFd);
        throw error;
      }
    },
    probe({ requester, exerciseEnospc = false }) {
      if (!registration || registration.released) throw new Error('oracle quota is not registered');
      assertRequester(registration, requester, procCgroup);
      exactKeeperState(registration, procCgroup);
      const filesystem = statfsProof(registration.stateFd, quotaBytes);
      const walked = boundedDirectorySize(`/proc/self/fd/${registration.stateFd}`, quotaBytes, 64);
      if (walked.symlinks > 0) throw new Error('oracle quota contains a symlink');
      const enospc = exerciseEnospc ? enospcProof(registration.stateFd, quotaBytes) : null;
      return {
        bytes: filesystem.bytes, entries: walked.entries,
        symlinks: walked.symlinks, symlink_paths: walked.symlink_paths,
        exceeded: filesystem.bytes >= quotaBytes, reason: filesystem.bytes >= quotaBytes ? 'bytes' : null,
        quota_proven: true, total_bytes: filesystem.total_bytes,
        enospc_proven: enospc?.proven === true,
        enospc_bytes_before_failure: enospc?.bytes_before_enospc ?? null,
      };
    },
    release({ requester }) {
      if (!registration || registration.released) throw new Error('oracle quota is not releasable');
      assertRequester(registration, requester, procCgroup);
      exactKeeperState(registration, procCgroup);
      const mountIds = [registration.mounts.root.mount_id,
        registration.mounts.oracle_state.mount_id,
        registration.mounts.oracle_cache_capability.mount_id];
      fs.closeSync(registration.cacheFd);
      fs.closeSync(registration.stateFd);
      fs.closeSync(registration.rootFd);
      registration.cacheFd = null;
      registration.stateFd = null;
      registration.rootFd = null;
      const pins = scanMountPins(mountIds);
      if (pins.length) throw new Error('oracle quota mount remained pinned by broker descriptors');
      registration.released = true;
      return {
        mount_fds_released: true, cache_capability_fd_released: true,
        root_fd_released: true, state_fd_released: true,
        broker_mount_id_pins: pins,
      };
    },
    finish({ requester }) {
      if (!registration?.released) throw new Error('oracle quota mount pins were not released');
      assertRequester(registration, requester, procCgroup);
      if (identityAlive(registration.keeper) || identityAlive(registration.outer)) {
        throw new Error('oracle quota identities remain alive');
      }
      let anchoredProcEsrch = false;
      try { fs.readFileSync(`${registration.anchor}/stat`); }
      catch (error) { anchoredProcEsrch = ['ENOENT', 'ESRCH'].includes(error?.code); }
      if (!anchoredProcEsrch) throw new Error('oracle keeper proc anchor still resolves after death');
      fs.closeSync(registration.procFd);
      registration.procFd = null;
      registration = null;
      terminal = { state: 'finished', cleanup_verified: true };
      return {
        identities_dead: true, anchored_proc_esrch: true, proc_anchor_released: true,
      };
    },
    usage() {
      if (terminal) return { ...terminal };
      if (!registration) return null;
      if (registration.released) return { state: 'release_authorized', cleanup_verified: false };
      try { return this.probe({ requester: registration.requester }); } catch { return null; }
    },
    prepareAbort() {
      if (terminal) return { ...terminal };
      if (!registration) {
        terminal = { state: 'aborted_before_registration', cleanup_verified: true };
        return { ...terminal };
      }
      if (!registration.released) {
        const mountIds = [registration.mounts.root.mount_id,
          registration.mounts.oracle_state.mount_id,
          registration.mounts.oracle_cache_capability.mount_id];
        if (registration.cacheFd !== null) fs.closeSync(registration.cacheFd);
        if (registration.stateFd !== null) fs.closeSync(registration.stateFd);
        if (registration.rootFd !== null) fs.closeSync(registration.rootFd);
        registration.cacheFd = null;
        registration.stateFd = null;
        registration.rootFd = null;
        const pins = scanMountPins(mountIds);
        if (pins.length) throw new Error('oracle quota abort left broker mount pins');
        registration.released = true;
      }
      return { state: 'abort_prepared', mount_fds_released: true };
    },
    finishAbort() {
      if (terminal) return { ...terminal };
      if (!registration) {
        terminal = { state: 'aborted_before_registration', cleanup_verified: true };
        return { ...terminal };
      }
      if (!registration.released) throw new Error('oracle quota abort was not prepared');
      if (identityAlive(registration.keeper) || identityAlive(registration.outer)) {
        return { state: 'abort_waiting_for_scope_death', cleanup_verified: false };
      }
      if (registration.procFd !== null) fs.closeSync(registration.procFd);
      registration.procFd = null;
      registration = null;
      terminal = { state: 'aborted', cleanup_verified: true, proc_anchor_released: true };
      return { ...terminal };
    },
  };
}
