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

  const rewardPath = path.join(trialDir, 'verifier', 'reward.json');
  const rewardFile = fs.existsSync(rewardPath) ? readJsonSafe(rewardPath) : null;
  const jobMeta = parseHarborJobName(jobName);
  const taskMeta = parseHarborTaskName(result.task_name || '');
  const agentFailed = Boolean(result.agent_failed);
  const task_id =
    rewardFile?.lamina_task_id || jobMeta?.task_id || taskMeta?.task_id || result.lamina_task_id;
  const arm = rewardFile?.lamina_arm || jobMeta?.arm || taskMeta?.arm || result.lamina_arm;
  const run = rewardFile?.lamina_run || jobMeta?.run || result.lamina_run || 1;
  if (!task_id || !arm) return null;

  // No verifier output (agent failed or verifier skipped) → not a valid artifact.
  const hasVerifierReward = Boolean(rewardFile) && typeof rewardFile === 'object';
  const scoringIncomplete = Boolean(
    rewardFile?.scoring_incomplete || rewardFile?.llm_judge_degraded
  );
  const artifact_valid = agentFailed
    ? false
    : hasVerifierReward
      ? rewardFile.artifact_valid === true
      : false;

  const harborReward = agentFailed || !hasVerifierReward
    ? 0
    : scoringIncomplete
      ? 0
      : Number(rewardFile.reward ?? rewardFile.composite ?? 0);

  const { total_tokens, cost_usd } = tokenTotals(result);
  const duration_ms = trialDurationMs(result);

  let failed_gate = null;
  if (agentFailed) failed_gate = 'agent_failed';
  else if (!hasVerifierReward) failed_gate = 'no_verifier';
  else if (scoringIncomplete) failed_gate = 'llm_judge_degraded';
  else if (rewardFile?.clarify_stall) failed_gate = 'clarify_stall';
  else if (!artifact_valid) failed_gate = 'artifact_invalid';
  else if (harborReward < 0.5) failed_gate = 'harbor_verifier';

  const status =
    !agentFailed &&
    hasVerifierReward &&
    !scoringIncomplete &&
    artifact_valid &&
    harborReward >= 0.5
      ? 'passed'
      : 'failed';

  const indexRow = {
    task_id,
    category: rewardFile?.lamina_category ?? null,
    run,
    arm,
    agent: result.agent_info?.name ?? release.agent,
    model: result.agent_info?.model_info?.name ?? release.model,
    harness_version: release.harness_version,
    results_contract_version: release.results_contract_version,
    runner: result.runner ?? 'harbor',
    harbor_job: path.basename(jobDir),
    harbor_trial: result.trial_name ?? path.basename(trialDir),
    artifact_path: null,
    duration_ms,
    total_tokens,
    cost_usd,
    timestamp: result.finished_at ?? result.started_at ?? new Date().toISOString(),
    scoring_target: 'implementation',
    status,
    artifact_valid,
    agent_failed: agentFailed,
    scoring_incomplete: scoringIncomplete || agentFailed || !hasVerifierReward,
    failed_gate,
    clarify_stall: Boolean(rewardFile?.clarify_stall),
    harbor_reward: harborReward,
    llm_judge_mean: rewardFile?.llm_judge_mean ?? null,
    llm_scores: rewardFile?.llm_scores ?? null,
    judge_mode: rewardFile?.judge_mode ?? 'rewardkit_judge_only',
    judge_evidence: null,
    rewardkit_details: null,
    interaction: {
      clarify_detected: Boolean(rewardFile?.clarify_stall),
      clarify_stalled: Boolean(rewardFile?.clarify_stall),
      auto_replied: false,
    },
  };

  const rewardRow = hasVerifierReward
    ? {
        ...rewardFile,
        reward: harborReward,
        artifact_valid,
        scoring_incomplete: scoringIncomplete,
        agent_failed: agentFailed,
        lamina_task_id: task_id,
        lamina_arm: arm,
        lamina_run: run,
      }
    : {
        reward: 0,
        composite: 0,
        artifact_valid: false,
        scoring_incomplete: true,
        agent_failed: agentFailed,
        failed_gate,
        lamina_task_id: task_id,
        lamina_arm: arm,
        lamina_run: run,
        lamina_category: null,
        feedback: agentFailed
          ? `Agent harness failed (exit ${result.agent_exit_status ?? '?'})`
          : 'No verifier reward.json',
      };

  return { indexRow, reward: rewardRow };
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
  let excluded = 0;

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
      if (ingested.reward.scoring_incomplete || ingested.reward.agent_failed) {
        excluded++;
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
      (skipped ? ` (${skipped} skipped)` : '') +
      (excluded ? ` (${excluded} scoring_incomplete/agent_failed — excluded from claim aggregate)` : '')
  );
  console.log(`  index  → ${RAW_INDEX}`);
  console.log(`  rewards → ${RAW_REWARDS}`);
}

main();
