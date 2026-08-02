#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSafely } from '../../scripts/safe-runner/runner.mjs';
import { validateReport as validateSafeRunnerReport } from '../../scripts/safe-runner/report.mjs';
import {
  COLD_RUNS, fixtureById, loadManifest, SCENARIOS, summarizeNanoseconds,
} from './contract.mjs';
import {
  validateScenarioResult, validateWorkloadRecord, workloadRecordFromReport,
} from './validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.resolve(HERE, '../..');
const WORKLOAD = path.join(HERE, 'workload.mjs');
const LIMITS = Object.freeze({
  memoryMaxBytes: 3 * 1024 ** 3,
  memoryHighBytes: Math.floor(2.75 * 1024 ** 3),
  pidsMax: 64,
  timeoutMs: 30 * 60_000,
  outputMaxBytes: 1024 * 1024,
  tempMaxBytes: 2 * 1024 ** 3,
  sampleIntervalMs: 250,
  sustainedHighSamples: 4,
  gracefulStopMs: 2_000,
});

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function assertExactOptions(args, names) {
  if (args.length !== 1 + names.length * 2) throw new Error('baseline command has unexpected arguments');
  const supplied = args.slice(1).filter((_value, index) => index % 2 === 0);
  if (supplied.length !== new Set(supplied).size
    || supplied.some((name) => !names.includes(name))
    || names.some((name) => !supplied.includes(name))) {
    throw new Error('baseline command requires each documented option exactly once');
  }
}

function initializeOutput(requested) {
  const root = path.resolve(requested);
  if (root === REPOSITORY || root.startsWith(`${REPOSITORY}${path.sep}`)) {
    throw new Error('baseline output must be outside the source repository');
  }
  if (fs.existsSync(root)) throw new Error('baseline output must not already exist');
  fs.mkdirSync(path.join(root, 'raw'), { recursive: true, mode: 0o700 });
  return root;
}

function tierChain(fixture) {
  return fixture.id === 'large' ? ['small', 'medium', 'large']
    : fixture.id === 'medium' ? ['small', 'medium'] : ['small'];
}

async function runScenario({ root, fixture, scenario, model, worker }) {
  const command = [process.execPath, WORKLOAD, 'run', fixture.id, scenario, model, worker];
  const runs = [];
  const workloadRecords = [];
  let status = 'valid';
  const execute = async (tier, { label, promote, sampleIndex }) => {
    const relative = `raw/${fixture.id}-${scenario}-${label}.json`;
    const reportFile = path.join(root, relative);
    const report = await runSafely({
      command, tier, cwd: REPOSITORY, reportFile, overrides: LIMITS,
      workloadId: `runtime-baseline-v1:${fixture.id}:${scenario}`, promote,
    });
    const safeValidation = validateSafeRunnerReport(report);
    if (!safeValidation.valid) throw new Error(`${relative}: ${safeValidation.errors.join('; ')}`);
    const bytes = fs.readFileSync(reportFile);
    runs.push({
      tier: report.tier,
      purpose: label.startsWith('promotion-') ? 'promotion-and-measurement' : 'measurement',
      sample_index: sampleIndex,
      outcome: report.outcome,
      limit: report.termination.limit,
      duration_ms: report.duration_ms,
      peak_memory_bytes: report.peaks.cgroup_memory_bytes,
      peak_pids: report.peaks.pids,
      peak_temporary_bytes: report.peaks.temporary_bytes,
      remaining_descendants: report.cleanup.descendants_remaining.length,
      remaining_managed_paths: report.cleanup.managed_paths_remaining.length,
      raw_report: relative,
      raw_report_sha256: sha256(bytes),
    });
    if (report.outcome !== 'success') {
      status = report.outcome === 'preflight_refused' ? 'refused' : 'invalid';
      return false;
    }
    const workload = workloadRecordFromReport(report);
    const workloadValidation = validateWorkloadRecord(workload, { fixtureId: fixture.id, scenario });
    if (!workloadValidation.valid) throw new Error(`${relative}: ${workloadValidation.errors.join('; ')}`);
    workloadRecords.push(workload);
    return true;
  };
  const tiers = tierChain(fixture);
  for (let index = 0; index < tiers.length; index += 1) {
    const ok = await execute(tiers[index], {
      label: `promotion-${tiers[index]}`, promote: true,
      sampleIndex: index === tiers.length - 1 ? 0 : null,
    });
    if (!ok) break;
  }
  if (status === 'valid' && workloadRecords.at(-1)?.classification === 'cold-sample') {
    for (let index = 1; index < COLD_RUNS; index += 1) {
      const ok = await execute(tiers.at(-1), {
        label: `measurement-${index}`, promote: false, sampleIndex: index,
      });
      if (!ok) break;
    }
  }
  let workload = workloadRecords.at(-1) || null;
  if (status === 'valid' && workload?.classification === 'cold-sample') {
    const measured = workloadRecords.slice(-COLD_RUNS);
    const samples = measured.map((record, index) => ({ ...record.samples[0], index }));
    workload = {
      ...workload,
      classification: 'cold',
      samples,
      statistics: summarizeNanoseconds(samples.map((sample) => sample.wall_time_ns), false),
      diagnostics: measured.flatMap((record) => record.diagnostics || []),
      cleanup: {
        repository_removed: measured.every((record) => record.cleanup.repository_removed),
        socket_removed: measured.every((record) => record.cleanup.socket_removed),
        lock_removed: measured.every((record) => record.cleanup.lock_removed),
      },
    };
  }
  const result = {
    schema: 'lamina.runtime-baseline-result/v1',
    generated_at: new Date().toISOString(),
    status,
    fixture: { id: fixture.id, commit: fixture.commit, url: fixture.url },
    scenario,
    measured_tier: tierChain(fixture).at(-1),
    workload,
    runs,
    limitations: [
      'Linux x64 baseline; other platforms are not represented.',
      'CocoIndex worker and production retrieval model are checksum-pinned release assets; current JavaScript CLI and graphd come from the measured Lamina commit.',
    ],
  };
  const file = path.join(root, `${fixture.id}-${scenario}.json`);
  fs.writeFileSync(file, stableJson(result), { flag: 'wx', mode: 0o600 });
  const validation = validateScenarioResult(result, root);
  if (!validation.valid) throw new Error(`${path.basename(file)}: ${validation.errors.join('; ')}`);
  return { file, result };
}

async function main(args) {
  const command = args[0];
  if (command === 'validate') {
    assertExactOptions(args, ['--file']);
    const file = option(args, '--file');
    if (!file) throw new Error('validate requires --file');
    const result = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    const validation = validateScenarioResult(result, path.dirname(path.resolve(file)));
    process.stdout.write(stableJson(validation));
    return validation.valid ? 0 : 1;
  }
  if (command !== 'run') throw new Error('usage: run.mjs run --fixture ID --output DIR --model FILE --worker FILE');
  assertExactOptions(args, ['--fixture', '--output', '--model', '--worker']);
  const fixture = fixtureById(option(args, '--fixture'));
  const output = initializeOutput(option(args, '--output'));
  const model = path.resolve(option(args, '--model'));
  const worker = path.resolve(option(args, '--worker'));
  const { digest: manifestDigest } = loadManifest();
  const completed = [];
  const outcomes = new Map();
  for (const scenario of SCENARIOS) {
    const run = await runScenario({ root: output, fixture, scenario, model, worker });
    completed.push(path.basename(run.file));
    outcomes.set(scenario, run.result.status);
    if (run.result.status !== 'valid') break;
  }
  const scenarioOutcomes = SCENARIOS.map((scenario) => ({
    scenario,
    status: outcomes.get(scenario) || 'blocked_after_previous_failure',
  }));
  const complete = scenarioOutcomes.every((item) => item.status === 'valid');
  const index = {
    schema: 'lamina.runtime-baseline-index/v1',
    generated_at: new Date().toISOString(),
    manifest_digest: manifestDigest,
    host: { platform: process.platform, release: os.release(), architecture: process.arch, cpu: os.cpus()[0]?.model || 'unknown', memory_bytes: os.totalmem() },
    fixture: fixture.id,
    completed,
    scenarios: scenarioOutcomes,
    expected: SCENARIOS.length,
    complete,
  };
  fs.writeFileSync(path.join(output, 'index.json'), stableJson(index), { flag: 'wx', mode: 0o600 });
  process.stdout.write(stableJson({ output, ...index }));
  return index.complete ? 0 : 2;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(stableJson({ schema: 'lamina.runtime-baseline-cli-error/v1', error: { message: error.message } }));
  process.exitCode = 2;
}
