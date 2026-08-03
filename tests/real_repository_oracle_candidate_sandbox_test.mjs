#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildCandidateRuntimeSnapshot,
  verifyCandidateRuntimeSnapshot,
} from '../benchmarks/real-repository-oracle-v1/candidate-runtime-closure.mjs';
import {
  CANDIDATE_OUTPUT_MAX_BYTES,
  CANDIDATE_SANDBOX_LIMITATION,
  candidateBubblewrapArguments,
  prepareCandidateSandbox,
  runCandidateSandbox,
} from '../benchmarks/real-repository-oracle-v1/candidate-sandbox.mjs';
import { descendantRecords, identityAlive, processIdentity } from
  '../scripts/safe-runner/processes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER_FIXTURE = path.join(ROOT,
  'tests/fixtures/real-repository-candidate-adapter.mjs');
const SUPERVISOR_HELPER = path.join(ROOT,
  'tests/fixtures/real-repository-candidate-supervisor-helper.mjs');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const writeCanonical = (file, value) => fs.writeFileSync(file,
  Buffer.from(JSON.stringify(canonical(value))), { flag: 'wx', mode: 0o600 });

const pureArguments = candidateBubblewrapArguments({
  adapter_entrypoint: 'adapter.mjs', platform: 'linux',
});
assert.deepEqual(pureArguments.slice(0, 20), [
  '--die-with-parent', '--new-session',
  '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-net',
  '--uid', '0', '--gid', '0', '--hostname', 'lamina-candidate',
  '--disable-userns', '--assert-userns-disabled', '--cap-drop', 'ALL', '--clearenv', '--tmpfs', '/',
]);
assert.equal(pureArguments.includes('--ro-bind'), false);
assert.equal(pureArguments.join('\0').includes('--ro-bind\0/\0/'), false,
  'candidate sandbox never binds the host root');
for (const pair of [
  ['--ro-bind-fd', '3'], ['--ro-bind-fd', '4'], ['--ro-bind-fd', '5'],
  ['--ro-bind-fd', '6'], ['--bind-fd', '7'],
]) {
  assert.ok(pureArguments.some((value, index) => value === pair[0]
    && pureArguments[index + 1] === pair[1]));
}
assert.throws(() => candidateBubblewrapArguments({
  adapter_entrypoint: 'adapter.mjs', platform: 'darwin',
}), /requires Linux/);

if (process.platform !== 'linux') {
  console.log('real repository oracle candidate sandbox portable contracts passed; Linux integration skipped');
  process.exit(0);
}

const temporary = fs.realpathSync.native(fs.mkdtempSync(
  path.join(os.tmpdir(), 'lamina-candidate-sandbox-test-'),
));
fs.chmodSync(temporary, 0o700);
const adapterRoot = path.join(temporary, 'adapter');
const repository = path.join(temporary, 'repository');
const runtimeRoot = path.join(temporary, 'runtime');
fs.mkdirSync(adapterRoot, { mode: 0o700 });
fs.copyFileSync(ADAPTER_FIXTURE, path.join(adapterRoot, 'adapter.mjs'));
fs.chmodSync(path.join(adapterRoot, 'adapter.mjs'), 0o500);
fs.mkdirSync(repository, { mode: 0o700 });
fs.writeFileSync(path.join(repository, 'observed.txt'), 'repository-visible\n', { mode: 0o600 });

let server;
let hostSentinel;
let supervisorHelper;
try {
  const runtime = buildCandidateRuntimeSnapshot({ snapshot_root: runtimeRoot });
  assert.equal(verifyCandidateRuntimeSnapshot(runtime), runtime);
  assert.ok(runtime.files.some((item) => item.role === 'node'));
  assert.ok(runtime.files.some((item) => item.role === 'loader'));
  assert.ok(runtime.files.filter((item) => item.role === 'library').length >= 1);
  assert.match(runtime.closure_sha256, /^[a-f0-9]{64}$/);

  const hostSocket = path.join(temporary, 'host-control.sock');
  server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(hostSocket, resolve);
  });
  hostSentinel = path.join(os.tmpdir(),
    `lamina-candidate-host-sentinel-${crypto.randomBytes(8).toString('hex')}`);
  fs.writeFileSync(hostSentinel, 'host-private\n', { mode: 0o600 });

  let runIndex = 0;
  const prepareRun = (mode, timeoutMs = 3_000, extra = {}) => {
    runIndex += 1;
    const input = path.join(temporary, `input-${runIndex}.json`);
    const output = path.join(temporary, `output-${runIndex}`);
    writeCanonical(input, {
      mode,
      token: 'canonical-public-token',
      inaccessible: [
        '/etc/passwd', '/home', hostSentinel, '/run', '/var', '/sys', '/controller/private',
      ],
      host_socket: hostSocket,
      environment_seeds: ['CANDIDATE_SECRET_SEED', 'NODE_OPTIONS', 'LD_PRELOAD'],
      ...extra,
    });
    fs.writeFileSync(output, '', { flag: 'wx', mode: 0o600 });
    const sibling = `${output}.sibling`;
    fs.writeFileSync(sibling, 'preserve-sibling\n', { flag: 'wx', mode: 0o600 });
    const authority = prepareCandidateSandbox({
      runtime_snapshot: runtime,
      adapter_root: adapterRoot,
      adapter_entrypoint: 'adapter.mjs',
      public_input: input,
      repository,
      output_file: output,
      timeout_ms: timeoutMs,
      git_dependent: false,
    });
    return { authority, input, output, sibling };
  };

  process.env.CANDIDATE_SECRET_SEED = 'must-not-cross';
  process.env.NODE_OPTIONS = '--trace-warnings';
  const success = prepareRun('success');
  assert.deepEqual(success.authority.prlimit_arguments.slice(0, 4), [
    '--fsize=16777216:16777216', '--core=0:0', '--nofile=64:64', '--',
  ]);
  assert.equal(success.authority.prlimit_arguments[4], success.authority.infrastructure.bwrap.path,
    'attested prlimit directly invokes attested bwrap');
  assert.match(success.authority.argv_sha256, /^[a-f0-9]{64}$/);
  assert.equal(success.authority.limitation, CANDIDATE_SANDBOX_LIMITATION);
  await assert.rejects(runCandidateSandbox(structuredClone(success.authority)), /was not issued/);
  const successResult = await runCandidateSandbox(success.authority);
  assert.equal(successResult.passed, true, successResult.stderr);
  const observed = JSON.parse(fs.readFileSync(success.output, 'utf8'));
  assert.equal(observed.repository_text, 'repository-visible\n');
  assert.equal(observed.input_token, 'canonical-public-token');
  assert.equal(observed.inaccessible.every(Boolean), true);
  assert.equal(observed.repository_mutation_refused, true);
  assert.equal(observed.output_sibling_refused, true);
  assert.equal(observed.environment_seed_absent, true);
  assert.deepEqual(observed.environment_keys, ['LANG', 'LC_ALL', 'PATH', 'PWD', 'TMPDIR', 'TZ']);
  assert.equal(success.authority.environment.PWD, '/repository',
    'bwrap contributes only its deterministic sandbox-local working directory variable');
  assert.equal(observed.network_refused, true);
  assert.equal(observed.host_socket_absent, true);
  assert.equal(observed.nested_userns_tool_absent, true);
  assert.equal(observed.mount_tool_absent, true);
  assert.equal(observed.hostname, 'lamina-candidate');
  assert.equal(fs.readFileSync(success.sibling, 'utf8'), 'preserve-sibling\n');
  assert.equal(fs.existsSync(path.join(repository, 'candidate-mutation')), false);
  assert.equal(successResult.cleanup_verified, false);

  const exact = prepareRun('exact-limit', 5_000);
  const exactResult = await runCandidateSandbox(exact.authority);
  assert.equal(exactResult.passed, true, exactResult.stderr);
  assert.equal(fs.statSync(exact.output).size, CANDIDATE_OUTPUT_MAX_BYTES);

  const overflow = prepareRun('overflow', 5_000);
  const overflowResult = await runCandidateSandbox(overflow.authority);
  assert.equal(overflowResult.passed, false);
  assert.notEqual(overflowResult.code, 0);
  assert.ok(fs.statSync(overflow.output).size <= CANDIDATE_OUTPUT_MAX_BYTES);

  for (const [mode, expected] of [
    ['timeout', 'timed_out'], ['flood', 'output_flood'], ['double-fork', 'timed_out'],
  ]) {
    const bounded = prepareRun(mode, 500);
    const result = await runCandidateSandbox(bounded.authority);
    assert.equal(result.passed, false);
    assert.equal(result[expected], true, `${mode} must hit ${expected}`);
    assert.deepEqual(result.descendants_remaining, [], `${mode} leaves no observed descendants`);
  }

  const swapped = prepareRun('timeout', 500);
  const displacedOutput = `${swapped.output}.candidate-owned`;
  const swappedRun = runCandidateSandbox(swapped.authority);
  await new Promise((resolve) => setTimeout(resolve, 100));
  fs.renameSync(swapped.output, displacedOutput);
  fs.writeFileSync(swapped.output, 'unrelated-victim\n', { flag: 'wx', mode: 0o600 });
  await assert.rejects(swappedRun, /candidate output pathname changed after launch/);
  assert.equal(fs.readFileSync(swapped.output, 'utf8'), 'unrelated-victim\n',
    'a path-swapped unrelated victim is neither accepted nor modified');
  assert.equal(fs.existsSync(displacedOutput), true,
    'the descriptor-anchored candidate output remains separately observable');

  const mutated = prepareRun('timeout', 500);
  const mutatedRun = runCandidateSandbox(mutated.authority);
  await new Promise((resolve) => setTimeout(resolve, 100));
  fs.writeFileSync(path.join(repository, 'observed.txt'), 'host-mutated-after-launch\n');
  await assert.rejects(mutatedRun,
    /candidate launch authority input identity changed after launch/);
  fs.writeFileSync(path.join(repository, 'observed.txt'), 'repository-visible\n');

  const linked = path.join(temporary, 'linked-worktree');
  fs.mkdirSync(linked, { mode: 0o700 });
  fs.writeFileSync(path.join(linked, '.git'), 'gitdir: /host/private/admin\n', { mode: 0o600 });
  fs.writeFileSync(path.join(linked, 'observed.txt'), 'linked-observable\n', { mode: 0o600 });
  const linkedInput = path.join(temporary, 'linked-input.json');
  const linkedOutput = path.join(temporary, 'linked-output');
  writeCanonical(linkedInput, {
    mode: 'success', token: 'linked-public-token',
    inaccessible: ['/etc/passwd'], host_socket: hostSocket,
    environment_seeds: ['NODE_OPTIONS'],
  });
  fs.writeFileSync(linkedOutput, '', { flag: 'wx', mode: 0o600 });
  assert.throws(() => prepareCandidateSandbox({
    runtime_snapshot: runtime, adapter_root: adapterRoot, adapter_entrypoint: 'adapter.mjs',
    public_input: linkedInput, repository: linked, output_file: linkedOutput,
    timeout_ms: 1_000, git_dependent: true,
  }), /Git-dependent linked-worktree candidate adapters are unsupported/);
  const readonlyLinked = prepareCandidateSandbox({
    runtime_snapshot: runtime, adapter_root: adapterRoot, adapter_entrypoint: 'adapter.mjs',
    public_input: linkedInput, repository: linked, output_file: linkedOutput,
    timeout_ms: 1_000, git_dependent: false,
  });
  assert.equal(readonlyLinked.git_dependent, false,
    'linked-worktree files remain observable to a non-Git-dependent adapter');
  const linkedResult = await runCandidateSandbox(readonlyLinked);
  assert.equal(linkedResult.passed, true, linkedResult.stderr);
  assert.equal(JSON.parse(fs.readFileSync(linkedOutput, 'utf8')).repository_text,
    'linked-observable\n');

  const deathInput = path.join(temporary, 'death-input.json');
  const deathOutput = path.join(temporary, 'death-output');
  const helperRuntime = path.join(temporary, 'helper-runtime');
  writeCanonical(deathInput, { mode: 'supervisor-death' });
  fs.writeFileSync(deathOutput, '', { flag: 'wx', mode: 0o600 });
  const helperConfig = path.join(temporary, 'supervisor-helper.json');
  writeCanonical(helperConfig, {
    runtime_snapshot: helperRuntime,
    adapter_root: adapterRoot,
    adapter_entrypoint: 'adapter.mjs',
    public_input: deathInput,
    repository,
    output_file: deathOutput,
  });
  const helper = spawn(process.execPath, [SUPERVISOR_HELPER, helperConfig], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  supervisorHelper = helper;
  let helperStderr = '';
  helper.stderr.on('data', (chunk) => { helperStderr += chunk.toString('utf8'); });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`supervisor helper timeout: ${helperStderr}`)), 10_000);
    helper.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.includes('READY\n')) { clearTimeout(timer); resolve(); }
    });
    helper.once('error', reject);
    helper.once('exit', (code, signal) => reject(new Error(
      `supervisor helper exited before READY: ${code}/${signal}: ${helperStderr}`,
    )));
  });
  const deathIdentities = [processIdentity(helper.pid), ...descendantRecords(helper.pid)
    .map((record) => processIdentity(record.pid))].filter(Boolean);
  assert.ok(deathIdentities.length >= 3);
  helper.kill('SIGKILL');
  await new Promise((resolve) => helper.once('exit', resolve));
  supervisorHelper = null;
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(deathIdentities.filter(identityAlive).length, 0,
    'bwrap die-with-parent removes the candidate tree after supervisor death');

  console.log('real repository oracle candidate-only sandbox contracts passed');
} finally {
  delete process.env.CANDIDATE_SECRET_SEED;
  delete process.env.NODE_OPTIONS;
  if (supervisorHelper?.exitCode === null && supervisorHelper?.signalCode === null) {
    try { supervisorHelper.kill('SIGKILL'); } catch {}
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  if (hostSentinel) {
    try { fs.unlinkSync(hostSentinel); } catch {}
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
