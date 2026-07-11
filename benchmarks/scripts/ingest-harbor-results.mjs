#!/usr/bin/env node
/**
 * Ingest Harbor job outputs into LaminaBench results/raw/index.jsonl + artifacts.
 *
 * Usage:
 *   node benchmarks/scripts/ingest-harbor-results.mjs [--jobs-dir path] [--fresh]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';
import { isClarifyOutput } from './bench-clarify.mjs';
import {
  computeJobFingerprint,
  getResultsContractVersion,
  getHarnessVersion,
  upsertIndexEntry,
  jobKey,
} from './bench-index.mjs';
import { resolveBenchModel } from './load-bench-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_JOBS = path.join(ROOT, 'benchmarks/results/harbor/jobs');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');
const SUITE_PATH = path.join(ROOT, 'benchmarks/tmp/bench-suite.json');

function parseArgs() {
  const opts = { jobsDir: DEFAULT_JOBS, fresh: false };
  const idx = process.argv.indexOf('--jobs-dir');
  if (idx !== -1) opts.jobsDir = path.resolve(process.argv[idx + 1]);
  if (process.argv.includes('--fresh')) opts.fresh = true;
  return opts;
}

function loadSuiteTasks() {
  if (!fs.existsSync(SUITE_PATH)) return new Map();
  const suite = JSON.parse(fs.readFileSync(SUITE_PATH, 'utf8'));
  return new Map(suite.tasks.map((t) => [t.id, t]));
}

function parseHarborTaskName(name) {
  const m = name.match(/^(task\d{3})-(control|treatment)$/);
  if (!m) return null;
  return { task_id: m[1], arm: m[2] };
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function findAgentOutput(trialDir) {
  const agentDir = path.join(trialDir, 'agent');
  if (!fs.existsSync(agentDir)) return '';
  const stack = [agentDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (/\.(txt|log|md|jsonl)$/i.test(ent.name)) {
        try {
          const text = fs.readFileSync(p, 'utf8');
          if (text.length > 100) return text.slice(0, 80000);
        } catch {
          /* skip */
        }
      }
    }
  }
  return '';
}

function extractAttempt(trialDir) {
  const result = readJsonSafe(path.join(trialDir, 'result.json'));
  if (result?.attempt != null) return Number(result.attempt);
  if (result?.attempt_number != null) return Number(result.attempt_number);
  const name = path.basename(trialDir);
  const m = name.match(/attempt[_-]?(\d+)/i);
  if (m) return Number(m[1]);
  return null;
}

function listTrialDirs(jobsDir) {
  const trials = [];
  if (!fs.existsSync(jobsDir)) return trials;
  for (const jobName of fs.readdirSync(jobsDir)) {
    const jobPath = path.join(jobsDir, jobName);
    if (!fs.statSync(jobPath).isDirectory()) continue;
    for (const trialName of fs.readdirSync(jobPath)) {
      const trialPath = path.join(jobPath, trialName);
      if (!fs.statSync(trialPath).isDirectory()) continue;
      const parsed = parseHarborTaskName(trialName.split('__')[0]);
      if (!parsed) {
        const alt = parseHarborTaskName(trialName);
        if (alt) trials.push({ trialPath, jobPath, jobName, trialName, ...alt });
        continue;
      }
      trials.push({ trialPath, jobPath, jobName, trialName, ...parsed });
    }
  }
  return trials;
}

function ingestTrial(trial, ctx) {
  const rewardJson = readJsonSafe(path.join(trial.trialPath, 'verifier', 'reward.json'));
  const rewardTxtPath = path.join(trial.trialPath, 'verifier', 'reward.txt');
  let reward = rewardJson?.reward;
  if (reward == null && fs.existsSync(rewardTxtPath)) {
    reward = Number(fs.readFileSync(rewardTxtPath, 'utf8').trim());
  }

  const artifactPaths = [
    path.join(trial.trialPath, 'verifier', 'implementation.md'),
    path.join(trial.trialPath, 'artifacts', 'implementation.md'),
  ];
  let artifact = '';
  for (const p of artifactPaths) {
    if (fs.existsSync(p)) {
      artifact = fs.readFileSync(p, 'utf8');
      break;
    }
  }

  const agentOutput = findAgentOutput(trial.trialPath);
  const clarify_stall =
    rewardJson?.clarify_stall === true ||
    (reward === 0 && isClarifyOutput(agentOutput) && !rewardJson?.artifact_valid);

  const attempt = extractAttempt(trial.trialPath);
  const run = attempt != null && attempt > 0 ? attempt : ctx.runCounter.get(trial.task_id + trial.arm) || 1;
  if (attempt == null) ctx.runCounter.set(trial.task_id + trial.arm, run + 1);

  const task = ctx.tasks.get(trial.task_id) || {
    id: trial.task_id,
    category: 'unknown',
    workflow: 'design',
    prompt: '',
    fixture: null,
  };

  const artifactRel = `artifacts/${trial.task_id}_${trial.arm}_run${run}.md`;
  const artifactAbs = path.join(RESULTS_RAW, artifactRel);
  if (artifact) {
    fs.mkdirSync(path.dirname(artifactAbs), { recursive: true });
    fs.writeFileSync(artifactAbs, artifact);
  }

  const artifact_valid = rewardJson?.artifact_valid === true || /Captured \d+ source file\(s\):/.test(artifact);
  const status = artifact_valid && (reward ?? 0) >= 0.5 ? 'success' : 'failed';
  const resultsContractVersion = getResultsContractVersion();
  const model = ctx.model;

  const entry = {
    task_id: trial.task_id,
    category: task.category,
    run,
    arm: trial.arm,
    agent: ctx.release.agent,
    model,
    harness_version: getHarnessVersion(),
    results_contract_version: resultsContractVersion,
    runner: 'harbor',
    harbor_job: trial.jobName,
    harbor_trial: trial.trialName,
    job_fingerprint: computeJobFingerprint(task, {
      arm: trial.arm,
      run,
      agent: ctx.release.agent,
      model,
      resultsContractVersion,
    }),
    artifact_path: artifact ? artifactRel : null,
    duration_ms: rewardJson?.duration_ms ?? null,
    total_tokens: rewardJson?.total_tokens ?? null,
    cost_usd: rewardJson?.cost_usd ?? null,
    timestamp: new Date().toISOString(),
    scoring_target: 'implementation',
    status,
    artifact_valid,
    failed_gate: clarify_stall ? 'clarify_stall' : status === 'failed' ? 'harbor_verifier' : null,
    clarify_stall,
    harbor_reward: reward ?? 0,
    golden_coverage: rewardJson?.golden_coverage ?? null,
    llm_judge_mean: rewardJson?.llm_judge_mean ?? null,
    judge_mode: rewardJson?.judge_mode ?? null,
    interaction: {
      clarify_detected: clarify_stall || isClarifyOutput(agentOutput),
      clarify_stalled: clarify_stall,
      auto_replied: false,
    },
  };

  upsertIndexEntry(entry, RESULTS_RAW);
  return entry;
}

function main() {
  const opts = parseArgs();
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  const model = resolveBenchModel(release);
  const tasks = loadSuiteTasks();

  if (opts.fresh) {
    const indexPath = path.join(RESULTS_RAW, 'index.jsonl');
    if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath);
  }

  fs.mkdirSync(RESULTS_RAW, { recursive: true });
  const trials = listTrialDirs(opts.jobsDir);
  if (!trials.length) {
    console.log(`No Harbor trials found under ${opts.jobsDir}`);
    return;
  }

  const ctx = {
    release,
    model,
    tasks,
    runCounter: new Map(),
  };

  const ingested = [];
  for (const trial of trials) {
    try {
      ingested.push(ingestTrial(trial, ctx));
    } catch (err) {
      console.warn(`Skip ${trial.trialName}: ${err.message}`);
    }
  }

  console.log(`Ingested ${ingested.length} Harbor trial(s) → ${path.join(RESULTS_RAW, 'index.jsonl')}`);
  const byKey = new Set(ingested.map((e) => jobKey(e)));
  console.log(`Unique jobs: ${byKey.size}`);
  const stalls = ingested.filter((e) => e.clarify_stall).length;
  if (stalls) console.log(`Clarify stalls (secondary): ${stalls}`);
}

main();
