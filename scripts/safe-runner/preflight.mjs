import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  DEFAULTS,
  PRODUCTION_TIERS,
  PORTABLE_SELF_TEST_CASE_IDS,
  SELF_TEST_CASE_IDS,
  SELF_TEST_FIXTURE_MODES,
  SELF_TEST_LIMIT_MAXIMA,
  TIER_ORDER,
} from './constants.mjs';
import { adapterProbe } from './adapter.mjs';
import { hostEnvelope } from './envelope.mjs';
import { existingLaminaProcesses } from './processes.mjs';
import {
  checkPromotion, checkSafetyRetry, frozenWorkloadIdentity, productionLockDirectory,
  readAttestation, stateDirectory,
} from './state.mjs';

const EXTERNAL_DAEMON_PROGRAMS = new Set(['docker', 'podman', 'harbor']);
const EXTERNAL_DAEMON_ENTRYPOINTS = [
  'benchmarks/lb6/pilot/scripts/run-three-arm.mjs',
  'benchmarks/lb6/pilot/scripts/build-runtime.mjs',
];

const EXTERNAL_TEXT = /(?:^|[\s;&|/"'])(?:docker|podman|harbor)(?=$|[\s;&|/"'])/i;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUDITED_NODE_ENTRYPOINTS = new Map([
  ['benchmarks/retrieval-v1/benchmark.mjs', false],
  ['evals/scripts/run-suite.mjs', true],
  ['evals/scripts/run-reference-matrix.mjs', true],
  ['evals/scripts/vendor-nextjs-fixture.mjs', true],
  ['evals/scripts/vendor-payload-fixture.mjs', true],
  ['evals/scripts/vendor-plane-fixture.mjs', true],
  ['evals/scripts/vendor-outline-fixture.mjs', true],
  ['scripts/build-standalone-cli.mjs', false],
  ['scripts/fetch-retrieval-model.mjs', true],
  ['scripts/prepare-retrieval-assets.mjs', false],
  ['tests/retrieval_native_index_test.mjs', false],
  ['tests/cli_binary_smoke_test.mjs', false],
  ['tests/fixtures/safe-runner-adversary.mjs', false],
  ['tests/fixtures/safe-runner-graphd-client.mjs', false],
  ['tests/fixtures/safe-runner-mutable.mjs', false],
]);
const AUDITED_BASH_ENTRYPOINTS = new Set(['evals/hooks/compatibility-matrix.sh']);
const AUDITED_NPX_PACKAGES = new Set(['agent-skills-eval', 'promptfoo']);
const SENSITIVE_WRITABLE_ROOTS = ['/','/tmp','/run','/proc','/sys','/dev'];

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}

export function writableWorktreeProof(cwd, protectedPaths = [stateDirectory(), productionLockDirectory()]) {
  const declared = path.resolve(cwd);
  let resolved;
  try { resolved = fs.realpathSync.native(cwd); } catch { resolved = path.resolve(cwd); }
  let physical = false;
  try {
    const stat = fs.lstatSync(declared);
    physical = stat.isDirectory() && !stat.isSymbolicLink() && declared === resolved
      && (typeof process.getuid !== 'function' || stat.uid === process.getuid());
  } catch {}
  const sensitive = SENSITIVE_WRITABLE_ROOTS.some((candidate) => resolved === candidate);
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: resolved, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_000,
    maxBuffer: 64 * 1024,
  });
  let worktree = null;
  try { worktree = fs.realpathSync.native(String(git.stdout || '').trim()); } catch {}
  const insideWorktree = git.status === 0 && worktree
    && (resolved === worktree || resolved.startsWith(`${worktree}${path.sep}`));
  const overlap = protectedPaths.map((candidate) => path.resolve(candidate))
    .find((candidate) => pathsOverlap(resolved, candidate)) || null;
  return {
    ok: physical && !sensitive && Boolean(insideWorktree) && overlap === null,
    cwd: resolved,
    worktree,
    protected_path_overlap: overlap,
    reason: sensitive ? 'writable cwd cannot be a host-sensitive root'
      : !physical ? 'writable cwd must be a same-user physical directory without symlink indirection'
      : !insideWorktree ? 'writable cwd must be a physical Git worktree surface'
        : overlap ? 'writable cwd overlaps runner authority state' : null,
  };
}

function repositoryEntrypoint(argument) {
  const resolved = path.resolve(argument);
  const relative = path.relative(REPOSITORY_ROOT, resolved).replaceAll('\\', '/');
  return relative.startsWith('../') || path.isAbsolute(relative) ? null : relative;
}

function auditedRepositoryFile(candidate, allowlist) {
  const relative = repositoryEntrypoint(candidate);
  if (relative === null || !allowlist.has(relative)) return null;
  const expected = path.join(REPOSITORY_ROOT, relative);
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()
      || fs.realpathSync.native(candidate) !== fs.realpathSync.native(expected)) return null;
  } catch { return null; }
  return relative;
}

function resolvedExecutable(command, cwd) {
  const declared = String(command || '');
  const candidates = declared.includes('/') || declared.includes('\\')
    ? [path.resolve(cwd, declared)]
    : String(process.env.PATH || '').split(path.delimiter)
      .filter(Boolean).map((directory) => path.resolve(directory, declared));
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return fs.realpathSync.native(candidate);
    } catch {}
  }
  return null;
}

function trustedExecutable(command, cwd, expected) {
  const actual = resolvedExecutable(command, cwd);
  if (!actual) return false;
  return expected.some((candidate) => {
    try { return actual === fs.realpathSync.native(candidate); } catch { return false; }
  });
}

export function auditedCommand(command = [], cwd = process.cwd()) {
  const executable = path.basename(String(command[0] || '')).toLowerCase();
  if (/^node(?:\.exe)?$/.test(executable)) {
    const resolved = resolvedExecutable(command[0], cwd);
    if (!resolved || !trustedExecutable(command[0], cwd, [process.execPath])) {
      return { audited: false, allow_network: false, entrypoint: null };
    }
    const entrypoint = command[1];
    const relative = entrypoint && !String(entrypoint).startsWith('-')
      ? auditedRepositoryFile(path.resolve(cwd, entrypoint), AUDITED_NODE_ENTRYPOINTS) : null;
    return relative !== null
      ? { audited: true, allow_network: AUDITED_NODE_ENTRYPOINTS.get(relative), entrypoint: relative,
        executable: resolved }
      : { audited: false, allow_network: false, entrypoint: relative };
  }
  if (/^(?:bash|sh)$/.test(executable)) {
    const trustedShells = executable === 'bash'
      ? ['/bin/bash', '/usr/bin/bash'] : ['/bin/sh', '/usr/bin/sh'];
    const resolved = resolvedExecutable(command[0], cwd);
    if (!resolved || !trustedExecutable(command[0], cwd, trustedShells)) {
      return { audited: false, allow_network: false, entrypoint: null };
    }
    const relative = command[1] && !String(command[1]).startsWith('-')
      ? auditedRepositoryFile(path.resolve(cwd, command[1]), AUDITED_BASH_ENTRYPOINTS) : null;
    return relative !== null
      ? { audited: true, allow_network: true, entrypoint: relative, executable: resolved }
      : { audited: false, allow_network: false, entrypoint: relative };
  }
  if (/^(?:npx|npx\.cmd)$/.test(executable)) {
    const expectedNpx = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npx.cmd' : 'npx');
    const resolved = resolvedExecutable(command[0], cwd);
    if (!resolved || !trustedExecutable(command[0], cwd, [expectedNpx])) {
      return { audited: false, allow_network: false, entrypoint: null };
    }
    const offset = ['--yes', '-y'].includes(command[1]) ? 2 : 1;
    const packageName = command[offset];
    return AUDITED_NPX_PACKAGES.has(packageName)
      ? { audited: true, allow_network: true, entrypoint: `npx:${packageName}`, executable: resolved }
      : { audited: false, allow_network: false, entrypoint: null };
  }
  return { audited: false, allow_network: false, entrypoint: null };
}

function boundedWrapperText(command, cwd) {
  const text = [command.join(' ')];
  for (const argument of command.slice(1, 5)) {
    const candidate = path.resolve(cwd, argument);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && stat.size <= 64 * 1024) text.push(fs.readFileSync(candidate, 'utf8'));
    } catch {}
  }
  const executable = path.basename(command[0] || '').toLowerCase();
  if (['npm', 'pnpm', 'yarn'].includes(executable) && command[1] === 'run' && command[2]) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
      text.push(String(packageJson.scripts?.[command[2]] || ''));
    } catch {}
  }
  return text.join('\n').replaceAll('\\', '/');
}

export function commandOwnership(command = [], cwd = process.cwd()) {
  const normalized = command.map((item) => String(item).replaceAll('\\', '/'));
  const executable = path.basename(normalized[0] || '').toLowerCase();
  const audit = auditedCommand(normalized, cwd);
  const ownershipText = boundedWrapperText(normalized, cwd)
    .replace(/\/[^\s'"`]*\/(?:docker|podman|containerd|crio)(?:\/[^\s'"`]*)?\.sock/g, ' [MASKED_CONTROL_SOCKET] ');
  const external = EXTERNAL_DAEMON_PROGRAMS.has(executable)
    || EXTERNAL_DAEMON_ENTRYPOINTS.some((entrypoint) =>
      normalized.some((argument) => argument.endsWith(entrypoint)))
    || EXTERNAL_TEXT.test(ownershipText);
  return {
    model: external ? 'external-daemon-unproven'
      : audit.audited ? 'audited-entrypoint-descendant-tree' : 'entrypoint-unproven',
    proven: !external && audit.audited,
    reason: external
      ? 'Docker/Harbor descendants are launched by an external daemon and are not proven members of the client scope.'
      : audit.audited ? null
        : 'command is not an explicitly audited safe-runner entrypoint; arbitrary wrappers are refused.',
    audited_entrypoint: audit.entrypoint,
    executable: audit.executable || null,
    network_access: audit.allow_network ? 'audited-required' : 'isolated',
  };
}

function deliberatelyTinySelfTest(mode, caseId, overrides, command) {
  if (mode !== 'self-test' || !SELF_TEST_CASE_IDS.includes(caseId)) return false;
  if (caseId === 'stale_process_record') return false;
  const normalized = command.map((item) => String(item).replaceAll('\\', '/'));
  if (path.resolve(normalized[0] || '') !== path.resolve(process.execPath)
    || !normalized[1]?.endsWith('/tests/fixtures/safe-runner-adversary.mjs')
    || !(Array.isArray(SELF_TEST_FIXTURE_MODES[caseId])
      ? SELF_TEST_FIXTURE_MODES[caseId].includes(normalized[2])
      : normalized[2] === SELF_TEST_FIXTURE_MODES[caseId])
    || normalized.length !== 3) return false;
  const required = Object.keys(SELF_TEST_LIMIT_MAXIMA);
  if (!required.every((key) => Number.isFinite(overrides[key]) && overrides[key] > 0)) return false;
  return required.every((key) => overrides[key] <= SELF_TEST_LIMIT_MAXIMA[key]);
}

function externalRuntimeContractReason(ownership, command, cwd) {
  if (['evals/scripts/run-suite.mjs', 'evals/scripts/run-reference-matrix.mjs']
    .includes(ownership.audited_entrypoint)) {
    return 'eval-suite requires the ignored .venv-eval runtime, which is not admitted into sealed execution authority; use the audited portable npx suite or provide a future bounded runtime contract';
  }
  if (ownership.audited_entrypoint !== 'benchmarks/retrieval-v1/benchmark.mjs'
    || (!command.includes('--evaluate') && !command.includes('--calibrate'))) return null;
  const workerIndex = command.indexOf('--worker');
  if (workerIndex < 0 || !command[workerIndex + 1]) {
    return 'retrieval evaluation requires --worker <repository worker executable>; uv/.venv execution is outside sealed execution authority';
  }
  const worker = path.resolve(cwd, command[workerIndex + 1]);
  const relative = path.relative(REPOSITORY_ROOT, worker);
  try {
    const stat = fs.lstatSync(worker);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)
      && stat.isFile() && !stat.isSymbolicLink()) {
      fs.accessSync(worker, fs.constants.X_OK);
      return null;
    }
  } catch {}
  return 'retrieval --worker must name a physical executable file inside the repository so it can be sealed';
}

export function preflightRun({
  tier,
  command = [],
  cwd,
  overrides = {},
  adapterInfo = adapterProbe(),
  mode = 'run',
  selfTestCaseId = null,
  injectedExistingProcesses = null,
  workloadId = null,
  promotionRequested = false,
} = {}) {
  const envelope = hostEnvelope({
    cwd,
    overrides,
    productionEnforcement: adapterInfo.production_enforcement === true,
  });
  const reasons = [];
  const production = PRODUCTION_TIERS.has(tier);
  const tinySelfTest = deliberatelyTinySelfTest(mode, selfTestCaseId, overrides, command);
  const portableTinySelfTest = tinySelfTest && PORTABLE_SELF_TEST_CASE_IDS.includes(selfTestCaseId);
  const ownership = commandOwnership(command, cwd);
  const externalRuntimeReason = externalRuntimeContractReason(ownership, command, cwd);
  const writableWorktree = adapterInfo.production_enforcement
    ? writableWorktreeProof(cwd) : { ok: true, cwd: path.resolve(cwd), worktree: null, reason: null };
  let sourceIdentityError = null;
  let sourceIdentity = null;
  let retry = tinySelfTest
    ? { ok: true, signature: null, previous: null }
    : { ok: false, signature: null, previous: null, unavailable: true };
  if (!tinySelfTest && ownership.proven) {
    try {
      const executionCommand = [ownership.executable, ...command.slice(1)];
      sourceIdentity = frozenWorkloadIdentity(cwd, executionCommand);
      retry = checkSafetyRetry(cwd, executionCommand, envelope.limits, sourceIdentity);
    }
    catch (error) { sourceIdentityError = error; }
  }
  if (!TIER_ORDER.includes(tier)) reasons.push(`tier must be one of ${TIER_ORDER.join(', ')}`);
  if (!Array.isArray(command) || command.length === 0) reasons.push('command must be a non-empty string array');
  const memoryReserve = portableTinySelfTest ? 128 * 1024 ** 2 : envelope.limits.os_reserve_bytes;
  const minimumDisk = portableTinySelfTest
    ? Math.max(64 * 1024 ** 2, envelope.limits.temporary_max_bytes * 2)
    : envelope.limits.minimum_free_disk_bytes;
  const requiredDisk = minimumDisk + (adapterInfo.production_enforcement
    ? DEFAULTS.executionAuthorityMaxBytes : 0);
  if (envelope.available_memory_bytes < envelope.limits.memory_max_bytes + memoryReserve) {
    reasons.push('available memory cannot preserve the mandatory 2 GiB OS/desktop reserve');
  }
  if (envelope.free_disk_bytes !== null
    && envelope.free_disk_bytes < requiredDisk) {
    reasons.push('free disk cannot cover payload temporary limits plus bounded execution authority');
  }
  if (envelope.temporary_free_disk_bytes !== null
    && envelope.temporary_free_disk_bytes < requiredDisk) {
    reasons.push('runner temporary filesystem cannot cover payload limits plus bounded execution authority');
  }
  if (!adapterInfo.production_enforcement && !portableTinySelfTest) {
    reasons.push(
      'aggregate enforcement is unavailable; only the built-in deliberately tiny self-test allowlist may use the portable adapter',
    );
  }
  if (production && !adapterInfo.production_enforcement) {
    reasons.push('medium/large execution requires Linux user-systemd cgroup-v2 aggregate enforcement');
  }
  if (!ownership.proven) reasons.push(ownership.reason);
  if (externalRuntimeReason) reasons.push(externalRuntimeReason);
  if (!writableWorktree.ok) reasons.push(writableWorktree.reason);
  if (sourceIdentityError) reasons.push(sourceIdentityError.message);
  if (!retry.ok && retry.previous) {
    reasons.push(
      `this command/workload source identity already hit ${retry.previous.limit}; change the implementation, workload, or concurrency model before retrying`,
    );
  }
  const existing = injectedExistingProcesses ?? existingLaminaProcesses();
  const attestation = readAttestation(adapterInfo);
  let promotion = { ok: !production, required: [], missing: [], completed: [] };
  if (ownership.proven && !sourceIdentityError) {
    try {
      const executionCommand = [ownership.executable, ...command.slice(1)];
      sourceIdentity ||= frozenWorkloadIdentity(cwd, executionCommand);
      promotion = checkPromotion(cwd, tier, workloadId, executionCommand, sourceIdentity);
    }
    catch (error) {
      sourceIdentityError = error;
      reasons.push(error.message);
    }
  }
  if (production && !attestation.valid) {
    reasons.push('medium/large execution requires a current passing adversarial self-test attestation');
  }
  if (production) promotion = { ...promotion, deferred_to_execution_snapshot: true };
  if (production && !workloadId) reasons.push('medium/large execution requires --workload <stable-id>');
  if (promotionRequested && !workloadId) reasons.push('--promote requires --workload <stable-id>');
  if (existing.length) {
    reasons.push(`existing Lamina processes must stop before launch: ${existing.map((item) => item.pid).join(', ')}`);
  }
  return {
    ok: reasons.length === 0,
    tier,
    cwd: path.resolve(cwd),
    inspected_at: new Date().toISOString(),
    mode,
    self_test_case_id: selfTestCaseId,
    deliberately_tiny_self_test: tinySelfTest,
    portable_self_test_allowed: portableTinySelfTest,
    adapter: adapterInfo,
    ownership,
    execution_command: ownership.proven ? [ownership.executable, ...command.slice(1)] : null,
    source_identity: sourceIdentity,
    writable_worktree: writableWorktree,
    retry,
    envelope,
    execution_authority_budget: {
      max_bytes: DEFAULTS.executionAuthorityMaxBytes,
      max_files: DEFAULTS.executionAuthorityMaxFiles,
      included_in_free_disk_preflight: adapterInfo.production_enforcement === true,
    },
    existing_lamina_processes: existing,
    attestation: {
      valid: attestation.valid,
      path: attestation.value ? 'present' : 'missing',
      tested_at: attestation.value?.tested_at || null,
      qualified_for_production_tiers: attestation.value?.qualified_for_production_tiers === true,
    },
    promotion,
    workload_id: workloadId,
    reasons,
  };
}
