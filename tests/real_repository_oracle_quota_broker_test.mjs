#!/usr/bin/env node
import assert from 'node:assert/strict';
import { authorizeBrokerRequest } from '../scripts/safe-runner/broker.mjs';
import {
  oracleHostResult, validateOracleHostInvocation,
} from '../benchmarks/real-repository-oracle-v1/oracle-host.mjs';
import { oracleKeeperBwrapArguments } from '../scripts/safe-runner/oracle-host-profile.mjs';
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
  '',
].join('\n'));
assert.deepEqual(mounts.root, { mount_id: 91, major_minor: '0:77', mount_point: '/',
  filesystem_type: 'tmpfs', access: 'ro' });
assert.deepEqual(mounts.oracle_state, { mount_id: 92, major_minor: '0:78',
  mount_point: '/oracle-state', filesystem_type: 'tmpfs', access: 'rw' });
for (const invalid of [
  '91 80 0:77 / / ro - tmpfs tmpfs rw\n',
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
}, authority), {
  ok: true, proof: { schema: 'lamina.safe-runner-oracle-quota-proof/v1', mount_id: 92 },
});
assert.equal(registrations[0].requester.pid, host.pid);
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
  }, authority).error, /descendant/);
}
authority.records = () => [host, outer, keeper];
authority.oracleHostLaunchAuthorized = () => false;
assert.match(authorizeBrokerRequest({
  operation: 'register_oracle_quota', requester,
  outer: { pid: outer.pid, start_ticks: outer.start_ticks },
  keeper: { pid: keeper.pid, start_ticks: keeper.start_ticks }, quota_bytes: 65_536,
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
  keeper_arguments: oracleKeeperBwrapArguments(65_536),
  broker_socket: '/tmp/lamina-oracle/supervisor.sock',
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
]) assert.throws(() => validateOracleHostInvocation(crossed,
  { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' }), /oracle-host invocation/);
const result = oracleHostResult({
  proof: { keeper: { pid: 412 } }, usage: { enospc_proven: true },
  release: { mount_fds_released: true }, finish: { identities_dead: true },
});
assert.equal(result.non_gradeable, true);
assert.equal(result.cleanup_proof_issued, false);
assert.equal(result.grading_reachable, false);
assert.equal(result.candidate_executed, false);
assert.ok(result.limitations.some((value) => value.includes('--bind-fd')));
assert.ok(Buffer.byteLength(`${JSON.stringify(result)}\n`) < 8 * 1024);

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
