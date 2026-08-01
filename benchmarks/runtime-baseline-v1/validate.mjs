import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { validateReport as validateSafeRunnerReport } from '../../scripts/safe-runner/report.mjs';
import {
  COLD_RUNS, loadManifest, SCENARIOS, WARM_SAMPLES, WORKLOAD_SCHEMA,
} from './contract.mjs';

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

export function workloadRecordFromReport(report) {
  const lines = String(report?.output?.stdout_tail || '').trim().split('\n').filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value?.schema === WORKLOAD_SCHEMA) return value;
    } catch {}
  }
  return null;
}

export function validateWorkloadRecord(record, { fixtureId = null, scenario = null } = {}) {
  const errors = [];
  const { manifest, digest } = loadManifest();
  const fixture = manifest.fixtures.find((item) => item.id === record?.fixture?.id);
  if (record?.schema !== WORKLOAD_SCHEMA) errors.push('record schema is invalid');
  if (record?.manifest_digest !== digest) errors.push('record manifest digest is stale');
  if (!fixture || fixture.commit !== record?.fixture?.commit || fixture.url !== record?.fixture?.url) {
    errors.push('record fixture identity contradicts the manifest');
  }
  if (fixtureId && record?.fixture?.id !== fixtureId) errors.push('record fixture id contradicts the command');
  if (!SCENARIOS.includes(record?.scenario) || (scenario && record?.scenario !== scenario)) {
    errors.push('record scenario contradicts the command');
  }
  const repository = record?.repository;
  if (!repository || repository.commit !== record?.fixture?.commit
    || !integer(repository.tracked_files) || !integer(repository.tracked_bytes)
    || !integer(repository.tracked_source_files) || !integer(repository.tracked_source_bytes)
    || !integer(repository.tracked_source_loc) || !integer(repository.indexed_candidate_files)
    || !integer(repository.indexed_candidate_bytes) || !Array.isArray(repository.exclusion_rules)
    || typeof repository.indexed_paths_digest !== 'string') {
    errors.push('record repository cardinality evidence is incomplete');
  }
  if (!record?.cleanup || record.cleanup.repository_removed !== true
    || record.cleanup.socket_removed !== true || record.cleanup.lock_removed !== true) {
    errors.push('record cleanup evidence is incomplete');
  }
  if (record?.classification === 'cold') {
    if (!Array.isArray(record.samples) || record.samples.length !== COLD_RUNS
      || record.statistics?.count !== COLD_RUNS || record.statistics?.p90 !== null
      || record.statistics?.p95 !== null) errors.push('cold statistics are mislabeled or incomplete');
  } else if (record?.classification === 'warm') {
    if (!Array.isArray(record.samples) || record.samples.length !== WARM_SAMPLES
      || record.statistics?.count !== WARM_SAMPLES || !integer(record.statistics?.p90)
      || !integer(record.statistics?.p95) || record.warmups_excluded !== 1) {
      errors.push('warm statistics are mislabeled or incomplete');
    }
  } else if (record?.classification === 'repeated-expensive') {
    if (!Array.isArray(record.samples) || record.samples.length !== COLD_RUNS
      || record.statistics?.p90 !== null || record.statistics?.p95 !== null
      || typeof record.p95_omitted_reason !== 'string') {
      errors.push('expensive repeated statistics must omit percentiles with a reason');
    }
  } else if (!['static', 'expected-cancellation'].includes(record?.classification)) {
    errors.push('record classification is invalid');
  }
  return { valid: errors.length === 0, errors };
}

export function validateScenarioResult(result, artifactRoot) {
  const errors = [];
  if (!exactKeys(result, [
    'schema', 'generated_at', 'status', 'fixture', 'scenario', 'measured_tier',
    'workload', 'runs', 'limitations',
  ]) || result.schema !== 'lamina.runtime-baseline-result/v1') {
    errors.push('scenario result has an invalid top-level shape');
  }
  if (!['valid', 'refused', 'invalid'].includes(result?.status)) errors.push('scenario result status is invalid');
  const tiers = result?.fixture?.id === 'large' ? ['small', 'medium', 'large']
    : result?.fixture?.id === 'medium' ? ['small', 'medium'] : ['small'];
  if (!Array.isArray(result?.runs) || result.runs.length < 1 || result.runs.length > tiers.length
    || result.runs.some((run, index) => run.tier !== tiers[index])
    || (result.status === 'valid' && result.runs.length !== tiers.length)) {
    errors.push('scenario result lacks its exact sequential promotion chain');
  }
  for (const run of result?.runs || []) {
    const file = path.resolve(artifactRoot, run.raw_report);
    if (!file.startsWith(`${path.resolve(artifactRoot)}${path.sep}`)) {
      errors.push(`${run.raw_report}: raw report escapes the artifact root`);
      continue;
    }
    let report;
    let bytes;
    try {
      bytes = fs.readFileSync(file);
      report = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      errors.push(`${run.raw_report}: ${error.message}`);
      continue;
    }
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== run.raw_report_sha256) {
      errors.push(`${run.raw_report}: raw report digest mismatch`);
    }
    const validation = validateSafeRunnerReport(report);
    if (!validation.valid) errors.push(`${run.raw_report}: ${validation.errors.join('; ')}`);
    if (report.outcome !== run.outcome || report.peaks.cgroup_memory_bytes !== run.peak_memory_bytes
      || report.cleanup.descendants_remaining.length !== run.remaining_descendants
      || report.cleanup.managed_paths_remaining.length !== run.remaining_managed_paths) {
      errors.push(`${run.raw_report}: summarized safe-runner evidence contradicts raw JSON`);
    }
  }
  if (result?.status === 'valid') {
    const workload = validateWorkloadRecord(result.workload, {
      fixtureId: result.fixture.id, scenario: result.scenario,
    });
    errors.push(...workload.errors);
    if (result.runs.some((run) => run.outcome !== 'success'
      || run.remaining_descendants !== 0 || run.remaining_managed_paths !== 0)) {
      errors.push('valid result contains a failed or unclean safe-runner execution');
    }
  }
  return { valid: errors.length === 0, errors };
}
