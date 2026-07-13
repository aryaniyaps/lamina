#!/usr/bin/env node
/**
 * Run a Harbor benchmark task via matched multi-phase claude --resume invocations.
 * Design C — ecological loop with equal phase count for control and treatment.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';
import { loadBenchEnv, resolveBenchModel } from './load-bench-env.mjs';
import { HARBOR_TASKS_DIR, loadRegistry, parseHarborDirName } from './harbor-tasks.mjs';

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
  fs.mkdirSync(path.join(trialDir, 'verifier'), { recursive: true });

  const phasesPerTrial = release.phases_per_trial ?? 5;
  const maxTurnsPerPhase =
    release.max_turns_per_phase ??
    Math.max(1, Math.floor((release.agent_max_turns ?? 200) / phasesPerTrial));

  console.log(
    `\n[matched-phased] ${harborName} arm=${arm} workflow=${workflow} attempt ${attempt} (${phasesPerTrial} phases, ${maxTurnsPerPhase} turns/phase)`
  );

  const build = docker('docker', [
    'build',
    '-t',
    imageTag,
    '-f',
    path.join(envDir, 'Dockerfile'),
    envDir,
  ]);
  if (build.status !== 0) process.exit(build.status ?? 1);

  const token = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  const model = resolveBenchModel(release);

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
    '-e',
    `LAMINA_BENCH_RUN=${attempt}`,
    '-e',
    `LAMINA_BENCH_ARM=${arm}`,
    '-e',
    `LAMINA_BENCH_WORKFLOW=${workflow}`,
    '-e',
    `LAMINA_BENCH_MAX_TURNS_PER_PHASE=${maxTurnsPerPhase}`,
    '-e',
    `REWARDKIT_JUDGE=${(release.llm_judges?.[0] || '').replace(/^anthropic:/, 'anthropic/')}`,
  ];

  const agent = docker(
    'docker',
    [
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
      imageTag,
      'bash',
      '/tests/matched-phased-agent.sh',
    ],
    { stdio: 'inherit' }
  );
  if (agent.status !== 0) {
    console.warn(`WARNING: matched phased agent exited ${agent.status}`);
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
