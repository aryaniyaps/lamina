#!/usr/bin/env node
/**
 * Aggregate Harbor publish job results into a judged summary table.
 * Prefers final-step reward.json; falls back to job-level Harbor metrics.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const jobsRoot = path.join(ROOT, 'jobs');
const outPath = path.join(ROOT, 'benchmarks/results/publish-final-results.json');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmarks/corpus/manifest.json'), 'utf8'));

function finalStepForArm(arm) {
  return arm === 'lamina' ? 'fix' : 'verify_fix';
}

function parseJobName(name) {
  // publish-<task>-<arm>-<timestamp>
  const m = name.match(/^publish-(.+)-(direct|plan|checklist|lamina)-(\d+)$/);
  if (!m) return null;
  return { task: m[1], arm: m[2], ts: m[3] };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

const trials = [];

for (const jobName of listDirs(jobsRoot)) {
  if (!jobName.startsWith('publish-')) continue;
  const parsed = parseJobName(jobName);
  if (!parsed) continue;
  const jobDir = path.join(jobsRoot, jobName);
  const jobResult = readJson(path.join(jobDir, 'result.json'));
  const finalStep = finalStepForArm(parsed.arm);

  for (const trialName of listDirs(jobDir)) {
    if (trialName === 'job.log' || trialName.startsWith('.')) continue;
    const trialDir = path.join(jobDir, trialName);
    if (!fs.statSync(trialDir).isDirectory()) continue;
    if (!trialName.includes(parsed.task) && !trialName.includes(parsed.arm)) {
      // still accept harbor trial folders
    }
    const rewardPath = path.join(trialDir, 'steps', finalStep, 'verifier', 'reward.json');
    const reportPath = path.join(trialDir, 'steps', finalStep, 'verifier', 'behavior_report.json');
    const reward = readJson(rewardPath);
    const report = readJson(reportPath);
    if (!reward && !report) continue;

    trials.push({
      job: jobName,
      trial: trialName,
      task: parsed.task,
      arm: parsed.arm,
      reward: reward?.reward ?? report?.reward ?? null,
      behavior: reward?.behavior ?? report?.behavior_pass_rate ?? report?.scores?.behavior ?? null,
      import_ok: reward?.import_ok ?? report?.scores?.import ?? null,
      invalid_treatment: report?.invalid_treatment ?? false,
      treatment_missing: report?.treatment?.missing ?? [],
      sequences: (report?.sequences ?? []).map((s) => ({
        actor: s.actor,
        passed: s.passed,
        errors: s.errors ?? [],
      })),
      finished_at: jobResult?.finished_at ?? null,
    });
  }
}

// Keep latest job per task×arm×trial-ish: group by task×arm
function cellKey(t) {
  return `${t.task}::${t.arm}`;
}

const byCell = new Map();
for (const trial of trials) {
  const key = cellKey(trial);
  if (!byCell.has(key)) byCell.set(key, []);
  byCell.get(key).push(trial);
}

const cells = [];
for (const [key, cellTrials] of [...byCell.entries()].sort()) {
  const [task, arm] = key.split('::');
  // Prefer trials from the newest job name (lexicographic timestamp suffix)
  const jobs = [...new Set(cellTrials.map((t) => t.job))].sort();
  const latestJob = jobs[jobs.length - 1];
  const latest = cellTrials.filter((t) => t.job === latestJob);
  const rewards = latest.map((t) => t.reward).filter((r) => typeof r === 'number');
  const mean = rewards.length ? rewards.reduce((a, b) => a + b, 0) / rewards.length : null;
  cells.push({
    task,
    arm,
    job: latestJob,
    n_trials: latest.length,
    rewards,
    mean_reward: mean,
    mean_behavior: latest
      .map((t) => t.behavior)
      .filter((r) => typeof r === 'number')
      .reduce((a, b, _, arr) => a + b / arr.length, 0) || null,
    invalid_treatment_count: latest.filter((t) => t.invalid_treatment).length,
    trials: latest,
  });
}

const expected = [];
for (const task of manifest.tasks) {
  for (const arm of manifest.arms) {
    expected.push({ task: task.id, arm });
  }
}

const coverage = expected.map(({ task, arm }) => {
  const cell = cells.find((c) => c.task === task && c.arm === arm);
  return {
    task,
    arm,
    status: cell ? 'done' : 'missing',
    mean_reward: cell?.mean_reward ?? null,
    n_trials: cell?.n_trials ?? 0,
    job: cell?.job ?? null,
  };
});

const summary = {
  generated_at: new Date().toISOString(),
  measurement: 'behavior_pass_rate (final step)',
  n_cells_done: coverage.filter((c) => c.status === 'done').length,
  n_cells_expected: coverage.length,
  coverage,
  cells,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n');

console.log('Final judged results → ' + outPath);
console.log(`Coverage: ${summary.n_cells_done}/${summary.n_cells_expected} cells\n`);
console.log('task\tarm\tstatus\tn\tmean_reward');
for (const row of coverage) {
  console.log(
    `${row.task}\t${row.arm}\t${row.status}\t${row.n_trials}\t${row.mean_reward ?? '-'}`
  );
}
