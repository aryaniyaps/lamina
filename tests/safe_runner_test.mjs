#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertAdapterShape } from '../scripts/safe-runner/adapter.mjs';
import { GIB, MIB } from '../scripts/safe-runner/constants.mjs';
import { createContext, safeRunnerContext } from '../scripts/safe-runner/context.mjs';
import { deriveLimits } from '../scripts/safe-runner/envelope.mjs';
import { commandOwnership, preflightRun } from '../scripts/safe-runner/preflight.mjs';
import { baseReport, finishReport, validateReport, writeReport } from '../scripts/safe-runner/report.mjs';
import {
  acquireConcurrencyLock,
  checkPromotion,
  readAttestation,
  recordPromotion,
  writeAttestation,
} from '../scripts/safe-runner/state.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-safe-runner-unit-'));
const previousState = process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
process.env.LAMINA_SAFE_RUNNER_STATE_DIR = path.join(root, 'state');

try {
  const eightGib = deriveLimits({}, { totalMemoryBytes: 8 * GIB });
  assert.equal(eightGib.memory_max_bytes, 2 * GIB);
  assert.equal(eightGib.memory_high_bytes, Math.floor(1.6 * GIB));
  assert.equal(eightGib.pids_max, 64);
  assert.equal(eightGib.concurrency, 1);
  assert.ok(eightGib.minimum_free_disk_bytes >= 5 * GIB);

  const portableProbe = {
    id: 'portable-process-group-small-only',
    platform: 'darwin',
    production_enforcement: false,
    aggregate_memory: false,
    aggregate_pids: false,
    complete_descendant_ownership: false,
    controllers: [],
    reasons: ['unsupported'],
  };
  const ordinarySmall = preflightRun({
    tier: 'small', command: ['node', '-e', ''], cwd: root, adapterInfo: portableProbe,
  });
  assert.equal(ordinarySmall.ok, false);
  assert.match(ordinarySmall.reasons.join('\n'), /only the built-in deliberately tiny self-test/);
  const portableSelfTest = preflightRun({
    tier: 'small',
    command: [process.execPath, path.join(process.cwd(), 'tests/fixtures/safe-runner-adversary.mjs'), 'success'],
    cwd: root,
    adapterInfo: portableProbe,
    mode: 'self-test',
    selfTestCaseId: 'normal_cleanup',
    overrides: {
      memoryMaxBytes: 64 * MIB,
      timeoutMs: 1_000,
      pidsMax: 8,
      outputMaxBytes: 64 * 1024,
      tempMaxBytes: 1 * MIB,
    },
  });
  assert.equal(portableSelfTest.ok, true);
  assert.equal(portableSelfTest.deliberately_tiny_self_test, true);
  const productionPortable = preflightRun({
    tier: 'medium', command: ['node', '-e', ''], cwd: root, adapterInfo: portableProbe,
  });
  assert.equal(productionPortable.ok, false);
  assert.match(productionPortable.reasons.join('\n'), /medium\/large execution requires Linux/);
  assert.equal(commandOwnership(['harbor', 'run']).proven, false);
  assert.equal(commandOwnership(['node', 'benchmarks/lb6/pilot/scripts/run-three-arm.mjs']).proven, false);
  assert.equal(commandOwnership(['node', 'tests/tiny.mjs']).proven, true);

  const report = finishReport(baseReport({
    tier: 'small', command: ['node', '-e', ''], cwd: root,
  }), Date.now());
  report.report_file = path.join(root, 'report.json');
  report.outcome = 'success';
  report.termination.reason = 'completed';
  report.cleanup.attempted = true;
  report.cleanup.descendants_remaining = [];
  report.cleanup.scope_removed = true;
  report.cleanup.temporary_directory_removed = true;
  assert.equal(validateReport(report).valid, true);
  writeReport(report.report_file, report);
  assert.equal(validateReport(JSON.parse(fs.readFileSync(report.report_file))).valid, true);
  assert.equal(validateReport({ ...report, unexpected: true }).valid, false);

  const contextDirectory = path.join(root, 'context');
  fs.mkdirSync(contextDirectory);
  const context = createContext(contextDirectory, {
    runId: 'unit', tier: 'small', adapter: portableProbe.id, unit: null,
  });
  const priorContext = process.env.LAMINA_SAFE_RUNNER_CONTEXT;
  const priorToken = process.env.LAMINA_SAFE_RUNNER_TOKEN;
  Object.assign(process.env, context.environment);
  assert.equal(safeRunnerContext()?.run_id, 'unit');
  if (priorContext === undefined) delete process.env.LAMINA_SAFE_RUNNER_CONTEXT;
  else process.env.LAMINA_SAFE_RUNNER_CONTEXT = priorContext;
  if (priorToken === undefined) delete process.env.LAMINA_SAFE_RUNNER_TOKEN;
  else process.env.LAMINA_SAFE_RUNNER_TOKEN = priorToken;

  const claims = path.join(process.env.LAMINA_SAFE_RUNNER_STATE_DIR, 'production-locks');
  fs.mkdirSync(claims, { recursive: true });
  fs.writeFileSync(path.join(claims, 'stale.json'), JSON.stringify({
    pid: process.pid, start_ticks: 'stale', nonce: 'never-reused',
  }));
  const lock = acquireConcurrencyLock();
  assert.equal(lock.release(), true);
  assert.deepEqual(fs.readdirSync(claims), []);

  assert.throws(() => recordPromotion(root, 'small', { outcome: 'success' }), /verified cleanup/);
  recordPromotion(root, 'small', report);
  assert.equal(checkPromotion(root, 'medium').ok, true);

  const productionProbe = { ...portableProbe, id: 'unit-production', production_enforcement: true };
  writeAttestation(productionProbe, Array.from({ length: 11 }, (_, index) => ({
    id: `wrong-${index}`,
    passed: true,
    cleanup_verified: true,
    outcome: 'success',
    report_digest: 'a'.repeat(64),
  })));
  assert.equal(readAttestation(productionProbe).valid, false);

  assertAdapterShape({
    id: 'unit', launch() {}, sample() {}, signal() {}, cleanup() {},
  });
  assert.throws(() => assertAdapterShape({ id: 'broken' }), /launch/);

  process.stdout.write('safe-runner unit contracts passed\n');
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
}
