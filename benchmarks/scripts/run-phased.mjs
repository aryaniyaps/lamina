#!/usr/bin/env node
/**
 * Run a Harbor benchmark task via matched multi-phase codex exec resume invocations.
 * Design C — ecological loop with equal phase count for control and treatment.
 * One session across phases; treatment slash commands are harness-sent user messages.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';
import { loadBenchEnv, resolveBenchModel } from './load-bench-env.mjs';
import { HARBOR_TASKS_DIR, loadRegistry, parseHarborDirName } from './harbor-tasks.mjs';
import { refreshTrialWorkspace } from './harbor-sync.mjs';
import { benchmarkProvenance } from './benchmark-provenance.mjs';

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

function runPhasedBenchmark(harborName, release, attempt, execution = {}) {
  const trialStartedAt = new Date().toISOString();
  const parsed = parseHarborDirName(harborName);
  if (!parsed) {
    throw new Error(`Invalid harbor task name: ${harborName}`);
  }

  const { id: taskId, arm } = parsed;
  const workflow = workflowForTask(taskId);
  const taskDir = path.join(HARBOR_TASKS_DIR, harborName);
  const envDir = path.join(taskDir, 'environment');
  const dockerfilePath = path.join(envDir, 'Dockerfile');
  const imageFingerprint = createHash('sha256')
    .update(fs.readFileSync(dockerfilePath))
    .digest('hex')
    .slice(0, 12);
  const imageTag = `lamina-bench-runtime-${imageFingerprint}:local`;
  const jobName = `${harborName}__run${attempt}`;
  const jobDir = path.join(HARBOR_JOBS, jobName);
  const trialName = `${harborName}__phased`;
  const trialDir = path.join(jobDir, trialName);

  // A trial invocation is never a resume. Remove every prior log/reward so an
  // infrastructure failure cannot accidentally inherit a stale success.
  if (fs.existsSync(trialDir)) {
    fixTrialOwnership(trialDir);
    fs.rmSync(trialDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(trialDir, 'agent'), { recursive: true });
  fs.mkdirSync(path.join(trialDir, 'agent', 'home'), { recursive: true });
  fs.mkdirSync(path.join(trialDir, 'verifier'), { recursive: true });
  fs.mkdirSync(path.join(trialDir, 'quality'), { recursive: true });

  const phasesPerTrial = release.phases_per_trial ?? 5;
  const agentTimeoutSec = release.agent_timeout_sec ?? 600;
  const judgeMaxAttempts = release.judge_max_attempts ?? 2;
  const judgeRetryDelaySec = release.judge_retry_delay_sec ?? 2;
  const verifierTimeoutSec = release.verifier_timeout_sec ?? 900;
  const qualityTimeoutSec = release.quality_timeout_sec ?? 900;

  console.log(
    `\n[matched-phased] ${harborName} arm=${arm} workflow=${workflow} attempt ${attempt} (${phasesPerTrial} phases, trial_timeout=${agentTimeoutSec}s)`
  );

  // Fresh workspace every trial — required for independent --runs N replications.
  console.log(`[matched-phased] refreshing clean workspace for ${harborName} (run ${attempt})`);
  refreshTrialWorkspace(taskId, arm);

  // Workspace is bind-mounted at runtime — rebuild only when the image is missing
  // (or LAMINA_BENCH_FORCE_BUILD=1). Avoids reinstalling Codex every trial.
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
  const runtimeImageId = spawnSync(
    'docker',
    ['image', 'inspect', imageTag, '--format', '{{.Id}}'],
    { encoding: 'utf8' }
  ).stdout?.trim() || null;

  const codexAuthPath = process.env.CODEX_AUTH_JSON_PATH || path.join(process.env.HOME || '', '.codex', 'auth.json');
  if (!fs.existsSync(codexAuthPath)) {
    console.error(`ERROR: Codex ChatGPT credentials not found at ${codexAuthPath}. Run \`codex login\` first or set CODEX_AUTH_JSON_PATH.`);
    return false;
  }
  let model;
  try {
    model = resolveBenchModel(release);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
  if (!model) {
    console.error('ERROR: no model pin — set release.yaml model or CODEX_MODEL');
    process.exit(1);
  }
  console.log(`[matched-phased] model=${model}`);

  const envArgs = [
    '-e',
    `CODEX_MODEL=${model}`,
    '-e',
    'IS_SANDBOX=1',
    '-e',
    'CODEX_HOME=/logs/agent/codex-home',
    '-e',
    `LAMINA_BENCH_RUN=${attempt}`,
    '-e',
    `LAMINA_BENCH_ARM=${arm}`,
    '-e',
    `LAMINA_BENCH_WORKFLOW=${workflow}`,
    '-e',
    `JUDGE_MAX_ATTEMPTS=${judgeMaxAttempts}`,
    '-e',
    `JUDGE_RETRY_DELAY_SEC=${judgeRetryDelaySec}`,
  ];
  const agentDriver = fs.readFileSync(
    path.join(taskDir, 'tests', 'matched-phased-agent.sh'),
    'utf8'
  );

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
      `${codexAuthPath}:/tmp/codex-auth.json:ro`,
      '-v',
      `${path.join(taskDir, 'instruction.md')}:/tmp/lamina-bench-instruction.md:ro`,
      '-w',
      '/app',
      imageTag,
      'bash',
      '-s',
    ],
    { stdio: ['pipe', 'inherit', 'inherit'], input: agentDriver }
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
          agent_info: { name: 'codex', model_info: { name: model, provider: 'openai' } },
          started_at: trialStartedAt,
          finished_at: new Date().toISOString(),
          runner: 'matched-phased',
          lamina_arm: arm,
          lamina_workflow: workflow,
          phases_per_trial: phasesPerTrial,
          reward_present: false,
          agent_failed: true,
          agent_exit_status: agent.status,
          benchmark_provenance: execution.provenance ?? benchmarkProvenance(),
          publish_mode: Boolean(execution.publishMode),
          schedule_position: execution.schedulePosition ?? null,
          runtime_image: { tag: imageTag, id: runtimeImageId },
          quality_isolated: false,
          claim_scope: execution.claimScope ?? null,
        },
        null,
        2
      ) + '\n'
    );
    return false;
  }

  fixWorkspaceOwnership(path.join(envDir, 'workspace'));
  fixTrialOwnership(trialDir);

  // Agent-authored build/test commands execute in a disposable container with
  // source mounted read-only and a separate output directory. They cannot
  // mutate the scored workspace, implementation capture, judge, or reward.
  const qualityDir = path.join(trialDir, 'quality');
  const quality = docker('timeout', [
    '--signal=TERM',
    '--kill-after=30',
    String(qualityTimeoutSec),
    'docker', 'run', '--rm',
    '-v', `${path.join(envDir, 'workspace')}:/app:ro`,
    '-v', `${qualityDir}:/logs/verifier`,
    '-v', `${path.join(taskDir, 'tests', 'quality_checks.py')}:/opt/quality_checks.py:ro`,
    '-v', `${path.join(taskDir, 'tests', 'task-meta.json')}:/opt/task-meta.json:ro`,
    '-e', 'LAMINA_QUALITY_META=/opt/task-meta.json',
    imageTag,
    'python3', '/opt/quality_checks.py',
  ]);
  fixTrialOwnership(trialDir);
  const isolatedQuality = path.join(qualityDir, 'quality-checks.json');
  const verifierQuality = path.join(trialDir, 'verifier', 'quality-checks.json');
  if (quality.status === 0 && fs.existsSync(isolatedQuality)) {
    fs.copyFileSync(isolatedQuality, verifierQuality);
  } else {
    const category = loadRegistry().find((task) => task.id === taskId)?.category;
    fs.writeFileSync(
      verifierQuality,
      JSON.stringify({
        schema: 'lamina-bench-quality/v2',
        required: category === 'greenfield',
        status: 'infrastructure_error',
        scoring_incomplete: true,
        clean_workspace: true,
        failure_reason: `isolated_quality_probe_exit_${quality.status ?? 'unknown'}`,
        checks: [],
      }, null, 2) + '\n'
    );
  }

  const verifier = docker('timeout', [
    '--signal=TERM',
    '--kill-after=30',
    String(verifierTimeoutSec),
    'docker', 'run', '--rm',
    ...envArgs,
    '-e',
    'CODEX_HOME=/logs/verifier/codex-home',
    '-e',
    'LAMINA_BENCH_QUALITY_PRECOMPUTED=1',
    '-v',
    `${path.join(envDir, 'workspace')}:/app:ro`,
    '-v',
    `${path.join(trialDir, 'verifier')}:/logs/verifier`,
    '-v',
    `${path.join(trialDir, 'agent')}:/logs/agent:ro`,
    '-v',
    `${codexAuthPath}:/tmp/codex-auth.json:ro`,
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
  fs.writeFileSync(
    path.join(trialDir, 'result.json'),
    JSON.stringify(
      {
        task_name: `aryaniyaps/${harborName}`,
        trial_name: trialName,
        agent_info: { name: 'codex', model_info: { name: model, provider: 'openai' } },
        started_at: trialStartedAt,
        finished_at: new Date().toISOString(),
        runner: 'matched-phased',
        lamina_arm: arm,
        lamina_workflow: workflow,
        phases_per_trial: phasesPerTrial,
        reward_present: fs.existsSync(rewardPath),
        workspace_snapshot: fs.existsSync(workspaceSnap),
        benchmark_provenance: execution.provenance ?? benchmarkProvenance(),
        publish_mode: Boolean(execution.publishMode),
        schedule_position: execution.schedulePosition ?? null,
        runtime_image: { tag: imageTag, id: runtimeImageId },
        quality_isolated: true,
        claim_scope: execution.claimScope ?? null,
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
  let execution = {};
  try {
    execution = JSON.parse(process.env.LAMINA_BENCH_EXECUTION_JSON || '{}');
  } catch {
    console.error('ERROR: invalid LAMINA_BENCH_EXECUTION_JSON');
    process.exit(1);
  }
  const ok = runPhasedBenchmark(harborName, release, attempt, execution);
  process.exit(ok ? 0 : 1);
}
