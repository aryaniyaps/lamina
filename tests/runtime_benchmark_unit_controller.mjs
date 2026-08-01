#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LIMITS } from '../benchmarks/runtime-v1/constants.mjs';
import { validateReport } from '../scripts/safe-runner/report.mjs';
import { runSafely } from '../scripts/safe-runner/runner.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configuredReport = process.env.LAMINA_RUNTIME_BENCHMARK_UNIT_REPORT || null;
const temporaryRoot = configuredReport
  ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-runtime-unit-controller-'));
const reportFile = configuredReport ? path.resolve(configuredReport) : path.join(temporaryRoot, 'report.json');
const reportParent = path.dirname(reportFile);

if (!path.isAbsolute(reportFile)) throw new Error('unit report must be absolute');
const parentStat = fs.lstatSync(reportParent);
if (!parentStat.isDirectory() || parentStat.isSymbolicLink()
  || fs.realpathSync.native(reportParent) !== reportParent) {
  throw new Error('unit report parent must be an existing physical directory');
}
if (fs.existsSync(reportFile)) throw new Error('unit report must not already exist');

try {
  const report = await runSafely({
    command: [process.execPath, path.join(repository, 'tests/runtime_benchmark_test.mjs')],
    tier: 'small',
    cwd: repository,
    reportFile,
    workloadId: 'runtime-benchmark-unit',
    promote: false,
    overrides: {
      ...DEFAULT_LIMITS,
      timeoutMs: 60_000,
      outputMaxBytes: 1024 * 1024,
      tempMaxBytes: 8 * 1024 ** 2,
    },
  });
  const validation = validateReport(report);
  const passed = validation.valid && report.outcome === 'success'
    && report.cleanup.descendants_remaining.length === 0;
  process.stdout.write(`${JSON.stringify({
    schema: 'lamina.runtime-benchmark-unit-controller/v1',
    passed,
    report: configuredReport ? reportFile : null,
    outcome: report.outcome,
    validation,
    termination: report.termination,
    cleanup: report.cleanup,
    stdout_tail: report.output.stdout_tail,
    stderr_tail: report.output.stderr_tail,
  }, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
} finally {
  if (temporaryRoot) {
    const entries = fs.readdirSync(temporaryRoot);
    if (entries.some((entry) => entry !== 'report.json')) {
      throw new Error(`unit controller refuses unexpected temporary entries: ${entries.join(', ')}`);
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
