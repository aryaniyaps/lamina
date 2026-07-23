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

export function buildSupervisorEnv(root = DEFAULT_ROOT, baseEnv = process.env) {
  const forkRoot = path.join(root, HARBOR_FORK_REL);
  const existingPythonPath = baseEnv.PYTHONPATH ? `:${baseEnv.PYTHONPATH}` : '';
  return {
    ...baseEnv,
    PYTHONPATH: `${forkRoot}${existingPythonPath}`,
    LB6_HOST_SEAL: '1',
    LB6_SEALED_ROOT: path.join(root, SEALED_STORE_REL),
    LB6_PRIVATE_VERIFIER_ROOT: path.join(root, PRIVATE_VERIFIER_REL),
    LB6_VERIFIER_IMAGE: baseEnv.LB6_VERIFIER_IMAGE || DEFAULT_VERIFIER_IMAGE,
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

export function discoverPilotTasks(tasksRoot) {
  if (!fs.existsSync(tasksRoot)) {
    return {
      ok: false,
      gate: 'pilot_tasks_missing',
      reason: `pilot tasks root missing: ${tasksRoot}`,
      taskId: null,
      byArm: {},
    };
  }

  const dirs = fs
    .readdirSync(tasksRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const byArm = {};
  for (const arm of PILOT_ARMS) {
    const matches = dirs.filter((name) => name.endsWith(`-${arm}`));
    byArm[arm] = matches;
  }

  const missing = PILOT_ARMS.filter((arm) => byArm[arm].length === 0);
  if (missing.length) {
    return {
      ok: false,
      gate: 'pilot_arm_tasks_incomplete',
      reason: `missing Harbor task directories for arms: ${missing.join(', ')}`,
      taskId: null,
      byArm,
    };
  }

  const extras = PILOT_ARMS.filter((arm) => byArm[arm].length > 1);
  if (extras.length) {
    return {
      ok: false,
      gate: 'pilot_arm_tasks_ambiguous',
      reason: `expected exactly one task per arm; ambiguous: ${extras
        .map((arm) => `${arm}=[${byArm[arm].join(', ')}]`)
        .join('; ')}`,
      taskId: null,
      byArm,
    };
  }

  const taskIds = PILOT_ARMS.map((arm) => byArm[arm][0].slice(0, -(arm.length + 1)));
  const unique = new Set(taskIds);
  if (unique.size !== 1) {
    return {
      ok: false,
      gate: 'pilot_task_id_mismatch',
      reason: `arms do not share one task id: ${JSON.stringify(Object.fromEntries(PILOT_ARMS.map((arm, i) => [arm, taskIds[i]])))}`,
      taskId: null,
      byArm,
    };
  }

  const taskId = taskIds[0];
  if (/checklist/i.test(taskId) || dirs.some((name) => /checklist/i.test(name))) {
    return {
      ok: false,
      gate: 'pilot_checklist_forbidden',
      reason: 'checklist arm/task is forbidden in the lb6 pilot package',
      taskId,
      byArm,
    };
  }

  if (V4_PATH_RE.test(tasksRoot.replaceAll('\\', '/'))) {
    return {
      ok: false,
      gate: 'pilot_v4_path_forbidden',
      reason: 'refusing V4 harbor task path; use benchmarks/lb6/pilot/harbor/tasks',
      taskId,
      byArm,
    };
  }

  return {
    ok: true,
    gate: 'pilot_tasks_ready',
    reason: null,
    taskId,
    byArm: Object.fromEntries(PILOT_ARMS.map((arm) => [arm, byArm[arm][0]])),
  };
}

export function makeJobName(taskId, arm, nowMs = Date.now()) {
  return `lb6-pilot-${taskId}-${arm}-${nowMs}`;
}

export function buildHarborArgs({
  arm,
  taskDirName,
  jobName,
  tasksPath = TASKS_REL,
  envFile,
  nConcurrent = 1,
  nConcurrentAgents = 1,
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
  return args;
}

function spawnPromise(spawnImpl, command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawnImpl(command, args, {
      stdio: options.stdio ?? 'inherit',
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
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        record.stdout += chunk;
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        record.stderr += chunk;
      });
    }
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

export async function runNodeScripts(scripts, { root, spawnImpl = defaultSpawn, label }) {
  const results = [];
  for (const scriptPath of scripts) {
    const rel = path.relative(root, scriptPath);
    const result = await spawnPromise(spawnImpl, process.execPath, [scriptPath], {
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

function looksLikeRateLimit(text) {
  return /rate[-\s]?limit|429|resource_exhausted|too many requests/i.test(text || '');
}

function looksLikeProvenanceFailure(text) {
  return /provenance|child_actual_model|persona.?child|native.?child|protocol_invalid/i.test(text || '');
}

export function classifyCellFailure(record) {
  const blob = `${record.stdout || ''}\n${record.stderr || ''}\n${record.error || ''}`;
  if (record.deadlineExceeded) {
    return { state: 'campaign_deadline_exceeded', failFast: true };
  }
  if (looksLikeRateLimit(blob)) {
    return { state: 'rate_limit_failure', failFast: true };
  }
  if (looksLikeProvenanceFailure(blob)) {
    return { state: 'provenance_failure', failFast: true };
  }
  if (record.error) return { state: 'spawn_error', failFast: false };
  if (record.signal) return { state: 'signaled', failFast: false };
  if (record.exitCode === 0) return { state: 'completed', failFast: false };
  return { state: 'harbor_nonzero_exit', failFast: false };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  let stop = false;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (!stop) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const outcome = await worker(items[index], index);
      results[index] = outcome;
      if (outcome?.failFast) stop = true;
    }
  });
  await Promise.all(runners);
  return results.filter((item) => item !== undefined);
}

function killChild(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // Best effort.
  }
}

export function preparePublicationPlan({ root, taskId, cells, reportPaths }) {
  const publicationDir = path.join(root, PUBLICATION_REL);
  fs.mkdirSync(publicationDir, { recursive: true });
  const commands = {
    note: 'Manual operator step only. This runner does not execute Harbor publication.',
    publication_eligible: false,
    blocked_until: 'authenticated harbor CLI + valid isolated rerun with all three final measurements',
    blocked_reasons: [
      'development-only package',
      'current campaign has no publication-valid three-arm result',
      'operator must review verifier isolation before any public upload',
    ],
    commands: [
      `harbor publish --public ${TASKS_REL}`,
      ...cells.map((cell) => `harbor upload --public ${path.join('jobs', cell.jobName)}`),
    ],
    artifacts: {
      reportJson: reportPaths?.json || null,
      reportMarkdown: reportPaths?.markdown || null,
      taskId,
      jobNames: cells.map((cell) => cell.jobName),
    },
    development_only: true,
    confirmatory: false,
    child_actual_model_unverified: true,
  };
  const outPath = path.join(publicationDir, 'manual-publish-plan.json');
  fs.writeFileSync(outPath, `${JSON.stringify(commands, null, 2)}\n`);
  return { outPath, plan: commands };
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

  if (!skipPackageScripts) {
    const scripts = discoverBuildValidateScripts(paths.scriptsDir);
    if (scripts.build.length) {
      const build = await runNodeScripts(scripts.build, {
        root,
        spawnImpl,
        label: 'pilot_build',
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
      const validate = await runNodeScripts(scripts.validate, {
        root,
        spawnImpl,
        label: 'pilot_validate',
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

  const discovery = discoverPilotTasks(paths.tasksRoot);
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

  const cells = PILOT_ARMS.map((arm, index) => ({
    arm,
    taskId: discovery.taskId,
    taskDirName: discovery.byArm[arm],
    jobName: makeJobName(discovery.taskId, arm, nowMs + index),
  }));

  const concurrency = resolveConcurrency(
    options.concurrency,
    cells.length,
    options.maxConcurrency ?? MAX_CONCURRENCY,
  );

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
      }),
    }));
    return {
      ok: true,
      exitCode: 0,
      gate: 'dry_run',
      reason: null,
      gates,
      concurrency,
      cells: planned,
      report: null,
    };
  }

  const activeChildren = new Set();
  const supervisorEnv = buildSupervisorEnv(root, options.env ?? process.env);
  let deadlineExceeded = false;
  let deadlineTimer = null;
  if (deadlineMs > 0) {
    deadlineTimer = setTimeout(() => {
      deadlineExceeded = true;
      for (const child of activeChildren) killChild(child);
    }, deadlineMs);
    if (typeof deadlineTimer.unref === 'function') deadlineTimer.unref();
  }

  const cellResults = await runPool(cells, concurrency.effective, async (cell) => {
    const args = buildHarborArgs({
      arm: cell.arm,
      taskDirName: cell.taskDirName,
      jobName: cell.jobName,
      tasksPath: TASKS_REL,
      envFile,
      nConcurrent: 1,
      nConcurrentAgents: 1,
    });
    const started = Date.now();
    const finished = await spawnPromise(spawnImpl, 'harbor', args, {
      cwd: root,
      stdio: options.stdio ?? 'inherit',
      env: supervisorEnv,
      onSpawn: (child) => activeChildren.add(child),
    });
    if (finished.child) activeChildren.delete(finished.child);

    const classification = classifyCellFailure({
      ...finished,
      deadlineExceeded,
    });
    const output = `${finished.stdout || ''}\n${finished.stderr || ''}\n${finished.error || ''}`;
    return {
      ...cell,
      args,
      exitCode: finished.exitCode,
      signal: finished.signal,
      error: finished.error,
      durationMs: Date.now() - started,
      state: classification.state,
      failFast: classification.failFast,
      rateLimit: looksLikeRateLimit(output),
      provenanceFailure: looksLikeProvenanceFailure(output),
      deadlineExceeded,
      jobPath: path.join(paths.jobsDir, cell.jobName),
    };
  });

  if (deadlineTimer) clearTimeout(deadlineTimer);

  const failFastHit = cellResults.find((cell) => cell.failFast);
  const allArmsPresent = PILOT_ARMS.every((arm) => cellResults.some((cell) => cell.arm === arm));
  const campaignOk =
    !deadlineExceeded
    && !failFastHit
    && allArmsPresent
    && cellResults.length === PILOT_ARMS.length
    && cellResults.every((cell) => cell.exitCode === 0);

  let aggregate = null;
  if (aggregateImpl) {
    aggregate = await aggregateImpl({
      root,
      jobNames: cellResults.map((cell) => cell.jobName),
      cells: cellResults,
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
    taskId: discovery.taskId,
    cells: cellResults,
    reportPaths: aggregate?.paths || null,
  });

  return {
    ok: finalCampaignOk,
    exitCode: finalCampaignOk ? 0 : 1,
    gate: finalGate,
    reason: failFastHit
      ? `fail-fast cell ${failFastHit.arm}: ${failFastHit.state}`
      : deadlineExceeded
        ? `campaign exceeded ${deadlineMs}ms deadline`
        : finalCampaignOk
          ? null
          : `one or more Harbor cells failed publication gates (${finalGate})`,
    gates,
    concurrency,
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

  const result = await runThreeArmCampaign({
    root,
    dryRun,
    skipPackageScripts,
    concurrency: concurrencyFlag,
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
      cells: result.cells?.map((cell) => ({
        arm: cell.arm,
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
