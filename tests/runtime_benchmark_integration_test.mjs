#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LIFECYCLE_PHASES, WARM_MEASURED_PHASES } from '../benchmarks/runtime-v1/constants.mjs';
import { runRuntimeBenchmark } from '../benchmarks/runtime-v1/harness.mjs';
import { validateResult } from '../benchmarks/runtime-v1/validate.mjs';

if (process.env.LAMINA_RUNTIME_BENCHMARK_INTEGRATION !== '1') {
  process.stdout.write('runtime benchmark integration skipped; set LAMINA_RUNTIME_BENCHMARK_INTEGRATION=1\n');
  process.exit(0);
}

const output = process.env.LAMINA_RUNTIME_BENCHMARK_OUTPUT;
if (!output || !path.isAbsolute(output)) {
  throw new Error('LAMINA_RUNTIME_BENCHMARK_OUTPUT must be an explicit absolute new directory');
}

const run = await runRuntimeBenchmark({ output, coldRuns: 3, warmups: 1, warmSamples: 30 });
assert.equal(run.result.status, 'valid', run.result.errors.join('; '));
assert.equal(run.validation.valid, true, run.validation.errors.join('; '));
assert.equal(validateResult(run.result, { artifactRoot: output }).valid, true);
assert.equal(run.result.series[0].executions.length, 3);
assert.equal(run.result.series[1].executions.length, 1);
assert.equal(run.result.series[0].statistics.p95, null);
assert.equal(run.result.series[1].statistics.samples.length, 30);
assert.equal(run.result.series[1].statistics.p95 !== null, true);
assert.equal(run.result.artifacts.length, 8);
assert.equal(run.result.cleanup.remaining_descendants, 0);
assert.deepEqual(run.result.cleanup.unexpected_paths, []);
assert.equal(run.result.series.flatMap((series) => series.executions)
  .every((execution) => execution.outcome === 'success'
    && execution.measurement_valid
    && execution.memory_difference_bytes === 0
    && execution.memory_tolerance_bytes === 0
    && execution.remaining_descendants.length === 0
    && execution.cpu_time_ms !== null), true);

const warmIndexes = new Set(WARM_MEASURED_PHASES.map((name) => LIFECYCLE_PHASES.indexOf(name)));
assert.equal(run.result.series[1].samples.every((sample) => sample.phase_time_ns.every(
  (value, index) => warmIndexes.has(index) ? Number.isInteger(value) : value === null,
)), true);
assert.equal(run.result.series[1].executions[0].scope_phase_time_ns.every(
  (value, index) => warmIndexes.has(index) ? value === null : Number.isInteger(value),
), true);
assert.equal(fs.existsSync(path.join(output, 'result.json')), true);
assert.equal(fs.existsSync(path.join(output, 'summary.md')), true);
process.stdout.write(`${JSON.stringify({ status: 'passed', output })}\n`);
