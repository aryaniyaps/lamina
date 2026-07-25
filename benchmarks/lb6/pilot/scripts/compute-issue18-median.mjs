#!/usr/bin/env node
/**
 * Recompute Issue #18 RewardKit median claim from frozen seed packages.
 *
 * Reads:
 *   benchmarks/lb6/pilot/publication/seeds/seed-{1,2,3}-issue18-rewardkit.json
 * Writes:
 *   benchmarks/lb6/pilot/publication/local-v3-issue18-rewardkit-median.{md,json}
 *
 * Deterministic: same seed JSONs → same median matrix (job paths normalized to jobs/<name>).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PILOT_ARMS } from '../lib/constants.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const PUB = path.join(ROOT, 'benchmarks/lb6/pilot/publication');
const SEEDS_DIR = path.join(PUB, 'seeds');
const TASKS = Object.freeze([
  'dev-loan-library',
  'dev-review-room',
  'dev-simple-list',
  'dev-toggle-preference',
]);
const SEED_NS = [1, 2, 3];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function median3(a, b, c) {
  return [a, b, c].sort((x, y) => x - y)[1];
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function relativeJobPath(jobName, jobPath) {
  if (jobName) return `jobs/${jobName}`;
  if (!jobPath) return null;
  const base = path.basename(jobPath);
  return base ? `jobs/${base}` : null;
}

function loadSeed(n) {
  const filePath = path.join(SEEDS_DIR, `seed-${n}-issue18-rewardkit.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing seed package: ${path.relative(ROOT, filePath)}`);
  }
  const doc = readJson(filePath);
  if (doc.measurement_valid_cells !== 12) {
    throw new Error(
      `seed-${n}: expected 12 measurement-valid cells, got ${doc.measurement_valid_cells}`,
    );
  }
  const byKey = new Map();
  for (const cell of doc.cells || []) {
    if (!cell.measurementValid) {
      throw new Error(`seed-${n}: invalid cell ${cell.taskId}/${cell.arm}`);
    }
    byKey.set(`${cell.taskId}/${cell.arm}`, cell);
  }
  for (const taskId of TASKS) {
    for (const arm of PILOT_ARMS) {
      if (!byKey.has(`${taskId}/${arm}`)) {
        throw new Error(`seed-${n}: missing cell ${taskId}/${arm}`);
      }
    }
  }
  return { n, filePath, doc, byKey };
}

function mean(values) {
  return round4(values.reduce((s, v) => s + v, 0) / values.length);
}

export function computeIssue18Median({ write = true } = {}) {
  const seeds = SEED_NS.map(loadSeed);
  const cells = [];
  const resultsMedian = {};
  for (const taskId of TASKS) {
    resultsMedian[taskId] = {};
    for (const arm of PILOT_ARMS) {
      const s1 = seeds[0].byKey.get(`${taskId}/${arm}`);
      const s2 = seeds[1].byKey.get(`${taskId}/${arm}`);
      const s3 = seeds[2].byKey.get(`${taskId}/${arm}`);
      const rewards = [s1.reward, s2.reward, s3.reward];
      const med = median3(...rewards);
      const min = Math.min(...rewards);
      const max = Math.max(...rewards);
      resultsMedian[taskId][arm] = med;
      cells.push({
        taskId,
        arm,
        rewards: { seed1: s1.reward, seed2: s2.reward, seed3: s3.reward },
        median: med,
        min,
        max,
        range: round4(max - min),
        seeds: {
          1: {
            reward: s1.reward,
            jobName: s1.jobName,
            jobPath: relativeJobPath(s1.jobName, s1.jobPath),
          },
          2: {
            reward: s2.reward,
            jobName: s2.jobName,
            jobPath: relativeJobPath(s2.jobName, s2.jobPath),
          },
          3: {
            reward: s3.reward,
            jobName: s3.jobName,
            jobPath: relativeJobPath(s3.jobName, s3.jobPath),
          },
        },
      });
    }
  }

  const meansMedian = Object.fromEntries(
    PILOT_ARMS.map((arm) => [arm, mean(TASKS.map((t) => resultsMedian[t][arm]))]),
  );

  const doc = {
    kind: 'lb6-local-v3-issue18-rewardkit-median',
    status: 'ready_for_manual_publish',
    claim_surface: 'rewardkit_llm_judge_median_n3',
    measurement: 'rewardkit_llm_judge_v3',
    aggregation: 'per_cell_median_of_3_seeds',
    n_seeds: 3,
    seed_artifacts: SEED_NS.map((n) => `seeds/seed-${n}-issue18-rewardkit.json`),
    seed_generated_at: {
      seed1: seeds[0].doc.generated_at,
      seed2: seeds[1].doc.generated_at,
      seed3: seeds[2].doc.generated_at,
    },
    seed_harness_commit: {
      seed1: seeds[0].doc.harness_commit,
      seed2: seeds[1].doc.harness_commit,
      seed3: seeds[2].doc.harness_commit,
    },
    generated_at: new Date().toISOString(),
    github_issue: 18,
    skills_staged: seeds[0].doc.skills_staged,
    harbor_version: seeds[0].doc.harbor_version,
    agent: seeds[0].doc.agent,
    model: seeds[0].doc.model,
    judge_mode: 'harbor_rewardkit',
    development_only: true,
    confirmatory: false,
    marketing_claim_eligible: false,
    child_actual_model_unverified: true,
    expected_cells: 12,
    measurement_valid_cells_per_seed: Object.fromEntries(
      seeds.map((s) => [String(s.n), s.doc.measurement_valid_cells]),
    ),
    results_median: resultsMedian,
    means_median: meansMedian,
    cells,
    retries: [
      {
        seed: 2,
        cell: 'dev-loan-library/plan',
        reason: 'trial_exception (shape_build NonZeroAgentExitCodeError)',
        replacement_job: 'lb6-pilot-skill-rerun-v3-dev-loan-library-plan-1784916309722',
        reward: 0.5388,
      },
      {
        seed: 3,
        cell: 'dev-review-room/lamina',
        reason: 'AgentTimeoutError (reward present but measurement invalid)',
        replacement_job: 'lb6-pilot-skill-rerun-v3-dev-review-room-lamina-1784920693601',
        reward: 0.6408,
      },
    ],
    limitations: [
      'Development-only; not LaminaBench-6 confirmatory evidence.',
      'Per-cell median of n=3 independent full matrices under the frozen Issue #18 harness.',
      'Host-sealed semantic verifier / harbor-fork disabled for this campaign.',
      'Job directories under jobs/ are local/gitignored; seed packages + job names are the portable record.',
    ],
  };

  const lines = [];
  lines.push('# LB6 Issue #18 RewardKit — median of 3 seeds');
  lines.push('');
  lines.push(
    '**Development-only.** Claim surface = **per-cell median** across three independent full-matrix re-runs (same harness, gpt-5.5 RewardKit).',
  );
  lines.push('');
  lines.push(
    'Per-seed packages: [`seeds/`](./seeds/) · Run notes: [`seeds/RUN_NOTES.md`](./seeds/RUN_NOTES.md) · Reproduce: [`REPRODUCE.md`](./REPRODUCE.md)',
  );
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(`- Status: \`${doc.status}\``);
  lines.push(`- Aggregation: \`median\` of n=3 seeds`);
  lines.push('- Each seed: `12/12` measurement-valid');
  lines.push(`- Measurement: \`${doc.measurement}\``);
  lines.push(`- Skills staged: \`${doc.skills_staged}\``);
  lines.push(`- Generated: \`${doc.generated_at}\``);
  lines.push('- `development_only: true` / `confirmatory: false`');
  lines.push('');
  lines.push('## Median reward matrix (publish table)');
  lines.push('');
  lines.push('| Task | direct | plan | lamina |');
  lines.push('|---|---:|---:|---:|');
  for (const taskId of TASKS) {
    const row = resultsMedian[taskId];
    lines.push(`| \`${taskId}\` | ${row.direct} | ${row.plan} | ${row.lamina} |`);
  }
  lines.push('');
  lines.push(
    `**Means (median matrix):** lamina **${meansMedian.lamina}** · plan **${meansMedian.plan}** · direct **${meansMedian.direct}**`,
  );
  lines.push('');
  lines.push('## Per-seed matrices');
  lines.push('');
  for (const seed of seeds) {
    lines.push(`### Seed ${seed.n} (\`${seed.doc.generated_at}\`)`);
    lines.push('');
    lines.push('| Task | direct | plan | lamina |');
    lines.push('|---|---:|---:|---:|');
    for (const taskId of TASKS) {
      const row = seed.doc.results[taskId];
      lines.push(`| \`${taskId}\` | ${row.direct} | ${row.plan} | ${row.lamina} |`);
    }
    lines.push('');
  }
  lines.push('## Per-cell seed spread (median / min–max)');
  lines.push('');
  lines.push('| Task | Arm | seed1 | seed2 | seed3 | median | min | max | range |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const cell of cells) {
    lines.push(
      `| \`${cell.taskId}\` | ${cell.arm} | ${cell.rewards.seed1} | ${cell.rewards.seed2} | ${cell.rewards.seed3} | **${cell.median}** | ${cell.min} | ${cell.max} | ${cell.range} |`,
    );
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push(
    '- Seed 2: `dev-loan-library` plan first attempt had `trial_exception` (shape_build non-zero exit); re-ran same arm → valid (see [`seeds/RUN_NOTES.md`](./seeds/RUN_NOTES.md)).',
  );
  lines.push(
    '- Seed 3: `dev-review-room` lamina first attempt `AgentTimeoutError`; re-ran same arm → valid (see [`seeds/RUN_NOTES.md`](./seeds/RUN_NOTES.md)).',
  );
  lines.push(
    '- Harness unchanged between seeds (ABI-on-implement lamina path, budgets 240/360/600/300, judge `openai/gpt-5.5`).',
  );
  lines.push(
    '- Recompute: `npm run bench:lb6:v3:median-issue18` (this file is generated from `seeds/seed-*-issue18-rewardkit.json`).',
  );
  lines.push('');

  const markdown = lines.join('\n');
  const outJson = path.join(PUB, 'local-v3-issue18-rewardkit-median.json');
  const outMd = path.join(PUB, 'local-v3-issue18-rewardkit-median.md');
  if (write) {
    fs.writeFileSync(outJson, `${JSON.stringify(doc, null, 2)}\n`);
    fs.writeFileSync(outMd, markdown);
  }
  return { doc, markdown, paths: { json: outJson, markdown: outMd } };
}

function main() {
  const { doc, paths } = computeIssue18Median({ write: true });
  console.log(
    `Issue #18 median: lamina=${doc.means_median.lamina} plan=${doc.means_median.plan} direct=${doc.means_median.direct}`,
  );
  console.log(`Wrote ${path.relative(ROOT, paths.markdown)}`);
  console.log(`Wrote ${path.relative(ROOT, paths.json)}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
