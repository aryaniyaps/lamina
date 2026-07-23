#!/usr/bin/env node
/**
 * Fail-closed three-arm development pilot runner.
 * Launches direct/plan/lamina Harbor cells concurrently; does not publish.
 */
import { spawn as defaultSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickEnvFile } from '../../../lib/load-env.mjs';
import { assertCampaignSelectionAllowed } from '../lib/frozen-tasks.mjs';
import {
  CANARY_TASK_ID,
  expectedPilotTaskDirName,
  MAX_LAMINA_PARENTS,
  parseSkillRerunPilotJobName,
  SKILL_RERUN_CAMPAIGN_ID,
  SKILL_RERUN_JOB_PREFIX,
} from '../lib/constants.mjs';
import { loadSkillBundleManifest, resolveHarnessGitProvenance, resolveStagedSkillPaths } from '../lib/skill-bundle.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '../../../..');

export const PILOT_ARMS = Object.freeze(['direct', 'plan', 'lamina']);
export const HARBOR_AGENT = 'cursor-cli';
export const HARBOR_MODEL = 'cursor/composer-2.5';
export const ATTEMPTS_PER_ARM = 1;
export const MAX_RETRIES = 0;
export const MAX_CONCURRENCY = 6;
export const CAMPAIGN_DEADLINE_MS = 2 * 60 * 60 * 1000;
export const TASKS_REL = 'benchmarks/lb6/pilot/harbor/tasks';
export const SCRIPTS_REL = 'benchmarks/lb6/pilot/scripts';
export const REPORTS_REL = 'benchmarks/lb6/pilot/reports';
export const PUBLICATION_REL = 'benchmarks/lb6/pilot/publication';
export const HARBOR_FORK_REL = 'benchmarks/lb6/harbor-fork';
export const PRIVATE_VERIFIER_REL = 'benchmarks/lb6/pilot/private-verifier';
export const SEALED_STORE_REL = 'benchmarks/lb6/pilot/sealed-store';
export const DEFAULT_VERIFIER_IMAGE = 'node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0';

const FORBIDDEN_CLAIM_RE =
  /\b(confirmatory\s+success|marketing\s+proof|sesoi\s+pass(?:ed)?|headline\s+gate\s+pass(?:ed)?|lamina\s+wins?|claim[- ]ready\s+result)\b/i;
const V4_PATH_RE = /(?:^|\/)(?:benchmarks\/harbor\/tasks|lamina-v[34]|harbor-v4)(?:\/|$)/i;

export function readFlag(argv, name, fallback = undefined) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] ?? fallback;
}

export function hasFlag(argv, name) {
  return argv.includes(name);
}

export function resolveConcurrency(requested, pendingCount, max = MAX_CONCURRENCY) {
  const pending = Math.max(0, Number(pendingCount) || 0);
  let value = requested === undefined || requested === null || requested === ''
    ? Math.min(max, pending || max)
    : Number(requested);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--concurrency must be an integer between 1 and ${max}`);
  }
  if (value > max) {
    throw new Error(`--concurrency ${value} exceeds hard maximum ${max}`);
  }
  const effective = Math.min(value, pending || value);
  return {
    requested: requested === undefined || requested === null || requested === ''
      ? Math.min(max, pending || max)
      : value,
    effective,
    max,
    pending,
  };
}

export function pilotPaths(root = DEFAULT_ROOT) {
  return {
    root,
    tasksRoot: path.join(root, TASKS_REL),
    scriptsDir: path.join(root, SCRIPTS_REL),
    reportsDir: path.join(root, REPORTS_REL),
    publicationDir: path.join(root, PUBLICATION_REL),
    jobsDir: path.join(root, 'jobs'),
  };
}

export function buildSupervisorEnv(root = DEFAULT_ROOT, baseEnv = process.env, skillManifestPath = null) {
  const forkRoot = path.join(root, HARBOR_FORK_REL);
  const existingPythonPath = baseEnv.PYTHONPATH ? `:${baseEnv.PYTHONPATH}` : '';
  return {
    ...baseEnv,
    PYTHONPATH: `${forkRoot}${existingPythonPath}`,
    LB6_HOST_SEAL: '1',
    LB6_SEALED_ROOT: path.join(root, SEALED_STORE_REL),
    LB6_PRIVATE_VERIFIER_ROOT: path.join(root, PRIVATE_VERIFIER_REL),
    LB6_VERIFIER_IMAGE: baseEnv.LB6_VERIFIER_IMAGE || DEFAULT_VERIFIER_IMAGE,
    LB6_SKILL_BUNDLE_MANIFEST: skillManifestPath || path.join(root, 'benchmarks/lb6/pilot/skill-bundle/manifest.json'),
    LB6_SKILL_BUNDLE_ROOT: path.join(root, 'benchmarks/lb6/pilot/skill-bundle/staged'),
    LB6_SKILL_RERUN_CAMPAIGN_ID: SKILL_RERUN_CAMPAIGN_ID,
  };
}

export function discoverBuildValidateScripts(scriptsDir) {
  if (!fs.existsSync(scriptsDir)) return { build: [], validate: [] };
  const names = fs.readdirSync(scriptsDir).filter((name) => name.endsWith('.mjs'));
  const build = names
    .filter((name) => /^build[-.].*\.mjs$/i.test(name))
    .map((name) => path.join(scriptsDir, name))
    .sort();
  const validate = names
    .filter((name) => /^validate[-.].*\.mjs$/i.test(name))
    .map((name) => path.join(scriptsDir, name))
    .sort();
  return { build, validate };
}

export function readTasksFlag(argv, fallbackTaskIds = []) {
  const index = argv.indexOf('--tasks');
  if (index === -1) return [...fallbackTaskIds];
  const value = argv[index + 1];
  if (!value) {
    throw new Error('--tasks requires a comma-separated task id list');
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function orderCellsForAdmission(taskIds, canaryTaskId = CANARY_TASK_ID) {
  const sorted = [...taskIds].sort();
  const cells = [];
  if (sorted.includes(canaryTaskId)) {
    cells.push({ taskId: canaryTaskId, arm: 'lamina' });
  }
  for (const taskId of sorted) {
    for (const arm of PILOT_ARMS) {
      if (taskId === canaryTaskId && arm === 'lamina') continue;
      cells.push({ taskId, arm });
    }
  }
  return cells;
}

export function splitCampaignCells(cells, canaryTaskId = CANARY_TASK_ID) {
  const canaryIndex = cells.findIndex(
    (cell) => cell.taskId === canaryTaskId && cell.arm === 'lamina',
  );
  if (canaryIndex === -1) {
    return { canary: null, remaining: cells, hasCanary: false, canaryIndex: -1 };
  }
  return {
    canary: cells[canaryIndex],
    remaining: cells.filter((_, index) => index !== canaryIndex),
    hasCanary: true,
    canaryIndex,
  };
}

export function isCanaryMeasurementValid(extractedCell) {
  return extractedCell?.measurementValid === true;
}

/**
 * Deterministic admission-aware schedule: global cap with at most one Lamina parent.
 * Loan-library Lamina is ordered first as the campaign canary slot.
 */
export function schedulePilotCells(
  taskIds,
  maxConcurrency = MAX_CONCURRENCY,
  maxLaminaParents = MAX_LAMINA_PARENTS,
) {
  const pending = orderCellsForAdmission(taskIds);
  const schedule = [];
  let scheduleIndex = 0;
  let wave = 1;

  while (pending.length) {
    const waveCells = [];
    let laminaInWave = 0;
    const stillPending = [];

    for (const cell of pending) {
      if (waveCells.length >= maxConcurrency) {
        stillPending.push(cell);
        continue;
      }
      if (cell.arm === 'lamina' && laminaInWave >= maxLaminaParents) {
        stillPending.push(cell);
        continue;
      }
      waveCells.push(cell);
      if (cell.arm === 'lamina') laminaInWave += 1;
    }

    if (!waveCells.length) {
      throw new Error('admission schedule deadlock: no runnable cell with current Lamina cap');
    }

    for (const cell of waveCells) {
      schedule.push({
        ...cell,
        scheduleIndex,
        wave,
        taskDirName: `${cell.taskId}-${cell.arm}`,
      });
      scheduleIndex += 1;
    }

    pending.splice(0, pending.length, ...stillPending);
    wave += 1;
  }

  return schedule;
}

export function discoverPilotTasks(tasksRoot, selectedTaskIds = null) {
  if (!fs.existsSync(tasksRoot)) {
    return {
      ok: false,
      gate: 'pilot_tasks_missing',
      reason: `pilot tasks root missing: ${tasksRoot}`,
      taskIds: [],
      selectedTaskIds: selectedTaskIds || [],
      byTaskArm: {},
    };
  }

  const dirs = fs
    .readdirSync(tasksRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (dirs.some((name) => /checklist/i.test(name))) {
    return {
      ok: false,
      gate: 'pilot_checklist_forbidden',
      reason: 'checklist arm/task is forbidden in the lb6 pilot package',
      taskIds: [],
      selectedTaskIds: selectedTaskIds || [],
      byTaskArm: {},
    };
  }

  if (V4_PATH_RE.test(tasksRoot.replaceAll('\\', '/'))) {
    return {
      ok: false,
      gate: 'pilot_v4_path_forbidden',
      reason: 'refusing V4 harbor task path; use benchmarks/lb6/pilot/harbor/tasks',
      taskIds: [],
      selectedTaskIds: selectedTaskIds || [],
      byTaskArm: {},
    };
  }

  const byTaskArm = {};
  for (const dirName of dirs) {
    const arm = PILOT_ARMS.find((value) => dirName.endsWith(`-${value}`));
    if (!arm) {
      return {
        ok: false,
        gate: 'pilot_task_dir_unrecognized',
        reason: `unrecognized Harbor task directory: ${dirName}`,
        taskIds: [],
        selectedTaskIds: selectedTaskIds || [],
        byTaskArm: {},
      };
    }
    const taskId = dirName.slice(0, -(arm.length + 1));
    byTaskArm[taskId] ||= {};
    if (byTaskArm[taskId][arm]) {
      return {
        ok: false,
        gate: 'pilot_arm_tasks_ambiguous',
        reason: `expected exactly one task per arm; duplicate ${taskId}-${arm}`,
        taskIds: [],
        selectedTaskIds: selectedTaskIds || [],
        byTaskArm: {},
      };
    }
    byTaskArm[taskId][arm] = dirName;
  }

  const discoveredTaskIds = Object.keys(byTaskArm).sort();
  for (const taskId of discoveredTaskIds) {
    const missingArms = PILOT_ARMS.filter((arm) => !byTaskArm[taskId][arm]);
    if (missingArms.length) {
      return {
        ok: false,
        gate: 'pilot_arm_tasks_incomplete',
        reason: `task ${taskId} missing Harbor task directories for arms: ${missingArms.join(', ')}`,
        taskIds: discoveredTaskIds,
        selectedTaskIds: selectedTaskIds || [],
        byTaskArm,
      };
    }
  }

  const effectiveSelected = selectedTaskIds?.length ? [...selectedTaskIds].sort() : discoveredTaskIds;
  for (const taskId of effectiveSelected) {
    if (!byTaskArm[taskId]) {
      return {
        ok: false,
        gate: 'pilot_selected_task_missing',
        reason: `selected task not present in pilot package: ${taskId}`,
        taskIds: discoveredTaskIds,
        selectedTaskIds: effectiveSelected,
        byTaskArm,
      };
    }
  }

  return {
    ok: true,
    gate: 'pilot_tasks_ready',
    reason: null,
    taskIds: discoveredTaskIds,
    selectedTaskIds: effectiveSelected,
    byTaskArm,
  };
}

export function makeJobName(taskId, arm, nowMs = Date.now(), jobPrefix = SKILL_RERUN_JOB_PREFIX) {
  return `lb6-pilot-${jobPrefix}-${taskId}-${arm}-${nowMs}`;
}

export function isFrozenPublicationTask(taskId) {
  return taskId === 'dev-care-circle';
}

export function isPublicationEligibleCell(cell, { requireMeasurementValid = true } = {}) {
  if (!cell?.taskId || !cell?.arm || isFrozenPublicationTask(cell.taskId)) return false;
  if (!PILOT_ARMS.includes(cell.arm)) return false;
  if (cell.priorNoSkill || cell.treatmentInvalid) return false;
  if (cell.skillEvidence?.priorNoSkill) return false;
  if (cell.skillEvidence?.passed !== true) return false;
  if (cell.skillEvidence?.hasLedgerEvidence !== true) return false;
  if (requireMeasurementValid && cell.measurementValid !== true) return false;

  const expectedTaskDirName = expectedPilotTaskDirName(cell.taskId, cell.arm);
  if (!cell.taskDirName || cell.taskDirName !== expectedTaskDirName) return false;

  if (!cell.jobName) return false;
  const parsedJob = parseSkillRerunPilotJobName(cell.jobName);
  if (!parsedJob) return false;
  if (parsedJob.taskId !== cell.taskId || parsedJob.arm !== cell.arm) return false;

  return true;
}

export function validatePublicationBoundary({ taskIds, reportCells, report = null }) {
  const runnableTaskIds = (taskIds || []).filter((taskId) => !isFrozenPublicationTask(taskId));
  const expectedCells = runnableTaskIds.length * PILOT_ARMS.length;
  const cells = Array.isArray(reportCells) ? reportCells : [];
  const issues = [];

  const reportCampaignId = report?.campaignId ?? report?.campaign?.campaignId ?? null;
  if (reportCampaignId !== SKILL_RERUN_CAMPAIGN_ID) {
    issues.push(`report campaign id must be ${SKILL_RERUN_CAMPAIGN_ID}`);
  }

  if (cells.length !== expectedCells) {
    issues.push(`expected ${expectedCells} report cells, found ${cells.length}`);
  }

  const seen = new Set();
  for (const cell of cells) {
    const key = cell?.taskId && cell?.arm ? `${cell.taskId}/${cell.arm}` : null;
    if (!key) {
      issues.push('report cell missing taskId/arm');
      continue;
    }
    if (seen.has(key)) {
      issues.push(`duplicate task/arm cell: ${key}`);
    }
    seen.add(key);
    if (!isPublicationEligibleCell(cell)) {
      issues.push(`cell ${key} failed publication boundary checks`);
    }
  }

  for (const taskId of runnableTaskIds) {
    for (const arm of PILOT_ARMS) {
      if (!seen.has(`${taskId}/${arm}`)) {
        issues.push(`missing task/arm cell: ${taskId}/${arm}`);
      }
    }
  }

  const gateOk = report?.gate === 'three_arm_campaign_complete' || report?.gate === 'pilot_report_ready';
  const isolatedCampaignResult = Boolean(
    issues.length === 0
    && report?.campaign?.ok
    && gateOk
    && cells.every((cell) => isPublicationEligibleCell(cell)),
  );

  const eligibleCells = isolatedCampaignResult
    ? cells.map((cell) => ({
      taskId: cell.taskId,
      arm: cell.arm,
      taskDirName: cell.taskDirName,
      jobName: cell.jobName,
    }))
    : [];

  return {
    issues,
    eligibleCells,
    isolatedCampaignResult,
    runnableTaskIds,
    expectedCells,
  };
}

export function buildHarborArgs({
  arm,
  taskDirName,
  jobName,
  tasksPath = TASKS_REL,
  envFile,
  nConcurrent = 1,
  nConcurrentAgents = 1,
  skillPaths = [],
}) {
  if (!PILOT_ARMS.includes(arm)) {
    throw new Error(`unsupported arm: ${arm}`);
  }
  const args = [
    'run',
    '--job-name', jobName,
    '--path', tasksPath,
    '--include-task-name', taskDirName,
    '--agent', HARBOR_AGENT,
    '--model', HARBOR_MODEL,
    '--n-attempts', String(ATTEMPTS_PER_ARM),
    '--n-concurrent', String(nConcurrent),
    '--n-concurrent-agents', String(nConcurrentAgents),
    '--max-retries', String(MAX_RETRIES),
    '--yes',
  ];
  if (envFile) args.push('--env-file', envFile);
  if (arm === 'lamina') {
    for (const skillPath of skillPaths) {
      args.push('--skills', skillPath);
    }
  }
  return args;
}

function spawnPromise(spawnImpl, command, args, options = {}) {
  const requestedStdio = options.stdio ?? 'inherit';
  const captureOutput = options.captureOutput !== false;
  const stdio = captureOutput ? ['inherit', 'pipe', 'pipe'] : requestedStdio;

  return new Promise((resolve) => {
    const child = spawnImpl(command, args, {
      stdio,
      cwd: options.cwd,
      env: options.env ?? process.env,
    });
    if (typeof options.onSpawn === 'function') options.onSpawn(child);
    const record = {
      command,
      args,
      pid: child.pid ?? null,
      exitCode: null,
      signal: null,
      error: null,
      stdout: '',
      stderr: '',
      killed: false,
      child,
    };
    const forward = (stream, target, field) => {
      if (!stream) return;
      stream.on('data', (chunk) => {
        const text = chunk.toString();
        record[field] += text;
        if (target) target.write(chunk);
      });
    };
    forward(child.stdout, process.stdout, 'stdout');
    forward(child.stderr, process.stderr, 'stderr');
    child.on('error', (error) => {
      record.error = error.message;
      record.exitCode = record.exitCode ?? 1;
      resolve(record);
    });
    child.on('exit', (code, signal) => {
      record.exitCode = code;
      record.signal = signal;
      resolve(record);
    });
  });
}

export async function runNodeScripts(scripts, { root, spawnImpl = defaultSpawn, label, scriptArgs = [] }) {
  const results = [];
  for (const scriptPath of scripts) {
    const rel = path.relative(root, scriptPath);
    const result = await spawnPromise(spawnImpl, process.execPath, [scriptPath, ...scriptArgs], {
      cwd: root,
      stdio: 'inherit',
    });
    results.push({
      label,
      script: rel,
      exitCode: result.exitCode,
      signal: result.signal,
      error: result.error,
    });
    if (result.exitCode !== 0) {
      return {
        ok: false,
        gate: `${label}_failed`,
        reason: `${label} script failed: ${rel} (exit=${result.exitCode}, signal=${result.signal || 'none'})`,
        results,
      };
    }
  }
  return { ok: true, gate: `${label}_passed`, reason: null, results };
}

function looksLikeResourceExhaustion(text) {
  return /resource_exhausted|resource exhausted/i.test(text || '');
}

function looksLikeRateLimit(text) {
  return /rate[-\s]?limit|429|resource_exhausted|too many requests/i.test(text || '');
}

function looksLikeUsageLimit(text) {
  return /usage.?limit|quota.?exceeded|billing.?limit|insufficient.?quota|api.?usage.?limit/i.test(text || '');
}

function looksLikeModelMismatch(text) {
  return /model.?mismatch|unexpected.?model|wrong.?model|selected.?model|child_actual_model/i.test(text || '');
}

function looksLikeSkillInjectionFailure(text) {
  return /skill.?injection|skill.?digest|skill.?bundle|missing.?skill|skills:\s*\[\]|pre_model_skill_gate/i.test(text || '');
}

function looksLikeProvenanceFailure(text) {
  return /provenance|child_actual_model|persona.?child|native.?child|protocol_invalid/i.test(text || '');
}

export function classifyFromJobEvidence(extractedCell) {
  if (!extractedCell) return null;
  if (extractedCell.state === 'job_missing' || extractedCell.state === 'trial_missing') {
    return null;
  }
  const blob = [
    extractedCell.exception?.exception_message,
    ...(extractedCell.stepExceptions || []).map((item) => item.message),
    extractedCell.reason,
    extractedCell.state,
  ].filter(Boolean).join('\n');

  if (extractedCell.state === 'campaign_deadline_exceeded') {
    return { state: 'campaign_deadline_exceeded', failFast: true };
  }
  if (!extractedCell.skillEvidence?.passed) {
    return { state: extractedCell.skillEvidence?.gate || 'skill_injection_failure', failFast: true };
  }
  if (looksLikeSkillInjectionFailure(blob)) {
    return { state: 'skill_injection_failure', failFast: true };
  }
  if (looksLikeResourceExhaustion(blob) || looksLikeRateLimit(blob) || looksLikeUsageLimit(blob)) {
    return { state: 'rate_limit_failure', failFast: true };
  }
  if (looksLikeModelMismatch(blob) || extractedCell.modelEvidence?.modelMatch === false) {
    return { state: 'model_mismatch_failure', failFast: true };
  }
  if (looksLikeProvenanceFailure(blob)) {
    return { state: 'provenance_failure', failFast: true };
  }
  if (extractedCell.state && extractedCell.state !== 'completed') {
    return { state: extractedCell.state, failFast: looksLikeResourceExhaustion(blob) };
  }
  return null;
}

export function classifyCellFailure(record, jobEvidence = null) {
  const blob = `${record.stdout || ''}\n${record.stderr || ''}\n${record.error || ''}`;
  if (record.deadlineExceeded) {
    return { state: 'campaign_deadline_exceeded', failFast: true };
  }
  if (looksLikeSkillInjectionFailure(blob)) {
    return { state: 'skill_injection_failure', failFast: true };
  }
  if (looksLikeResourceExhaustion(blob) || looksLikeRateLimit(blob) || looksLikeUsageLimit(blob)) {
    return { state: 'rate_limit_failure', failFast: true };
  }
  if (looksLikeModelMismatch(blob)) {
    return { state: 'model_mismatch_failure', failFast: true };
  }
  if (looksLikeProvenanceFailure(blob)) {
    return { state: 'provenance_failure', failFast: true };
  }

  const fromJob = classifyFromJobEvidence(jobEvidence?.extractedCell);
  if (fromJob?.failFast) return fromJob;
  if (fromJob) return fromJob;
  if (record.error) return { state: 'spawn_error', failFast: false };
  if (record.signal) return { state: 'signaled', failFast: false };
  if (record.exitCode === 0) return { state: 'completed', failFast: false };
  return { state: 'harbor_nonzero_exit', failFast: false };
}

async function runAdmissionPool(items, concurrency, maxLaminaParents, worker) {
  const results = new Array(items.length);
  const pending = items.map((item, index) => ({ item, index }));
  let active = 0;
  let activeLamina = 0;
  let stop = false;

  return new Promise((resolve) => {
    function maybeFinish() {
      if ((stop && active === 0) || (!pending.length && active === 0)) {
        resolve(results.filter((item) => item !== undefined));
      }
    }

    function pump() {
      if (stop) {
        maybeFinish();
        return;
      }
      for (let i = 0; i < pending.length; i += 1) {
        const slot = pending[i];
        if (active >= concurrency) break;
        if (slot.item.arm === 'lamina' && activeLamina >= maxLaminaParents) continue;
        pending.splice(i, 1);
        active += 1;
        if (slot.item.arm === 'lamina') activeLamina += 1;
        worker(slot.item, slot.index).then((outcome) => {
          results[slot.index] = outcome;
          active -= 1;
          if (slot.item.arm === 'lamina') activeLamina -= 1;
          if (outcome?.failFast) stop = true;
          pump();
          maybeFinish();
        });
        i -= 1;
      }
      maybeFinish();
    }

    pump();
  });
}

function killChild(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // Best effort.
  }
}

export function preparePublicationPlan({ root, taskIds, cells, reportPaths, report = null, write = true }) {
  const publicationDir = path.join(root, PUBLICATION_REL);
  const reportCells = Array.isArray(report?.cells) ? report.cells : cells;
  const boundary = validatePublicationBoundary({ taskIds, reportCells, report });
  const { eligibleCells, isolatedCampaignResult, runnableTaskIds, issues } = boundary;
  const selectedTaskDirs = [...new Set(
    eligibleCells.map((cell) => cell.taskDirName).filter(Boolean),
  )].sort();
  const harborCommands = isolatedCampaignResult
    ? [
      ...selectedTaskDirs.map((taskDirName) => `harbor publish --public ${path.join(TASKS_REL, taskDirName)}`),
      ...eligibleCells.map((cell) => `harbor upload --public ${path.join('jobs', cell.jobName)}`),
    ]
    : [];
  const commands = {
    note: 'Manual operator step only. This runner does not execute Harbor publication.',
    campaign_id: SKILL_RERUN_CAMPAIGN_ID,
    publication_eligible: isolatedCampaignResult,
    benchmark_upload_ready: isolatedCampaignResult,
    blocked_until: 'authenticated Harbor CLI + explicit approval to disclose a development-only package',
    blocked_reasons: [
      'development-only package; not eligible for a confirmatory or marketing claim',
      'Cursor persona child actual selected model is unverified',
      'Harbor registry authentication is required for publish/upload',
      'frozen dev-care-circle package and prior no-skill Lamina jobs are excluded from this plan',
      ...(!isolatedCampaignResult
        ? [
          'current campaign lacks a measurement-valid isolated multi-task result with skill evidence',
          ...issues,
        ]
        : []),
    ],
    excluded_frozen_tasks: ['dev-care-circle'],
    excluded_prior_no_skill_jobs: 'jobs/lb6-pilot-* without pre_model_skill_gate evidence are not enumerated',
    commands: harborCommands,
    artifacts: {
      reportJson: reportPaths?.json || null,
      reportMarkdown: reportPaths?.markdown || null,
      taskIds: runnableTaskIds,
      jobNames: eligibleCells.map((cell) => cell.jobName),
      campaignId: SKILL_RERUN_CAMPAIGN_ID,
    },
    development_only: true,
    confirmatory: false,
    child_actual_model_unverified: true,
  };
  const outPath = path.join(publicationDir, 'manual-publish-plan.json');
  if (write) {
    fs.mkdirSync(publicationDir, { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(commands, null, 2)}\n`);
  }
  return { outPath: write ? outPath : null, plan: commands };
}

export async function runThreeArmCampaign(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const paths = pilotPaths(root);
  const spawnImpl = options.spawnImpl || defaultSpawn;
  const nowMs = options.nowMs ?? Date.now();
  const deadlineMs = options.deadlineMs ?? CAMPAIGN_DEADLINE_MS;
  const dryRun = Boolean(options.dryRun);
  const skipPackageScripts = Boolean(options.skipPackageScripts);
  const aggregateImpl = options.aggregateImpl;
  const selectedTaskIds = options.selectedTaskIds || null;

  const gates = [];
  const startedAt = new Date(nowMs).toISOString();
  const deadlineAt = new Date(nowMs + deadlineMs).toISOString();

  const envFile = options.envFile === undefined ? pickEnvFile(root) : options.envFile;
  if (!envFile) {
    return {
      ok: false,
      exitCode: 1,
      gate: 'root_env_missing',
      reason: 'repo root .env is required for CURSOR_API_KEY / Harbor env-file wiring',
      report: null,
    };
  }

  if (selectedTaskIds?.length) {
    const manifestPath = path.join(root, 'benchmarks/lb6/pilot/corpus/manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        assertCampaignSelectionAllowed(selectedTaskIds, JSON.parse(
          fs.readFileSync(manifestPath, 'utf8'),
        ));
      } catch (error) {
        return {
          ok: false,
          exitCode: 1,
          gate: 'pilot_frozen_task_forbidden',
          reason: error.message,
          gates,
          report: null,
        };
      }
    }
  }

  if (!skipPackageScripts) {
    const scripts = discoverBuildValidateScripts(paths.scriptsDir);
    if (scripts.build.length) {
      const buildArgs = selectedTaskIds?.length
        ? ['--tasks', selectedTaskIds.join(',')]
        : [];
      const build = await runNodeScripts(scripts.build, {
        root,
        spawnImpl,
        label: 'pilot_build',
        scriptArgs: buildArgs,
      });
      gates.push(build);
      if (!build.ok) {
        return { ok: false, exitCode: 1, gate: build.gate, reason: build.reason, gates, report: null };
      }
    } else {
      gates.push({
        ok: true,
        gate: 'pilot_build_absent',
        reason: 'no build-*.mjs under benchmarks/lb6/pilot/scripts yet; continuing with discovered tasks',
        results: [],
      });
    }

    if (scripts.validate.length) {
      const validateArgs = selectedTaskIds?.length
        ? ['--tasks', selectedTaskIds.join(',')]
        : [];
      const validate = await runNodeScripts(scripts.validate, {
        root,
        spawnImpl,
        label: 'pilot_validate',
        scriptArgs: validateArgs,
      });
      gates.push(validate);
      if (!validate.ok) {
        return {
          ok: false,
          exitCode: 1,
          gate: validate.gate,
          reason: validate.reason,
          gates,
          report: null,
        };
      }
    } else {
      gates.push({
        ok: true,
        gate: 'pilot_validate_absent',
        reason: 'no validate-*.mjs under benchmarks/lb6/pilot/scripts yet; continuing with discovered tasks',
        results: [],
      });
    }
  }

  const discovery = discoverPilotTasks(paths.tasksRoot, selectedTaskIds);
  gates.push(discovery);
  if (!discovery.ok) {
    return {
      ok: false,
      exitCode: 1,
      gate: discovery.gate,
      reason: discovery.reason,
      gates,
      report: null,
    };
  }

  const schedule = schedulePilotCells(discovery.selectedTaskIds);
  const cells = schedule.map((slot, index) => ({
    ...slot,
    taskDirName: discovery.byTaskArm[slot.taskId][slot.arm],
    jobName: makeJobName(slot.taskId, slot.arm, nowMs + index),
  }));

  const concurrency = resolveConcurrency(
    options.concurrency,
    cells.length,
    options.maxConcurrency ?? MAX_CONCURRENCY,
  );

  let skillBundle = null;
  let laminaSkillPaths = [];
  try {
    skillBundle = loadSkillBundleManifest(root);
    laminaSkillPaths = resolveStagedSkillPaths(root, skillBundle.manifest);
  } catch (error) {
    if (!skipPackageScripts) {
      return {
        ok: false,
        exitCode: 1,
        gate: 'skill_bundle_missing',
        reason: error.message,
        gates,
        report: null,
      };
    }
  }

  let harnessProvenance = null;
  try {
    harnessProvenance = resolveHarnessGitProvenance(root);
  } catch (error) {
    if (!skipPackageScripts) {
      return {
        ok: false,
        exitCode: 1,
        gate: 'harness_git_unavailable',
        reason: error.message,
        gates,
        report: null,
      };
    }
  }

  const { canary, remaining, hasCanary } = splitCampaignCells(cells);
  const remainingSchedule = hasCanary
    ? schedulePilotCells([...new Set(remaining.map((cell) => cell.taskId))].sort())
    : schedule;

  if (dryRun) {
    const planned = cells.map((cell) => ({
      ...cell,
      args: buildHarborArgs({
        arm: cell.arm,
        taskDirName: cell.taskDirName,
        jobName: cell.jobName,
        tasksPath: TASKS_REL,
        envFile,
        nConcurrent: 1,
        nConcurrentAgents: 1,
        skillPaths: cell.arm === 'lamina' ? laminaSkillPaths : [],
      }),
    }));
    return {
      ok: true,
      exitCode: 0,
      gate: 'dry_run',
      reason: null,
      gates,
      concurrency,
      schedule,
      canaryPhase: hasCanary ? [planned.find((cell) => cell.taskId === CANARY_TASK_ID && cell.arm === 'lamina')] : [],
      remainingSchedule,
      cells: planned,
      skillBundle: skillBundle?.manifest ?? null,
      campaign: {
        campaignId: SKILL_RERUN_CAMPAIGN_ID,
        maxLaminaParents: MAX_LAMINA_PARENTS,
        selectedTaskIds: discovery.selectedTaskIds,
        sourceSkillCommit: skillBundle?.manifest?.source_skill_commit ?? null,
        harnessGitCommit: harnessProvenance?.harness_git_commit ?? skillBundle?.manifest?.harness_git_commit ?? null,
        harnessGitClean: harnessProvenance?.harness_git_clean ?? null,
      },
      report: null,
    };
  }

  if (
    harnessProvenance
    && !harnessProvenance.unavailable
    && !harnessProvenance.harness_git_clean
    && options.requireCleanHarness !== false
  ) {
    return {
      ok: false,
      exitCode: 1,
      gate: 'harness_git_dirty',
      reason: 'refusing paid campaign launch with uncommitted harness changes',
      gates,
      report: null,
      campaign: {
        harnessGitCommit: harnessProvenance.harness_git_commit,
        harnessGitClean: false,
      },
    };
  }

  const activeChildren = new Set();
  const supervisorEnv = buildSupervisorEnv(
    root,
    options.env ?? process.env,
    skillBundle?.manifestPath ?? null,
  );
  let deadlineExceeded = false;
  let deadlineTimer = null;
  if (deadlineMs > 0) {
    deadlineTimer = setTimeout(() => {
      deadlineExceeded = true;
      for (const child of activeChildren) killChild(child);
    }, deadlineMs);
    if (typeof deadlineTimer.unref === 'function') deadlineTimer.unref();
  }

  const { extractCellRecord } = await import('./aggregate-results.mjs');

  async function runPilotCell(cell) {
    const args = buildHarborArgs({
      arm: cell.arm,
      taskDirName: cell.taskDirName,
      jobName: cell.jobName,
      tasksPath: TASKS_REL,
      envFile,
      nConcurrent: 1,
      nConcurrentAgents: 1,
      skillPaths: cell.arm === 'lamina' ? laminaSkillPaths : [],
    });
    const started = Date.now();
    const finished = await spawnPromise(spawnImpl, 'harbor', args, {
      cwd: root,
      stdio: options.stdio ?? 'inherit',
      env: supervisorEnv,
      onSpawn: (child) => activeChildren.add(child),
    });
    if (finished.child) activeChildren.delete(finished.child);

    const partial = {
      ...cell,
      args,
      exitCode: finished.exitCode,
      signal: finished.signal,
      error: finished.error,
      durationMs: Date.now() - started,
      deadlineExceeded,
      jobPath: path.join(paths.jobsDir, cell.jobName),
    };
    const extractedCell = extractCellRecord({
      jobsRoot: paths.jobsDir,
      jobName: cell.jobName,
      cellMeta: partial,
    });
    const classification = classifyCellFailure(
      { ...finished, deadlineExceeded },
      { extractedCell },
    );
    const output = `${finished.stdout || ''}\n${finished.stderr || ''}\n${finished.error || ''}`;
    return {
      ...partial,
      extractedCell,
      state: classification.state,
      failFast: classification.failFast,
      measurementValid: extractedCell.measurementValid === true,
      rateLimit: looksLikeRateLimit(output) || looksLikeResourceExhaustion(output),
      provenanceFailure: looksLikeProvenanceFailure(output),
    };
  }

  const resultsByKey = new Map();
  let canaryGate = null;

  if (hasCanary) {
    const canaryOutcome = await runPilotCell(canary);
    resultsByKey.set(`${canary.taskId}/${canary.arm}`, canaryOutcome);
    if (canaryOutcome.failFast) {
      canaryGate = canaryOutcome.state;
    } else if (!isCanaryMeasurementValid(canaryOutcome.extractedCell)) {
      canaryGate = 'canary_not_measurement_valid';
    }
  }

  let remainingResults = [];
  if (!canaryGate) {
    remainingResults = await runAdmissionPool(
      remaining,
      concurrency.effective,
      MAX_LAMINA_PARENTS,
      async (cell) => {
        const outcome = await runPilotCell(cell);
        resultsByKey.set(`${cell.taskId}/${cell.arm}`, outcome);
        return outcome;
      },
    );
  }

  if (deadlineTimer) clearTimeout(deadlineTimer);

  const cellResults = cells
    .map((cell) => resultsByKey.get(`${cell.taskId}/${cell.arm}`))
    .filter(Boolean);

  const failFastHit = canaryGate
    ? { state: canaryGate, taskId: canary?.taskId, arm: canary?.arm }
    : cellResults.find((cell) => cell.failFast);
  const expectedCellCount = discovery.selectedTaskIds.length * PILOT_ARMS.length;
  const allCellsPresent =
    cellResults.length === expectedCellCount
    && discovery.selectedTaskIds.every((taskId) =>
      PILOT_ARMS.every((arm) => cellResults.some((cell) => cell.taskId === taskId && cell.arm === arm)),
    );
  const campaignOk =
    !deadlineExceeded
    && !failFastHit
    && allCellsPresent
    && cellResults.every((cell) => cell.exitCode === 0);

  let aggregate = null;
  if (aggregateImpl) {
    aggregate = await aggregateImpl({
      root,
      jobNames: cellResults.map((cell) => cell.jobName),
      cells: cellResults,
      schedule,
      selectedTaskIds: discovery.selectedTaskIds,
      concurrency,
      campaign: {
        startedAt,
        deadlineAt,
        deadlineMs,
        deadlineExceeded,
        ok: campaignOk,
        gate: failFastHit
          ? failFastHit.state
          : deadlineExceeded
            ? 'campaign_deadline_exceeded'
            : campaignOk
              ? 'three_arm_campaign_complete'
              : 'three_arm_campaign_incomplete',
      },
    });
  }

  const aggregateGate = aggregate?.report?.gate || null;
  const aggregateOk = aggregate?.report?.campaign?.ok !== false;
  const finalCampaignOk = campaignOk && aggregateOk;
  const finalGate = finalCampaignOk
    ? 'three_arm_campaign_complete'
    : failFastHit
      ? failFastHit.state
      : aggregateGate && aggregateGate !== 'three_arm_campaign_complete'
        ? aggregateGate
        : deadlineExceeded
          ? 'campaign_deadline_exceeded'
          : 'three_arm_campaign_incomplete';

  const publication = preparePublicationPlan({
    root,
    taskIds: discovery.selectedTaskIds,
    cells: cellResults,
    reportPaths: aggregate?.paths || null,
    report: aggregate?.report || null,
  });

  return {
    ok: finalCampaignOk,
    exitCode: finalCampaignOk ? 0 : 1,
    gate: finalGate,
    reason: failFastHit
      ? `fail-fast cell ${failFastHit.taskId}/${failFastHit.arm}: ${failFastHit.state}`
      : deadlineExceeded
        ? `campaign exceeded ${deadlineMs}ms deadline`
        : finalCampaignOk
          ? null
          : `one or more Harbor cells failed publication gates (${finalGate})`,
    gates,
    concurrency,
    schedule,
    cells: cellResults,
    aggregate,
    publication,
    campaign: {
      startedAt,
      deadlineAt,
      deadlineMs,
      deadlineExceeded,
      agent: HARBOR_AGENT,
      model: HARBOR_MODEL,
      attemptsPerArm: ATTEMPTS_PER_ARM,
      maxRetries: MAX_RETRIES,
      selectedTaskIds: discovery.selectedTaskIds,
      campaignId: SKILL_RERUN_CAMPAIGN_ID,
      maxLaminaParents: MAX_LAMINA_PARENTS,
      skillBundleDigest: skillBundle?.manifest?.aggregate_digest ?? null,
      pinnedSkillCommit: skillBundle?.manifest?.source_skill_commit ?? skillBundle?.manifest?.pinned_commit ?? null,
      sourceSkillCommit: skillBundle?.manifest?.source_skill_commit ?? skillBundle?.manifest?.pinned_commit ?? null,
      harnessGitCommit: harnessProvenance?.harness_git_commit ?? skillBundle?.manifest?.harness_git_commit ?? null,
      harnessGitClean: harnessProvenance?.harness_git_clean ?? null,
      development_only: true,
      confirmatory: false,
      child_actual_model_unverified: true,
    },
  };
}

function assertNoForbiddenClaims(text) {
  if (FORBIDDEN_CLAIM_RE.test(text)) {
    throw new Error(`refusing confirmatory/marketing wording: ${text.match(FORBIDDEN_CLAIM_RE)?.[0]}`);
  }
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const dryRun = hasFlag(argv, '--dry-run');
  const skipPackageScripts = hasFlag(argv, '--skip-package-scripts');
  const concurrencyFlag = readFlag(argv, '--concurrency', undefined);
  const { aggregatePilotCampaign } = await import('./aggregate-results.mjs');

  let selectedTaskIds = options.selectedTaskIds || null;
  if (!selectedTaskIds) {
    const manifestPath = path.join(root, 'benchmarks/lb6/pilot/corpus/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const fallback =
      manifest.pilot?.default_run_tasks
      || manifest.pilot?.tasks
      || manifest.tasks.map((task) => task.id);
    selectedTaskIds = readTasksFlag(argv, fallback);
  }

  const result = await runThreeArmCampaign({
    root,
    dryRun,
    skipPackageScripts,
    concurrency: concurrencyFlag,
    selectedTaskIds,
    spawnImpl: options.spawnImpl,
    aggregateImpl: dryRun
      ? null
      : async (payload) => aggregatePilotCampaign({
          ...payload,
          write: true,
        }),
    nowMs: options.nowMs,
    deadlineMs: options.deadlineMs,
    stdio: options.stdio,
    env: options.env,
  });

  assertNoForbiddenClaims(JSON.stringify(result.campaign || {}));

  if (dryRun) {
    console.log(JSON.stringify({
      gate: result.gate,
      concurrency: result.concurrency,
      campaignId: SKILL_RERUN_CAMPAIGN_ID,
      maxLaminaParents: MAX_LAMINA_PARENTS,
      skillBundleDigest: result.skillBundle?.aggregate_digest ?? null,
      selectedTaskIds: result.campaign?.selectedTaskIds || selectedTaskIds,
      schedule: result.schedule,
      cells: result.cells?.map((cell) => ({
        taskId: cell.taskId,
        arm: cell.arm,
        scheduleIndex: cell.scheduleIndex,
        wave: cell.wave,
        jobName: cell.jobName,
        taskDirName: cell.taskDirName,
        args: cell.args,
      })),
      development_only: true,
      confirmatory: false,
      child_actual_model_unverified: true,
    }, null, 2));
    return result.exitCode;
  }

  if (!result.ok) {
    console.error(`Pilot campaign stopped at gate=${result.gate}: ${result.reason}`);
    return result.exitCode;
  }

  console.log(`Pilot campaign complete. concurrency requested=${result.concurrency.requested} effective=${result.concurrency.effective}`);
  if (result.publication?.outPath) {
    console.log(`Publication plan prepared (not executed): ${result.publication.outPath}`);
  }
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
