#!/usr/bin/env node
/**
 * Accumulate skill-rerun-v3 Harbor cells into one publish-oriented results pair:
 *   benchmarks/lb6/pilot/publication/local-v3-results.{md,json}
 *
 * Reuses aggregate extractCellRecord scoring; does not invent rewards.
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
  PINNED_SKILL_COMMIT,
  PILOT_ARMS,
  SKILL_RERUN_CAMPAIGN_ID,
  expectedPilotTaskDirName,
  parseSkillRerunPilotJobName,
} from '../lib/constants.mjs';
import { resolveHarnessGitProvenance, loadSkillBundleManifest } from '../lib/skill-bundle.mjs';
import {
  assertDevelopmentCopy,
  extractCellRecord,
  listDirs,
} from './aggregate-results.mjs';
import { PUBLICATION_REL, TASKS_REL, preparePublicationPlan } from './run-three-arm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '../../../..');

export const LOCAL_RUN_TASKS = Object.freeze([
  'dev-loan-library',
  'dev-review-room',
  'dev-simple-list',
  'dev-toggle-preference',
]);

const EXPECTED_CELLS = LOCAL_RUN_TASKS.length * PILOT_ARMS.length;

function jobsRoot(root) {
  return path.join(root, 'jobs');
}

function publicationDir(root) {
  return path.join(root, PUBLICATION_REL);
}

function resultsPaths(root) {
  const dir = publicationDir(root);
  return {
    dir,
    json: path.join(dir, 'local-v3-results.json'),
    markdown: path.join(dir, 'local-v3-results.md'),
    publishPlan: path.join(dir, 'manual-publish-plan-v3.json'),
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function harborCliVersion() {
  const probe = spawnSync('harbor', ['--version'], { encoding: 'utf8' });
  return `${probe.stdout || ''}${probe.stderr || ''}`.trim().split('\n')[0] || null;
}

function listSkillRerunV3Jobs(root) {
  const rootJobs = jobsRoot(root);
  return listDirs(rootJobs)
    .map((name) => {
      const parsed = parseSkillRerunPilotJobName(name);
      if (!parsed) return null;
      if (!LOCAL_RUN_TASKS.includes(parsed.taskId)) return null;
      if (!PILOT_ARMS.includes(parsed.arm)) return null;
      return { name, ...parsed, tsNum: Number(parsed.ts) || 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.tsNum - a.tsNum);
}

function cellRank(record) {
  if (!record) return -1;
  if (record.measurementValid) return 300;
  if (record.llmJudgeReward != null) return 250;
  if (record.state === 'completed' && record.ok) return 200;
  if (record.state === 'completed') return 150;
  if (record.state === 'running') return 120;
  if (record.finishedAt || record.startedAt) return 50;
  if (record.state && record.state !== 'job_missing' && record.state !== 'trial_missing') return 25;
  return 0;
}

function isJobStillRunning(record) {
  if (!record?.jobPath) return false;
  const jobResult = readJson(path.join(record.jobPath, 'result.json'));
  if (!jobResult) return false;
  if (jobResult.finished_at) return false;
  // Orphaned Harbor jobs can leave n_running_trials=1 forever after a killed parent.
  // Only treat as running when the result file was updated recently.
  const updated = Date.parse(jobResult.updated_at || jobResult.started_at || '');
  if (!Number.isFinite(updated)) return false;
  const maxAgeMs = 45 * 60 * 1000;
  if (Date.now() - updated > maxAgeMs) return false;
  return Number(jobResult?.stats?.n_running_trials || 0) > 0 || jobResult.finished_at == null;
}

function loadLlmJudge(trialPath) {
  if (!trialPath) return null;
  const judgePath = path.join(trialPath, 'protocol', 'llm-judge.json');
  const judge = readJson(judgePath);
  if (!judge) return null;
  return { judge, judgePath };
}

/**
 * Claim surface is host-side llm_judge_v3 (Option D style).
 * Offline semantic_criteria_v3 remains diagnostic only.
 */
function applyJudgeClaim(record) {
  if (!record || record.state === 'pending') return record;
  const loaded = loadLlmJudge(record.trialPath);
  const judge = loaded?.judge || null;
  const judgeOk = Boolean(
    judge
      && judge.measurement === 'llm_judge_v3'
      && !judge.llm_judge_degraded
      && !judge.scoring_incomplete
      && typeof judge.reward === 'number',
  );
  const protocolOk = Boolean(
    record.state === 'completed'
      && !record.treatmentInvalid
      && record.skillEvidence?.passed !== false
      && record.isolationEvidence?.passed !== false
      && !record.verifierIsolation?.breach,
  );
  const measurementValid = Boolean(judgeOk && protocolOk);
  return {
    ...record,
    claimSurface: 'llm_judge',
    measurement: 'llm_judge_v3',
    judgeMode: 'openai_judge_only',
    semanticReward: record.observedReward ?? null,
    semanticMeasurementValid: Boolean(record.measurementValid),
    semanticEarned: record.earned ?? null,
    semanticPossible: record.possible ?? null,
    semanticRawBehavior: record.rawBehavior ?? null,
    llmJudge: judge,
    llmJudgePath: loaded?.judgePath || null,
    llmJudgeModel: judge?.model ?? null,
    llmJudgeReward: judgeOk ? judge.reward : null,
    reward: measurementValid ? judge.reward : null,
    measurementValid,
    reason:
      measurementValid
        ? null
        : (!judge
          ? (record.reason || 'llm_judge.json missing — run bench:lb6:v3:rescore-llm-judge')
          : (judge.degradation_reason || record.reason || 'llm judge degraded or protocol incomplete')),
  };
}

function normalizeCellRecord(record) {
  if (!record || record.state === 'pending') return record;
  if (isJobStillRunning(record)) {
    return {
      ...record,
      state: 'running',
      measurementValid: false,
      reason: record.reason || 'Harbor job still running',
    };
  }
  return applyJudgeClaim(record);
}

function pickBestCell(candidates) {
  if (!candidates.length) return null;
  const newestTs = Math.max(...candidates.map((item) => item.tsNum || 0));
  const normalized = candidates.map((candidate) => {
    const record = normalizeCellRecord(candidate);
    // Only the newest job for a cell may stay "running"; older unfinished jobs are abandoned.
    if (record.state === 'running' && (record.tsNum || 0) < newestTs) {
      return {
        ...record,
        state: 'abandoned',
        reason: 'superseded by a newer skill-rerun-v3 job',
      };
    }
    return record;
  });

  let best = null;
  for (const candidate of normalized) {
    if (!best) {
      best = candidate;
      continue;
    }
    const rankDiff = cellRank(candidate) - cellRank(best);
    if (rankDiff > 0) {
      best = candidate;
      continue;
    }
    if (rankDiff === 0 && (candidate.tsNum || 0) > (best.tsNum || 0)) {
      best = candidate;
    }
  }
  return best;
}

function extractAllCells(root) {
  const rootJobs = jobsRoot(root);
  const byKey = new Map();
  for (const job of listSkillRerunV3Jobs(root)) {
    const key = `${job.taskId}/${job.arm}`;
    const list = byKey.get(key) || [];
    const record = extractCellRecord({ jobsRoot: rootJobs, jobName: job.name });
    list.push({ ...record, tsNum: job.tsNum });
    byKey.set(key, list);
  }

  const cells = [];
  for (const taskId of LOCAL_RUN_TASKS) {
    for (const arm of PILOT_ARMS) {
      const key = `${taskId}/${arm}`;
      const picked = pickBestCell(byKey.get(key) || []);
      if (picked) {
        cells.push(picked);
      } else {
        cells.push({
          taskId,
          arm,
          jobName: null,
          jobPath: null,
          state: 'pending',
          reward: null,
          rawBehavior: null,
          earned: null,
          possible: null,
          measurementValid: false,
          treatmentInvalid: false,
          invalidTreatment: false,
          skillEvidence: null,
          reason: 'no skill-rerun-v3 job found yet',
          child_actual_model_unverified: true,
        });
      }
    }
  }
  return cells;
}

function mergeTriage(priorTriage, cells, generatedAt) {
  const triage = Array.isArray(priorTriage) ? [...priorTriage] : [];
  const seen = new Set(triage.map((entry) => entry.id).filter(Boolean));

  for (const cell of cells) {
    if (!cell.taskId || !cell.arm) continue;
    if (cell.state === 'pending' || cell.state === 'running') continue;
    if (cell.measurementValid && cell.state === 'completed') continue;

    const id = `${cell.jobName || 'no-job'}:${cell.state}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const reason =
      cell.reason
      || cell.measurementInvalidReason
      || cell.exception?.exception_message
      || cell.stepExceptions?.[0]?.message
      || cell.skillEvidence?.reason
      || null;

    triage.push({
      id,
      at: generatedAt,
      taskId: cell.taskId,
      arm: cell.arm,
      state: cell.state,
      jobName: cell.jobName,
      reason,
    });
  }

  return triage;
}

function buildResultsMatrix(cells) {
  const results = {};
  for (const taskId of LOCAL_RUN_TASKS) {
    results[taskId] = Object.fromEntries(PILOT_ARMS.map((arm) => [arm, null]));
  }
  for (const cell of cells) {
    if (!results[cell.taskId]) continue;
    results[cell.taskId][cell.arm] = cell.measurementValid ? cell.reward : null;
  }
  return results;
}

function summarizeStatus(cells) {
  const measurementValid = cells.filter((cell) => cell.measurementValid === true);
  const running = cells.some((cell) => cell.state === 'running');
  const blocked = cells.filter(
    (cell) =>
      cell.state !== 'pending'
      && cell.state !== 'completed'
      && cell.state !== 'running'
      && !cell.measurementValid,
  );
  if (measurementValid.length === EXPECTED_CELLS) return 'ready_for_manual_publish';
  if (running) return 'in_progress';
  if (blocked.length) return 'blocked';
  return 'in_progress';
}

function buildPublishCommands(cells) {
  const eligible = cells.filter((cell) => cell.measurementValid && cell.jobName && cell.taskDirName);
  const taskDirs = [...new Set(eligible.map((cell) => cell.taskDirName))].sort();
  return {
    note: 'Manual operator step only. Collector does not execute Harbor publication.',
    campaign_id: SKILL_RERUN_CAMPAIGN_ID,
    publication_eligible: eligible.length === EXPECTED_CELLS,
    commands: [
      ...taskDirs.map((taskDirName) => `harbor publish --public ${path.join(TASKS_REL, taskDirName)}`),
      ...eligible.map((cell) => `harbor upload --public ${path.join('jobs', cell.jobName)}`),
    ],
    blocked_until: 'authenticated Harbor CLI + explicit approval to disclose a development-only package',
    blocked_reasons: [
      'development-only package; not eligible for a confirmatory or marketing claim',
      'Cursor persona child actual selected model is unverified',
      'Harbor registry authentication is required for publish/upload',
      'frozen dev-care-circle package is excluded from this plan',
      ...(eligible.length === EXPECTED_CELLS
        ? []
        : [`only ${eligible.length}/${EXPECTED_CELLS} measurement-valid cells present`]),
    ],
  };
}

function renderMarkdown(doc) {
  const lines = [];
  lines.push('# LB6 local v3 results (publish prep)');
  lines.push('');
  lines.push(
    '**Development-only / non-confirmatory.** Do not treat these cells as LaminaBench-6 confirmatory evidence, a product-win advertisement, or a frozen statistical gate result.',
  );
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(`- Status: \`${doc.status}\``);
  lines.push(`- Campaign: \`${doc.campaign_id}\``);
  lines.push(`- Claim surface: \`${doc.claim_surface}\` / measurement \`${doc.measurement}\``);
  lines.push(`- Judge mode: \`${doc.judge_mode}\``);
  lines.push(`- Judge model: \`${doc.judge_model || 'n/a'}\``);
  lines.push(`- Generated: \`${doc.generated_at}\``);
  lines.push(`- Completed measurement-valid cells: \`${doc.measurement_valid_cells}/${doc.expected_cells}\``);
  lines.push(`- Present jobs (any state): \`${doc.present_cells}/${doc.expected_cells}\``);
  lines.push(`- Harbor CLI (host): \`${doc.harbor_version_observed || 'unknown'}\``);
  lines.push(`- Harbor pin: \`${doc.harbor_version}\``);
  lines.push(`- Agent: \`${doc.agent}\``);
  lines.push(`- Model: \`${doc.model}\``);
  lines.push(`- Attempts per cell: \`${doc.attempts_per_cell}\``);
  lines.push(`- Source skill commit: \`${doc.source_skill_commit}\``);
  lines.push(`- Harness commit: \`${doc.harness_commit || 'unknown'}\``);
  lines.push(`- Harness clean (meaningful): \`${doc.harness_git_clean}\``);
  lines.push(`- \`child_actual_model_unverified: true\``);
  lines.push(`- \`development_only: true\` / \`confirmatory: false\` / \`marketing_claim_eligible: false\``);
  lines.push('');
  lines.push('## Reward matrix (LLM judge claim)');
  lines.push('');
  lines.push('| Task | direct | plan | lamina |');
  lines.push('|---|---:|---:|---:|');
  for (const taskId of LOCAL_RUN_TASKS) {
    const row = doc.results[taskId] || {};
    const fmt = (value) => (value === null || value === undefined ? '—' : value);
    lines.push(`| \`${taskId}\` | ${fmt(row.direct)} | ${fmt(row.plan)} | ${fmt(row.lamina)} |`);
  }
  lines.push('');
  lines.push('Primary rewards are host-side `llm_judge_v3` (OpenAI). Shown only when `measurementValid` is true.');
  lines.push('');
  lines.push('## Semantic diagnostic matrix (not claim)');
  lines.push('');
  lines.push('| Task | direct | plan | lamina |');
  lines.push('|---|---:|---:|---:|');
  for (const taskId of LOCAL_RUN_TASKS) {
    const row = doc.semantic_results?.[taskId] || {};
    const fmt = (value) => (value === null || value === undefined ? '—' : value);
    lines.push(`| \`${taskId}\` | ${fmt(row.direct)} | ${fmt(row.plan)} | ${fmt(row.lamina)} |`);
  }
  lines.push('');
  lines.push('Offline `semantic_criteria_v3` Laplace scores retained as diagnostic only.');
  lines.push('');
  lines.push('## Per-task cells');
  lines.push('');
  for (const taskId of LOCAL_RUN_TASKS) {
    lines.push(`### \`${taskId}\``);
    lines.push('');
    lines.push('| Arm | Judge reward | Semantic | Earned | measurementValid | treatmentInvalid | State | Job |');
    lines.push('|---|---:|---:|---:|---|---|---|---|');
    for (const arm of PILOT_ARMS) {
      const cell = doc.cells.find((item) => item.taskId === taskId && item.arm === arm);
      lines.push(
        `| ${arm} | ${cell?.measurementValid ? cell.reward : '—'} | ${cell?.semanticReward ?? '—'} | ${cell?.semanticEarned ?? '—'}/${cell?.semanticPossible ?? '—'} | ${cell?.measurementValid ? 'yes' : 'no'} | ${cell?.treatmentInvalid ? 'yes' : 'no'} | \`${cell?.state || 'pending'}\` | \`${cell?.jobName || 'pending'}\` |`,
      );
    }
    lines.push('');
  }
  lines.push('## Job paths');
  lines.push('');
  for (const cell of doc.cells) {
    lines.push(`- ${cell.taskId}/${cell.arm}: \`${cell.jobPath || 'pending'}\``);
  }
  lines.push('');
  lines.push('## Triage log');
  lines.push('');
  if (!doc.triage?.length) {
    lines.push('- None yet.');
  } else {
    for (const entry of doc.triage) {
      lines.push(
        `- \`${entry.at}\` **${entry.taskId}/${entry.arm}** state=\`${entry.state}\` job=\`${entry.jobName || 'n/a'}\`${entry.reason ? ` — ${entry.reason}` : ''}`,
      );
    }
  }
  lines.push('');
  lines.push('## Limitations');
  lines.push('');
  for (const item of doc.limitations) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('## Publication checklist');
  lines.push('');
  const allValid = doc.measurement_valid_cells === doc.expected_cells;
  lines.push(`- [${allValid ? 'x' : ' '}] All 12 cells measurement-valid`);
  lines.push(`- [${allValid ? 'x' : ' '}] Review \`local-v3-results.md\` / \`.json\` for triage blockers`);
  lines.push('- [ ] `harbor auth login` (or `HARBOR_API_KEY` in repo-root `.env`)');
  lines.push('- [ ] Confirm frozen `dev-care-circle` is not republished from this package');
  lines.push('- [ ] Run publish/upload commands below only after explicit approval');
  lines.push('');
  lines.push('### Manual Harbor commands');
  lines.push('');
  if (!doc.publish?.commands?.length) {
    lines.push('_No publication commands yet — commands appear when cells are measurement-valid._');
  } else {
    for (const command of doc.publish.commands) {
      lines.push(`- \`${command}\``);
    }
  }
  lines.push('');
  lines.push(`Blocked until: ${doc.publish?.blocked_until || 'n/a'}`);
  lines.push('');
  for (const reason of doc.publish?.blocked_reasons || []) {
    lines.push(`- ${reason}`);
  }
  lines.push('');
  const markdown = `${lines.join('\n')}\n`;
  assertDevelopmentCopy(markdown);
  return markdown;
}

export function collectLocalV3Results({ root = DEFAULT_ROOT, write = true } = {}) {
  const generatedAt = new Date().toISOString();
  const paths = resultsPaths(root);
  const prior = readJson(paths.json);
  const cells = extractAllCells(root);
  const harness = resolveHarnessGitProvenance(root);
  let skillCommit = PINNED_SKILL_COMMIT;
  try {
    const bundle = loadSkillBundleManifest(root);
    skillCommit = bundle?.manifest?.source_skill_commit || bundle?.manifest?.pinned_commit || skillCommit;
  } catch {
    // Keep constant pin when staged manifest is unavailable.
  }

  const measurementValidCells = cells.filter((cell) => cell.measurementValid).length;
  const presentCells = cells.filter((cell) => cell.state !== 'pending').length;
  const status = summarizeStatus(cells);
  const publish = buildPublishCommands(cells);
  const triage = mergeTriage(prior?.triage, cells, generatedAt);
  const judgeModels = [...new Set(cells.map((cell) => cell.llmJudgeModel).filter(Boolean))];
  const semanticResults = {};
  for (const taskId of LOCAL_RUN_TASKS) {
    semanticResults[taskId] = Object.fromEntries(PILOT_ARMS.map((arm) => [arm, null]));
  }
  for (const cell of cells) {
    if (!semanticResults[cell.taskId]) continue;
    semanticResults[cell.taskId][cell.arm] = cell.semanticReward ?? null;
  }

  const doc = {
    kind: 'lb6-local-v3-results',
    status,
    campaign_id: SKILL_RERUN_CAMPAIGN_ID,
    claim_surface: 'llm_judge',
    measurement: 'llm_judge_v3',
    judge_mode: 'openai_judge_only',
    judge_model: judgeModels[0] || process.env.LB6_LLM_JUDGE_MODEL || process.env.OPENAI_JUDGE_MODEL || 'gpt-4.1',
    generated_at: generatedAt,
    visibility: 'local',
    harbor_version: HARBOR_VERSION,
    harbor_version_observed: harborCliVersion(),
    agent: HARBOR_AGENT,
    model: HARBOR_MODEL,
    source_skill_commit: skillCommit,
    harness_commit: harness.harness_git_commit,
    harness_git_clean: harness.harness_git_clean,
    development_only: true,
    confirmatory: false,
    marketing_claim_eligible: false,
    child_actual_model_unverified: true,
    attempts_per_cell: 1,
    harbor_retries: 0,
    expected_cells: EXPECTED_CELLS,
    present_cells: presentCells,
    measurement_valid_cells: measurementValidCells,
    results: buildResultsMatrix(cells),
    semantic_results: semanticResults,
    cells: cells.map((cell) => ({
      taskId: cell.taskId,
      arm: cell.arm,
      taskDirName: cell.taskDirName || expectedPilotTaskDirName(cell.taskId, cell.arm),
      jobName: cell.jobName,
      jobPath: cell.jobPath,
      trialPath: cell.trialPath || null,
      state: cell.state,
      claimSurface: 'llm_judge',
      measurement: 'llm_judge_v3',
      reward: cell.measurementValid ? cell.reward : null,
      llmJudgeReward: cell.llmJudgeReward ?? null,
      llmJudgeModel: cell.llmJudgeModel ?? null,
      llmJudgePath: cell.llmJudgePath ?? null,
      semanticReward: cell.semanticReward ?? null,
      semanticMeasurementValid: Boolean(cell.semanticMeasurementValid),
      semanticRawBehavior: cell.semanticRawBehavior ?? null,
      semanticEarned: cell.semanticEarned ?? null,
      semanticPossible: cell.semanticPossible ?? null,
      rawBehavior: cell.semanticRawBehavior ?? null,
      earned: cell.semanticEarned ?? null,
      possible: cell.semanticPossible ?? null,
      measurementValid: Boolean(cell.measurementValid),
      treatmentInvalid: Boolean(cell.treatmentInvalid),
      invalidTreatment: Boolean(cell.invalidTreatment),
      skillGate: cell.skillEvidence?.gate ?? null,
      skillPassed: cell.skillEvidence?.passed ?? null,
      reason: cell.reason || cell.measurementInvalidReason || null,
      startedAt: cell.startedAt ?? null,
      finishedAt: cell.finishedAt ?? null,
      child_actual_model_unverified: true,
    })),
    triage,
    limitations: [
      'Development-only pilot; not LaminaBench-6 confirmatory evidence.',
      'Primary claim surface is host-side llm_judge_v3 (OpenAI); semantic_criteria_v3 is diagnostic only.',
      'Persona child actual selected model remains unverified (child_actual_model_unverified: true).',
      'No effect-size gate, confidence interval, or product-win claim is computed or implied.',
      'Collector includes only lb6-pilot-skill-rerun-v3 jobs for the four runnable tasks.',
      'Frozen dev-care-circle is excluded.',
      'Harbor publication remains a manual operator step.',
      'One attempt per cell for this local pass; ×3 attempts are out of scope here.',
    ],
    publish,
  };

  const markdown = renderMarkdown(doc);
  const reportSha = createHash('sha256').update(markdown).digest('hex');
  doc.report_sha256 = reportSha;

  // Prefer preparePublicationPlan when the incremental local campaign is fully valid.
  let publicationPlan = publish;
  if (measurementValidCells === EXPECTED_CELLS) {
    try {
      const planned = preparePublicationPlan({
        root,
        taskIds: LOCAL_RUN_TASKS,
        cells,
        reportPaths: { json: paths.json, markdown: paths.markdown },
        report: {
          campaignId: SKILL_RERUN_CAMPAIGN_ID,
          gate: 'three_arm_campaign_complete',
          campaign: {
            ok: true,
            campaignId: SKILL_RERUN_CAMPAIGN_ID,
            gate: 'three_arm_campaign_complete',
          },
          cells,
        },
        write: false,
      });
      if (planned?.plan?.publication_eligible && planned.plan.commands?.length) {
        publicationPlan = {
          ...planned.plan,
          artifacts: {
            ...(planned.plan.artifacts || {}),
            reportJson: paths.json,
            reportMarkdown: paths.markdown,
          },
        };
      }
    } catch {
      // Keep collector-built publish block if boundary helper rejects incomplete evidence fields.
    }
  }
  doc.publish = publicationPlan;

  if (write) {
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.json, `${JSON.stringify(doc, null, 2)}\n`);
    fs.writeFileSync(paths.markdown, renderMarkdown(doc));
    fs.writeFileSync(paths.publishPlan, `${JSON.stringify(publicationPlan, null, 2)}\n`);
  }

  return { doc, paths, markdown };
}

function main(argv = process.argv.slice(2)) {
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag === -1 ? DEFAULT_ROOT : argv[rootFlag + 1];
  const { doc, paths } = collectLocalV3Results({ root, write: true });
  console.log(
    `Local v3 results: status=${doc.status} measurement_valid=${doc.measurement_valid_cells}/${doc.expected_cells}`,
  );
  console.log(`Wrote ${paths.markdown}`);
  console.log(`Wrote ${paths.json}`);
  console.log(`Wrote ${paths.publishPlan}`);
  // Collector is observational; non-zero only on hard write/extract failure.
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
