#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadManifest as loadBaselineManifest } from '../runtime-baseline-v1/contract.mjs';
import {
  fixturesForProfile,
  INDEX_SCHEMA,
  loadManifest,
  profileById,
  QUALIFICATION_SCHEMA,
  stableJson,
} from './contract.mjs';
import { evaluateQualificationIndex } from './gates.mjs';
import { validateQualificationIndex } from './validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.resolve(HERE, '../..');
const BASELINE_RUN = path.join(REPOSITORY, 'benchmarks/runtime-baseline-v1/run.mjs');

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function hasFlag(args, name) {
  return args.includes(name);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function runCommand(command, args, { cwd = REPOSITORY, env = process.env, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    const error = new Error(`command failed: ${command} ${args.join(' ')}`);
    error.result = result;
    throw error;
  }
  return result;
}

function ensureAssets(model, worker) {
  const resolvedModel = path.resolve(model);
  const resolvedWorker = path.resolve(worker);
  if (!fs.existsSync(resolvedModel) || !fs.existsSync(resolvedWorker)) {
    throw new Error('runtime qualification requires checksum-pinned model and worker assets');
  }
  return { model: resolvedModel, worker: resolvedWorker };
}

function readBaselineIndex(outputDir) {
  const indexFile = path.join(outputDir, 'index.json');
  if (!fs.existsSync(indexFile)) {
    const completed = fs.readdirSync(outputDir)
      .filter((name) => name.endsWith('.json') && name !== 'index.json');
    const scenarioResults = completed.map((name) => JSON.parse(fs.readFileSync(path.join(outputDir, name), 'utf8')));
    return {
      index: { complete: false, scenarios: scenarioResults.map((item) => ({ scenario: item.scenario, status: item.status })) },
      scenarioResults,
    };
  }
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const scenarioResults = index.completed.map((name) => {
    const file = path.join(outputDir, name);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  });
  return { index, scenarioResults };
}

async function runBaselineFixture({ fixture, output, model, worker }) {
  if (fs.existsSync(output)) throw new Error(`baseline output already exists: ${output}`);
  const env = {
    ...process.env,
    ...(process.env.LAMINA_SAFE_RUNNER_STATE_DIR
      ? { LAMINA_SAFE_RUNNER_STATE_DIR: process.env.LAMINA_SAFE_RUNNER_STATE_DIR }
      : {}),
  };
  const result = runCommand(process.execPath, [
    BASELINE_RUN, 'run',
    '--fixture', fixture,
    '--output', output,
    '--model', model,
    '--worker', worker,
  ], { allowFailure: true, env });
  const parsed = result.stdout.trim().split('\n').filter(Boolean).pop();
  let index = null;
  try {
    index = parsed ? JSON.parse(parsed) : null;
  } catch {}
  const baseline = fs.existsSync(path.join(output, 'index.json'))
    ? readBaselineIndex(output)
    : { index: index || { complete: false, scenarios: [] }, scenarioResults: [] };
  return {
    exit_code: result.status ?? 1,
    output,
    index: baseline.index,
    scenario_results: baseline.scenarioResults,
    stderr_tail: String(result.stderr || '').slice(-4000),
  };
}

function runOracleSuite(suite, { skipOracle = false } = {}) {
  if (skipOracle) {
    return {
      id: suite.id,
      command: suite.command,
      exit_code: 0,
      skipped: true,
      reason: 'oracle suite skipped by --skip-oracle',
    };
  }
  const [command, ...args] = suite.command.split(/\s+/);
  const result = runCommand(command, args, { allowFailure: true });
  return {
    id: suite.id,
    command: suite.command,
    exit_code: result.status ?? 1,
    skipped: false,
    stdout_tail: String(result.stdout || '').slice(-2000),
    stderr_tail: String(result.stderr || '').slice(-2000),
  };
}

function collectDeferred({ profileId, fixture, cell, platform }) {
  const deferred = [];
  if (fixture === 'large' && profileId === '8gb') {
    deferred.push({
      id: `${profileId}.${fixture}`,
      blocking: false,
      reason: '8 GB profile excludes large fixture by policy',
    });
  }
  // Platform deferrals are documented in QUALIFICATION.md; they do not block Linux qualification.
  if (cell?.index && cell.index.complete === false) {
    const blocked = (cell.index.scenarios || []).filter((item) => item.status !== 'valid');
    if (blocked.length) {
      deferred.push({
        id: `${profileId}.${fixture}.baseline_matrix`,
        blocking: true,
        reason: `Baseline promotion incomplete: ${blocked.map((item) => `${item.scenario}=${item.status}`).join(', ')}`,
      });
    }
  }
  if (cell?.exit_code && cell.exit_code !== 0 && (!cell.index || cell.index.complete === false)) {
    deferred.push({
      id: `${profileId}.${fixture}.baseline_exit`,
      blocking: true,
      reason: `Baseline runner exited ${cell.exit_code} before completing the promotion fence`,
    });
  }
  return deferred;
}

async function runQualification(args) {
  const profileId = option(args, '--profile') || '16gb';
  const fixtureFilter = option(args, '--fixture');
  const outputRoot = path.resolve(option(args, '--output') || path.join(os.tmpdir(), `lamina-runtime-qualification-${Date.now()}`));
  const model = option(args, '--model');
  const worker = option(args, '--worker');
  const skipOracle = hasFlag(args, '--skip-oracle');
  const skipBaseline = hasFlag(args, '--skip-baseline');
  const presubmit = hasFlag(args, '--presubmit');

  profileById(profileId);
  const { manifest, digest: manifestDigest } = loadManifest();
  const { digest: baselineManifestDigest } = loadBaselineManifest();
  const assets = model && worker ? ensureAssets(model, worker) : null;

  const fixtures = fixtureFilter ? [fixtureFilter] : fixturesForProfile(profileId);
  if (fixtureFilter && !fixturesForProfile(profileId).includes(fixtureFilter)) {
    throw new Error(`fixture ${fixtureFilter} is outside profile ${profileId}`);
  }

  fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const oracleSuites = presubmit
    ? manifest.oracle_suites.filter((suite) => suite.presubmit)
    : manifest.oracle_suites;
  const oracleResults = oracleSuites.map((suite) => runOracleSuite(suite, { skipOracle }));

  const cells = [];
  const deferred = [];
  const platform = manifest.platforms.find((item) => item.id === `linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}`) || null;

  if (!skipBaseline) {
    if (!assets) throw new Error('baseline measurement requires --model and --worker');
    for (const fixture of fixtures) {
      const output = path.join(outputRoot, `${profileId}-${fixture}-baseline`);
      const cell = await runBaselineFixture({
        fixture,
        output,
        model: assets.model,
        worker: assets.worker,
      });
      cells.push({
        profile: profileId,
        fixture,
        platform: platform?.id || `linux-${process.arch}`,
        baseline_output: output,
        index: cell.index,
        scenario_results: cell.scenario_results,
        exit_code: cell.exit_code,
      });
      deferred.push(...collectDeferred({ profileId, fixture, cell, platform }));
    }
  }

  const index = {
    schema: INDEX_SCHEMA,
    generated_at: new Date().toISOString(),
    lamina_commit: runCommand('git', ['rev-parse', 'HEAD']).stdout.trim(),
    manifest_digest: manifestDigest,
    baseline_manifest_digest: baselineManifestDigest,
    host: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      memory_bytes: os.totalmem(),
    },
    profile: profileId,
    mode: presubmit ? 'presubmit' : 'full',
    cells,
    oracle_results: oracleResults,
    deferred: [...new Map(deferred.map((item) => [item.id, item])).values()],
    install_footprint: null,
  };

  if (process.env.LAMINA_RELEASE_DIR && process.platform === 'linux') {
    const measured = runCommand(process.execPath, ['scripts/measure-linux-install-footprint.mjs'], {
      allowFailure: true,
    });
    const line = measured.stdout.trim().split('\n').filter(Boolean).pop();
    if (line) {
      try {
        index.install_footprint = JSON.parse(line);
      } catch {}
    }
  }

  const evaluation = evaluateQualificationIndex(index);
  const result = {
    schema: QUALIFICATION_SCHEMA,
    generated_at: index.generated_at,
    index,
    evaluation,
  };

  const resultFile = path.join(outputRoot, 'qualification.json');
  fs.writeFileSync(resultFile, stableJson(result), { mode: 0o600 });
  const validation = validateQualificationIndex(index);
  if (!validation.valid) throw new Error(validation.errors.join('; '));

  process.stdout.write(stableJson({
    result_file: resultFile,
    evaluation: evaluation.summary,
    deferred: index.deferred,
  }));
  return evaluation.summary.overall_pass ? 0 : 2;
}

async function validateCommand(args) {
  const file = path.resolve(option(args, '--file'));
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const index = payload.index || payload;
  const validation = validateQualificationIndex(index);
  const evaluation = evaluateQualificationIndex(index);
  process.stdout.write(stableJson({ validation, evaluation: evaluation.summary }));
  return validation.valid && evaluation.summary.overall_pass ? 0 : 1;
}

async function main(args) {
  const command = args[0];
  if (command === 'validate') return validateCommand(args);
  if (command === 'run') return runQualification(args.slice(1));
  throw new Error('usage: run.mjs <run|validate> [options]');
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(stableJson({
    schema: 'lamina.runtime-qualification-cli-error/v1',
    error: { message: error.message, details: error.result?.stderr || null },
  }));
  process.exitCode = 2;
}
