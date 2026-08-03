#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adapterProbe, assertAdapterShape } from '../scripts/safe-runner/adapter.mjs';
import { MIB, SELF_TEST_CASE_IDS } from '../scripts/safe-runner/constants.mjs';
import {
  fixedGitDirectoriesForPlatform, refusalProgramForPlatform,
} from '../scripts/safe-runner/git.mjs';
import {
  sameTrustedBinaryStableFields, trustedBinaryStableFields,
  trustedBinaryStatPolicy, trustedPhysicalPathEqual, trustedReadOpenFlags,
} from '../scripts/safe-runner/infrastructure.mjs';
import { PortableProcessGroupAdapter } from '../scripts/safe-runner/portable-process-group.mjs';
import { preflightRun } from '../scripts/safe-runner/preflight.mjs';
import { runAdversarialSelfTests } from '../scripts/safe-runner/self-test.mjs';
import { readAttestation } from '../scripts/safe-runner/state.mjs';

const stateSource = fs.readFileSync('scripts/safe-runner/state.mjs', 'utf8');
assert.match(
  stateSource,
  /function fsyncParentDirectory[\s\S]*process\.platform === 'win32'\) return;[\s\S]*fs\.openSync\(path\.dirname\(file\), 'r'\)[\s\S]*fs\.fsyncSync\(parent\)/,
  'Windows may skip only unsupported parent-directory fsync',
);
assert.match(
  stateSource,
  /fs\.constants\.O_CREAT \| fs\.constants\.O_EXCL \| fs\.constants\.O_WRONLY[\s\S]*fs\.writeSync\(descriptor[\s\S]*fs\.fsyncSync\(descriptor\)[\s\S]*fs\.renameSync\(temporary, file\)[\s\S]*fsyncParentDirectory\(file\)/,
  'state publication must write and flush one writable descriptor before atomic rename',
);
assert.doesNotMatch(stateSource, /fs\.openSync\(temporary, 'r'\)/);

for (const platform of ['darwin', 'win32']) {
  const probe = adapterProbe(platform);
  assert.equal(probe.id, 'portable-process-group-small-only');
  assert.equal(probe.production_enforcement, false);
  assert.equal(probe.aggregate_memory, false);
  assert.equal(probe.aggregate_pids, false);
  assert.equal(probe.complete_descendant_ownership, false);
}
assert.equal(assertAdapterShape(new PortableProcessGroupAdapter()).id,
  'portable-process-group-small-only');

const windowsRegularFile = {
  platform: 'win32', regularFile: true, symbolicLink: false,
  mode: 0o100666n, uid: 0n, currentUid: null, requireRootOwnership: false,
};
assert.equal(trustedBinaryStatPolicy(windowsRegularFile), true,
  'Windows trust must not reinterpret unsupported execute, group/other, or setid bits');
assert.equal(trustedBinaryStatPolicy({ ...windowsRegularFile, regularFile: false }), false);
assert.equal(trustedBinaryStatPolicy({ ...windowsRegularFile, symbolicLink: true }), false);
assert.equal(trustedBinaryStatPolicy({ ...windowsRegularFile, requireRootOwnership: true }), false,
  'POSIX root ownership authority is unavailable on Windows');
assert.equal(trustedBinaryStatPolicy({ ...windowsRegularFile, platform: 'linux' }), false,
  'the identical writable non-executable mode remains forbidden by the POSIX policy');
assert.equal(trustedBinaryStatPolicy({ ...windowsRegularFile, platform: 'linux',
  mode: 0o100755n, uid: BigInt(process.getuid?.() ?? 1),
  currentUid: process.getuid?.() ?? 1 }), true);
assert.equal(trustedBinaryStatPolicy({ ...windowsRegularFile, platform: 'linux',
  mode: 0o104755n }), false, 'the POSIX setid rejection remains exact');
assert.equal(trustedPhysicalPathEqual(
  'C:\\Program Files\\Git\\mingw64\\bin\\git.exe',
  'c:\\Program Files\\Git\\mingw64\\bin\\git.exe', 'win32',
), true, 'Windows physical path comparison permits drive-letter case only');
for (const changedCase of [
  'C:\\program files\\Git\\mingw64\\bin\\git.exe',
  'C:\\Program Files\\Git\\mingw64\\bin\\GIT.EXE',
]) {
  assert.equal(trustedPhysicalPathEqual(
    'C:\\Program Files\\Git\\mingw64\\bin\\git.exe', changedCase, 'win32',
  ), false, 'canonical component casing must remain exact for case-sensitive Windows directories');
}
assert.equal(trustedPhysicalPathEqual(
  'C:\\Program Files\\Git\\mingw64\\bin\\git.exe',
  'C:\\Elsewhere\\git.exe', 'win32',
), false, 'case handling must not admit a different real path or reparse target');
assert.deepEqual(fixedGitDirectoriesForPlatform('win32'), [
  'C:\\Program Files\\Git\\mingw64\\bin',
  'C:\\Program Files\\Git\\clangarm64\\bin',
  'C:\\Program Files\\Git\\mingw32\\bin',
  'C:\\Program Files (x86)\\Git\\mingw32\\bin',
]);
assert.ok(fixedGitDirectoriesForPlatform('win32').every((directory) =>
  /[\\/]Git[\\/](?:mingw64|clangarm64|mingw32)[\\/]bin$/i.test(directory)),
  'Windows fixed Git authority must name actual architecture binaries, not wrapper entry points');
assert.equal(refusalProgramForPlatform('win32'),
  'C:\\Windows\\System32\\lamina-safe-runner-refuse-execution-does-not-exist.exe');
assert.equal(path.win32.isAbsolute(refusalProgramForPlatform('win32')), true);
assert.doesNotMatch(refusalProgramForPlatform('win32'), /cmd\.exe|[\s"']/i,
  'Windows refusal hooks must never invoke an ambient command interpreter');
assert.equal(refusalProgramForPlatform('linux'), '/bin/false');
assert.equal(trustedReadOpenFlags('win32'), fs.constants.O_RDONLY,
  'Windows must use its explicit lstat/fstat continuity fallback without a fake O_NOFOLLOW bit');
if (Number.isInteger(fs.constants.O_NOFOLLOW)) {
  assert.equal(trustedReadOpenFlags('linux'),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    'hosts exposing O_NOFOLLOW retain the exact POSIX no-follow descriptor flags');
} else {
  assert.throws(() => trustedReadOpenFlags('linux'), /no-follow open is unavailable/,
    'a synthetic POSIX request must fail closed when the Windows host exposes no O_NOFOLLOW');
}

const stableBinaryStat = {
  dev: 1n, ino: 2n, uid: 3n, gid: 4n, mode: 0o100666n, size: 8n,
  nlink: 1n, mtimeNs: 5n, ctimeNs: 6n,
};
assert.deepEqual(trustedBinaryStableFields(stableBinaryStat), {
  dev: '1', ino: '2', uid: '3', gid: '4', mode: String(0o100666), size: '8',
  nlink: '1', mtimeNs: '5', ctimeNs: '6',
});
assert.equal(sameTrustedBinaryStableFields(stableBinaryStat, { ...stableBinaryStat }), true);
for (const field of ['mtimeNs', 'ctimeNs', 'uid', 'gid', 'nlink']) {
  assert.equal(sameTrustedBinaryStableFields(stableBinaryStat, {
    ...stableBinaryStat, [field]: stableBinaryStat[field] + 1n,
  }), false, `trusted binary continuity must reject ${field} drift at unchanged size`);
}
assert.equal(sameTrustedBinaryStableFields(stableBinaryStat, {
  ...stableBinaryStat, size: stableBinaryStat.size,
  mtimeNs: stableBinaryStat.mtimeNs + 1n,
}), false, 'same-size in-place timestamp drift must fail continuity');
assert.equal(sameTrustedBinaryStableFields(stableBinaryStat,
  { ...stableBinaryStat, ctimeNs: undefined }), false,
  'missing stable metadata must fail closed');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-portable-contract-'));
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
const previousBwrapPath = process.env.LAMINA_SAFE_BWRAP_PATH;
const previousBwrapSha = process.env.LAMINA_SAFE_BWRAP_SHA256;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(root, 'state');
process.env.LAMINA_SAFE_BWRAP_PATH = 'deliberately-relative-portable-poison';
process.env.LAMINA_SAFE_BWRAP_SHA256 = 'not-a-digest';
try {
  const probe = process.platform === 'linux' ? adapterProbe('darwin') : adapterProbe();
  const portableAttestation = readAttestation(probe);
  assert.deepEqual(portableAttestation, {
    valid: false,
    expected_fingerprint: null,
    value: null,
    qualification_available: false,
    qualified_for_production_tiers: false,
    adapter: 'portable-process-group-small-only',
    reason: 'production attestation is unavailable without aggregate production enforcement',
  });
  const fixture = path.resolve('tests/fixtures/safe-runner-adversary.mjs');
  const base = {
    memoryMaxBytes: 192 * MIB,
    memoryHighBytes: 160 * MIB,
    timeoutMs: 2_000,
    outputMaxBytes: 256 * 1024,
    tempMaxBytes: 4 * MIB,
    sampleIntervalMs: 25,
    sustainedHighSamples: 2,
    gracefulStopMs: 100,
  };
  const classify = (pidsMax) => preflightRun({
    tier: 'small', command: [process.execPath, fixture, 'success'], cwd: process.cwd(),
    overrides: { ...base, pidsMax }, adapterInfo: probe, mode: 'self-test',
    selfTestCaseId: 'normal_cleanup', injectedExistingProcesses: [],
  });
  const tiny = classify(32);
  assert.equal(tiny.deliberately_tiny_self_test, true);
  assert.equal(tiny.portable_self_test_allowed, true);
  const tinyReasons = tiny.reasons.join('\n');
  assert.doesNotMatch(
    tinyReasons,
    /aggregate enforcement is unavailable|medium\/large execution|adversarial self-test attestation|bwrap|systemd|cgroup/i,
    `portable tiny allowlist added a production/infrastructure refusal: ${JSON.stringify(tiny.reasons)}`,
  );
  assert.deepEqual(tiny.attestation, {
    valid: false, path: 'unavailable', tested_at: null,
    qualified_for_production_tiers: false, qualification_available: false,
    reason: 'production attestation is unavailable without aggregate production enforcement',
  });
  const oversized = classify(64);
  assert.equal(oversized.deliberately_tiny_self_test, false);
  assert.equal(oversized.portable_self_test_allowed, false);
  assert.match(oversized.reasons.join('\n'), /aggregate enforcement is unavailable/);

  const medium = preflightRun({
    tier: 'medium', command: [process.execPath, fixture, 'success'], cwd: process.cwd(),
    overrides: { ...base, pidsMax: 32 }, adapterInfo: probe,
    injectedExistingProcesses: [], workloadId: 'portable-refusal-contract',
  });
  assert.equal(medium.ok, false);
  assert.match(medium.reasons.join('\n'), /medium\/large execution requires Linux/);

  const qualification = await runAdversarialSelfTests({ cwd: process.cwd(), probe });
  assert.equal(qualification.passed, false);
  assert.equal(qualification.qualified_for_production_tiers, false);
  assert.equal(qualification.cases.length, SELF_TEST_CASE_IDS.length);
  assert.ok(qualification.cases.every((item) => item.skipped === true));
  assert.match(qualification.refusal.message, /requires Linux user-systemd cgroup-v2/);
  const persisted = JSON.parse(fs.readFileSync(path.join(root, 'state', 'self-test.json'), 'utf8'));
  assert.equal(persisted.qualified_for_production_tiers, false);
  assert.equal(persisted.host_fingerprint, null,
    'portable refusal evidence must not compute a Linux infrastructure fingerprint');
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  if (previousBwrapPath === undefined) delete process.env.LAMINA_SAFE_BWRAP_PATH;
  else process.env.LAMINA_SAFE_BWRAP_PATH = previousBwrapPath;
  if (previousBwrapSha === undefined) delete process.env.LAMINA_SAFE_BWRAP_SHA256;
  else process.env.LAMINA_SAFE_BWRAP_SHA256 = previousBwrapSha;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('safe-runner portable contracts passed');
