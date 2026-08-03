#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { authorizeBrokerRequest } from '../scripts/safe-runner/broker.mjs';
import {
  oracleHostResult, terminateKeeper, validateOracleHostInvocation,
} from '../benchmarks/real-repository-oracle-v1/oracle-host.mjs';
import { EventEmitter } from 'node:events';
import { oracleKeeperBwrapArguments } from '../scripts/safe-runner/oracle-host-profile.mjs';
import * as oracleCacheCapability from
  '../scripts/safe-runner/oracle-cache-capability.mjs';
import {
  createOracleQuotaRegistry,
  exactOracleQuotaReadyProof,
  parseOracleBwrapInfo,
  parseOracleMountInfo,
  parseOracleProcCgroup,
  parseOracleProcStat,
  parseOracleProcStatus,
  procCgroupFromControlPath,
} from '../scripts/safe-runner/oracle-quota-broker.mjs';

assert.equal(procCgroupFromControlPath('/sys/fs/cgroup/user.slice/lamina-safe.scope'),
  '/user.slice/lamina-safe.scope');
for (const crossed of ['/sys/fs/cgroup', '/sys/fs/cgroup/../escape', '/tmp/cgroup']) {
  assert.throws(() => procCgroupFromControlPath(crossed), /control cgroup escapes/);
}
import { oracleQuotaCompletionAuthorized } from '../scripts/safe-runner/runner.mjs';

assert.equal(typeof oracleCacheCapability.validateOracleCacheCapabilityEvidence, 'function',
  'anonymous cache-capability evidence requires one exact pure validator');
const capabilityPrivateRoot = '/tmp/lamina-safe-runner-test/payload-tmp';
const capabilityIdentity = {
  dev: '21', ino: '34', uid: process.getuid?.() ?? 1000, mode: 0o400,
  size: Buffer.byteLength(oracleCacheCapability.ORACLE_CACHE_CAPABILITY_CONTENT),
  digest: oracleCacheCapability.ORACLE_CACHE_CAPABILITY_DIGEST,
};
const capabilityClaim = {
  schema: 'lamina.safe-runner-oracle-cache-capability-claim/v1',
  transfer: 'fixed-fd-post-setup-anonymized-read-only', descriptor: 4,
  source_path: path.join(capabilityPrivateRoot, '.oracle-cache-capability'),
  pathname_absent: true, source_fd_closed: true,
  identity: capabilityIdentity,
};
const capabilityObservation = {
  identity: capabilityIdentity, mount_id: 93, mount_access: 'ro',
  pathname_exists: false,
  requester_fd_retained: false, outer_fd_retained: false, keeper_fd_retained: false,
  read_descriptor_write_refused: true, open_for_write_refused: true,
};
const capabilityEvidence = oracleCacheCapability.validateOracleCacheCapabilityEvidence(
  capabilityClaim, capabilityObservation, { privateTmpRoot: capabilityPrivateRoot },
);
assert.equal(capabilityEvidence.schema,
  'lamina.safe-runner-oracle-cache-capability-proof/v1');
assert.equal(capabilityEvidence.non_gradeable, true);
assert.equal(capabilityEvidence.transfer,
  'fixed-fd-post-setup-anonymized-read-only');
assert.equal(capabilityEvidence.descriptor, 4);
assert.equal(capabilityEvidence.mount.path, '/oracle-cache-capability');
assert.equal(capabilityEvidence.source.pathname_absent, true);
assert.equal(capabilityEvidence.source.fd_closed, true);
assert.deepEqual(capabilityEvidence.retained_fds,
  { requester: false, outer: false, keeper: false });
assert.equal(capabilityEvidence.write_refused, true);
assert.equal(capabilityEvidence.open_for_write_refused, true);
const crossedCapability = (claimMutation = () => {}, observationMutation = () => {}) => {
  const claim = structuredClone(capabilityClaim);
  const observation = structuredClone(capabilityObservation);
  claimMutation(claim);
  observationMutation(observation);
  assert.throws(() => oracleCacheCapability.validateOracleCacheCapabilityEvidence(
    claim, observation, { privateTmpRoot: capabilityPrivateRoot },
  ), /cache capability/);
};
crossedCapability(() => {}, (value) => { value.identity.ino = '35'; });
crossedCapability((value) => { value.unexpected = true; });
crossedCapability(() => {}, (value) => { value.unexpected = true; });
crossedCapability((value) => { value.identity.digest = '0'.repeat(64); });
crossedCapability((value) => { value.identity.mode = 0o600; },
  (value) => { value.identity.mode = 0o600; });
crossedCapability((value) => { value.pathname_absent = false; },
  (value) => { value.pathname_exists = true; });
crossedCapability((value) => { value.descriptor = 5; });
crossedCapability(() => {}, (value) => { value.requester_fd_retained = true; });
crossedCapability(() => {}, (value) => { value.outer_fd_retained = true; });
crossedCapability(() => {}, (value) => { value.keeper_fd_retained = true; });
crossedCapability(() => {}, (value) => { value.read_descriptor_write_refused = false; });
crossedCapability(() => {}, (value) => { value.open_for_write_refused = false; });

const bwrapInfo = `${JSON.stringify({
  'child-pid': 412,
  'ipc-namespace': 1002,
  'mnt-namespace': 1003,
  'net-namespace': 1004,
  'pid-namespace': 1005,
  'uts-namespace': 1006,
}, null, 4)}\n`;
assert.deepEqual(parseOracleBwrapInfo(bwrapInfo), {
  child_pid: 412,
  namespaces: { ipc: 1002, mount: 1003, network: 1004, pid: 1005, uts: 1006 },
});
for (const invalid of [
  '', '{}\n', '{"child-pid":1}\n', `${bwrapInfo.trimEnd()} trailing`,
  bwrapInfo.replace('"uts-namespace": 1006', '"extra": 1006'),
  `${'{'.repeat(8193)}\n`, '{"child-pid":412}\ntrailing',
]) assert.throws(() => parseOracleBwrapInfo(invalid), /bwrap info/);

assert.deepEqual(parseOracleProcStat(
  `412 (bwrap weird name) ${[
    'S', '411', ...Array(17).fill('0'), '99881', '0', '0',
  ].join(' ')}\n`,
), { state: 'S', ppid: 411, start_ticks: '99881' });
assert.throws(() => parseOracleProcStat('412 malformed\n'), /proc stat/);

assert.deepEqual(parseOracleProcStatus([
  'Name:\tbwrap',
  'State:\tS (sleeping)',
  'Uid:\t1000\t1000\t1000\t1000',
  'Gid:\t1000\t1000\t1000\t1000',
  'NSpid:\t412\t1',
  'NoNewPrivs:\t1',
  'CapEff:\t0000000000000000',
  '',
].join('\n')), {
  uid: 1000, gid: 1000, namespace_pids: [412, 1], no_new_privs: 1,
  effective_capabilities: '0000000000000000',
});
for (const invalid of [
  'Uid:\t1000\nGid:\t1000\nNSpid:\t412\nNoNewPrivs:\t1\nCapEff:\t0\n',
  'Uid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\nNSpid:\t412\t1\nNoNewPrivs:\t0\nCapEff:\t0000000000000000\n',
  'Uid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\nNSpid:\t412\t1\nNoNewPrivs:\t1\nCapEff:\t0000000000000001\n',
]) assert.throws(() => parseOracleProcStatus(invalid), /proc status/);

assert.equal(parseOracleProcCgroup('0::/user.slice/lamina-safe.scope\n'),
  '/user.slice/lamina-safe.scope');
for (const invalid of [
  '0::/other.scope\n1:name=/legacy\n', '0::relative\n', '0::/one\n0::/two\n',
]) assert.throws(() => parseOracleProcCgroup(invalid), /proc cgroup/);

const mounts = parseOracleMountInfo([
  '91 80 0:77 / / ro,nosuid,nodev - tmpfs tmpfs rw,size=1024k',
  '92 91 0:78 / /oracle-state rw,nosuid,nodev - tmpfs tmpfs rw,size=65536',
  '93 91 0:79 /file /oracle-cache-capability ro,nosuid,nodev - tmpfs tmpfs rw',
  '',
].join('\n'));
assert.deepEqual(mounts.root, { mount_id: 91, major_minor: '0:77', mount_point: '/',
  filesystem_type: 'tmpfs', access: 'ro' });
assert.deepEqual(mounts.oracle_state, { mount_id: 92, major_minor: '0:78',
  mount_point: '/oracle-state', filesystem_type: 'tmpfs', access: 'rw' });
assert.deepEqual(mounts.oracle_cache_capability, { mount_id: 93, major_minor: '0:79',
  mount_point: '/oracle-cache-capability', filesystem_type: 'tmpfs', access: 'ro' });
for (const invalid of [
  '91 80 0:77 / / ro - tmpfs tmpfs rw\n',
  '91 80 0:77 / / ro - tmpfs tmpfs rw\n92 91 0:78 / /oracle-state rw - tmpfs tmpfs rw\n',
  '91 80 0:77 / / ro - ext4 /dev/x rw\n92 91 0:78 / /oracle-state rw - tmpfs tmpfs rw\n',
  '91 80 0:77 / / ro - tmpfs tmpfs rw\n92 91 0:78 / /oracle-state rw - ext4 /dev/x rw\n',
  '91 80 0:77 / / rw - tmpfs tmpfs rw\n92 91 0:78 / /oracle-state rw - tmpfs tmpfs rw\n',
  '91 80 0:77 / / ro - tmpfs tmpfs rw\n92 91 0:78 / /oracle-state ro - tmpfs tmpfs rw\n',
]) assert.throws(() => parseOracleMountInfo(invalid), /mountinfo/);

const host = { pid: 410, ppid: 73, start_ticks: '4100', namespace_pids: [410] };
const outer = { pid: 411, ppid: 410, start_ticks: '4110', namespace_pids: [411] };
const keeper = { pid: 412, ppid: 411, start_ticks: '4120', namespace_pids: [412, 1] };
const registrations = [];
const authority = {
  tier: 'small', unit: 'lamina-safe-test.scope', cgroup: '/user.slice/lamina-safe-test.scope',
  records: () => [host, outer, keeper], registrations, reservations: [],
  oracleHostLaunchAuthorized: (record) => record === host,
  registerOracleQuota(record) {
    registrations.push(record);
    return { schema: 'lamina.safe-runner-oracle-quota-proof/v1', mount_id: 92 };
  },
  probeOracleQuota: () => ({ bytes: 4096, entries: 1, quota_proven: true }),
  releaseOracleQuota: () => ({ mount_fds_released: true }),
  finishOracleQuota: () => ({ identities_dead: true, proc_anchor_released: true }),
};
const requester = { pid: host.pid, start_ticks: host.start_ticks };
assert.deepEqual(authorizeBrokerRequest({
  operation: 'register_oracle_quota', requester,
  outer: { pid: outer.pid, start_ticks: outer.start_ticks },
  keeper: { pid: keeper.pid, start_ticks: keeper.start_ticks }, quota_bytes: 65_536,
  bwrap_info: { exact: true }, cache_capability: capabilityClaim,
}, authority), {
  ok: true, proof: { schema: 'lamina.safe-runner-oracle-quota-proof/v1', mount_id: 92 },
});
assert.equal(registrations[0].requester.pid, host.pid);
assert.deepEqual(registrations[0].cache_capability, capabilityClaim);
assert.match(authorizeBrokerRequest({
  operation: 'register_oracle_quota', requester,
  outer: { pid: outer.pid, start_ticks: outer.start_ticks },
  keeper: { pid: keeper.pid, start_ticks: keeper.start_ticks }, quota_bytes: 65_536,
  bwrap_info: { exact: true }, cache_capability: capabilityClaim, unexpected: true,
}, authority).error, /registration is not exact/);
for (const crossed of [
  { outer: { ...outer, ppid: 999 }, keeper },
  { outer, keeper: { ...keeper, ppid: 999 } },
]) {
  authority.records = () => [host, crossed.outer, crossed.keeper];
  assert.match(authorizeBrokerRequest({
    operation: 'register_oracle_quota', requester,
    outer: { pid: crossed.outer.pid, start_ticks: crossed.outer.start_ticks },
    keeper: { pid: crossed.keeper.pid, start_ticks: crossed.keeper.start_ticks },
    quota_bytes: 65_536,
    bwrap_info: { exact: true }, cache_capability: capabilityClaim,
  }, authority).error, /descendant/);
}
authority.records = () => [host, outer, keeper];
authority.oracleHostLaunchAuthorized = () => false;
assert.match(authorizeBrokerRequest({
  operation: 'register_oracle_quota', requester,
  outer: { pid: outer.pid, start_ticks: outer.start_ticks },
  keeper: { pid: keeper.pid, start_ticks: keeper.start_ticks }, quota_bytes: 65_536,
  bwrap_info: { exact: true }, cache_capability: capabilityClaim,
}, authority).error, /exact sealed oracle-host/);
authority.oracleHostLaunchAuthorized = (record) => record === host;
for (const [operation, property] of [
  ['probe_oracle_quota', 'usage'],
  ['release_oracle_quota', 'release'],
  ['finish_oracle_quota', 'finish'],
]) assert.equal(authorizeBrokerRequest({ operation, requester }, authority)[property] !== undefined,
  true);

const profile = {
  schema: 'lamina.safe-runner-oracle-host-launch-profile/v1',
  id: 'oracle-host-probe-v1', non_gradeable: true,
  bwrap: '/usr/bin/bwrap', quota_bytes: 65_536,
  bwrap_identity: {}, bwrap_capabilities: {},
  launcher: '/tmp/lamina-oracle/launcher.mjs', launcher_identity: {},
  bootstrap_environment: {},
  host: '/tmp/lamina-oracle/oracle-host.mjs', host_identity: {},
  keeper_arguments: oracleKeeperBwrapArguments(65_536),
  broker_socket: '/tmp/lamina-oracle/supervisor.sock',
  private_tmp_root: '/tmp/lamina-oracle/payload-tmp',
  cache_capability: oracleCacheCapability.ORACLE_CACHE_CAPABILITY_AUTHORITY,
};
const encodedProfile = Buffer.from(JSON.stringify(profile)).toString('base64url');
assert.deepEqual(validateOracleHostInvocation([
  '/tmp/lamina-oracle/quota.ready', '/tmp/lamina-oracle/quota.release', encodedProfile,
], { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' }).profile, profile);
for (const crossed of [
  ['/tmp/lamina-oracle/quota.ready', '/tmp/lamina-oracle/quota.release',
    Buffer.from(JSON.stringify({ ...profile, broker_socket: '/tmp/crossed.sock' })).toString('base64url')],
  ['/tmp/lamina-oracle/quota.ready', '/tmp/lamina-oracle/quota.release',
    Buffer.from(JSON.stringify({ ...profile, keeper_arguments: ['--ro-bind', '/', '/'] })).toString('base64url')],
  ['/tmp/lamina-oracle/quota.ready', '/tmp/lamina-oracle/quota.release',
    Buffer.from(JSON.stringify({ ...profile, unexpected: true })).toString('base64url')],
  ['/tmp/lamina-oracle/quota.ready', '/tmp/lamina-oracle/quota.release',
    Buffer.from(JSON.stringify({ ...profile,
      private_tmp_root: '/tmp/lamina-oracle/other' })).toString('base64url')],
  ['/tmp/lamina-oracle/quota.ready', '/tmp/lamina-oracle/quota.release',
    Buffer.from(JSON.stringify({ ...profile, cache_capability: {
      ...profile.cache_capability, descriptor: 5,
    } })).toString('base64url')],
]) assert.throws(() => validateOracleHostInvocation(crossed,
  { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' }), /oracle-host invocation/);
const result = oracleHostResult({
  proof: { keeper: { pid: 412 }, cache_capability: capabilityEvidence },
  usage: { enospc_proven: true },
  release: {
    mount_fds_released: true, cache_capability_fd_released: true,
    root_fd_released: true, state_fd_released: true,
  },
  finish: { identities_dead: true, proc_anchor_released: true },
});
assert.equal(result.non_gradeable, true);
assert.equal(result.cleanup_proof_issued, false);
assert.equal(result.grading_reachable, false);
assert.equal(result.candidate_executed, false);
assert.equal(result.anonymous_cache_capability_transfer_proven, true);
assert.equal(result.cache_capability.transfer,
  'fixed-fd-post-setup-anonymized-read-only');
assert.equal(result.cache_capability_fd_released, true);
assert.equal(result.root_fd_released, true);
assert.equal(result.state_fd_released, true);
assert.ok(result.limitations.some((value) => value.includes('--bind-fd')));
assert.ok(result.limitations.some((value) => value.includes('post-setup anonymization')
  && value.includes('already-unlinked regular-file FD')));
assert.ok(result.limitations.some((value) => value.includes('same-UID concurrent attacker')
  && value.includes('outside the threat model')));
assert.ok(result.limitations.some((value) => value.includes('proof-broker requester impersonation')
  && value.includes('terminal tuple')));
assert.ok(Buffer.byteLength(`${JSON.stringify(result)}\n`) < 8 * 1024);
for (const crossed of [
  {
    release: {
      mount_fds_released: false, cache_capability_fd_released: true,
      root_fd_released: true, state_fd_released: true,
    },
    finish: { identities_dead: true, proc_anchor_released: true },
  },
  {
    release: {
      mount_fds_released: true, cache_capability_fd_released: true,
      root_fd_released: true, state_fd_released: true,
    },
    finish: { identities_dead: false, proc_anchor_released: true },
  },
  {
    release: {
      mount_fds_released: true, cache_capability_fd_released: true,
      root_fd_released: true, state_fd_released: true,
    },
    finish: { identities_dead: true, proc_anchor_released: false },
  },
]) assert.throws(() => oracleHostResult({
  proof: { keeper: { pid: 412 }, cache_capability: capabilityEvidence },
  usage: { enospc_proven: true },
  ...crossed,
}), /anonymous cache capability lifecycle/);

const originalProcessKill = process.kill;
const pidSignals = [];
process.kill = (...arguments_) => { pidSignals.push(arguments_); return true; };
try {
  const reusedPidChild = new EventEmitter();
  reusedPidChild.pid = 2_147_483_647;
  reusedPidChild.exitCode = null;
  reusedPidChild.signalCode = null;
  let keeperGateReleases = 0;
  reusedPidChild.stdin = {
    end() {
      keeperGateReleases += 1;
      queueMicrotask(() => reusedPidChild.emit('close', 0, null));
    },
  };
  await terminateKeeper(reusedPidChild, { timeoutMs: 100 });
  assert.equal(keeperGateReleases, 1);
  assert.deepEqual(pidSignals, [],
    'a stored PID that may be stale or reused must never receive a PID-number signal');

  const stuckChild = new EventEmitter();
  stuckChild.pid = 2_147_483_646;
  stuckChild.exitCode = null;
  stuckChild.signalCode = null;
  stuckChild.stdin = { end() {} };
  await assert.rejects(() => terminateKeeper(stuckChild, { timeoutMs: 5 }),
    /did not close after its owned block gate was released/);
  assert.deepEqual(pidSignals, [],
    'timeout must defer to exact cgroup cleanup without signaling a potentially reused PID');
} finally {
  process.kill = originalProcessKill;
}

const heldProof = {
  schema: 'lamina.safe-runner-oracle-quota-proof/v1', non_gradeable: true,
  cgroup: '/user.slice/lamina-safe-test.scope', requester: { pid: 410, start_ticks: '4100' },
  keeper: { pid: 412, start_ticks: '4120' }, filesystem: { block_size: 4096, blocks: 16 },
};
const readyProof = { ...heldProof, filesystem_type: 'tmpfs', block_size: 4096, blocks: 16 };
assert.equal(exactOracleQuotaReadyProof(
  readyProof, heldProof, '/user.slice/lamina-safe-test.scope',
), true);
for (const crossed of [
  { ...readyProof, cgroup: '/crossed.scope' },
  { ...readyProof, keeper: { ...readyProof.keeper, start_ticks: 'stale' } },
  { ...readyProof, unexpected: true },
]) assert.equal(exactOracleQuotaReadyProof(
  crossed, heldProof, '/user.slice/lamina-safe-test.scope',
), false);

const completeLifecycle = {
  launchProfile: 'oracle-host-probe-v1', proof: heldProof,
  releaseAuthorized: true, finished: true,
  registryState: { state: 'finished', cleanup_verified: true },
};
assert.equal(oracleQuotaCompletionAuthorized(completeLifecycle), true);
for (const [field, value] of [
  ['proof', null], ['releaseAuthorized', false], ['finished', false],
  ['registryState', { state: 'release_authorized', cleanup_verified: false }],
]) assert.equal(oracleQuotaCompletionAuthorized({ ...completeLifecycle, [field]: value }), false);
assert.equal(oracleQuotaCompletionAuthorized({ launchProfile: null }), true);

const emptyRegistry = createOracleQuotaRegistry({
  cgroup: '/control.scope', procCgroup: '/proc.scope', quotaBytes: 65_536,
  bwrap: '/usr/bin/bwrap', bwrapIdentity: { dev: '1', ino: '2', uid: 0 },
  keeperArguments: oracleKeeperBwrapArguments(65_536),
  privateTmpRoot: capabilityPrivateRoot,
  cacheCapabilityAuthority: oracleCacheCapability.ORACLE_CACHE_CAPABILITY_AUTHORITY,
});
assert.deepEqual(emptyRegistry.prepareAbort(), {
  state: 'aborted_before_registration', cleanup_verified: true,
});
assert.deepEqual(emptyRegistry.prepareAbort(), {
  state: 'aborted_before_registration', cleanup_verified: true,
});
assert.deepEqual(emptyRegistry.finishAbort(), {
  state: 'aborted_before_registration', cleanup_verified: true,
});

console.log('real repository oracle quota broker parser contracts passed');
