#!/usr/bin/env node
/**
 * Ingest Harbor job directories into LaminaBench raw results.
 *
 * Usage:
 *   node benchmarks/scripts/ingest-harbor-results.mjs [--jobs-dir PATH] [--fresh]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';
import {
  HARBOR_JOBS,
  RAW_DIR,
  RAW_INDEX,
  RAW_REWARDS,
  listJobDirs,
  listTrialDirs,
  parseHarborJobName,
  parseHarborTaskName,
  readJsonSafe,
  tokenTotals,
  trialDurationMs,
} from './bench-results-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs() {
  const opts = { jobsDir: HARBOR_JOBS, fresh: process.argv.includes('--fresh') };
  const idx = process.argv.indexOf('--jobs-dir');
  if (idx !== -1) opts.jobsDir = path.resolve(process.argv[idx + 1]);
  return opts;
}

function loadRelease() {
  return readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
}

function ingestTrial({ jobDir, jobName, trialDir, release }) {
  const result = readJsonSafe(path.join(trialDir, 'result.json'));
  if (!result) return null;

  const reward = readJsonSafe(path.join(trialDir, 'verifier', 'reward.json')) ?? {};
  const jobMeta = parseHarborJobName(jobName);
  const taskMeta = parseHarborTaskName(result.task_name || '');
  const task_id = reward.lamina_task_id || jobMeta?.task_id || taskMeta?.task_id;
  const arm = reward.lamina_arm || jobMeta?.arm || taskMeta?.arm;
  const run = reward.lamina_run || jobMeta?.run || 1;
  if (!task_id || !arm) return null;

  const harborReward = Number(reward.reward ?? reward.composite ?? 0);
  const goldenCoverage =
    typeof reward.golden_coverage === 'number'
      ? reward.golden_coverage
      : Math.round(Number(reward.golden_coverage_norm ?? 0) * 100);
  const { total_tokens, cost_usd } = tokenTotals(result);
  const duration_ms = trialDurationMs(result);

  const indexRow = {
    task_id,
    category: reward.lamina_category ?? null,
    run,
    arm,
    agent: result.agent_info?.name ?? release.agent,
    model: result.agent_info?.model_info?.name ?? release.model,
    harness_version: release.harness_version,
    results_contract_version: release.results_contract_version,
    runner: 'harbor',
    harbor_job: path.basename(jobDir),
    harbor_trial: result.trial_name ?? path.basename(trialDir),
    artifact_path: null,
    duration_ms,
    total_tokens,
    cost_usd,
    timestamp: result.finished_at ?? result.started_at ?? new Date().toISOString(),
    scoring_target: 'implementation',
    status: harborReward >= 0.5 && reward.artifact_valid !== false ? 'passed' : 'failed',
    artifact_valid: reward.artifact_valid !== false,
    failed_gate: harborReward >= 0.5 ? null : reward.clarify_stall ? 'clarify_stall' : 'harbor_verifier',
    clarify_stall: Boolean(reward.clarify_stall),
    harbor_reward: harborReward,
    golden_coverage: goldenCoverage,
    golden_checks_passed: reward.checks_passed ?? null,
    golden_checks_total: reward.checks_total ?? null,
    llm_judge_mean: reward.llm_judge_mean ?? null,
    llm_scores: reward.llm_scores ?? null,
    judge_mode: reward.judge_mode ?? 'rewardkit',
    judge_evidence: null,
    rewardkit_details: null,
    interaction: {
      clarify_detected: Boolean(reward.clarify_stall),
      clarify_stalled: Boolean(reward.clarify_stall),
      auto_replied: false,
    },
  };

  return { indexRow, reward };
}

function main() {
  const opts = parseArgs();
  const release = loadRelease();
  fs.mkdirSync(RAW_DIR, { recursive: true });

  if (opts.fresh) {
    for (const p of [RAW_INDEX, RAW_REWARDS]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }

  const indexRows = [];
  const rewardRows = [];
  let skipped = 0;

  for (const jobDir of listJobDirs(opts.jobsDir)) {
    const jobName = path.basename(jobDir);
    for (const trialDir of listTrialDirs(jobDir)) {
      const ingested = ingestTrial({
        jobDir,
        jobName,
        trialDir,
        release,
      });
      if (!ingested) {
        skipped++;
        continue;
      }
      indexRows.push(ingested.indexRow);
      rewardRows.push(ingested.reward);
    }
  }

  if (indexRows.length) {
    fs.appendFileSync(
      RAW_INDEX,
      indexRows.map((r) => JSON.stringify(r)).join('\n') + '\n'
    );
    fs.appendFileSync(
      RAW_REWARDS,
      rewardRows.map((r) => JSON.stringify(r)).join('\n') + '\n'
    );
  }

  console.log(
    `Ingested ${indexRows.length} trial(s) from ${listJobDirs(opts.jobsDir).length} job dir(s)` +
      (skipped ? ` (${skipped} skipped)` : '')
  );
  console.log(`  index  → ${RAW_INDEX}`);
  console.log(`  rewards → ${RAW_REWARDS}`);
}

main();
