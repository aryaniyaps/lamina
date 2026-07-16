#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageBenchFixture } from '../../scripts/stage-bench-fixture.mjs';
import { compileMatrix } from './compile-matrix.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V2_ROOT = path.resolve(HERE, '..');
const ROOT = path.resolve(V2_ROOT, '../..');

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
    child.on('error', (error) => { fs.closeSync(log); reject(error); });
    child.on('exit', (code, signal) => {
      fs.closeSync(log);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code ?? signal}`));
    });
  });
}

async function executeCell(cell, options, resultsRoot) {
  const cellRoot = path.join(resultsRoot, cell.id);
  const statusPath = path.join(cellRoot, 'result.json');
  if (!options.fresh && fs.existsSync(statusPath)) {
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    if (status.status === 'complete') return status;
  }
  fs.mkdirSync(cellRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const taskDir = path.join(V2_ROOT, 'corpus', cell.task_package);
  const mainWorkspace = path.join(cellRoot, 'main-workspace');
  const mainOutput = path.join(cellRoot, 'main-output');
  const transferWorkspace = path.join(cellRoot, 'transfer-workspace');
  const transferOutput = path.join(cellRoot, 'transfer-output');
  try {
    prepareWorkspace(cell, mainWorkspace, cell.arm === 'lamina');
    await runProcess(process.execPath, [path.join(HERE, 'run-trial.mjs'), '--task-dir', taskDir, '--workspace', mainWorkspace, '--output', mainOutput, '--arm', cell.arm, '--track', cell.track, '--provider', cell.provider, '--model', cell.model], ROOT, path.join(cellRoot, 'main.log'));
    const snapshot = path.join(mainOutput, cell.arm === 'raw' ? 'product-contract.md' : cell.arm === 'structured' ? 'benchmark-contract.json' : 'run.json');
    prepareWorkspace(cell, transferWorkspace, false);
    await runProcess(process.execPath, [path.join(HERE, 'run-transfer.mjs'), '--contract', snapshot, '--brief', path.join(taskDir, 'brief.md'), '--workspace', transferWorkspace, '--output', transferOutput, '--provider', cell.provider, '--model', cell.model], ROOT, path.join(cellRoot, 'transfer.log'));
    const status = { ...cell, status: 'complete', started_at: startedAt, ended_at: new Date().toISOString(), paths: { main_workspace: mainWorkspace, main_output: mainOutput, transfer_workspace: transferWorkspace, transfer_output: transferOutput } };
    fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
    return status;
  } catch (error) {
    const status = { ...cell, status: 'failed', started_at: startedAt, ended_at: new Date().toISOString(), error: error.message };
    fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
    throw Object.assign(error, { cellStatus: status });
  }
}

const options = parseArgs(process.argv);
const release = JSON.parse(fs.readFileSync(path.join(V2_ROOT, 'release.json'), 'utf8'));
const corpus = JSON.parse(fs.readFileSync(path.join(V2_ROOT, 'corpus', 'manifest.json'), 'utf8'));
if (options.mode === 'publication') {
  throw new Error('The bundled host runner is development-only. Export a frozen publication matrix with bench:v2:publication:export and follow EXECUTION_CUSTODY.md.');
}
let cells = compileMatrix(release, corpus, options);
if (options.limit) cells = cells.slice(0, Number(options.limit));
const resultsRoot = path.resolve(options.output || path.join(ROOT, 'benchmarks', 'results', 'v2', options.mode));
fs.mkdirSync(resultsRoot, { recursive: true });
fs.writeFileSync(path.join(resultsRoot, 'matrix.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), cells }, null, 2)}\n`);

let cursor = 0;
const completed = [];
const failures = [];
async function worker() {
  while (cursor < cells.length) {
    const cell = cells[cursor++];
    try { completed.push(await executeCell(cell, options, resultsRoot)); }
    catch (error) {
      failures.push(error.cellStatus || { id: cell.id, status: 'failed', error: error.message });
      if (options['fail-fast']) return;
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, Number(options.jobs) || 1) }, () => worker()));
const summary = { planned: cells.length, complete: completed.length, failed: failures.length, failures };
fs.writeFileSync(path.join(resultsRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exitCode = 1;
