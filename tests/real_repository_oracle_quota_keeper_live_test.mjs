#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import {
  createOracleQuotaRegistry, parseOracleBwrapInfo, parseOracleProcCgroup,
  waitForOracleKeeperMountTopology,
} from '../scripts/safe-runner/oracle-quota-broker.mjs';
import { infrastructureBinaries } from '../scripts/safe-runner/infrastructure.mjs';
import { oracleKeeperBwrapArguments } from '../scripts/safe-runner/oracle-host-profile.mjs';
import { identityAlive, processRecord } from '../scripts/safe-runner/processes.mjs';
import { anonymizeCacheCapability, createCacheCapabilitySource } from
  '../benchmarks/real-repository-oracle-v1/oracle-host.mjs';
import { oracleCacheCapabilityAuthority } from
  '../scripts/safe-runner/oracle-cache-capability.mjs';
import { buildOracleTierPackedBareCache } from
  '../benchmarks/real-repository-oracle-v1/persistent-materializer.mjs';
import { pinnedCollectionForTier } from
  '../benchmarks/real-repository-oracle-v1/collection-pins.mjs';

if (process.platform !== 'linux') {
  console.log('real repository oracle quota keeper live test skipped outside Linux');
  process.exit(0);
}

const quotaBytes = 64 * 1024;
let infrastructure;
try {
  if (process.argv.slice(2).includes('--simulate-no-trusted-bwrap')) {
    throw Object.assign(new Error(
      'trusted root-owned infrastructure binary is unavailable: bwrap',
    ), { code: 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY' });
  }
  infrastructure = infrastructureBinaries();
} catch (error) {
  if (error?.code !== 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY'
    || error.message !== 'trusted root-owned infrastructure binary is unavailable: bwrap') throw error;
  console.log('real repository oracle quota keeper live test skipped: exact bwrap unavailable');
  process.exit(0);
}
const keeperArguments = oracleKeeperBwrapArguments(quotaBytes);
const capabilityRoot = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-oracle-cache-capability-'),
));
fs.chmodSync(capabilityRoot, 0o700);
const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-oracle-cache-build-'));
const collectionPin = pinnedCollectionForTier('small');
let sealed;
try {
  sealed = buildOracleTierPackedBareCache({
    workDirectory: buildRoot,
    collection: {
      fixture_id: collectionPin.fixture_id,
      fixture_class: collectionPin.fixture_class,
      repository_url: collectionPin.repository_url,
      commit: collectionPin.commit,
      tree_oid: collectionPin.tree_oid,
    },
  });
} finally {
  const makeWritable = (directory) => {
    for (const name of fs.readdirSync(directory)) {
      const child = path.join(directory, name);
      const stat = fs.lstatSync(child);
      if (stat.isDirectory()) {
        makeWritable(child);
        fs.chmodSync(child, 0o700);
      } else {
        fs.chmodSync(child, 0o600);
      }
    }
    fs.chmodSync(directory, 0o700);
  };
  try { makeWritable(buildRoot); } catch {}
  fs.rmSync(buildRoot, { recursive: true, force: true });
}
const authority = oracleCacheCapabilityAuthority(sealed);
const capability = createCacheCapabilitySource(capabilityRoot, authority, sealed.bytes);
let capabilityDescriptor = capability.descriptor;
const child = spawn(infrastructure.bwrap, keeperArguments, {
  cwd: process.cwd(), env: process.env,
  stdio: ['pipe', 'ignore', 'pipe', 'pipe', capabilityDescriptor],
});
let stderr = '';
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8192); });
const outerIdentity = { pid: child.pid, start_ticks: null };
let keeperIdentity = null;
const waitForRecord = async (pid) => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const record = processRecord(pid);
    if (record) return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`process record ${pid} unavailable: ${stderr}`);
};
try {
  let info = '';
  child.stdio[3].setEncoding('utf8');
  for await (const chunk of child.stdio[3]) {
    info += chunk;
    if (Buffer.byteLength(info) > 8 * 1024) throw new Error('live bwrap info exceeded bound');
  }
  const bwrapInfo = parseOracleBwrapInfo(info);
  await waitForOracleKeeperMountTopology(bwrapInfo.child_pid);
  const capabilityClaim = anonymizeCacheCapability(capability, authority);
  capabilityDescriptor = null;
  const keeperPid = bwrapInfo.child_pid;
  const outer = await waitForRecord(child.pid);
  const keeper = await waitForRecord(keeperPid);
  assert.equal(outer.ppid, process.pid);
  assert.equal(keeper.ppid, outer.pid);
  assert.deepEqual(outer.argv, [infrastructure.bwrap, ...keeperArguments]);
  assert.deepEqual(keeper.argv, [infrastructure.bwrap, ...keeperArguments]);
  for (const field of ['dev', 'ino', 'uid']) {
    assert.equal(outer.executable_identity[field], infrastructure.identities.bwrap[field]);
    assert.equal(keeper.executable_identity[field], infrastructure.identities.bwrap[field]);
  }
  outerIdentity.start_ticks = outer.start_ticks;
  keeperIdentity = { pid: keeper.pid, start_ticks: keeper.start_ticks };
  const registry = createOracleQuotaRegistry({
    cgroup: parseOracleProcCgroup(fs.readFileSync('/proc/self/cgroup', 'utf8')),
    quotaBytes,
    bwrap: infrastructure.bwrap,
    bwrapIdentity: infrastructure.identities.bwrap,
    keeperArguments,
    privateTmpRoot: capabilityRoot,
    cacheCapabilityAuthority: authority,
  });
  const proof = registry.register({
    requester: processRecord(process.pid), outer, keeper, bwrap_info: bwrapInfo,
    quota_bytes: quotaBytes, cache_capability: capabilityClaim,
  });
  assert.equal(proof.schema, 'lamina.safe-runner-oracle-quota-proof/v1');
  assert.equal(proof.non_gradeable, true);
  assert.equal(proof.cgroup, parseOracleProcCgroup(fs.readFileSync('/proc/self/cgroup', 'utf8')));
  assert.equal(proof.keeper.pid, keeper.pid);
  assert.equal(proof.keeper.namespace_pids.at(-1), 1);
  assert.equal(proof.keeper.no_new_privs, 1);
  assert.equal(proof.keeper.effective_capabilities, '0000000000000000');
  assert.equal(proof.filesystem.type_magic, 16_914_836);
  assert.equal(proof.root_filesystem.read_only_write_refused, true);
  assert.ok(proof.filesystem.total_bytes > 0 && proof.filesystem.total_bytes <= quotaBytes + 4096);
  assert.match(proof.namespaces.mount, /^mnt:\[\d+\]$/);
  assert.match(proof.namespaces.user, /^user:\[\d+\]$/);
  assert.equal(proof.nonce.created_read_removed, true);
  assert.equal(proof.cache_capability.transfer,
    'fixed-fd-post-setup-anonymized-read-only');
  assert.equal(proof.cache_capability.descriptor, 4);
  assert.equal(proof.cache_capability.tier, 'small');
  assert.equal(proof.cache_capability.pack_closure_digest, authority.pack_closure_digest);
  assert.equal(proof.cache_capability.source.pathname_absent, true);
  assert.equal(proof.cache_capability.source.fd_closed, true);
  assert.deepEqual(proof.cache_capability.retained_fds,
    { requester: false, outer: false, keeper: false });
  assert.equal(proof.cache_capability.write_refused, true);
  assert.equal(proof.cache_capability.open_for_write_refused, true);

  const usage = registry.probe({ requester: processRecord(process.pid), exerciseEnospc: true });
  assert.equal(usage.quota_proven, true);
  assert.equal(usage.enospc_proven, true);
  assert.ok(usage.bytes >= 0 && usage.bytes <= quotaBytes);
  const released = registry.release({ requester: processRecord(process.pid) });
  assert.equal(released.mount_fds_released, true);
  assert.equal(released.cache_capability_fd_released, true);
  assert.equal(released.root_fd_released, true);
  assert.equal(released.state_fd_released, true);
  assert.deepEqual(released.broker_mount_id_pins, []);

  child.kill('SIGTERM');
  await Promise.race([once(child, 'close'), new Promise((resolve) => setTimeout(resolve, 1_000))]);
  if (identityAlive(keeperIdentity)) {
    try { process.kill(keeperIdentity.pid, 'SIGKILL'); } catch {}
  }
  if (identityAlive(outerIdentity)) {
    try { process.kill(outerIdentity.pid, 'SIGKILL'); } catch {}
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && (identityAlive(keeperIdentity) || identityAlive(outerIdentity))) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const finish = registry.finish({ requester: processRecord(process.pid) });
  assert.equal(finish.identities_dead, true);
  assert.equal(finish.anchored_proc_esrch, true);
  assert.equal(finish.proc_anchor_released, true);
} finally {
  if (capabilityDescriptor !== null) {
    try { fs.closeSync(capabilityDescriptor); } catch {}
  }
  try { child.stdin.end(); } catch {}
  if (keeperIdentity && identityAlive(keeperIdentity)) {
    try { process.kill(keeperIdentity.pid, 'SIGKILL'); } catch {}
  }
  if (outerIdentity.start_ticks && identityAlive(outerIdentity)) {
    try { process.kill(outerIdentity.pid, 'SIGKILL'); } catch {}
  }
  fs.rmSync(capabilityRoot, { recursive: true, force: true });
}

console.log('real repository oracle quota keeper live lifecycle passed');
