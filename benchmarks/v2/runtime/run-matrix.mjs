#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageBenchFixture } from '../../scripts/stage-bench-fixture.mjs';
import { reconcileAbandonedAttempts } from './attempt-ledger.mjs';
import { compileMatrix } from './compile-matrix.mjs';
import { cellProtocolHash, protocolBaseHash } from './protocol-hash.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V2_ROOT = path.resolve(HERE, '..');
const ROOT = path.resolve(V2_ROOT, '../..');
const activeChildren = new Set();
let shutdownSignal = null;

function requestShutdown(signal) {
  if (shutdownSignal) return;
  shutdownSignal = signal;
  for (const child of activeChildren) child.kill('SIGTERM');
}

process.on('SIGINT', () => requestShutdown('SIGINT'));
process.on('SIGTERM', () => requestShutdown('SIGTERM'));

function parseArgs(argv) {
  const options = { mode: 'development', jobs: '1' };
  for (let index = 2; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    if (['fresh', 'fail-fast'].includes(key)) options[key] = true;
    else options[key] = argv[++index];
  }
  return options;
}

function prepareWorkspace(cell, destination, withLamina) {
  fs.rmSync(destination, { recursive: true, force: true });
  if (cell.fixture_ref) stageBenchFixture(cell.fixture_ref, destination);
  else fs.mkdirSync(destination, { recursive: true });
  if (withLamina) {
    for (const target of [path.join(destination, '.agents', 'skills'), path.join(destination, '.claude', 'skills')]) {
      fs.mkdirSync(target, { recursive: true });
      for (const entry of fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })) {
        if (entry.isDirectory()) fs.cpSync(path.join(ROOT, 'skills', entry.name), path.join(target, entry.name), { recursive: true });
      }
    }
  }
}

function runProcess(command, args, cwd, logPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const log = fs.openSync(logPath, 'a');
    const child = spawn(command, args, { cwd, stdio: ['ignore', log, log] });
    activeChildren.add(child);
    child.on('error', (error) => { activeChildren.delete(child); fs.closeSync(log); reject(error); });
    child.on('exit', (code, signal) => {
      activeChildren.delete(child);
      fs.closeSync(log);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code ?? signal}`));
    });
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function appendJsonLine(file, value) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function verifyCompletedAttempt(attemptRoot) {
  try {
    const trial = readJson(path.join(attemptRoot, 'main-output', 'trial.json'));
    const transfer = readJson(path.join(attemptRoot, 'transfer-output', 'transfer.json'));
    const mainChecks = readJson(path.join(attemptRoot, 'main-output', 'checks.json'));
    const transferChecks = readJson(path.join(attemptRoot, 'transfer-output', 'checks.json'));
    const stages = ['after_implement', 'after_fix'];
    const checksPass = (checks) => checks.isolation?.passed && checks.contract_immutable && checks.preimplementation_source_immutable !== false && checks.telemetry?.ok && stages.every((stage) => checks.product_stages?.[stage]?.snapshot?.ok && checks.product_stages?.[stage]?.validation?.passed);
    return { ok: trial.status === 'complete' && transfer.status === 'complete' && checksPass(mainChecks) && checksPass(transferChecks), trial, transfer };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function nextAttempt(cellRoot) {
  const attemptsRoot = path.join(cellRoot, 'attempts');
  fs.mkdirSync(attemptsRoot, { recursive: true });
  const indexes = fs.readdirSync(attemptsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^attempt-\d+$/.test(entry.name))
    .map((entry) => Number(entry.name.slice('attempt-'.length)));
  const number = (indexes.length ? Math.max(...indexes) : 0) + 1;
  return { number, root: path.join(attemptsRoot, `attempt-${String(number).padStart(3, '0')}`) };
}

async function executeCell(cell, options, resultsRoot, baseHash) {
  const cellRoot = path.join(resultsRoot, 'cells', cell.id);
  const statusPath = path.join(cellRoot, 'result.json');
  const protocol = cellProtocolHash(cell, baseHash);
  const previous = fs.existsSync(statusPath) ? readJson(statusPath) : null;
  if (previous?.status === 'complete' && previous.protocol_hash === protocol.sha256 && previous.cell_input_hash === protocol.cell_input_sha256 && !options.fresh) {
    const verification = verifyCompletedAttempt(path.resolve(resultsRoot, previous.attempt_path));
    if (verification.ok) return { ...previous, reused: true };
  }
  if (previous && previous.protocol_hash === protocol.sha256 && previous.cell_input_hash === protocol.cell_input_sha256 && (options.fresh || previous.status !== 'complete') && !options['rerun-reason']) {
    throw Object.assign(new Error(`${cell.id} already has an attempt under the same protocol hash; supply --rerun-reason to preserve the non-selective rerun record`), { configurationError: true });
  }

  fs.mkdirSync(cellRoot, { recursive: true });
  if (previous?.protocol_hash && (previous.protocol_hash !== protocol.sha256 || previous.cell_input_hash !== protocol.cell_input_sha256)) {
    appendJsonLine(path.join(resultsRoot, 'invalidation-ledger.jsonl'), { at: new Date().toISOString(), cell_id: cell.id, previous_protocol_hash: previous.protocol_hash, replacement_protocol_hash: protocol.sha256, previous_cell_input_hash: previous.cell_input_hash || null, replacement_cell_input_hash: protocol.cell_input_sha256, reason: 'protocol_or_input_hash_changed' });
  }
  const attempt = nextAttempt(cellRoot);
  fs.mkdirSync(attempt.root, { recursive: true });
  fs.writeFileSync(path.join(attempt.root, 'protocol.json'), `${JSON.stringify(protocol, null, 2)}\n`);
  const startedAt = new Date().toISOString();
  const taskDir = path.join(V2_ROOT, 'corpus', cell.task_package);
  const mainWorkspace = path.join(attempt.root, 'main-workspace');
  const mainOutput = path.join(attempt.root, 'main-output');
  const transferWorkspace = path.join(attempt.root, 'transfer-workspace');
  const transferOutput = path.join(attempt.root, 'transfer-output');
  const attemptPath = path.relative(resultsRoot, attempt.root);
  const recordBase = { ...cell, protocol_hash: protocol.sha256, cell_input_hash: protocol.cell_input_sha256, attempt: attempt.number, attempt_path: attemptPath, started_at: startedAt, rerun_reason: options['rerun-reason'] || null };
  appendJsonLine(path.join(resultsRoot, 'attempt-ledger.jsonl'), { ...recordBase, event: 'started' });
  try {
    prepareWorkspace(cell, mainWorkspace, cell.arm === 'lamina');
    await runProcess(process.execPath, [path.join(HERE, 'run-trial.mjs'), '--task-dir', taskDir, '--workspace', mainWorkspace, '--output', mainOutput, '--arm', cell.arm, '--track', cell.track, '--provider', cell.provider, '--model', cell.model, '--timeout', String(release.agent_timeout_sec), '--validation-timeout', String(release.judge_timeout_sec), '--validation-test-replays', String(release.validation_test_replays), '--transient-retries', String(release.agent_transient_retries)], ROOT, path.join(attempt.root, 'main.log'));
    const snapshot = path.join(mainOutput, cell.arm === 'raw' ? 'product-contract.md' : cell.arm === 'structured' ? 'benchmark-contract.json' : 'run.json');
    prepareWorkspace(cell, transferWorkspace, false);
    await runProcess(process.execPath, [path.join(HERE, 'run-transfer.mjs'), '--contract', snapshot, '--brief', path.join(taskDir, 'brief.md'), '--workspace', transferWorkspace, '--output', transferOutput, '--arm', cell.arm, '--provider', cell.provider, '--model', cell.model, '--timeout', String(release.agent_timeout_sec), '--validation-timeout', String(release.judge_timeout_sec), '--validation-test-replays', String(release.validation_test_replays), '--transient-retries', String(release.agent_transient_retries)], ROOT, path.join(attempt.root, 'transfer.log'));
    const verified = verifyCompletedAttempt(attempt.root);
    if (!verified.ok) throw new Error(`Cell subprocesses exited successfully but evidence validation failed: ${verified.error || 'incomplete checks'}`);
    const status = { ...recordBase, status: 'complete', ended_at: new Date().toISOString(), paths: { main_workspace: path.relative(resultsRoot, mainWorkspace), main_output: path.relative(resultsRoot, mainOutput), transfer_workspace: path.relative(resultsRoot, transferWorkspace), transfer_output: path.relative(resultsRoot, transferOutput) } };
    fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
    appendJsonLine(path.join(resultsRoot, 'attempt-ledger.jsonl'), { ...status, event: 'completed' });
    return status;
  } catch (error) {
    const status = { ...recordBase, status: 'failed', ended_at: new Date().toISOString(), error: error.message };
    fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
    appendJsonLine(path.join(resultsRoot, 'attempt-ledger.jsonl'), { ...status, event: 'failed' });
    appendJsonLine(path.join(resultsRoot, 'failure-ledger.jsonl'), status);
    throw Object.assign(error, { cellStatus: status });
  }
}

const options = parseArgs(process.argv);
const release = JSON.parse(fs.readFileSync(path.join(V2_ROOT, 'release.json'), 'utf8'));
const corpus = JSON.parse(fs.readFileSync(path.join(V2_ROOT, 'corpus', 'manifest.json'), 'utf8'));
if (options.mode === 'publication') throw new Error('The bundled host runner is development-only. Export a frozen publication matrix with bench:v2:publication:export and follow EXECUTION_CUSTODY.md.');
let cells = compileMatrix(release, corpus, options);
if (options.limit) cells = cells.slice(0, Number(options.limit));
const jobs = Math.max(1, Number(options.jobs) || 1);
if (jobs > 1 && !options['concurrency-verified']) throw new Error('Concurrency requires --concurrency-verified after a completely verified one-cell smoke test');
const resultsRoot = path.resolve(options.output || path.join(ROOT, 'benchmarks', 'results', 'v2', options.mode));
fs.mkdirSync(resultsRoot, { recursive: true });
reconcileAbandonedAttempts(resultsRoot, cells.map((cell) => cell.id));
const matrix = { generated_at: new Date().toISOString(), protocol_base_hash: protocolBaseHash(), cells };
fs.writeFileSync(path.join(resultsRoot, 'matrix.json'), `${JSON.stringify(matrix, null, 2)}\n`);
fs.mkdirSync(path.join(resultsRoot, 'matrix-history'), { recursive: true });
fs.writeFileSync(path.join(resultsRoot, 'matrix-history', `${matrix.generated_at.replaceAll(':', '-')}.json`), `${JSON.stringify(matrix, null, 2)}\n`);

let cursor = 0;
const completed = [];
const failures = [];
async function worker() {
  while (cursor < cells.length && !shutdownSignal) {
    const cell = cells[cursor++];
    try { completed.push(await executeCell(cell, options, resultsRoot, matrix.protocol_base_hash)); }
    catch (error) {
      failures.push(error.cellStatus || { id: cell.id, status: 'failed', error: error.message });
      if (error.configurationError || options['fail-fast']) return;
    }
  }
}
await Promise.all(Array.from({ length: jobs }, () => worker()));
const summary = { planned: cells.length, complete: completed.length, reused: completed.filter((item) => item.reused).length, failed: failures.length, failures };
fs.writeFileSync(path.join(resultsRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
if (failures.length || shutdownSignal) process.exitCode = 1;
