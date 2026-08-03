import fs from 'node:fs';
import path from 'node:path';
import { SCENARIOS, sha256, WORKLOAD_SCHEMA } from './contract.mjs';
import { workloadRecordFromReport } from './validate.mjs';
import {
  ATTRIBUTION_SCHEMA,
  LIFECYCLE_PHASES,
  SCENARIO_PHASE_IDS,
  classifyProcessRole,
  scenarioPhaseIds,
} from './attribution-contract.mjs';

export {
  ATTRIBUTION_SCHEMA,
  LIFECYCLE_PHASES,
  SCENARIO_PHASE_IDS,
  classifyProcessRole,
  compactProductAttribution,
  createPhaseTracker,
  sampleDescendantPeaks,
  scenarioPhaseIds,
} from './attribution-contract.mjs';

const ROLE_ALIASES = Object.freeze({
  graphd: 'graphd_startup',
  asset_extraction_worker: 'cocoindex_worker',
  observation_worker: 'cocoindex_worker',
  retrieval_worker: 'cocoindex_worker',
  onnx_embedder: 'onnx_embedder',
  cli: 'cli',
});

function summarizeSafeRunnerDescendants(descendants = []) {
  const byRole = {};
  for (const item of descendants) {
    const role = classifyProcessRole(item.command || '');
    const bucket = byRole[role] || (byRole[role] = {
      processes: 0,
      peak_threads: 0,
      peak_rss_bytes: 0,
      first_seen_ms: null,
      last_seen_ms: null,
    });
    bucket.processes += 1;
    bucket.peak_threads = Math.max(bucket.peak_threads, item.peak_threads || 0);
    bucket.peak_rss_bytes = Math.max(bucket.peak_rss_bytes, item.peak_rss_bytes || 0);
    bucket.first_seen_ms = bucket.first_seen_ms === null
      ? item.first_seen_ms : Math.min(bucket.first_seen_ms, item.first_seen_ms);
    bucket.last_seen_ms = bucket.last_seen_ms === null
      ? item.last_seen_ms : Math.max(bucket.last_seen_ms, item.last_seen_ms);
  }
  return byRole;
}

function dominantCostLabel(role, metrics) {
  const alias = ROLE_ALIASES[role] || role;
  if (alias === 'graphd_startup' || role === 'graphd') return 'graphd startup';
  if (alias === 'cocoindex_worker') return 'CocoIndex worker';
  if (alias === 'onnx_embedder') return 'ONNX embedder';
  if (alias === 'cli') return 'CLI dispatch';
  if (metrics?.peak_threads >= 8) return `${alias} thread fan-out`;
  return alias;
}

export function analyzeDominantCosts(scenarioEntries = []) {
  const totals = {};
  const refusal = [];
  for (const entry of scenarioEntries) {
    const peaks = entry.safe_runner?.descendants_by_role || {};
    for (const [role, metrics] of Object.entries(peaks)) {
      const label = dominantCostLabel(role, metrics);
      const bucket = totals[label] || (totals[label] = {
        label,
        peak_threads: 0,
        peak_rss_bytes: 0,
        scenarios: new Set(),
      });
      bucket.peak_threads = Math.max(bucket.peak_threads, metrics.peak_threads || 0);
      bucket.peak_rss_bytes = Math.max(bucket.peak_rss_bytes, metrics.peak_rss_bytes || 0);
      bucket.scenarios.add(entry.scenario);
    }
    if (entry.status === 'refused' || entry.status === 'invalid') {
      refusal.push({
        scenario: entry.scenario,
        outcome: entry.safe_runner?.outcome || null,
        limit: entry.safe_runner?.limit || null,
        peak_pids: entry.safe_runner?.peak_pids ?? null,
        peak_memory_bytes: entry.safe_runner?.peak_memory_bytes ?? null,
        dominant_roles: Object.entries(peaks)
          .sort((left, right) => (right[1].peak_threads || 0) - (left[1].peak_threads || 0))
          .slice(0, 4)
          .map(([role, metrics]) => ({ role, peak_threads: metrics.peak_threads || 0 })),
      });
    }
  }
  const ranked = Object.values(totals)
    .map((item) => ({
      label: item.label,
      peak_threads: item.peak_threads,
      peak_rss_bytes: item.peak_rss_bytes,
      scenarios: [...item.scenarios].sort(),
    }))
    .sort((left, right) => right.peak_threads - left.peak_threads || right.peak_rss_bytes - left.peak_rss_bytes);
  return { ranked, refusal_envelopes: refusal };
}

export function scenarioAttributionFromResult(result, artifactRoot) {
  const lastRun = result?.runs?.at(-1) || null;
  let rawReport = null;
  if (lastRun?.raw_report) {
    try {
      rawReport = JSON.parse(fs.readFileSync(path.resolve(artifactRoot, lastRun.raw_report), 'utf8'));
    } catch {}
  }
  const workload = result?.workload;
  const workloadAttribution = workload?.attribution || null;
  const safeRunner = rawReport ? {
    outcome: rawReport.outcome,
    limit: rawReport.termination?.limit || null,
    duration_ms: rawReport.duration_ms,
    peak_pids: rawReport.peaks?.pids ?? null,
    peak_memory_bytes: rawReport.peaks?.cgroup_memory_bytes ?? null,
    descendants_by_role: summarizeSafeRunnerDescendants(rawReport.descendants),
    descendant_count: rawReport.descendants?.length || 0,
  } : {
    outcome: lastRun?.outcome || null,
    limit: lastRun?.limit || null,
    duration_ms: lastRun?.duration_ms ?? null,
    peak_pids: lastRun?.peak_pids ?? null,
    peak_memory_bytes: lastRun?.peak_memory_bytes ?? null,
    descendants_by_role: {},
    descendant_count: 0,
  };
  const product = Array.isArray(workload?.diagnostics)
    ? workload.diagnostics.map((item) => item?.product_attribution).find(Boolean)
    : workload?.diagnostics?.product_attribution || null;
  return {
    scenario: result.scenario,
    status: result.status,
    phase_ids: workloadAttribution?.phase_ids || scenarioPhaseIds(result.scenario),
    phase_time_ns: workloadAttribution?.phase_time_ns || null,
    subprocess_launches: workloadAttribution?.subprocess_launches || null,
    descendant_peaks_by_phase: workloadAttribution?.descendant_peaks_by_phase || null,
    product,
    safe_runner: safeRunner,
  };
}

export function buildAttributionReport({
  fixture,
  laminaCommit,
  host,
  scenarioResults,
  artifactRoot,
  generatedAt = new Date().toISOString(),
}) {
  const scenarios = scenarioResults.map((result) => scenarioAttributionFromResult(result, artifactRoot));
  const dominant = analyzeDominantCosts(scenarios);
  return {
    schema: ATTRIBUTION_SCHEMA,
    generated_at: generatedAt,
    fixture: {
      id: fixture.id,
      commit: fixture.commit,
      url: fixture.url,
    },
    lamina_commit: laminaCommit,
    host,
    lifecycle_phases: LIFECYCLE_PHASES,
    scenario_phase_map: SCENARIO_PHASE_IDS,
    scenarios,
    dominant_costs: dominant.ranked,
    refusal_envelopes: dominant.refusal_envelopes,
    limitations: [
      'Descendant peaks are sampled per lifecycle phase inside the workload and aggregated across the safe-runner report.',
      'Thread counts are sampled diagnostics, not simultaneous guarantees.',
      'PID-limit refusals report envelope peaks only; they are not valid latency measurements.',
    ],
  };
}

export function loadScenarioResults(outputRoot) {
  const root = path.resolve(outputRoot);
  const indexFile = path.join(root, 'index.json');
  const fixtureId = fs.existsSync(indexFile)
    ? JSON.parse(fs.readFileSync(indexFile, 'utf8')).fixture
    : null;
  const results = [];
  for (const scenario of SCENARIOS) {
    const resultFile = path.join(root, `${fixtureId || 'small'}-${scenario}.json`);
    if (!fs.existsSync(resultFile)) break;
    results.push(JSON.parse(fs.readFileSync(resultFile, 'utf8')));
  }
  return results;
}

export function writeAttributionReport(report, destination, { overwrite = false } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, bytes, { flag: overwrite ? 'w' : 'wx', mode: 0o600 });
  return { path: destination, sha256: sha256(bytes) };
}

export function attributionFromSafeRunnerReport(report) {
  const workload = workloadRecordFromReport(report);
  return {
    workload_schema: workload?.schema === WORKLOAD_SCHEMA ? WORKLOAD_SCHEMA : null,
    workload_attribution: workload?.attribution || null,
    descendants_by_role: summarizeSafeRunnerDescendants(report?.descendants),
  };
}
