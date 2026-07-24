#!/usr/bin/env node
/**
 * Aggregate lb6 development-pilot Harbor jobs into JSON + Markdown reports.
 * Refuses old V4 jobs and confirmatory/marketing claim language.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEVELOPMENT_FLAGS,
  PILOT_SKILL_RERUN_JOB_RE,
  SKILL_RERUN_CAMPAIGN_ID,
  SKILL_RERUN_JOB_PREFIX,
  expectedPilotTaskDirName,
  parseSkillRerunPilotJobName,
} from '../lib/constants.mjs';
import {
  collectHostLedgerEntries,
  evaluatePreModelSkillGate,
  readTrialLock,
} from '../lib/pre-model-gate.mjs';
import { loadSkillBundleManifest } from '../lib/skill-bundle.mjs';
import { validateSemanticMeasurement } from '../lib/semantic-measurement.mjs';
export { validateSemanticMeasurement } from '../lib/semantic-measurement.mjs';
import {
  HARBOR_AGENT,
  HARBOR_MODEL,
  PILOT_ARMS,
  REPORTS_REL,
  TASKS_REL,
} from './run-three-arm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '../../../..');

const FORBIDDEN_CLAIM_RE =
  /\b(confirmatory\s+success|marketing\s+proof|sesoi\s+pass(?:ed)?|headline\s+gate\s+pass(?:ed)?|lamina\s+wins?|claim[- ]ready\s+result)\b/i;
const PILOT_JOB_RE = PILOT_SKILL_RERUN_JOB_RE;
const V4_JOB_RE = /^(?:lamina-v[34]|publish-)/i;
const V4_PATH_RE = /(?:benchmarks\/harbor\/tasks|harbor-v4|lamina-v[34])/i;
const FORBIDDEN_VERIFIER_PATH_RE =
  /\/tests\/(?:grade|behavior-grade|pilot-behavior-grade|pilot-treatment)\.mjs\b/g;

export function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function parsePilotJobName(name) {
  const parsed = parseSkillRerunPilotJobName(name);
  if (!parsed) return null;
  return { ...parsed, campaignJobPrefix: SKILL_RERUN_JOB_PREFIX };
}

export function readTaskCampaignId(root, taskId, arm) {
  const taskTomlPath = path.join(root, TASKS_REL, expectedPilotTaskDirName(taskId, arm), 'task.toml');
  if (!fs.existsSync(taskTomlPath)) {
    return { campaignId: null, reason: `task metadata missing: ${taskTomlPath}` };
  }
  const toml = fs.readFileSync(taskTomlPath, 'utf8');
  const match = toml.match(/^\s*campaign_id\s*=\s*"([^"]+)"/m);
  if (!match) {
    return { campaignId: null, reason: `task metadata missing campaign_id: ${taskTomlPath}` };
  }
  return { campaignId: match[1], reason: null };
}

export function validateCampaignCells(cells, root = DEFAULT_ROOT) {
  const seen = new Set();
  const campaignIds = new Set();

  for (const cell of cells) {
    if (!cell?.taskId || !cell?.arm) continue;
    const key = `${cell.taskId}/${cell.arm}`;
    if (seen.has(key)) {
      return {
        ok: false,
        reason: `duplicate task/arm cell in aggregation set: ${key}`,
      };
    }
    seen.add(key);

    const metadata = readTaskCampaignId(root, cell.taskId, cell.arm);
    if (!metadata.campaignId) {
      return { ok: false, reason: metadata.reason };
    }
    if (metadata.campaignId !== SKILL_RERUN_CAMPAIGN_ID) {
      return {
        ok: false,
        reason: `task ${key} campaign_id ${metadata.campaignId} does not match ${SKILL_RERUN_CAMPAIGN_ID}`,
      };
    }
    campaignIds.add(metadata.campaignId);
  }

  if (campaignIds.size > 1) {
    return {
      ok: false,
      reason: `mixed campaign IDs in aggregation set: ${[...campaignIds].join(', ')}`,
    };
  }

  return { ok: true, reason: null, campaignId: campaignIds.values().next().value ?? null };
}

export function refuseLegacySource(label) {
  const value = String(label || '');
  if (V4_JOB_RE.test(value) || V4_PATH_RE.test(value.replaceAll('\\', '/'))) {
    return {
      refused: true,
      reason: `refusing aggregation of old Harbor V4 / non-pilot source: ${value}`,
    };
  }
  return { refused: false, reason: null };
}

export function assertDevelopmentCopy(text) {
  if (FORBIDDEN_CLAIM_RE.test(text || '')) {
    throw new Error(
      `refusing confirmatory/marketing wording in development report: ${text.match(FORBIDDEN_CLAIM_RE)?.[0]}`,
    );
  }
}

function finalStepForArm(arm) {
  return arm === 'lamina' ? 'fix' : 'verify_fix';
}

function durationBetween(start, end) {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, b - a);
}

function collectModelEvidence(trialResult) {
  const agentInfo = trialResult?.agent_info || {};
  const modelInfo = agentInfo.model_info || {};
  const stepModels = (trialResult?.step_results || []).map((step) => ({
    step: step.step_name,
    tokensIn: step.agent_result?.n_input_tokens ?? null,
    tokensOut: step.agent_result?.n_output_tokens ?? null,
    costUsd: step.agent_result?.cost_usd ?? null,
    exceptionType: step.exception_info?.exception_type ?? null,
    exceptionMessage: step.exception_info?.exception_message ?? null,
    agentStartedAt: step.agent_execution?.started_at ?? null,
    agentFinishedAt: step.agent_execution?.finished_at ?? null,
  }));

  return {
    configuredAgent: agentInfo.name || null,
    configuredModel: modelInfo.name || null,
    provider: modelInfo.provider || null,
    expectedAgent: HARBOR_AGENT,
    expectedModel: HARBOR_MODEL,
    modelMatch:
      (modelInfo.name || '') === HARBOR_MODEL
      || (modelInfo.name || '') === 'composer-2.5'
      || /composer[\s._-]?2[\s._-]?5/i.test(modelInfo.name || ''),
    steps: stepModels,
    child_actual_model_unverified: true,
  };
}

function findReward(trialDir, arm) {
  const finalStep = finalStepForArm(arm);
  const candidates = [
    path.join(trialDir, 'steps', finalStep, 'verifier', 'reward.json'),
    path.join(trialDir, 'verifier', 'reward.json'),
  ];
  for (const candidate of candidates) {
    const reward = readJson(candidate);
    if (reward) return { reward, path: candidate, finalStep };
  }
  return { reward: null, path: null, finalStep };
}

function findBehaviorReport(trialDir, arm) {
  const finalStep = finalStepForArm(arm);
  const candidates = [
    path.join(trialDir, 'steps', finalStep, 'verifier', 'behavior_report.json'),
    path.join(trialDir, 'verifier', 'behavior_report.json'),
  ];
  for (const candidate of candidates) {
    const report = readJson(candidate);
    if (report) return { report, path: candidate };
  }
  return { report: null, path: null };
}

function listFilesRecursive(root, targetName) {
  if (!root || !fs.existsSync(root)) return [];
  const found = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name === targetName) found.push(full);
    }
  }
  return found;
}

export function collectSkillEvidence({
  root = DEFAULT_ROOT,
  jobPath,
  trialDir,
  arm,
  taskId,
}) {
  let manifest = null;
  let stagedRoot = null;
  try {
    const loaded = loadSkillBundleManifest(root);
    manifest = loaded.manifest;
    stagedRoot = loaded.stagedRoot;
  } catch (error) {
    return {
      passed: false,
      treatmentValid: false,
      priorNoSkill: arm === 'lamina',
      gate: 'skill_bundle_missing',
      reason: error.message,
    };
  }

  const lock = readTrialLock(jobPath, trialDir ? path.basename(trialDir) : null);
  const ledgerPath = trialDir ? path.join(trialDir, 'protocol', 'transition-ledger.jsonl') : null;
  return evaluatePreModelSkillGate({
    arm,
    taskId,
    lock,
    ledgerEntries: collectHostLedgerEntries(ledgerPath),
    stagedRoot,
    manifest,
    root,
    requireLedgerEvidence: true,
  });
}

export function laminaDeltaEligible(cell) {
  if (!cell || cell.arm !== 'lamina') return true;
  if (cell.skillEvidence?.priorNoSkill) return false;
  if (cell.skillEvidence?.passed === false) return false;
  if (cell.skillEvidence?.treatmentValid === false) return false;
  if (cell.invalidTreatment) return false;
  return cell.measurementValid === true;
}

export function detectVerifierIsolationBreach(trialDir) {
  const evidence = [];
  for (const logPath of listFilesRecursive(trialDir, 'cursor-cli.txt')) {
    const paths = [];
    for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const read = event?.tool_call?.readToolCall;
      const readPath = read?.args?.path;
      if (
        typeof readPath === 'string'
        && /\/tests\/(?:grade|behavior-grade|pilot-behavior-grade|pilot-treatment)\.mjs\b/.test(readPath)
        && typeof read?.result?.success?.content === 'string'
      ) paths.push(readPath);
      const shellOutput = event?.tool_call?.shellToolCall?.result?.success?.stdout;
      if (typeof shellOutput === 'string') {
        paths.push(...(shellOutput.match(FORBIDDEN_VERIFIER_PATH_RE) || []));
      }
    }
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length) {
      evidence.push({
        logPath,
        forbiddenPaths: uniquePaths,
      });
    }
  }
  return {
    passed: evidence.length === 0,
    breach: evidence.length > 0,
    evidence,
  };
}

export function collectIsolationEvidence(trialDir, arm) {
  if (!trialDir) return { passed: false, reason: 'trial directory missing' };
  const finalStep = finalStepForArm(arm);
  const sealPath = path.join(trialDir, 'protocol', 'final-seal.json');
  const ledgerPath = path.join(trialDir, 'protocol', 'transition-ledger.jsonl');
  const abiPath = path.join(trialDir, 'steps', finalStep, 'verifier', 'verifier-abi.json');
  const seal = readJson(sealPath);
  const abi = readJson(abiPath);
  let ledger = [];
  try {
    ledger = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    ledger = [];
  }
  const events = ledger.map((entry) => entry.event);
  const passed = Boolean(
    seal?.double_capture_identical === true
      && typeof seal?.candidate_digest === 'string'
      && seal.candidate_digest === abi?.candidate_digest
      && abi?.network_mode === 'none'
      && abi?.read_only_rootfs === true
      && abi?.campaign_id === SKILL_RERUN_CAMPAIGN_ID
      && abi?.measurement_contract === 'semantic_criteria_v3'
      && events.includes('final_sealed')
      && events.includes('agent_environment_removed')
      && events.includes('scoring_complete'),
  );
  return {
    passed,
    reason: passed ? null : 'host seal / isolated verifier evidence incomplete or inconsistent',
    sealPath: fs.existsSync(sealPath) ? sealPath : null,
    verifierAbiPath: fs.existsSync(abiPath) ? abiPath : null,
    ledgerPath: fs.existsSync(ledgerPath) ? ledgerPath : null,
    candidateDigest: seal?.candidate_digest ?? null,
    verifierImageDigest: abi?.verifier_image_digest ?? null,
    doubleCaptureIdentical: seal?.double_capture_identical ?? false,
    networkMode: abi?.network_mode ?? null,
    readOnlyRootfs: abi?.read_only_rootfs ?? false,
    campaignId: abi?.campaign_id ?? null,
    measurementContract: abi?.measurement_contract ?? null,
    events,
  };
}


export function extractCellRecord({ jobsRoot, jobName, cellMeta = {} }) {
  const legacy = refuseLegacySource(jobName);
  if (legacy.refused) {
    return {
      ok: false,
      jobName,
      state: 'refused_legacy_source',
      reason: legacy.reason,
      child_actual_model_unverified: true,
    };
  }

  const parsed = parsePilotJobName(jobName);
  if (!parsed) {
    return {
      ok: false,
      jobName,
      state: 'invalid_pilot_job_name',
      reason: `job name is not an lb6-pilot first-attempt record: ${jobName}`,
      child_actual_model_unverified: true,
    };
  }

  const jobPath = path.join(jobsRoot, jobName);
  if (!fs.existsSync(jobPath)) {
    return {
      ok: false,
      jobName,
      taskId: parsed.taskId,
      arm: parsed.arm,
      jobPath,
      state: cellMeta.state || 'job_missing',
      reason: `Harbor job directory missing: ${jobPath}`,
      exitCode: cellMeta.exitCode ?? null,
      durationMs: cellMeta.durationMs ?? null,
      child_actual_model_unverified: true,
    };
  }

  const pathLegacy = refuseLegacySource(jobPath);
  if (pathLegacy.refused) {
    return {
      ok: false,
      jobName,
      jobPath,
      state: 'refused_legacy_source',
      reason: pathLegacy.reason,
      child_actual_model_unverified: true,
    };
  }

  const jobResult = readJson(path.join(jobPath, 'result.json'));
  const jobConfig = readJson(path.join(jobPath, 'config.json'));
  const datasetPath = jobConfig?.datasets?.[0]?.path || null;
  if (datasetPath) {
    const datasetLegacy = refuseLegacySource(datasetPath);
    if (datasetLegacy.refused) {
      return {
        ok: false,
        jobName,
        jobPath,
        state: 'refused_legacy_source',
        reason: datasetLegacy.reason,
        child_actual_model_unverified: true,
      };
    }
    if (!String(datasetPath).includes(TASKS_REL)) {
      return {
        ok: false,
        jobName,
        jobPath,
        state: 'refused_non_pilot_dataset',
        reason: `dataset path is not the lb6 pilot tasks root: ${datasetPath}`,
        child_actual_model_unverified: true,
      };
    }
  }

  const trialNames = listDirs(jobPath).filter((name) => name !== 'job.log' && !name.startsWith('.'));
  const trialName = trialNames[0] || null;
  const trialDir = trialName ? path.join(jobPath, trialName) : null;
  const trialResult = trialDir ? readJson(path.join(trialDir, 'result.json')) : null;
  const rewardInfo = trialDir
    ? findReward(trialDir, parsed.arm)
    : { reward: null, path: null, finalStep: finalStepForArm(parsed.arm) };
  const behaviorInfo = trialDir
    ? findBehaviorReport(trialDir, parsed.arm)
    : { report: null, path: null };
  const semanticEvidence = validateSemanticMeasurement(rewardInfo.reward, behaviorInfo.report);
  const modelEvidence = collectModelEvidence(trialResult);
  const verifierIsolation = detectVerifierIsolationBreach(trialDir);
  const isolationEvidence = collectIsolationEvidence(trialDir, parsed.arm);
  const skillEvidence = collectSkillEvidence({
    root: jobsRoot ? path.resolve(jobsRoot, '..') : DEFAULT_ROOT,
    jobPath,
    trialDir,
    arm: parsed.arm,
    taskId: parsed.taskId,
  });

  const exception = trialResult?.exception_info || null;
  const stepExceptions = (trialResult?.step_results || [])
    .filter((step) => step.exception_info)
    .map((step) => ({
      step: step.step_name,
      type: step.exception_info.exception_type,
      message: step.exception_info.exception_message,
    }));

  let state = cellMeta.state || 'completed';
  if (cellMeta.deadlineExceeded) state = 'campaign_deadline_exceeded';
  else if (verifierIsolation.breach) state = 'verifier_isolation_breach';
  else if (!skillEvidence.passed) state = skillEvidence.gate || 'skill_injection_failure';
  else if (!semanticEvidence.passed) state = 'semantic_measurement_invalid';
  else if (!isolationEvidence.passed && !exception && !stepExceptions.length) state = 'protocol_evidence_missing';
  else if (exception || stepExceptions.length) state = 'trial_exception';
  else if (cellMeta.exitCode && cellMeta.exitCode !== 0) state = cellMeta.state || 'harbor_nonzero_exit';
  else if (!trialResult) state = cellMeta.state || 'trial_missing';

  const observedReward = rewardInfo.reward?.reward ?? behaviorInfo.report?.reward ?? null;
  const observedBehavior = rewardInfo.reward?.behavior
    ?? behaviorInfo.report?.raw_behavior
    ?? behaviorInfo.report?.behavior_pass_rate
    ?? behaviorInfo.report?.scores?.behavior
    ?? null;
  const ok =
    state === 'completed'
    && observedReward !== undefined
    && observedReward !== null
    && modelEvidence.modelMatch
    && !verifierIsolation.breach
    && isolationEvidence.passed
    && skillEvidence.passed
    && semanticEvidence.passed
    && !behaviorInfo.report?.invalid_treatment
    && !behaviorInfo.report?.measurement_invalid;
  const measurementValid =
    ok
    && state === 'completed'
    && !verifierIsolation.breach
    && isolationEvidence.passed
    && skillEvidence.passed
    && semanticEvidence.passed
    && !behaviorInfo.report?.invalid_treatment
    && !behaviorInfo.report?.measurement_invalid;

  return {
    ok,
    jobName,
    jobPath,
    trialName,
    trialPath: trialDir,
    taskId: parsed.taskId,
    arm: parsed.arm,
    taskDirName: expectedPilotTaskDirName(parsed.taskId, parsed.arm),
    state,
    exitCode: cellMeta.exitCode ?? null,
    signal: cellMeta.signal ?? null,
    durationMs: cellMeta.durationMs ?? durationBetween(trialResult?.started_at, trialResult?.finished_at),
    startedAt: trialResult?.started_at || jobResult?.started_at || null,
    finishedAt: trialResult?.finished_at || jobResult?.finished_at || null,
    observedReward,
    reward: measurementValid ? observedReward : null,
    behavior: measurementValid ? observedBehavior : null,
    invalidTreatment: behaviorInfo.report?.invalid_treatment ?? false,
    measurementInvalid: behaviorInfo.report?.measurement_invalid ?? false,
    measurementInvalidReason: behaviorInfo.report?.measurement_invalid_reason ?? null,
    criteria: behaviorInfo.report?.criteria ?? [],
    earned: behaviorInfo.report?.earned ?? null,
    possible: behaviorInfo.report?.possible ?? null,
    rawBehavior: behaviorInfo.report?.raw_behavior ?? observedBehavior,
    semanticEvidence,
    skillEvidence,
    priorNoSkill: Boolean(skillEvidence.priorNoSkill),
    treatmentInvalid: Boolean(skillEvidence.priorNoSkill || skillEvidence.treatmentValid === false),
    rewardPath: rewardInfo.path,
    behaviorReportPath: behaviorInfo.path,
    finalStep: rewardInfo.finalStep,
    costUsd: jobResult?.stats?.cost_usd
      ?? trialResult?.step_results?.reduce((sum, step) => sum + (step.agent_result?.cost_usd || 0), 0)
      ?? null,
    tokens: {
      input: jobResult?.stats?.n_input_tokens ?? null,
      cache: jobResult?.stats?.n_cache_tokens ?? null,
      output: jobResult?.stats?.n_output_tokens ?? null,
    },
    exception,
    stepExceptions,
    verifierIsolation,
    isolationEvidence,
    measurementValid,
    modelEvidence,
    taskChecksum: trialResult?.task_checksum || null,
    ...DEVELOPMENT_FLAGS,
  };
}

export function buildTaskCluster(taskId, cells) {
  const byArm = Object.fromEntries(PILOT_ARMS.map((arm) => [arm, null]));
  for (const cell of cells) {
    if (cell.taskId === taskId) byArm[cell.arm] = cell;
  }
  const publicReward = (cell) => (cell?.ok && cell?.measurementValid ? cell.reward : null);
  const rewards = Object.fromEntries(PILOT_ARMS.map((arm) => [arm, publicReward(byArm[arm])]));
  const direct = rewards.direct;
  const laminaEligible = laminaDeltaEligible(byArm.lamina);
  const deltas = {
    plan_minus_direct: direct !== null && rewards.plan !== null ? rewards.plan - direct : null,
    lamina_minus_direct:
      direct !== null && rewards.lamina !== null && laminaEligible ? rewards.lamina - direct : null,
    lamina_minus_plan:
      rewards.plan !== null && rewards.lamina !== null && laminaEligible
        ? rewards.lamina - rewards.plan
        : null,
  };
  const measurementValid = PILOT_ARMS.every((arm) => byArm[arm]?.ok && byArm[arm]?.measurementValid);
  return {
    taskId,
    rewards,
    deltas,
    laminaDeltaSuppressed: Boolean(byArm.lamina && !laminaEligible),
    measurementValid,
    cells: PILOT_ARMS.map((arm) => byArm[arm]).filter(Boolean),
  };
}

export function renderMarkdownReport(report) {
  const lines = [];
  lines.push('# LaminaBench development pilot report');
  lines.push('');
  lines.push('**Development-only / non-confirmatory.** Do not treat these cells as LaminaBench-6 evidence, a product-win advertisement, or a frozen statistical gate result.');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Selected tasks: ${(report.selectedTaskIds || []).map((id) => `\`${id}\``).join(', ') || '`unknown`'}`);
  lines.push(`- Agent: \`${report.agent}\``);
  lines.push(`- Model: \`${report.model}\``);
  lines.push(`- Attempts per arm: \`${report.attemptsPerArm}\``);
  lines.push(`- Max retries after model invocation: \`${report.maxRetries}\``);
  lines.push(`- Concurrency requested: \`${report.concurrency?.requested}\``);
  lines.push(`- Concurrency effective: \`${report.concurrency?.effective}\``);
  lines.push(`- Concurrency hard max: \`${report.concurrency?.max}\``);
  lines.push(`- Campaign deadline: \`${report.campaign?.deadlineAt || 'n/a'}\``);
  lines.push(`- Campaign gate: \`${report.campaign?.gate || report.gate}\``);
  lines.push('- Behavior rubric: `10` equal semantic points; raw score = `earned / 10`.');
  lines.push('- Valid Harbor reward: arm-blind Laplace smoothing `(earned + 1) / 12` (ceiling `0.9167`).');
  lines.push('- Deterministic replay: hard measurement-validity gate.');
  lines.push('- `child_actual_model_unverified: true`');
  lines.push('');
  lines.push('## Schedule');
  lines.push('');
  lines.push('Deterministic makespan-aware order (development-only throughput optimization; not a confirmatory randomized schedule):');
  lines.push('');
  lines.push('| Index | Wave | Task | Arm | Job |');
  lines.push('|---:|---:|---|---|---|');
  for (const slot of report.schedule || []) {
    const cell = (report.cells || []).find(
      (item) => item.taskId === slot.taskId && item.arm === slot.arm,
    );
    lines.push(
      `| ${slot.scheduleIndex} | ${slot.wave} | \`${slot.taskId}\` | ${slot.arm} | \`${cell?.jobName || 'pending'}\` |`,
    );
  }
  lines.push('');
  lines.push('## Task clusters');
  lines.push('');
  for (const cluster of report.taskClusters || []) {
    lines.push(`### \`${cluster.taskId}\``);
    lines.push('');
    lines.push('| Arm | Reward | Raw | Earned | Valid measurement | Delta vs direct |');
    lines.push('|---|---:|---:|---:|---|---|');
    for (const arm of PILOT_ARMS) {
      const cell = cluster.cells.find((item) => item.arm === arm);
      const delta =
        arm === 'direct'
          ? '—'
          : arm === 'plan'
            ? cluster.deltas.plan_minus_direct
            : cluster.deltas.lamina_minus_direct;
      lines.push(
        `| ${arm} | ${cluster.rewards[arm] ?? 'n/a'} | ${cell?.rawBehavior ?? 'n/a'} | ${cell?.earned ?? 'n/a'}/${cell?.possible ?? 'n/a'} | ${cell?.measurementValid ? 'yes' : 'no'} | ${delta ?? 'n/a'} |`,
      );
    }
    lines.push('');
  }
  lines.push('## Limitations and missing gates');
  lines.push('');
  for (const item of report.limitations || []) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('## Failure states');
  lines.push('');
  const failures = (report.cells || []).filter((cell) => cell.state !== 'completed');
  if (!failures.length) {
    lines.push('- None recorded as non-completed (still development-only; not a product claim).');
  } else {
    for (const cell of failures) {
      lines.push(`- **${cell.taskId}/${cell.arm}**: ${cell.state}${cell.reason ? ` — ${cell.reason}` : ''}`);
    }
  }
  lines.push('');
  lines.push('## Job paths');
  lines.push('');
  for (const cell of report.cells || []) {
    lines.push(`- ${cell.taskId}/${cell.arm}: \`${cell.jobPath || 'missing'}\``);
  }
  lines.push('');
  lines.push('## Publication');
  lines.push('');
  lines.push('- Harbor publication was prepared but not executed by this runner.');
  lines.push('- Operator must publish manually only after reviewing development gates.');
  const markdown = `${lines.join('\n')}\n`;
  assertDevelopmentCopy(markdown);
  return markdown;
}

export function buildPilotReport({
  cells,
  concurrency,
  campaign = {},
  selectedTaskIds = [],
  schedule = [],
  generatedAt = new Date().toISOString(),
}) {
  const taskIds = selectedTaskIds.length
    ? [...selectedTaskIds].sort()
    : [...new Set(cells.map((cell) => cell.taskId).filter(Boolean))].sort();
  const expectedCellCount = taskIds.length * PILOT_ARMS.length;
  const taskClusters = taskIds.map((taskId) => buildTaskCluster(taskId, cells));
  const refused = cells.filter((cell) => String(cell.state || '').startsWith('refused_'));
  const isolationBreaches = cells.filter((cell) => cell.verifierIsolation?.breach);
  const allSelectedCellsPresent =
    cells.length === expectedCellCount
    && taskIds.every((taskId) =>
      PILOT_ARMS.every((arm) => cells.some((cell) => cell.taskId === taskId && cell.arm === arm)),
    );
  const allCellsValid = allSelectedCellsPresent && cells.every((cell) => cell.ok && cell.measurementValid);
  const reportOk = Boolean(campaign.ok) && allCellsValid;
  const reportGate = refused.length
    ? 'refused_legacy_or_invalid_source'
    : isolationBreaches.length
      ? 'verifier_isolation_breach'
      : !allSelectedCellsPresent
        ? 'pilot_cells_incomplete'
      : !allCellsValid
        ? 'pilot_measurement_invalid'
        : campaign.gate || 'pilot_report_ready';

  const report = {
    kind: 'lb6_pilot_semantic_v3_development_report',
    ...DEVELOPMENT_FLAGS,
    not_claim_ready: true,
    distinct_from: 'lamina-bench-6',
    campaignId: SKILL_RERUN_CAMPAIGN_ID,
    generatedAt,
    selectedTaskIds: taskIds,
    taskClusters,
    schedule,
    agent: HARBOR_AGENT,
    model: HARBOR_MODEL,
    attemptsPerArm: 1,
    maxRetries: 0,
    scoring: {
      measurement: 'semantic_criteria_v3',
      behaviorPoints: 10,
      raw: 'earned / 10',
      reward: '(earned + 1) / 12',
      smoothing: { kind: 'laplace', alpha: 1, beta: 1, armBlind: true },
      deterministicReplay: 'hard measurement-validity gate',
    },
    concurrency: {
      requested: concurrency?.requested ?? null,
      effective: concurrency?.effective ?? null,
      max: concurrency?.max ?? 6,
      pending: concurrency?.pending ?? cells.length,
    },
    campaign: {
      startedAt: campaign.startedAt || null,
      deadlineAt: campaign.deadlineAt || null,
      deadlineMs: campaign.deadlineMs || null,
      deadlineExceeded: Boolean(campaign.deadlineExceeded),
      ok: reportOk,
      gate: reportGate,
    },
    gate: reportGate,
    cells,
    limitations: [
      'Development-only pilot; not LaminaBench-6 confirmatory evidence.',
      'Persona child actual selected model remains unverified (`child_actual_model_unverified: true`).',
      'No effect-size gate, confidence interval, or product-win claim is computed or implied.',
      'Old Harbor V4 jobs/results are refused and never averaged into this report.',
      'Harbor publication remains a manual operator step.',
      'Schedule order is deterministic admission-aware optimization with at most one Lamina parent, not a confirmatory randomized arm schedule.',
      'Prior Lamina efficacy deltas from no-skill Harbor locks are treatment-invalid and are suppressed from lamina_minus_* deltas.',
      ...(isolationBreaches.length
        ? ['Verifier isolation failed: agent phases accessed private evaluator implementation under `/tests`; all observed rewards are invalid for comparison or publication.']
        : []),
      ...(!allCellsValid ? ['At least one selected task/arm cell lacks a valid final measurement; no cross-arm comparison is computed.'] : []),
      ...(campaign.deadlineExceeded ? ['Campaign hit the two-hour outer deadline.'] : []),
      ...(refused.length ? refused.map((cell) => cell.reason).filter(Boolean) : []),
    ],
  };

  assertDevelopmentCopy(JSON.stringify(report));
  return report;
}

export async function aggregatePilotCampaign({
  root = DEFAULT_ROOT,
  jobsRoot = path.join(root, 'jobs'),
  jobNames = [],
  cells = [],
  schedule = [],
  selectedTaskIds = [],
  concurrency = null,
  campaign = {},
  write = false,
  reportsDir = path.join(root, REPORTS_REL),
} = {}) {
  const metaByJob = new Map(cells.map((cell) => [cell.jobName, cell]));
  const names = jobNames.length
    ? jobNames
    : cells.map((cell) => cell.jobName).filter(Boolean);

  if (!names.length) {
    throw new Error('aggregatePilotCampaign requires jobNames or cells with jobName');
  }

  for (const name of names) {
    const legacy = refuseLegacySource(name);
    if (legacy.refused) {
      throw new Error(legacy.reason);
    }
  }

  const extracted = names.map((jobName) =>
    extractCellRecord({
      jobsRoot,
      jobName,
      cellMeta: metaByJob.get(jobName) || {},
    }));

  const refused = extracted.filter((cell) => String(cell.state || '').startsWith('refused_'));
  if (refused.length) {
    throw new Error(refused[0].reason || 'refused legacy source during aggregation');
  }

  const invalidNames = extracted.filter((cell) => cell.state === 'invalid_pilot_job_name');
  if (invalidNames.length) {
    throw new Error(invalidNames[0].reason || 'invalid pilot job name during aggregation');
  }

  const campaignCheck = validateCampaignCells(extracted, root);
  if (!campaignCheck.ok) {
    throw new Error(campaignCheck.reason || 'campaign identity validation failed');
  }

  const taskIds = selectedTaskIds.length
    ? [...selectedTaskIds].sort()
    : [...new Set(extracted.map((cell) => cell.taskId).filter(Boolean))].sort();
  const missing = [];
  for (const taskId of taskIds) {
    for (const arm of PILOT_ARMS) {
      if (!extracted.some((cell) => cell.taskId === taskId && cell.arm === arm)) {
        missing.push(`${taskId}/${arm}`);
      }
    }
  }
  if (missing.length) {
    throw new Error(`aggregatePilotCampaign missing selected task/arm cells: ${missing.join(', ')}`);
  }

  const report = buildPilotReport({
    cells: extracted,
    concurrency,
    campaign,
    selectedTaskIds: taskIds,
    schedule,
  });
  const markdown = renderMarkdownReport(report);

  const paths = { json: null, markdown: null };
  if (write) {
    fs.mkdirSync(reportsDir, { recursive: true });
    paths.json = path.join(reportsDir, 'skill-rerun-v3.json');
    paths.markdown = path.join(reportsDir, 'skill-rerun-v3.md');
    fs.writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(paths.markdown, markdown);
  }

  return { report, markdown, paths };
}

export function main(argv = process.argv.slice(2)) {
  const root = DEFAULT_ROOT;
  const jobs = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--job' && argv[i + 1]) {
      jobs.push(argv[i + 1]);
      i += 1;
    }
  }
  if (!jobs.length) {
    console.error('Usage: node aggregate-results.mjs --job <lb6-pilot-...> [--job ...]');
    return 1;
  }
  return aggregatePilotCampaign({
    root,
    jobNames: jobs,
    concurrency: {
      requested: jobs.length,
      effective: jobs.length,
      max: 6,
      pending: jobs.length,
    },
    write: true,
  }).then(({ report, paths }) => {
    console.log(`Wrote ${paths.json}`);
    console.log(`Wrote ${paths.markdown}`);
    console.log(`gate=${report.gate}; child_actual_model_unverified=true`);
    return 0;
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  Promise.resolve()
    .then(() => main())
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message || error);
      process.exitCode = 1;
    });
}
