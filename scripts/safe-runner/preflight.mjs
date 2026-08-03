import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CASE_DISCOVERY_WORKLOAD_ID,
  DEFAULTS,
  GENERIC_TEMPORARY_MAX_INODES,
  PRODUCTION_TIERS,
  PORTABLE_SELF_TEST_CASE_IDS,
  retainedOutputTailBytes,
  SELF_TEST_CASE_IDS,
  SELF_TEST_FIXTURE_MODES,
  SELF_TEST_LIMIT_MAXIMA,
  SCENARIO_VERIFICATION_WORKLOAD_ID,
  SCENARIO_VERIFICATION_LARGE_TEMPORARY_INODE_RESERVATION,
  temporaryMaxInodesForBytes,
  TIER_ORDER,
  validateScenarioVerificationLargeInodeReservation,
} from './constants.mjs';
import {
  ORACLE_HOST_LAUNCH_PROFILE,
  ORACLE_HOST_PROBE_COMMAND,
  ORACLE_HOST_PROBE_WORKLOAD_ID,
  oracleHostProbeLimits,
} from './oracle-host-profile.mjs';
import { adapterProbe } from './adapter.mjs';
import { hostEnvelope } from './envelope.mjs';
import { existingLaminaProcesses } from './processes.mjs';
import { spawnTrustedGit } from './git.mjs';
import { optionalAuditedNpxCommand } from './npx-authority.mjs';
import { repositoryOutputRefusal } from './output-policy.mjs';
import { retrievalQualificationAuthority } from './retrieval-authority.mjs';
import {
  assertScenario as assertRuntimeBaselineScenario,
  fixtureById as runtimeBaselineFixtureById,
  loadManifest as loadRuntimeBaselineManifest,
} from '../../benchmarks/runtime-baseline-v1/contract.mjs';
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
export const RUNTIME_BASELINE_ENTRYPOINT = 'benchmarks/runtime-baseline-v1/workload.mjs';
export const REAL_REPOSITORY_ORACLE_ENTRYPOINT = 'benchmarks/real-repository-oracle-v1/workload.mjs';
export const REAL_REPOSITORY_ORACLE_WORKLOAD_ID = 'real-repository-oracle-v1:inventory-admission';
export const REAL_REPOSITORY_ORACLE_RECONSTRUCTION_WORKLOAD_ID = 'real-repository-oracle-v1:inventory-reconstruction';
export const REAL_REPOSITORY_ORACLE_REVIEW_WORKLOAD_ID = 'real-repository-oracle-v1:inventory-review';
export const REAL_REPOSITORY_ORACLE_DISCOVERY_WORKLOAD_ID = CASE_DISCOVERY_WORKLOAD_ID;
export const REAL_REPOSITORY_ORACLE_EVIDENCE_WORKLOAD_ID = 'real-repository-oracle-v1:evidence-expansion';
export const REAL_REPOSITORY_ORACLE_SCENARIO_VERIFICATION_WORKLOAD_ID = SCENARIO_VERIFICATION_WORKLOAD_ID;
export const REAL_REPOSITORY_ORACLE_HOST_PROBE_WORKLOAD_ID = ORACLE_HOST_PROBE_WORKLOAD_ID;

const AUDITED_NODE_ENTRYPOINTS = new Map([
  ['benchmarks/retrieval-v1/benchmark.mjs', false],
  [REAL_REPOSITORY_ORACLE_ENTRYPOINT, true],
  [RUNTIME_BASELINE_ENTRYPOINT, true],
  ['benchmarks/runtime-v1/fixture/tiny-runtime.mjs', false],
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
  ['tests/runtime_benchmark_test.mjs', false],
  ['tests/cli_binary_smoke_test.mjs', false],
  ['tests/fixtures/safe-runner-adversary.mjs', false],
  ['tests/fixtures/safe-runner-graphd-client.mjs', false],
  ['tests/fixtures/safe-runner-mutable.mjs', false],
]);
const AUDITED_BASH_ENTRYPOINTS = new Set(['evals/hooks/compatibility-matrix.sh']);
const SMALL_ONLY_SCRATCH_FIXTURES = new Set([
  'benchmarks/runtime-v1/fixture/tiny-runtime.mjs',
  'tests/runtime_benchmark_test.mjs',
  'tests/fixtures/safe-runner-graphd-client.mjs',
  'tests/fixtures/safe-runner-mutable.mjs',
]);
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
  let git = { status: null, stdout: '' };
  let gitConfigError = null;
  try {
    git = spawnTrustedGit(resolved, ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_000,
      maxBuffer: 64 * 1024,
    });
  } catch (error) { gitConfigError = error; }
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
      : gitConfigError ? `writable cwd has unsafe Git authority: ${gitConfigError.message}`
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

function ignoredRuntimeBaselineInput(argument, expected, { executable = false } = {}) {
  const declared = path.resolve(REPOSITORY_ROOT, String(argument || ''));
  const relative = path.relative(REPOSITORY_ROOT, declared).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) return false;
  try {
    const physical = fs.realpathSync.native(declared);
    const stat = fs.lstatSync(declared);
    if (physical !== declared || !stat.isFile() || stat.isSymbolicLink()
      || stat.size !== expected.bytes
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      || (executable && (stat.mode & 0o111) === 0)) return false;
    const ignored = spawnTrustedGit(REPOSITORY_ROOT, ['check-ignore', '--quiet', '--', relative], {
      encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'], timeout: 2_000,
      maxBuffer: 8 * 1024,
    });
    return ignored.status === 0;
  } catch { return false; }
}

export function auditedRuntimeBaselineCommand(command = [], cwd = process.cwd()) {
  if (command.length !== 7 || command[2] !== 'run') return false;
  try {
    runtimeBaselineFixtureById(command[3]);
    assertRuntimeBaselineScenario(command[4]);
    const { manifest } = loadRuntimeBaselineManifest();
    return ignoredRuntimeBaselineInput(path.resolve(cwd, command[5]), manifest.runtime_assets.model)
      && ignoredRuntimeBaselineInput(path.resolve(cwd, command[6]),
        manifest.runtime_assets.worker_linux_x64, { executable: true });
  } catch { return false; }
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
    if (relative === RUNTIME_BASELINE_ENTRYPOINT
      && !auditedRuntimeBaselineCommand(command, cwd)) {
      return { audited: false, allow_network: false, entrypoint: relative };
    }
    if (relative === REAL_REPOSITORY_ORACLE_ENTRYPOINT
      && (command.length !== 3
        || !['admit-inventory', 'reconstruct-inventory', 'review-inventory', 'discover-cases', 'expand-evidence', 'verify-scenarios', ORACLE_HOST_PROBE_COMMAND]
          .includes(command[2]))) {
      return { audited: false, allow_network: false, entrypoint: relative };
    }
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
    const contract = optionalAuditedNpxCommand(REPOSITORY_ROOT, command, cwd);
    return contract
      ? { audited: true, allow_network: true, entrypoint: `npx:${contract.package_name}`,
        executable: resolved, npx_authority: contract }
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
    npx_authority: audit.npx_authority || null,
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
  const needsRuntimeThreadHeadroom = [
    'aggregate_child_memory_limit', 'detached_descendant',
  ].includes(caseId);
  return required.every((key) => overrides[key] <= (needsRuntimeThreadHeadroom
    && key === 'pidsMax' ? DEFAULTS.pidsMax : SELF_TEST_LIMIT_MAXIMA[key]));
}

function externalRuntimeContract(ownership, command, cwd) {
  if (ownership.npx_authority?.launch_admitted === false) {
    return { reason: ownership.npx_authority.launch_refusal, retrieval_authority: null };
  }
  const repositoryOutputReason = repositoryOutputRefusal(ownership.audited_entrypoint);
  if (repositoryOutputReason) return { reason: repositoryOutputReason, retrieval_authority: null };
  if (ownership.audited_entrypoint !== 'benchmarks/retrieval-v1/benchmark.mjs') {
    return { reason: null, retrieval_authority: null };
  }
  try {
    return {
      reason: null,
      retrieval_authority: retrievalQualificationAuthority({
        repository: REPOSITORY_ROOT, cwd, command,
      }),
    };
  } catch (error) {
    return { reason: error.message, retrieval_authority: null };
  }
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
  const exactRealRepositoryEntrypoint = ownership.audited_entrypoint
    === REAL_REPOSITORY_ORACLE_ENTRYPOINT && command.length === 3;
  const exactScenarioVerification = exactRealRepositoryEntrypoint
    && command[2] === 'verify-scenarios'
    && workloadId === REAL_REPOSITORY_ORACLE_SCENARIO_VERIFICATION_WORKLOAD_ID;
  const exactOracleHostProbe = exactRealRepositoryEntrypoint
    && command[2] === ORACLE_HOST_PROBE_COMMAND
    && workloadId === REAL_REPOSITORY_ORACLE_HOST_PROBE_WORKLOAD_ID;
  const exactRealRepositoryStructuredOutput = exactRealRepositoryEntrypoint
    && ((command[2] === 'discover-cases'
      && workloadId === REAL_REPOSITORY_ORACLE_DISCOVERY_WORKLOAD_ID)
      || exactScenarioVerification);
  const structuredOutputWorkloadId = exactRealRepositoryStructuredOutput ? workloadId : null;
  const temporaryInodeReservation = exactScenarioVerification && tier === 'large'
    ? SCENARIO_VERIFICATION_LARGE_TEMPORARY_INODE_RESERVATION : null;
  const temporaryInodeReservationValidation = temporaryInodeReservation
    ? validateScenarioVerificationLargeInodeReservation(temporaryInodeReservation) : null;
  const temporaryInodeCeiling = temporaryInodeReservation
    ? Math.min(temporaryInodeReservation.requested_max_inodes,
      temporaryInodeReservation.hard_ceiling)
    : GENERIC_TEMPORARY_MAX_INODES;
  envelope.limits = {
    ...envelope.limits,
    temporary_max_inodes: temporaryMaxInodesForBytes(
      envelope.limits.temporary_max_bytes, temporaryInodeCeiling,
    ),
    stdout_tail_max_bytes: retainedOutputTailBytes(structuredOutputWorkloadId, 'stdout'),
    stderr_tail_max_bytes: retainedOutputTailBytes(structuredOutputWorkloadId, 'stderr'),
  };
  const exactOracleHostProfile = exactOracleHostProbe && tier === 'small'
    && oracleHostProbeLimits(envelope.limits);
  const runtimeContract = externalRuntimeContract(ownership, command, cwd);
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
  if (temporaryInodeReservationValidation?.valid === false) {
    reasons.push('large scenario verification temporary inode geometry exceeds its hard ceiling');
  } else if (temporaryInodeReservationValidation
    && envelope.limits.temporary_max_inodes
      < temporaryInodeReservationValidation.required_inodes) {
    reasons.push('large scenario verification temporary inode geometry exceeds its effective reservation');
  }
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
  if (runtimeContract.reason) reasons.push(runtimeContract.reason);
  if (SMALL_ONLY_SCRATCH_FIXTURES.has(ownership.audited_entrypoint) && tier !== 'small') {
    reasons.push('safe-runner scratch fixtures are deliberately tiny and require --tier small');
  }
  if (ownership.audited_entrypoint === REAL_REPOSITORY_ORACLE_ENTRYPOINT) {
    const expectedWorkloadId = command[2] === 'reconstruct-inventory'
      ? REAL_REPOSITORY_ORACLE_RECONSTRUCTION_WORKLOAD_ID
      : command[2] === 'review-inventory' ? REAL_REPOSITORY_ORACLE_REVIEW_WORKLOAD_ID
      : command[2] === 'discover-cases' ? REAL_REPOSITORY_ORACLE_DISCOVERY_WORKLOAD_ID
      : command[2] === 'expand-evidence' ? REAL_REPOSITORY_ORACLE_EVIDENCE_WORKLOAD_ID
      : command[2] === 'verify-scenarios' ? REAL_REPOSITORY_ORACLE_SCENARIO_VERIFICATION_WORKLOAD_ID
      : command[2] === ORACLE_HOST_PROBE_COMMAND ? REAL_REPOSITORY_ORACLE_HOST_PROBE_WORKLOAD_ID
      : command[2] === 'admit-inventory' ? REAL_REPOSITORY_ORACLE_WORKLOAD_ID : null;
    if (expectedWorkloadId && workloadId !== expectedWorkloadId) {
      const operation = command[2] === 'reconstruct-inventory'
        ? 'inventory reconstruction' : command[2] === 'review-inventory'
          ? 'independent inventory review' : command[2] === 'discover-cases'
            ? 'case discovery' : command[2] === 'expand-evidence'
              ? 'evidence expansion' : command[2] === 'verify-scenarios'
                ? 'scenario verification' : command[2] === ORACLE_HOST_PROBE_COMMAND
                  ? 'oracle-host probe' : 'inventory admission';
      reasons.push(`real-repository ${operation} requires --workload ${expectedWorkloadId}`);
    }
  }
  if (command[2] === ORACLE_HOST_PROBE_COMMAND
    && !exactOracleHostProfile) {
    reasons.push('oracle-host probe requires its exact workload id, small tier, and tiny bounded limits');
  }
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
    retrieval_authority: runtimeContract.retrieval_authority,
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
      path: attestation.qualification_available === false
        ? 'unavailable' : attestation.value ? 'present' : 'missing',
      tested_at: attestation.value?.tested_at || null,
      qualified_for_production_tiers: attestation.value?.qualified_for_production_tiers === true,
      qualification_available: attestation.qualification_available !== false,
      reason: attestation.reason || null,
    },
    promotion,
    workload_id: workloadId,
    launch_profile: exactOracleHostProfile ? ORACLE_HOST_LAUNCH_PROFILE : null,
    temporary_inode_reservation: temporaryInodeReservation,
    reasons,
  };
}
