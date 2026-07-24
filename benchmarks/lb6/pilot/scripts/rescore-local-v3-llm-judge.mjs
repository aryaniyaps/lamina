#!/usr/bin/env node
/**
 * Re-judge existing skill-rerun-v3 sealed candidates with host-side OpenAI LLM judge.
 * Writes protocol/llm-judge.json; does not mutate semantic reward.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PILOT_ARMS } from '../lib/constants.mjs';
import { loadEnvFiles } from '../lib/llm-judge/load-env.mjs';
import { runLlmJudge } from '../lib/llm-judge/run-llm-judge.mjs';
import {
  LOCAL_RUN_TASKS,
  collectLocalV3Results,
} from './collect-local-v3-results.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '../../../..');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function findTrialDir(jobPath) {
  if (!jobPath || !fs.existsSync(jobPath)) return null;
  const names = fs.readdirSync(jobPath).filter((name) => {
    if (name === 'job.log' || name.startsWith('.')) return false;
    return fs.statSync(path.join(jobPath, name)).isDirectory();
  });
  return names[0] ? path.join(jobPath, names[0]) : null;
}

/** Keep in sync with aggregate-results.mjs finalStepForArm. */
function finalStepForArm(arm) {
  return arm === 'lamina' ? 'fix' : 'verify_fix';
}

function loadSemanticDiagnostic(trialDir, arm) {
  const step = finalStepForArm(arm);
  const rewardPath = path.join(trialDir, 'steps', step, 'verifier', 'reward.json');
  const reportPath = path.join(trialDir, 'steps', step, 'verifier', 'behavior_report.json');
  const reward = readJson(rewardPath);
  const report = readJson(reportPath);
  return {
    reward: reward?.reward ?? null,
    measurement: reward?.measurement ?? report?.measurement ?? null,
    earned: report?.earned ?? reward?.earned ?? null,
    possible: report?.possible ?? reward?.possible ?? null,
    rawBehavior: report?.raw_behavior ?? reward?.raw_behavior ?? null,
    rewardPath: fs.existsSync(rewardPath) ? rewardPath : null,
    behaviorReportPath: fs.existsSync(reportPath) ? reportPath : null,
  };
}

function parseArgs(argv) {
  const out = {
    root: DEFAULT_ROOT,
    tasks: LOCAL_RUN_TASKS.slice(),
    arms: PILOT_ARMS.slice(),
    force: false,
    skipCollect: false,
    concurrency: 1,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--root') {
      out.root = path.resolve(next);
      i += 1;
    } else if (arg === '--tasks') {
      out.tasks = String(next)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg === '--arms') {
      out.arms = String(next)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg === '--concurrency') {
      out.concurrency = Math.max(1, Number(next) || 1);
      i += 1;
    } else if (arg === '--force') {
      out.force = true;
    } else if (arg === '--skip-collect') {
      out.skipCollect = true;
    }
  }
  return out;
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
}

export async function rescoreLocalV3LlmJudge(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  loadEnvFiles(root);
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY missing (set in repo-root .env or benchmarks/.env)');
  }

  const prior = collectLocalV3Results({ root, write: false }).doc;
  const wantedTasks = new Set(options.tasks || LOCAL_RUN_TASKS);
  const wantedArms = new Set(options.arms || PILOT_ARMS);
  const cells = prior.cells.filter(
    (cell) =>
      wantedTasks.has(cell.taskId)
      && wantedArms.has(cell.arm)
      && cell.state === 'completed'
      && cell.jobPath,
  );

  if (!cells.length) {
    throw new Error('no completed local v3 cells found to rescore');
  }

  const targets = [];
  for (const cell of cells) {
    const trialDir = findTrialDir(cell.jobPath);
    if (!trialDir) {
      targets.push({ cell, error: 'trial directory missing' });
      continue;
    }
    const seal = readJson(path.join(trialDir, 'protocol', 'final-seal.json'));
    const digest = seal?.candidate_digest;
    if (!digest) {
      targets.push({ cell, trialDir, error: 'final-seal.json missing candidate_digest' });
      continue;
    }
    const outPath = path.join(trialDir, 'protocol', 'llm-judge.json');
    if (!options.force && fs.existsSync(outPath)) {
      const existing = readJson(outPath);
      if (existing?.measurement === 'llm_judge_v3' && !existing?.llm_judge_degraded) {
        targets.push({
          cell,
          trialDir,
          digest,
          outPath,
          skipped: true,
          reward: existing.reward,
        });
        continue;
      }
    }
    targets.push({
      cell,
      trialDir,
      digest,
      outPath,
      semantic: loadSemanticDiagnostic(trialDir, cell.arm),
    });
  }

  const runnable = targets.filter((item) => item.digest && !item.skipped && !item.error);
  const scored = await mapPool(runnable, options.concurrency || 1, async (item) => {
    try {
      const result = await runLlmJudge({
        root,
        taskId: item.cell.taskId,
        arm: item.cell.arm,
        candidateDigest: item.digest,
        outPath: item.outPath,
        jobName: item.cell.jobName,
        trialPath: item.trialDir,
        semanticReward: item.semantic,
      });
      // Mirror under verifier dir for discoverability (do not overwrite reward.json).
      const step = finalStepForArm(item.cell.arm);
      const mirror = path.join(item.trialDir, 'steps', step, 'verifier', 'llm-judge.json');
      fs.mkdirSync(path.dirname(mirror), { recursive: true });
      fs.copyFileSync(item.outPath, mirror);
      return { ...item, ok: true, reward: result.reward, model: result.model };
    } catch (error) {
      if (error?.result && item.outPath) {
        fs.mkdirSync(path.dirname(item.outPath), { recursive: true });
        fs.writeFileSync(item.outPath, `${JSON.stringify(error.result, null, 2)}\n`);
      }
      return { ...item, ok: false, error: String(error.message || error) };
    }
  });

  const byKey = new Map(
    scored.map((item) => [`${item.cell.taskId}/${item.cell.arm}`, item]),
  );
  const summary = {
    kind: 'lb6-local-v3-llm-judge-rescore',
    generated_at: new Date().toISOString(),
    model: process.env.LB6_LLM_JUDGE_MODEL || process.env.OPENAI_JUDGE_MODEL || 'gpt-4.1',
    cells: targets.map((item) => {
      const key = `${item.cell.taskId}/${item.cell.arm}`;
      const ran = byKey.get(key);
      if (item.error) {
        return {
          taskId: item.cell.taskId,
          arm: item.cell.arm,
          jobName: item.cell.jobName,
          ok: false,
          error: item.error,
        };
      }
      if (item.skipped) {
        return {
          taskId: item.cell.taskId,
          arm: item.cell.arm,
          jobName: item.cell.jobName,
          ok: true,
          skipped: true,
          reward: item.reward,
          outPath: item.outPath,
        };
      }
      return {
        taskId: item.cell.taskId,
        arm: item.cell.arm,
        jobName: item.cell.jobName,
        ok: Boolean(ran?.ok),
        skipped: false,
        reward: ran?.reward ?? null,
        model: ran?.model ?? null,
        outPath: item.outPath,
        error: ran?.error || null,
      };
    }),
  };

  const summaryPath = path.join(
    root,
    'benchmarks/lb6/pilot/publication/local-v3-llm-judge-rescore.json',
  );
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  let collected = null;
  if (!options.skipCollect) {
    collected = collectLocalV3Results({ root, write: true });
  }

  const failed = summary.cells.filter((cell) => !cell.ok);
  return { summary, summaryPath, collected, failed };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const { summary, summaryPath, collected, failed } = await rescoreLocalV3LlmJudge(args);
  const okCount = summary.cells.filter((cell) => cell.ok).length;
  console.log(`LLM judge rescore: ${okCount}/${summary.cells.length} ok`);
  console.log(`Wrote ${summaryPath}`);
  if (collected) {
    console.log(
      `Collector: status=${collected.doc.status} measurement_valid=${collected.doc.measurement_valid_cells}/${collected.doc.expected_cells}`,
    );
    console.log(`Wrote ${collected.paths.markdown}`);
    console.log(`Wrote ${collected.paths.json}`);
  }
  for (const cell of summary.cells) {
    const label = `${cell.taskId}/${cell.arm}`;
    if (cell.skipped) console.log(`  skip ${label} reward=${cell.reward}`);
    else if (cell.ok) console.log(`  ok   ${label} reward=${cell.reward}`);
    else console.log(`  FAIL ${label} — ${cell.error}`);
  }
  process.exitCode = failed.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
