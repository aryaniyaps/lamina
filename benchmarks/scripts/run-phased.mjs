#!/usr/bin/env node
/**
 * Run a Harbor benchmark task via matched multi-phase claude --resume invocations.
 * Design C — ecological loop with equal phase count for control and treatment.
 * One session across phases; treatment slash commands are harness-sent user messages.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';
import { loadBenchEnv, resolveBenchModel } from './load-bench-env.mjs';
import { HARBOR_TASKS_DIR, loadRegistry, parseHarborDirName } from './harbor-tasks.mjs';
import { refreshTrialWorkspace } from './harbor-sync.mjs';

loadBenchEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARBOR_JOBS = path.join(ROOT, 'benchmarks/results/harbor/jobs');

function docker(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: process.env, ...opts });
}

function workflowForTask(taskId) {
  const task = loadRegistry().find((t) => t.id === taskId);
  return task?.workflow === 'audit' ? 'audit' : 'design';
}

function fixOwnership(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
  docker(
    'docker',
    ['run', '--rm', '-v', `${targetPath}:/work`, 'alpine', 'chown', '-R', `${uid}:${gid}`, '/work'],
    { stdio: 'ignore' }
  );
}

function fixWorkspaceOwnership(workspacePath) {
  fixOwnership(workspacePath);
}

function fixTrialOwnership(trialDir) {
  fixOwnership(trialDir);
}

function runPhasedBenchmark(harborName, release, attempt) {
  const parsed = parseHarborDirName(harborName);
  if (!parsed) {
    throw new Error(`Invalid harbor task name: ${harborName}`);
  }

  const { id: taskId, arm } = parsed;
  const workflow = workflowForTask(taskId);
  const taskDir = path.join(HARBOR_TASKS_DIR, harborName);
  const envDir = path.join(taskDir, 'environment');
  const imageTag = `lamina-bench-${harborName}:local`;
  const jobName = `${harborName}__run${attempt}`;
  const jobDir = path.join(HARBOR_JOBS, jobName);
  const trialName = `${harborName}__phased`;
  const trialDir = path.join(jobDir, trialName);

  fs.mkdirSync(path.join(trialDir, 'agent'), { recursive: true });
  fs.mkdirSync(path.join(trialDir, 'agent', 'home'), { recursive: true });
  fs.mkdirSync(path.join(trialDir, 'verifier'), { recursive: true });

  const phasesPerTrial = release.phases_per_trial ?? 5;
  const maxTurnsPerPhase =
    release.max_turns_per_phase ??
    Math.max(1, Math.floor((release.agent_max_turns ?? 100) / phasesPerTrial));
  const agentTimeoutSec = release.agent_timeout_sec ?? 600;
  const phaseTimeoutSec = release.phase_timeout_sec ?? 120;
  const bgWaitCeilingMs = release.bg_wait_ceiling_ms ?? 30000;
  const rewardkitMaxAttempts = release.rewardkit_max_attempts ?? 2;
  const rewardkitRetryDelaySec = release.rewardkit_retry_delay_sec ?? 2;

  console.log(
    `\n[matched-phased] ${harborName} arm=${arm} workflow=${workflow} attempt ${attempt} (${phasesPerTrial} phases, ${maxTurnsPerPhase} turns/phase, phase_timeout=${phaseTimeoutSec}s, agent_timeout=${agentTimeoutSec}s)`
  );

  // Fresh workspace every trial — required for independent --runs N replications.
  console.log(`[matched-phased] refreshing clean workspace for ${harborName} (run ${attempt})`);
  refreshTrialWorkspace(taskId, arm);

  // Workspace is bind-mounted at runtime — rebuild only when the image is missing
  // (or LAMINA_BENCH_FORCE_BUILD=1). Avoids reinstalling claude-code every trial.
  const forceBuild = process.env.LAMINA_BENCH_FORCE_BUILD === '1';
  const imageExists =
    spawnSync('docker', ['image', 'inspect', imageTag], { stdio: 'ignore' }).status === 0;
  if (forceBuild || !imageExists) {
    console.log(`[matched-phased] building image ${imageTag}${forceBuild ? ' (forced)' : ''}`);
    const build = docker('docker', [
      'build',
      '-t',
      imageTag,
      '-f',
      path.join(envDir, 'Dockerfile'),
      envDir,
    ]);
    if (build.status !== 0) process.exit(build.status ?? 1);
  } else {
    console.log(`[matched-phased] reusing image ${imageTag}`);
  }

  const token = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  let model;
  try {
    model = resolveBenchModel(release);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
  if (!model) {
    console.error('ERROR: no model pin — set release.yaml model or ANTHROPIC_MODEL');
    process.exit(1);
  }
  console.log(`[matched-phased] model=${model}`);

  const envArgs = [
    '-e',
    `ANTHROPIC_API_KEY=${token}`,
    '-e',
    `ANTHROPIC_AUTH_TOKEN=${token}`,
    '-e',
    `ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL || ''}`,
    '-e',
    `ANTHROPIC_MODEL=${model}`,
    '-e',
    'IS_SANDBOX=1',
    // Persist skillUsage / .claude.json into the mounted agent log dir.
    '-e',
    'HOME=/logs/agent/home',
    // Fail fast on hung print-mode subagents / API stalls (was 600000).
    '-e',
    `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=${bgWaitCeilingMs}`,
    '-e',
    `LAMINA_BENCH_RUN=${attempt}`,
    '-e',
    `LAMINA_BENCH_ARM=${arm}`,
    '-e',
    `LAMINA_BENCH_WORKFLOW=${workflow}`,
    '-e',
    `LAMINA_BENCH_MAX_TURNS_PER_PHASE=${maxTurnsPerPhase}`,
    '-e',
    `LAMINA_BENCH_PHASE_TIMEOUT_SEC=${phaseTimeoutSec}`,
    '-e',
    `REWARDKIT_MAX_ATTEMPTS=${rewardkitMaxAttempts}`,
    '-e',
    `REWARDKIT_RETRY_DELAY_SEC=${rewardkitRetryDelaySec}`,
    '-e',
    `REWARDKIT_JUDGE=${(release.llm_judges?.[0] || '').replace(/^anthropic:/, 'anthropic/')}`,
    // Drop litellm params unsupported by gateway remaps (e.g. reasoning_effort on lx1).
    '-e',
    'LITELLM_DROP_PARAMS=1',
  ];

  // Hard wall-clock for the whole agent trial (prevents 20–60m ECONNRESET hangs).
  const agent = docker(
    'timeout',
    [
      '--signal=TERM',
      '--kill-after=30',
      String(agentTimeoutSec),
      'docker',
      'run',
      '--rm',
      ...envArgs,
      '-v',
      `${path.join(envDir, 'workspace')}:/app`,
      '-v',
      `${path.join(trialDir, 'agent')}:/logs/agent`,
      '-v',
      `${path.join(taskDir, 'instruction.md')}:/tmp/lamina-bench-instruction.md:ro`,
      '-v',
      `${path.join(taskDir, 'tests')}:/tests:ro`,
      '-w',
      '/app',
      imageTag,
      'bash',
      '/tests/matched-phased-agent.sh',
    ],
    { stdio: 'inherit' }
  );
  if (agent.status === 124) {
    console.warn(
      `ERROR: agent trial hit hard wall-clock timeout (${agentTimeoutSec}s) — trial failed`
    );
  }
  if (agent.status !== 0) {
    console.warn(`ERROR: matched phased agent exited ${agent.status} — trial failed`);
    fixWorkspaceOwnership(path.join(envDir, 'workspace'));
    fixTrialOwnership(trialDir);
    fs.writeFileSync(
      path.join(trialDir, 'result.json'),
      JSON.stringify(
        {
          task_name: `aryaniyaps/${harborName}`,
          trial_name: trialName,
          agent_info: { name: 'claude-code', model_info: { name: model, provider: 'anthropic' } },
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          runner: 'matched-phased',
          lamina_arm: arm,
          lamina_workflow: workflow,
          phases_per_trial: phasesPerTrial,
          max_turns_per_phase: maxTurnsPerPhase,
          reward_present: false,
          agent_failed: true,
          agent_exit_status: agent.status,
        },
        null,
        2
      ) + '\n'
    );
    return false;
  }

  fixWorkspaceOwnership(path.join(envDir, 'workspace'));
  fixTrialOwnership(trialDir);

  const verifier = docker('docker', [
    'run',
    '--rm',
    ...envArgs,
    '-v',
    `${path.join(envDir, 'workspace')}:/app`,
    '-v',
    `${path.join(trialDir, 'verifier')}:/logs/verifier`,
    '-v',
    `${path.join(trialDir, 'agent')}:/logs/agent`,
    '-v',
    `${path.join(taskDir, 'tests')}:/tests:ro`,
    imageTag,
    'bash',
    '/tests/test.sh',
  ]);
  if (verifier.status !== 0) {
    console.warn(`WARNING: verifier exited ${verifier.status}`);
  }

  fixTrialOwnership(trialDir);

  // Snapshot scored workspace beside verifier artifacts so raw/debug exports
  // match implementation.md (host task workspace may be refreshed later).
  const workspaceSrc = path.join(envDir, 'workspace');
  const workspaceSnap = path.join(trialDir, 'workspace');
  try {
    fs.rmSync(workspaceSnap, { recursive: true, force: true });
    fs.cpSync(workspaceSrc, workspaceSnap, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src);
        return ![
          'node_modules',
          '.git',
          '.next',
          'dist',
          'build',
          '.cache',
          '.venv',
          'coverage',
        ].includes(base);
      },
    });
    const manifestSrc = path.join(trialDir, 'verifier', 'artifact-manifest.json');
    if (fs.existsSync(manifestSrc)) {
      fs.copyFileSync(manifestSrc, path.join(workspaceSnap, 'artifact-manifest.json'));
    }
    console.log(`[matched-phased] snapped workspace → ${workspaceSnap}`);
  } catch (err) {
    console.warn(`[matched-phased] workspace snapshot failed: ${err.message}`);
  }

  const rewardPath = path.join(trialDir, 'verifier', 'reward.json');
  const started = new Date().toISOString();
  fs.writeFileSync(
    path.join(trialDir, 'result.json'),
    JSON.stringify(
      {
        task_name: `aryaniyaps/${harborName}`,
        trial_name: trialName,
        agent_info: { name: 'claude-code', model_info: { name: model, provider: 'anthropic' } },
        started_at: started,
        finished_at: new Date().toISOString(),
        runner: 'matched-phased',
        lamina_arm: arm,
        lamina_workflow: workflow,
        phases_per_trial: phasesPerTrial,
        max_turns_per_phase: maxTurnsPerPhase,
        reward_present: fs.existsSync(rewardPath),
        workspace_snapshot: fs.existsSync(workspaceSnap),
      },
      null,
      2
    ) + '\n'
  );

  return fs.existsSync(rewardPath);
}

export { runPhasedBenchmark };

if (import.meta.url === `file://${process.argv[1]}`) {
  const harborName = process.argv[2];
  const attempt = Number(process.argv[3] || '1');
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  const ok = runPhasedBenchmark(harborName, release, attempt);
  process.exit(ok ? 0 : 1);
}
