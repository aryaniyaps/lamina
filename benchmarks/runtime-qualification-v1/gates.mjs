import { MAX_INSTALL_FOOTPRINT_BYTES } from '../../packages/cli/lib/runtime-lifecycle.mjs';
import {
  latencyGate, loadManifest, nsToMs, profileById,
} from './contract.mjs';

const NS_PER_S = 1_000_000_000;

function gateResult(id, pass, { measured = null, threshold = null, note = null } = {}) {
  return {
    id,
    pass,
    measured,
    threshold,
    note,
  };
}

function peakFromRuns(runs) {
  if (!Array.isArray(runs) || !runs.length) return null;
  return Math.max(...runs.map((run) => run.peak_memory_bytes || 0));
}

function peakPidsFromRuns(runs) {
  if (!Array.isArray(runs) || !runs.length) return null;
  return Math.max(...runs.map((run) => run.peak_pids || 0));
}

function scenarioResult(index, scenario) {
  return index?.scenario_results?.find((item) => item.scenario === scenario) || null;
}

function workloadStatistics(result) {
  return result?.workload?.statistics || null;
}

function idleRssMedian(result) {
  const samples = result?.workload?.samples;
  if (!Array.isArray(samples) || !samples.length) return null;
  const values = samples.map((sample) => sample.rss_bytes).filter(Number.isFinite);
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function evaluateScenarioGates({ manifest, profileId, fixtureId, scenarioResults }) {
  const profile = profileById(profileId);
  const gates = [];
  const byScenario = new Map(scenarioResults.map((item) => [item.scenario, item]));

  for (const result of scenarioResults) {
    if (result.status !== 'valid') {
      gates.push(gateResult(`${fixtureId}.${result.scenario}.complete`, false, {
        measured: result.status,
        threshold: 'valid',
        note: 'Scenario must complete without safety refusal or invalid evidence',
      }));
      continue;
    }
    gates.push(gateResult(`${fixtureId}.${result.scenario}.complete`, true, {
      measured: 'valid',
      threshold: 'valid',
    }));

    const peak = peakFromRuns(result.runs);
    if (peak !== null) {
      gates.push(gateResult(`${fixtureId}.${result.scenario}.peak_rss`, peak <= profile.peak_rss_max_bytes, {
        measured: peak,
        threshold: profile.peak_rss_max_bytes,
      }));
    }

    const peakPids = peakPidsFromRuns(result.runs);
    if (peakPids !== null) {
      gates.push(gateResult(`${fixtureId}.${result.scenario}.no_pid_refusal`, true, {
        measured: peakPids,
        threshold: 64,
        note: 'Measured peak tasks; refusal would have produced invalid status',
      }));
    }

    const orphans = result.runs?.some((run) => run.remaining_descendants > 0
      || run.remaining_managed_paths > 0);
    gates.push(gateResult(`${fixtureId}.${result.scenario}.no_orphans`, !orphans, {
      measured: orphans ? 'leaked' : 'clean',
      threshold: 'clean',
    }));
  }

  const doctor = byScenario.get('doctor-status-startup');
  if (doctor?.status === 'valid') {
    const median = doctor.workload?.statistics?.median;
    const threshold = latencyGate(manifest, 'doctor_status_warm_p95_max', fixtureId);
    gates.push(gateResult(`${fixtureId}.doctor-status-startup.cold_median`, median <= threshold, {
      measured: median,
      threshold,
      note: 'Cold doctor/status median used as presubmit proxy; warm p95 requires 30-sample series',
    }));
  }

  const warm = byScenario.get('warm-preparation');
  if (warm?.status === 'valid') {
    const p95 = warm.workload?.statistics?.p95;
    const threshold = latencyGate(manifest, 'warm_preparation_p95_max', fixtureId);
    gates.push(gateResult(`${fixtureId}.warm-preparation.p95`, p95 <= threshold, {
      measured: p95,
      threshold,
    }));
  }

  const noop = byScenario.get('noop-synchronization');
  if (noop?.status === 'valid') {
    const p95 = noop.workload?.statistics?.p95;
    const threshold = latencyGate(manifest, 'noop_sync_p95_max', fixtureId);
    gates.push(gateResult(`${fixtureId}.noop-synchronization.p95`, p95 <= threshold, {
      measured: p95,
      threshold,
    }));
  }

  for (const scenario of ['one-file-change', 'multi-file-change']) {
    const item = byScenario.get(scenario);
    if (item?.status === 'valid') {
      const median = item.workload?.samples?.[0]?.wall_time_ns
        ?? item.workload?.statistics?.median;
      const threshold = latencyGate(manifest, 'incremental_queryable_max', fixtureId);
      gates.push(gateResult(`${fixtureId}.${scenario}.incremental`, median <= threshold, {
        measured: median,
        threshold,
      }));
    }
  }

  const firstPrep = byScenario.get('first-useful-preparation');
  if (firstPrep?.status === 'valid') {
    const median = firstPrep.workload?.samples?.[0]?.wall_time_ns
      ?? firstPrep.workload?.statistics?.median;
    const threshold = latencyGate(manifest, 'cold_first_preparation_max', fixtureId);
    gates.push(gateResult(`${fixtureId}.first-useful-preparation.cold`, median <= threshold, {
      measured: median,
      threshold,
    }));
  }

  const idle = byScenario.get('post-command-idle-rss');
  if (idle?.status === 'valid') {
    const median = idleRssMedian(idle);
    gates.push(gateResult(`${fixtureId}.post-command-idle-rss.median`, median <= profile.idle_rss_max_bytes, {
      measured: median,
      threshold: profile.idle_rss_max_bytes,
    }));
  }

  const footprint = byScenario.get('footprint');
  if (footprint?.status === 'valid') {
    const prepared = footprint.workload?.diagnostics?.prepared_assets?.bytes || 0;
    const sealedModel = footprint.workload?.diagnostics?.sealed_model?.bytes || 0;
    const sealedWorker = footprint.workload?.diagnostics?.sealed_worker?.bytes || 0;
    const measured = prepared + sealedModel + sealedWorker;
    gates.push(gateResult(`${fixtureId}.footprint.prepared_assets`, measured <= manifest.resource_gates.install_max_bytes, {
      measured,
      threshold: manifest.resource_gates.install_max_bytes,
      note: 'Prepared runtime assets from baseline footprint scenario; release install gate uses linux-install-footprint',
    }));
  }

  return gates;
}

export function evaluateOracleGates({ manifest, oracleResults }) {
  return manifest.oracle_suites.map((suite) => {
    const result = oracleResults.find((item) => item.id === suite.id);
    return gateResult(`oracle.${suite.id}`, result?.exit_code === 0, {
      measured: result?.exit_code ?? null,
      threshold: 0,
      note: result?.skipped ? result.reason : suite.command,
    });
  });
}

export function evaluateQualificationIndex(index) {
  const { manifest } = loadManifest();
  const gates = [];
  for (const cell of index.cells || []) {
    gates.push(...evaluateScenarioGates({
      manifest,
      profileId: cell.profile,
      fixtureId: cell.fixture,
      scenarioResults: cell.scenario_results || [],
    }));
  }
  gates.push(...evaluateOracleGates({ manifest, oracleResults: index.oracle_results || [] }));

  if (index.install_footprint) {
    gates.push(gateResult('resource.install_footprint', index.install_footprint.within_limit === true, {
      measured: index.install_footprint.total_bytes,
      threshold: MAX_INSTALL_FOOTPRINT_BYTES,
    }));
  }

  const failed = gates.filter((gate) => !gate.pass);
  const deferred = index.deferred || [];
  const blockingDeferred = deferred.filter((item) => item.blocking === true);
  return {
    gates,
    summary: {
      total: gates.length,
      passed: gates.length - failed.length,
      failed: failed.length,
      deferred: deferred.length,
      blocking_deferred: blockingDeferred.length,
      overall_pass: failed.length === 0 && blockingDeferred.length === 0,
    },
    failed,
    deferred,
    blocking_deferred: blockingDeferred,
  };
}

export function summarizeGatesForMarkdown(evaluation) {
  const lines = [];
  for (const gate of evaluation.gates) {
    const status = gate.pass ? 'pass' : 'fail';
    const measured = gate.measured === null ? 'n/a' : (
      typeof gate.measured === 'number' && gate.measured > NS_PER_S / 2
        ? `${nsToMs(gate.measured)} ms`
        : String(gate.measured)
    );
    const threshold = gate.threshold === null ? 'n/a' : (
      typeof gate.threshold === 'number' && gate.threshold > NS_PER_S / 2
        ? `${nsToMs(gate.threshold)} ms`
        : String(gate.threshold)
    );
    lines.push(`| ${gate.id} | ${status} | ${measured} | ${threshold} | ${gate.note || ''} |`);
  }
  return lines;
}
