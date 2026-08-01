#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adapterProbe, assertAdapterShape } from '../scripts/safe-runner/adapter.mjs';
import { GIB, MIB, SELF_TEST_CASE_IDS } from '../scripts/safe-runner/constants.mjs';
import { createContext, safeRunnerContext } from '../scripts/safe-runner/context.mjs';
import { deriveLimits } from '../scripts/safe-runner/envelope.mjs';
import {
  classifyRemainingDescendants,
  registeredManagedGraphd,
} from '../scripts/safe-runner/managed-descendants.mjs';
import { commandOwnership, preflightRun } from '../scripts/safe-runner/preflight.mjs';
import {
  baseReport,
  finishReport,
  validateReport,
  writeReport,
  writeReportWithFallback,
} from '../scripts/safe-runner/report.mjs';
import { runAdversarialSelfTests } from '../scripts/safe-runner/self-test.mjs';
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
  assert.equal(adapterProbe('darwin').production_enforcement, false);
  assert.equal(adapterProbe('win32').id, 'portable-process-group-small-only');
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
  const portableQualification = await runAdversarialSelfTests({ cwd: root, probe: portableProbe });
  assert.equal(portableQualification.passed, false);
  assert.equal(portableQualification.qualified_for_production_tiers, false);
  assert.match(portableQualification.refusal.message, /requires Linux user-systemd cgroup-v2/);
  assert.equal(portableQualification.cases.length, SELF_TEST_CASE_IDS.length);
  assert.ok(portableQualification.cases.every((item) => item.skipped === true));
  assert.equal(commandOwnership(['harbor', 'run']).proven, false);
  assert.equal(commandOwnership(['node', 'benchmarks/lb6/pilot/scripts/run-three-arm.mjs']).proven, false);
  assert.equal(commandOwnership(['node', 'tests/tiny.mjs']).proven, true);
  const externalSmall = preflightRun({
    tier: 'small', command: ['docker', 'run', 'tiny'], cwd: root,
  });
  assert.equal(externalSmall.ok, false);
  assert.match(externalSmall.reasons.join('\n'), /external daemon/);

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
  assert.equal(validateReport({
    ...report,
    cleanup: { ...report.cleanup, scope_removed: 'yes' },
  }).valid, false);
  const unwritableParent = path.join(root, 'not-a-directory');
  fs.writeFileSync(unwritableParent, 'file');
  const fallbackReport = structuredClone(report);
  const fallback = writeReportWithFallback(path.join(unwritableParent, 'report.json'), fallbackReport);
  assert.equal(fallback.fallback, true);
  assert.equal(validateReport(JSON.parse(fs.readFileSync(fallback.path))).valid, true);
  fs.rmSync(fallback.path, { force: true });

  const contextDirectory = path.join(root, 'context');
  fs.mkdirSync(contextDirectory);
  const context = createContext(contextDirectory, {
    runId: 'unit', tier: 'small', adapter: portableProbe.id, unit: null,
  });
  const priorContext = process.env.LAMINA_SAFE_RUNNER_CONTEXT;
  const priorToken = process.env.LAMINA_SAFE_RUNNER_TOKEN;
  Object.assign(process.env, context.environment);
  assert.equal(safeRunnerContext()?.run_id, 'unit');
  assert.equal(
    context.environment.LAMINA_SAFE_RUNNER_MANAGED_DESCENDANTS,
    path.join(contextDirectory, 'managed-descendants.jsonl'),
  );
  if (priorContext === undefined) delete process.env.LAMINA_SAFE_RUNNER_CONTEXT;
  else process.env.LAMINA_SAFE_RUNNER_CONTEXT = priorContext;
  if (priorToken === undefined) delete process.env.LAMINA_SAFE_RUNNER_TOKEN;
  else process.env.LAMINA_SAFE_RUNNER_TOKEN = priorToken;

  const managedFile = context.environment.LAMINA_SAFE_RUNNER_MANAGED_DESCENDANTS;
  const graphdRecord = {
    pid: 41001,
    ppid: 1,
    start_ticks: '100',
    command: `${process.execPath} /repo/packages/cli/lib/graph-runtime/server.mjs /repo`,
  };
  const graphdWorker = {
    pid: 41002, ppid: graphdRecord.pid, start_ticks: '101', command: 'retrieval_worker.py',
  };
  fs.appendFileSync(managedFile, `${JSON.stringify({
    schema: 'lamina.safe-runner-managed-descendant/v1',
    role: 'graphd',
    pid: graphdRecord.pid,
    start_ticks: graphdRecord.start_ticks,
  })}\n`);
  assert.deepEqual(registeredManagedGraphd(managedFile, [graphdRecord]), [graphdRecord]);
  assert.equal(
    classifyRemainingDescendants(managedFile, [graphdRecord, graphdWorker]).kind,
    'managed_graphd',
  );
  assert.equal(
    classifyRemainingDescendants(managedFile, [graphdRecord, graphdWorker, {
      pid: 41003, ppid: 1, start_ticks: '102', command: 'unregistered-daemon',
    }]).kind,
    'unmanaged',
  );
  fs.writeFileSync(managedFile, `${JSON.stringify({
    schema: 'lamina.safe-runner-managed-descendant/v1',
    role: 'graphd',
    pid: 41001,
    start_ticks: 'wrong',
  })}\n`);
  assert.deepEqual(registeredManagedGraphd(managedFile, [graphdRecord]), []);

  if (process.platform === 'linux') {
    const claims = path.join(process.env.LAMINA_SAFE_RUNNER_STATE_DIR, 'production-locks');
    fs.mkdirSync(claims, { recursive: true });
    fs.writeFileSync(path.join(claims, 'stale.json'), JSON.stringify({
      pid: process.pid, start_ticks: 'stale', nonce: 'never-reused',
    }));
    const lock = acquireConcurrencyLock();
    assert.throws(() => acquireConcurrencyLock(), /another medium\/large safe-runner/);
    assert.equal(lock.release(), true);
    assert.deepEqual(fs.readdirSync(claims), []);
  }

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
  const validCases = SELF_TEST_CASE_IDS.map((id) => ({
    id,
    passed: true,
    cleanup_verified: true,
    outcome: 'success',
    report_digest: 'b'.repeat(64),
  }));
  writeAttestation(productionProbe, validCases);
  assert.equal(readAttestation(productionProbe).valid, true);
  const promotionRoot = path.join(root, 'unpromoted-repository');
  fs.mkdirSync(promotionRoot);
  const unpromoted = preflightRun({
    tier: 'medium', command: ['node', '-e', ''], cwd: promotionRoot,
    adapterInfo: productionProbe, injectedExistingProcesses: [],
  });
  assert.equal(unpromoted.ok, false);
  assert.match(unpromoted.reasons.join('\n'), /tier promotion requires successful cleanup for: small/);

  assertAdapterShape({
    id: 'unit', launch() {}, sample() {}, signal() {}, cleanup() {},
  });
  assert.throws(() => assertAdapterShape({ id: 'broken' }), /launch/);

  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(packageJson.scripts['safe:run'], /safe-runner\/cli\.mjs run/);
  assert.match(packageJson.scripts['safe:self-test'], /safe-runner\/cli\.mjs self-test/);
  assert.match(packageJson.scripts['test:safe-runner'], /safe_runner_integration_test/);
  const readme = fs.readFileSync('README.md', 'utf8');
  const guide = fs.readFileSync('docs/content/advanced/safe-runner.mdx', 'utf8');
  const adr = fs.readFileSync('docs/decisions/014-crash-safe-resource-supervision.md', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/safe-runner.yml', 'utf8');
  assert.match(readme, /npm run safe:envelope/);
  assert.match(guide, /--tier small[\s\S]*--report[\s\S]*--promote/);
  assert.match(guide, /There is no unrestricted fallback/);
  assert.match(adr, /# ADR-014:[\s\S]*## Decision[\s\S]*systemd scope/);
  assert.match(workflow, /ubuntu-latest[\s\S]*npm run safe:self-test/);

  process.stdout.write('safe-runner unit contracts passed\n');
} finally {
  if (previousState === undefined) delete process.env.LAMINA_SAFE_RUNNER_STATE_DIR;
  else process.env.LAMINA_SAFE_RUNNER_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
}
