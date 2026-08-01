import path from 'node:path';
import {
  PRODUCTION_TIERS,
  SELF_TEST_CASE_IDS,
  SELF_TEST_FIXTURE_MODES,
  SELF_TEST_LIMIT_MAXIMA,
  TIER_ORDER,
} from './constants.mjs';
import { adapterProbe } from './adapter.mjs';
import { hostEnvelope } from './envelope.mjs';
import { existingLaminaProcesses } from './processes.mjs';
import { checkPromotion, readAttestation } from './state.mjs';

const EXTERNAL_DAEMON_PROGRAMS = new Set(['docker', 'podman', 'harbor']);
const EXTERNAL_DAEMON_ENTRYPOINTS = [
  'benchmarks/lb6/pilot/scripts/run-three-arm.mjs',
  'benchmarks/lb6/pilot/scripts/build-runtime.mjs',
];

export function commandOwnership(command = []) {
  const normalized = command.map((item) => String(item).replaceAll('\\', '/'));
  const executable = path.basename(normalized[0] || '').toLowerCase();
  const external = EXTERNAL_DAEMON_PROGRAMS.has(executable)
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
} = {}) {
  const envelope = hostEnvelope({ cwd, overrides });
  const reasons = [];
  const production = PRODUCTION_TIERS.has(tier);
  const tinySelfTest = deliberatelyTinySelfTest(mode, selfTestCaseId, overrides, command);
  const ownership = commandOwnership(command);
  if (!TIER_ORDER.includes(tier)) reasons.push(`tier must be one of ${TIER_ORDER.join(', ')}`);
  if (!Array.isArray(command) || command.length === 0) reasons.push('command must be a non-empty string array');
  if (envelope.available_memory_bytes < envelope.limits.memory_max_bytes + envelope.limits.os_reserve_bytes) {
    reasons.push('available memory cannot preserve the mandatory 2 GiB OS/desktop reserve');
  }
  if (envelope.free_disk_bytes !== null
    && envelope.free_disk_bytes < envelope.limits.minimum_free_disk_bytes) {
    reasons.push('free disk is below max(5 GiB, twice the declared temporary budget)');
  }
  if (!adapterInfo.production_enforcement && !tinySelfTest) {
    reasons.push(
      'aggregate enforcement is unavailable; only the built-in deliberately tiny self-test allowlist may use the portable adapter',
    );
  }
  if (production && !adapterInfo.production_enforcement) {
    reasons.push('medium/large execution requires Linux user-systemd cgroup-v2 aggregate enforcement');
  }
  if (production && !ownership.proven) reasons.push(ownership.reason);
  const existing = injectedExistingProcesses ?? existingLaminaProcesses();
  const attestation = readAttestation(adapterInfo);
  const promotion = checkPromotion(cwd, tier);
  if (production && !attestation.valid) {
    reasons.push('medium/large execution requires a current passing adversarial self-test attestation');
  }
  if (production && !promotion.ok) {
    reasons.push(`tier promotion requires successful cleanup for: ${promotion.missing.join(', ')}`);
  }
  if (production && existing.length) {
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
    adapter: adapterInfo,
    ownership,
    envelope,
    existing_lamina_processes: existing,
    attestation: {
      valid: attestation.valid,
      path: attestation.value ? 'present' : 'missing',
      tested_at: attestation.value?.tested_at || null,
      qualified_for_production_tiers: attestation.value?.qualified_for_production_tiers === true,
    },
    promotion,
    reasons,
  };
}
