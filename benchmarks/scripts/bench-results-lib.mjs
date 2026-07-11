/**
 * Shared paths and helpers for LaminaBench result ingest / aggregation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const BENCH_ROOT = path.join(ROOT, 'benchmarks');
export const HARBOR_JOBS = path.join(BENCH_ROOT, 'results/harbor/jobs');
export const RAW_DIR = path.join(BENCH_ROOT, 'results/raw');
export const RAW_INDEX = path.join(RAW_DIR, 'index.jsonl');
export const RAW_REWARDS = path.join(RAW_DIR, 'rewards.jsonl');
export const AGGREGATED_DIR = path.join(BENCH_ROOT, 'results/aggregated');
export const AGGREGATED_BENCHMARK = path.join(AGGREGATED_DIR, 'benchmark.json');
export const METRIC_SCRIPT = path.join(BENCH_ROOT, 'harbor/dataset/metric.py');

export function parseHarborJobName(jobName) {
  const m = jobName.match(/^(task\d{3})-(control|treatment)(?:__run(\d+))?$/);
  if (!m) return null;
  return { task_id: m[1], arm: m[2], run: Number(m[3] || '1') };
}

export function parseHarborTaskName(taskName) {
  const m = String(taskName).match(/^(task\d{3})-(control|treatment)$/);
  if (!m) return null;
  return { task_id: m[1], arm: m[2] };
}

export function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function listJobDirs(jobsDir = HARBOR_JOBS) {
  if (!fs.existsSync(jobsDir)) return [];
  return fs
    .readdirSync(jobsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(jobsDir, d.name))
    .sort();
}

export function listTrialDirs(jobDir) {
  return fs
    .readdirSync(jobDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(jobDir, d.name));
}

export function trialDurationMs(result) {
  if (!result?.started_at || !result?.finished_at) return null;
  const start = Date.parse(result.started_at);
  const end = Date.parse(result.finished_at);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return end - start;
}

export function tokenTotals(result) {
  const ctx = result?.agent_result;
  if (!ctx) return { total_tokens: null, cost_usd: null };
  const input = ctx.n_input_tokens ?? null;
  const output = ctx.n_output_tokens ?? null;
  const total =
    input != null || output != null ? (input ?? 0) + (output ?? 0) : null;
  return { total_tokens: total, cost_usd: ctx.cost_usd ?? null };
}
