#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  assertExecutionSnapshot, prepareExecutionSnapshot,
} from '../scripts/safe-runner/execution-snapshot.mjs';
import { infrastructureBinaries } from '../scripts/safe-runner/infrastructure.mjs';
import {
  auditedCommand, preflightRun, REAL_REPOSITORY_ORACLE_HOST_PROBE_WORKLOAD_ID,
} from '../scripts/safe-runner/preflight.mjs';
import {
  attestOracleKeeperBwrapHelp, ORACLE_HOST_LAUNCH_PROFILE,
  ORACLE_HOST_PROBE_COMMAND, oracleKeeperBwrapArguments,
} from '../scripts/safe-runner/oracle-host-profile.mjs';
import { validateOracleHostLaunchAuthority } from
  '../scripts/safe-runner/oracle-host-launcher.mjs';
import {
  encodeOracleHostLaunchAuthority, exactOracleHostLaunchAuthorized,
} from '../scripts/safe-runner/linux-systemd.mjs';
import { baseReport, finishReport, validateReport } from '../scripts/safe-runner/report.mjs';
import { realRepositoryOracleSourceClosure } from
  '../scripts/safe-runner/real-repository-source-closure.mjs';

if (process.platform !== 'linux') {
  console.log('real repository oracle-host launch profile portable contracts passed; Linux snapshot skipped');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRYPOINT = path.join(ROOT, 'benchmarks/real-repository-oracle-v1/workload.mjs');
const command = [process.execPath, ENTRYPOINT, ORACLE_HOST_PROBE_COMMAND];
assert.equal(auditedCommand(command, ROOT).audited, true);
for (const crossed of [
  [...command, 'extra'],
  [process.execPath, path.join(ROOT, 'tests/test_util_test.mjs'), ORACLE_HOST_PROBE_COMMAND],
]) assert.equal(auditedCommand(crossed, ROOT).audited, false);
assert.equal(auditedCommand(
  [process.execPath, ENTRYPOINT, 'verify-scenarios'], ROOT,
).audited, true);

const adapterInfo = {
  id: 'linux-systemd-cgroup-v2', platform: 'linux', production_enforcement: true,
  aggregate_memory: true, aggregate_pids: true, complete_descendant_ownership: true,
  temporary_quota: true, controllers: ['memory', 'pids'], reasons: [],
};
const limits = {
  memoryMaxBytes: 256 * 1024 ** 2,
  memoryHighBytes: 192 * 1024 ** 2,
  pidsMax: 16,
  timeoutMs: 8_000,
  tempMaxBytes: 64 * 1024,
  outputMaxBytes: 1024 * 1024,
};
const exact = preflightRun({
  tier: 'small', command, cwd: ROOT, overrides: limits, adapterInfo,
  injectedExistingProcesses: [], workloadId: REAL_REPOSITORY_ORACLE_HOST_PROBE_WORKLOAD_ID,
});
assert.equal(exact.launch_profile, ORACLE_HOST_LAUNCH_PROFILE);
assert.equal(exact.reasons.some((reason) => reason.includes('oracle-host probe requires')), false);
for (const crossed of [
  { tier: 'small', workloadId: 'real-repository-oracle-v1:scenario-verification' },
  { tier: 'small', workloadId: REAL_REPOSITORY_ORACLE_HOST_PROBE_WORKLOAD_ID,
    command: [...command, 'extra'] },
  { tier: 'small', workloadId: REAL_REPOSITORY_ORACLE_HOST_PROBE_WORKLOAD_ID,
    command: [process.execPath, ENTRYPOINT, 'verify-scenarios'] },
]) {
  const refusal = preflightRun({
    tier: crossed.tier, command: crossed.command || command, cwd: ROOT, overrides: limits,
    adapterInfo, injectedExistingProcesses: [], workloadId: crossed.workloadId,
  });
  assert.equal(refusal.ok, false);
  assert.notEqual(refusal.launch_profile, ORACLE_HOST_LAUNCH_PROFILE);
}
const oversizedProfile = preflightRun({
  tier: 'medium', command, cwd: ROOT, overrides: limits, adapterInfo,
  injectedExistingProcesses: [], workloadId: REAL_REPOSITORY_ORACLE_HOST_PROBE_WORKLOAD_ID,
});
assert.equal(oversizedProfile.ok, false);
assert.equal(oversizedProfile.launch_profile, null);

const arguments_ = oracleKeeperBwrapArguments(64 * 1024);
assert.equal(arguments_.includes('--ro-bind'), false);
assert.equal(arguments_.includes('--bind'), false);
assert.equal(arguments_.includes('/proc'), false);
assert.equal(arguments_.includes('/runtime'), false);
assert.deepEqual(arguments_.slice(-2), ['--', '/oracle-state']);
assert.equal(arguments_.filter((value) => value === '--tmpfs').length, 2);
assert.match(attestOracleKeeperBwrapHelp(execFileSync('/usr/bin/bwrap', ['--help'], {
  encoding: 'utf8',
})).help_sha256, /^[a-f0-9]{64}$/);
assert.deepEqual(realRepositoryOracleSourceClosure(ORACLE_HOST_PROBE_COMMAND), [
  'benchmarks/real-repository-oracle-v1/workload.mjs',
  'benchmarks/real-repository-oracle-v1/oracle-host.mjs',
  'scripts/safe-runner/oracle-host-launcher.mjs',
  'scripts/safe-runner/oracle-host-profile.mjs',
]);

const temporary = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-oracle-host-profile-test-'),
));
fs.chmodSync(temporary, 0o700);
try {
  const snapshot = prepareExecutionSnapshot({
    cwd: ROOT, command, temporaryDirectory: temporary,
    infrastructure: infrastructureBinaries(), environment: process.env,
  });
  assert.equal(snapshot.launch_profile, ORACLE_HOST_LAUNCH_PROFILE);
  assert.equal(snapshot.oracle_host_launch_cwd, snapshot.snapshot_repository);
  assert.deepEqual(snapshot.oracle_host_launch_command, [
    snapshot.infrastructure.node,
    path.join(snapshot.snapshot_repository,
      'benchmarks/real-repository-oracle-v1/oracle-host.mjs'),
  ]);
  assert.notEqual(snapshot.oracle_host_launch_command[1], ENTRYPOINT);
  assert.equal(snapshot.oracle_host_profile.non_gradeable, true);
  assert.equal(snapshot.oracle_host_profile.launcher,
    snapshot.infrastructure.oracle_host_launcher_mjs);
  assert.match(snapshot.oracle_host_launch_binding.host_sha256, /^[a-f0-9]{64}$/);
  const profileArgument = Buffer.from(JSON.stringify({
    ...snapshot.oracle_host_profile,
    quota_bytes: limits.tempMaxBytes,
    keeper_arguments: oracleKeeperBwrapArguments(limits.tempMaxBytes),
  })).toString('base64url');
  const hostArgv = [
    snapshot.infrastructure.node,
    snapshot.oracle_host_launch_command[1],
    path.join(temporary, 'quota.ready'),
    path.join(temporary, 'quota.release'),
    profileArgument,
  ];
  const encodedAuthority = encodeOracleHostLaunchAuthority({
    node: snapshot.infrastructure.node,
    nodeIdentity: snapshot.infrastructure.identities.node,
    launcher: snapshot.oracle_host_profile.launcher,
    launcherIdentity: snapshot.oracle_host_profile.launcher_identity,
    host: snapshot.oracle_host_profile.host,
    hostIdentity: snapshot.oracle_host_profile.host_identity,
    cwd: snapshot.oracle_host_launch_cwd,
    argv: hostArgv,
    profileArgument,
  });
  assert.deepEqual(validateOracleHostLaunchAuthority(encodedAuthority, {
    argv: [snapshot.infrastructure.node, snapshot.oracle_host_profile.launcher,
      encodedAuthority],
    execPath: snapshot.infrastructure.node,
    launcherPath: snapshot.oracle_host_profile.launcher,
    environment: {},
  }).argv, hostArgv);
  const exactLaunchRecord = {
    ppid: 73,
    argv: [snapshot.infrastructure.node, snapshot.oracle_host_profile.launcher,
      encodedAuthority],
    cwd: snapshot.oracle_host_launch_cwd,
    executable_identity: snapshot.infrastructure.identities.node,
    environment_attestation: {
      readable: true, bounded: true, malformed: false, execution_hooks: [],
    },
  };
  const exactLaunchAuthority = {
    profile: ORACLE_HOST_LAUNCH_PROFILE,
    argv: exactLaunchRecord.argv,
    cwd: exactLaunchRecord.cwd,
    executable_identity: exactLaunchRecord.executable_identity,
  };
  assert.equal(exactOracleHostLaunchAuthorized(
    exactLaunchRecord, exactLaunchAuthority, 73,
  ), true);
  assert.equal(exactOracleHostLaunchAuthorized(
    { ...exactLaunchRecord, ppid: 74 }, exactLaunchAuthority, 73,
  ), false);
  assert.equal(exactOracleHostLaunchAuthorized({
    ...exactLaunchRecord, argv: hostArgv,
  }, exactLaunchAuthority, 73), false);
  assert.throws(() => validateOracleHostLaunchAuthority(encodedAuthority, {
    argv: [snapshot.infrastructure.node, snapshot.oracle_host_profile.launcher,
      `${encodedAuthority}a`],
    execPath: snapshot.infrastructure.node,
    launcherPath: snapshot.oracle_host_profile.launcher,
    environment: {},
  }), /argv is not exact/);
  assert.throws(() => validateOracleHostLaunchAuthority(`${encodedAuthority}=`, {
    argv: [snapshot.infrastructure.node, snapshot.oracle_host_profile.launcher,
      `${encodedAuthority}=`],
    execPath: snapshot.infrastructure.node,
    launcherPath: snapshot.oracle_host_profile.launcher,
    environment: {},
  }), /encoding is invalid/);
  const extraNestedAuthority = JSON.parse(Buffer.from(encodedAuthority, 'base64url'));
  extraNestedAuthority.host.unexpected = true;
  const encodedExtraNested = Buffer.from(JSON.stringify(extraNestedAuthority)).toString('base64url');
  assert.throws(() => validateOracleHostLaunchAuthority(encodedExtraNested, {
    argv: [snapshot.infrastructure.node, snapshot.oracle_host_profile.launcher,
      encodedExtraNested],
    execPath: snapshot.infrastructure.node,
    launcherPath: snapshot.oracle_host_profile.launcher,
    environment: {},
  }), /sealed launch translation is invalid/);
  const hostHardlink = path.join(temporary, 'oracle-host-hardlink.mjs');
  fs.linkSync(snapshot.oracle_host_profile.host, hostHardlink);
  try {
    assert.throws(() => validateOracleHostLaunchAuthority(encodedAuthority, {
      argv: [snapshot.infrastructure.node, snapshot.oracle_host_profile.launcher,
        encodedAuthority],
      execPath: snapshot.infrastructure.node,
      launcherPath: snapshot.oracle_host_profile.launcher,
      environment: {},
    }), /file identity changed/);
  } finally { fs.unlinkSync(hostHardlink); }
  const trustedHost = `${snapshot.oracle_host_profile.host}.trusted`;
  fs.renameSync(snapshot.oracle_host_profile.host, trustedHost);
  try {
    fs.copyFileSync(trustedHost, snapshot.oracle_host_profile.host);
    fs.chmodSync(snapshot.oracle_host_profile.host, 0o400);
    assert.throws(() => validateOracleHostLaunchAuthority(encodedAuthority, {
      argv: [snapshot.infrastructure.node, snapshot.oracle_host_profile.launcher,
        encodedAuthority],
      execPath: snapshot.infrastructure.node,
      launcherPath: snapshot.oracle_host_profile.launcher,
      environment: {},
    }), /file identity changed/);
  } finally {
    fs.rmSync(snapshot.oracle_host_profile.host, { force: true });
    fs.renameSync(trustedHost, snapshot.oracle_host_profile.host);
  }
  assert.equal(assertExecutionSnapshot(snapshot), true);

  const genericTemporary = path.join(temporary, 'generic-snapshot');
  fs.mkdirSync(genericTemporary, { mode: 0o700 });
  const genericSnapshot = prepareExecutionSnapshot({
    cwd: ROOT,
    command: [process.execPath, ENTRYPOINT, 'review-inventory'],
    temporaryDirectory: genericTemporary,
    infrastructure: infrastructureBinaries(),
    environment: process.env,
  });
  assert.equal(genericSnapshot.launch_profile, null);
  assert.equal(genericSnapshot.infrastructure.oracle_host_launcher_mjs, undefined);
  assert.equal(genericSnapshot.entries.some((entry) =>
    entry.label === 'infrastructure:oracle-host-launcher.mjs'), false);
  assert.equal(assertExecutionSnapshot(genericSnapshot), true);

  const report = baseReport({ tier: 'small', command, cwd: ROOT });
  report.outcome = 'preflight_refused';
  report.preflight = {
    ok: false,
    execution_snapshot: {
      launch_profile: snapshot.launch_profile,
      translated_launch_binding: snapshot.oracle_host_launch_binding,
    },
  };
  report.termination.reason = 'preflight_refused';
  report.error = { code: 'LAMINA_SAFE_TEST', message: 'schema acceptance fixture' };
  finishReport(report, Date.now());
  assert.equal(validateReport(report).valid, true);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log('real repository oracle-host launch profile contracts passed');
