#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  FIXTURE_SCHEMA,
  LIFECYCLE_PHASES,
  MAX_WARM_SAMPLES,
  MAX_WARMUPS,
  MIN_WARM_SAMPLES,
  MIN_WARMUPS,
  WARM_MEASURED_PHASES,
} from '../constants.mjs';
import { TINY_SOURCE } from './fixture-data.mjs';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function boundedInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

async function runChild() {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', 'sleep 0.075'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code !== 0 || signal) {
        reject(new Error(`tiny child failed: code=${code} signal=${signal || 'none'}`));
      } else resolve(true);
    });
  });
}

async function phase(name, state) {
  if (name === 'doctor') {
    if (!process.version.startsWith('v')) throw new Error('Node runtime unavailable');
  } else if (name === 'status') {
    fs.statSync(process.argv[1]);
  } else if (name === 'startup') {
    fs.mkdirSync(state, { recursive: true, mode: 0o700 });
    await runChild();
  } else if (name === 'observation') {
    fs.writeFileSync(path.join(state, 'observed.json'), `${JSON.stringify(TINY_SOURCE)}\n`, { mode: 0o600 });
  } else if (name === 'retrieval_readiness') {
    crypto.createHash('sha256').update(fs.readFileSync(path.join(state, 'observed.json'))).digest();
  } else if (name === 'preparation') {
    JSON.parse(fs.readFileSync(path.join(state, 'observed.json'), 'utf8'));
  } else if (name === 'noop_sync') {
    fs.statSync(path.join(state, 'observed.json'));
  } else if (name === 'incremental_change') {
    fs.appendFileSync(path.join(state, 'observed.json'), '{"change":1}\n');
  } else if (name === 'rebuild') {
    const source = fs.readFileSync(path.join(state, 'observed.json'));
    fs.writeFileSync(path.join(state, 'derived.sha256'), crypto.createHash('sha256').update(source).digest('hex'), { mode: 0o600 });
  } else if (name === 'idle') {
    await wait(2);
  } else if (name === 'shutdown') {
    fs.rmSync(path.join(state, 'derived.sha256'), { force: true });
  } else if (name === 'cleanup') {
    fs.rmSync(state, { recursive: true, force: true });
  } else {
    throw new Error(`unknown lifecycle phase: ${name}`);
  }
}

async function coldObservation(index, stateRoot) {
  const phaseTimeNs = [];
  const started = process.hrtime.bigint();
  const state = path.join(stateRoot, `cold-${index}`);
  for (const name of LIFECYCLE_PHASES) {
    const phaseStarted = process.hrtime.bigint();
    await phase(name, state);
    phaseTimeNs.push(Number(process.hrtime.bigint() - phaseStarted));
  }
  return {
    index,
    classification: 'cold',
    wall_time_ns: Number(process.hrtime.bigint() - started),
    phase_time_ns: phaseTimeNs,
  };
}

async function warmObservation(classification, index, state) {
  const phaseTimeNs = new Array(LIFECYCLE_PHASES.length).fill(null);
  const started = process.hrtime.bigint();
  for (const name of WARM_MEASURED_PHASES) {
    const phaseStarted = process.hrtime.bigint();
    await phase(name, state);
    phaseTimeNs[LIFECYCLE_PHASES.indexOf(name)] = Number(process.hrtime.bigint() - phaseStarted);
  }
  return {
    index,
    classification,
    wall_time_ns: Number(process.hrtime.bigint() - started),
    phase_time_ns: phaseTimeNs,
  };
}

async function runWarmSeries(warmups, measured, stateRoot) {
  const state = path.join(stateRoot, 'warm-persistent');
  const lifecycleOuterNs = new Array(LIFECYCLE_PHASES.length).fill(null);
  for (const name of ['startup', 'observation', 'incremental_change', 'rebuild']) {
    const started = process.hrtime.bigint();
    await phase(name, state);
    lifecycleOuterNs[LIFECYCLE_PHASES.indexOf(name)] = Number(process.hrtime.bigint() - started);
  }
  const identity = fs.statSync(state, { bigint: true });
  const observations = [];
  for (let index = 0; index < warmups; index += 1) {
    observations.push(await warmObservation('warmup', index, state));
  }
  for (let index = 0; index < measured; index += 1) {
    observations.push(await warmObservation('measured_warm', index, state));
  }
  for (const name of ['idle', 'shutdown', 'cleanup']) {
    const started = process.hrtime.bigint();
    await phase(name, state);
    lifecycleOuterNs[LIFECYCLE_PHASES.indexOf(name)] = Number(process.hrtime.bigint() - started);
  }
  return {
    observations,
    lifecycle_outer_phase_time_ns: lifecycleOuterNs,
    persistent_state_reused: observations.length > 1,
    persistent_state_identity: { dev: String(identity.dev), ino: String(identity.ino) },
  };
}

async function main() {
  const [mode, warmupValue = '1', measuredValue = '30'] = process.argv.slice(2);
  if (!['cold', 'warm'].includes(mode)) throw new Error('mode must be cold or warm');
  const temporary = process.env.LAMINA_SAFE_RUNNER_TEMP;
  if (!temporary || !path.isAbsolute(temporary)) throw new Error('LAMINA_SAFE_RUNNER_TEMP is required');
  const warmups = mode === 'warm'
    ? boundedInteger(warmupValue, 'warmups', MIN_WARMUPS, MAX_WARMUPS) : 0;
  const measured = mode === 'warm'
    ? boundedInteger(measuredValue, 'warm samples', MIN_WARM_SAMPLES, MAX_WARM_SAMPLES) : 1;
  const stateRoot = path.join(temporary, 'runtime-benchmark-fixture');
  const warm = mode === 'warm' ? await runWarmSeries(warmups, measured, stateRoot) : null;
  const observations = warm?.observations || [await coldObservation(0, stateRoot)];
  fs.rmSync(stateRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({
    schema: FIXTURE_SCHEMA,
    mode,
    phase_order: LIFECYCLE_PHASES,
    observations,
    lifecycle_outer_phase_time_ns: warm?.lifecycle_outer_phase_time_ns
      || new Array(LIFECYCLE_PHASES.length).fill(null),
    persistent_state_reused: warm?.persistent_state_reused || false,
    persistent_state_identity: warm?.persistent_state_identity || null,
    child_processes: 1,
    state_removed: !fs.existsSync(stateRoot),
  })}\n`);
}

await main();
