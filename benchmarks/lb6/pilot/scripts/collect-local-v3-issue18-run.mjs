#!/usr/bin/env node
/**
 * Collect Issue #18 RewardKit campaign results:
 *   benchmarks/lb6/pilot/publication/local-v3-issue18-rewardkit.{md,json}
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  HARBOR_AGENT,
  HARBOR_MODEL,
  HARBOR_VERSION,
  MEASUREMENT_CONTRACT,
  PILOT_ARMS,
  SKILL_RERUN_CAMPAIGN_ID,
  expectedPilotTaskDirName,
  parseSkillRerunPilotJobName,
  LAMINA_BENCH_SKILLS,
} from '../lib/constants.mjs';
import { resolveHarnessGitProvenance, loadSkillBundleManifest } from '../lib/skill-bundle.mjs';
import { assertDevelopmentCopy, extractCellRecord, listDirs } from './aggregate-results.mjs';
import { PUBLICATION_REL } from './run-three-arm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '../../../..');
const LOCAL_RUN_TASKS = Object.freeze([
  'dev-loan-library',
  'dev-review-room',
  'dev-simple-list',
  'dev-toggle-preference',
]);
const EXPECTED_CELLS = LOCAL_RUN_TASKS.length * PILOT_ARMS.length;
const CAMPAIGN_MARKER_REL = 'benchmarks/lb6/pilot/publication/local-v3-issue18-rewardkit.campaign.json';

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resultsPaths(root) {
  const dir = path.join(root, PUBLICATION_REL);
  return {
    dir,
    json: path.join(dir, 'local-v3-issue18-rewardkit.json'),
    markdown: path.join(dir, 'local-v3-issue18-rewardkit.md'),
    campaignMarker: path.join(root, CAMPAIGN_MARKER_REL),
  };
}

export function ensureCampaignMarker(root = DEFAULT_ROOT, { force = false } = {}) {
  const paths = resultsPaths(root);
  const existing = readJson(paths.campaignMarker);
  if (existing?.min_job_ts && !force) return existing;
  const marker = {
    kind: 'lb6-issue18-rewardkit-campaign',
    campaign_id: SKILL_RERUN_CAMPAIGN_ID,
    measurement: MEASUREMENT_CONTRACT,
    claim_surface: 'rewardkit_llm_judge',
    started_at: new Date().toISOString(),
    min_job_ts: Date.now(),
    skills_staged: LAMINA_BENCH_SKILLS.length,
  };
  fs.mkdirSync(path.dirname(paths.campaignMarker), { recursive: true });
  fs.writeFileSync(paths.campaignMarker, `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

function listJobs(root, minJobTs) {
  return listDirs(path.join(root, 'jobs'))
    .map((name) => {
      const parsed = parseSkillRerunPilotJobName(name);
      if (!parsed || !LOCAL_RUN_TASKS.includes(parsed.taskId) || !PILOT_ARMS.includes(parsed.arm)) {
        return null;
      }
      const tsNum = Number(parsed.ts) || 0;
      if (tsNum < minJobTs) return null;
      return { name, ...parsed, tsNum };
    })
    .filter(Boolean)
    .sort((a, b) => b.tsNum - a.tsNum);
}

function pickBest(candidates) {
  if (!candidates.length) return null;
  return candidates.sort((a, b) => {
    const av = a.measurementValid ? 1 : 0;
    const bv = b.measurementValid ? 1 : 0;
    if (av !== bv) return bv - av;
    return (b.tsNum || 0) - (a.tsNum || 0);
  })[0];
}

export function collectIssue18Results({ root = DEFAULT_ROOT, write = true, ensureMarker = false, forceMarker = false } = {}) {
  if (forceMarker) ensureCampaignMarker(root, { force: true });
  else if (ensureMarker) ensureCampaignMarker(root);
  const marker = readJson(path.join(root, CAMPAIGN_MARKER_REL));
  const minJobTs = Number(marker?.min_job_ts) || 0;
  const paths = resultsPaths(root);
  const byKey = new Map();
  for (const job of listJobs(root, minJobTs)) {
    const record = {
      ...extractCellRecord({ jobsRoot: path.join(root, 'jobs'), jobName: job.name }),
      tsNum: job.tsNum,
    };
    const key = `${job.taskId}/${job.arm}`;
    const list = byKey.get(key) || [];
    list.push(record);
    byKey.set(key, list);
  }
  const cells = [];
  for (const taskId of LOCAL_RUN_TASKS) {
    for (const arm of PILOT_ARMS) {
      const picked = pickBest(byKey.get(`${taskId}/${arm}`) || []);
      cells.push(
        picked || {
          taskId,
          arm,
          state: 'pending',
          reward: null,
          measurementValid: false,
          jobName: null,
          jobPath: null,
          reason: 'no issue-18 campaign job yet',
        },
      );
    }
  }

  const results = {};
  for (const taskId of LOCAL_RUN_TASKS) {
    results[taskId] = Object.fromEntries(PILOT_ARMS.map((arm) => [arm, null]));
  }
  for (const cell of cells) {
    if (cell.measurementValid) results[cell.taskId][cell.arm] = cell.reward;
  }

  const measurementValidCells = cells.filter((c) => c.measurementValid).length;
  const status =
    measurementValidCells === EXPECTED_CELLS
      ? 'ready_for_manual_publish'
      : cells.some((c) => c.state === 'running')
        ? 'in_progress'
        : measurementValidCells > 0
          ? 'in_progress'
          : 'in_progress';

  let skillCount = LAMINA_BENCH_SKILLS.length;
  try {
    skillCount = loadSkillBundleManifest(root).manifest.skills.length;
  } catch {
    // keep constant
  }
  const harness = resolveHarnessGitProvenance(root);
  const generatedAt = new Date().toISOString();

  const doc = {
    kind: 'lb6-local-v3-issue18-rewardkit',
    status,
    campaign_id: SKILL_RERUN_CAMPAIGN_ID,
    github_issue: 18,
    claim_surface: 'rewardkit_llm_judge',
    measurement: MEASUREMENT_CONTRACT,
    judge_mode: 'harbor_rewardkit',
    skills_staged: skillCount,
    campaign_started_at: marker?.started_at || null,
    min_job_ts: minJobTs || null,
    generated_at: generatedAt,
    harbor_version: HARBOR_VERSION,
    harbor_version_observed:
      `${spawnSync('harbor', ['--version'], { encoding: 'utf8' }).stdout || ''}`.trim().split('\n')[0] || null,
    agent: HARBOR_AGENT,
    model: HARBOR_MODEL,
    harness_commit: harness.harness_git_commit,
    development_only: true,
    confirmatory: false,
    marketing_claim_eligible: false,
    child_actual_model_unverified: true,
    expected_cells: EXPECTED_CELLS,
    present_cells: cells.filter((c) => c.state !== 'pending').length,
    measurement_valid_cells: measurementValidCells,
    results,
    cells: cells.map((cell) => ({
      taskId: cell.taskId,
      arm: cell.arm,
      taskDirName: cell.taskDirName || expectedPilotTaskDirName(cell.taskId, cell.arm),
      jobName: cell.jobName,
      jobPath: cell.jobPath,
      state: cell.state,
      reward: cell.measurementValid ? cell.reward : null,
      measurementValid: Boolean(cell.measurementValid),
      isolationMode: cell.isolationEvidence?.mode || null,
      reason: cell.reason || null,
      startedAt: cell.startedAt ?? null,
      finishedAt: cell.finishedAt ?? null,
      child_actual_model_unverified: true,
    })),
    limitations: [
      'Development-only; closes GitHub issue #18 shape (RewardKit + full skills + artifacts).',
      'Not LaminaBench-6 confirmatory evidence.',
      'Host-sealed semantic verifier / harbor-fork are disabled for this campaign.',
    ],
  };

  const lines = [];
  lines.push('# LB6 Issue #18 RewardKit run');
  lines.push('');
  lines.push('**Development-only.** Stock Harbor + RewardKit LLM judge; all staged lamina skills; step artifacts enabled.');
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(`- Status: \`${doc.status}\``);
  lines.push(`- GitHub issue: \`#18\``);
  lines.push(`- Measurement: \`${doc.measurement}\``);
  lines.push(`- Skills staged: \`${doc.skills_staged}\``);
  lines.push(`- Valid cells: \`${doc.measurement_valid_cells}/${doc.expected_cells}\``);
  lines.push(`- Generated: \`${doc.generated_at}\``);
  lines.push(`- \`development_only: true\` / \`confirmatory: false\``);
  lines.push('');
  lines.push('## Reward matrix');
  lines.push('');
  lines.push('| Task | direct | plan | lamina |');
  lines.push('|---|---:|---:|---:|');
  for (const taskId of LOCAL_RUN_TASKS) {
    const row = doc.results[taskId];
    const fmt = (v) => (v == null ? '—' : v);
    lines.push(`| \`${taskId}\` | ${fmt(row.direct)} | ${fmt(row.plan)} | ${fmt(row.lamina)} |`);
  }
  lines.push('');
  lines.push('## Per-task cells');
  lines.push('');
  for (const taskId of LOCAL_RUN_TASKS) {
    lines.push(`### \`${taskId}\``);
    lines.push('');
    lines.push('| Arm | Reward | Valid | State | Job |');
    lines.push('|---|---:|---|---|---|');
    for (const arm of PILOT_ARMS) {
      const cell = doc.cells.find((c) => c.taskId === taskId && c.arm === arm);
      lines.push(
        `| ${arm} | ${cell?.measurementValid ? cell.reward : '—'} | ${cell?.measurementValid ? 'yes' : 'no'} | \`${cell?.state || 'pending'}\` | \`${cell?.jobName || 'pending'}\` |`,
      );
    }
    lines.push('');
  }
  const markdown = `${lines.join('\n')}\n`;
  assertDevelopmentCopy(markdown);
  doc.report_sha256 = createHash('sha256').update(markdown).digest('hex');

  if (write) {
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.json, `${JSON.stringify(doc, null, 2)}\n`);
    fs.writeFileSync(paths.markdown, markdown);
  }
  return { doc, paths, markdown };
}

function main(argv = process.argv.slice(2)) {
  const forceMarker = argv.includes('--force-marker');
  const ensureMarker = argv.includes('--ensure-marker') || forceMarker;
  const { doc, paths } = collectIssue18Results({
    write: true,
    ensureMarker,
    forceMarker,
  });
  console.log(
    `Issue #18 results: status=${doc.status} valid=${doc.measurement_valid_cells}/${doc.expected_cells} skills=${doc.skills_staged}`,
  );
  console.log(`Wrote ${paths.markdown}`);
  console.log(`Wrote ${paths.json}`);
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
