import fs from 'node:fs';
import path from 'node:path';
import {
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
import { checkPromotion, checkSafetyRetry, readAttestation } from './state.mjs';

const EXTERNAL_DAEMON_PROGRAMS = new Set(['docker', 'podman', 'harbor']);
const EXTERNAL_DAEMON_ENTRYPOINTS = [
  'benchmarks/lb6/pilot/scripts/run-three-arm.mjs',
  'benchmarks/lb6/pilot/scripts/build-runtime.mjs',
];

const EXTERNAL_TEXT = /(?:^|[\s;&|/"'])(?:docker|podman|harbor)(?=$|[\s;&|/"'])/i;

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
  const external = EXTERNAL_DAEMON_PROGRAMS.has(executable)
    || EXTERNAL_TEXT.test(boundedWrapperText(normalized, cwd))
    || EXTERNAL_DAEMON_ENTRYPOINTS.some((entrypoint) =>
      normalized.some((argument) => argument.endsWith(entrypoint)));
  return {
    model: external ? 'external-daemon-unproven' : 'adapter-descendant-tree',
    proven: !external,
    reason: external
      ? 'Docker/Harbor descendants are launched by an external daemon and are not proven members of the client scope.'
      : null,
  };
}

function deliberatelyTinySelfTest(mode, caseId, overrides, command) {
  if (mode !== 'self-test' || !SELF_TEST_CASE_IDS.includes(caseId)) return false;
  if (caseId === 'stale_process_record') return false;
  const normalized = command.map((item) => String(item).replaceAll('\\', '/'));
  if (path.resolve(normalized[0] || '') !== path.resolve(process.execPath)
    || !normalized[1]?.endsWith('/tests/fixtures/safe-runner-adversary.mjs')
    || normalized[2] !== SELF_TEST_FIXTURE_MODES[caseId]
    || normalized.length !== 3) return false;
  const required = Object.keys(SELF_TEST_LIMIT_MAXIMA);
  if (!required.every((key) => Number.isFinite(overrides[key]) && overrides[key] > 0)) return false;
  return required.every((key) => overrides[key] <= SELF_TEST_LIMIT_MAXIMA[key]);
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
} = {}) {
  const envelope = hostEnvelope({ cwd, overrides });
  const reasons = [];
  const production = PRODUCTION_TIERS.has(tier);
  const tinySelfTest = deliberatelyTinySelfTest(mode, selfTestCaseId, overrides, command);
  const portableTinySelfTest = tinySelfTest && PORTABLE_SELF_TEST_CASE_IDS.includes(selfTestCaseId);
  const ownership = commandOwnership(command, cwd);
  const retry = mode === 'self-test'
    ? { ok: true, signature: null, previous: null }
    : checkSafetyRetry(cwd, command, envelope.limits);
  if (!TIER_ORDER.includes(tier)) reasons.push(`tier must be one of ${TIER_ORDER.join(', ')}`);
  if (!Array.isArray(command) || command.length === 0) reasons.push('command must be a non-empty string array');
  const memoryReserve = portableTinySelfTest ? 128 * 1024 ** 2 : envelope.limits.os_reserve_bytes;
  const minimumDisk = portableTinySelfTest
    ? Math.max(64 * 1024 ** 2, envelope.limits.temporary_max_bytes * 2)
    : envelope.limits.minimum_free_disk_bytes;
  if (envelope.available_memory_bytes < envelope.limits.memory_max_bytes + memoryReserve) {
    reasons.push('available memory cannot preserve the mandatory 2 GiB OS/desktop reserve');
  }
  if (envelope.free_disk_bytes !== null
    && envelope.free_disk_bytes < minimumDisk) {
    reasons.push('free disk is below max(5 GiB, twice the declared temporary budget)');
  }
  if (envelope.temporary_free_disk_bytes !== null
    && envelope.temporary_free_disk_bytes < minimumDisk) {
    reasons.push('runner temporary filesystem is below max(5 GiB, twice the declared temporary budget)');
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
  if (!retry.ok) {
    reasons.push(
      `an identical command/workload/limit configuration already hit ${retry.previous.limit}; change the implementation, workload, or limits before retrying`,
    );
  }
  const existing = injectedExistingProcesses ?? existingLaminaProcesses();
  const attestation = readAttestation(adapterInfo);
  const promotion = checkPromotion(cwd, tier, workloadId);
  if (production && !attestation.valid) {
    reasons.push('medium/large execution requires a current passing adversarial self-test attestation');
  }
  if (production && !promotion.ok) {
    reasons.push(`tier promotion requires successful cleanup for: ${promotion.missing.join(', ')}`);
  }
  if (production && !workloadId) reasons.push('medium/large execution requires --workload <stable-id>');
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
    retry,
    envelope,
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
