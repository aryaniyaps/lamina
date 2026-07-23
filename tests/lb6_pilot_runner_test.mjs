import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTEMPTS_PER_ARM,
  HARBOR_AGENT,
  HARBOR_MODEL,
  MAX_CONCURRENCY,
  MAX_RETRIES,
  PILOT_ARMS,
  buildHarborArgs,
  discoverPilotTasks,
  makeJobName,
  resolveConcurrency,
  runThreeArmCampaign,
  schedulePilotCells,
} from '../benchmarks/lb6/pilot/scripts/run-three-arm.mjs';
import {
  aggregatePilotCampaign,
  assertDevelopmentCopy,
  buildTaskCluster,
  detectVerifierIsolationBreach,
  extractCellRecord,
  parsePilotJobName,
  refuseLegacySource,
  renderMarkdownReport,
} from '../benchmarks/lb6/pilot/scripts/aggregate-results.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mockChild({ exitCode = 0, signal = null, stdout = '', stderr = '', delayMs = 5 } = {}) {
  const child = new EventEmitter();
  child.pid = Math.floor(Math.random() * 10_000) + 1;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
  };
  setTimeout(() => {
    if (stdout) child.stdout.emit('data', stdout);
    if (stderr) child.stderr.emit('data', stderr);
    if (!child.killed) child.emit('exit', exitCode, signal);
  }, delayMs);
  return child;
}

function writeTaskDirs(tasksRoot, taskId = 'pilot-care-circle') {
  for (const arm of PILOT_ARMS) {
    const dir = path.join(tasksRoot, `${taskId}-${arm}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'task.toml'), `name="${taskId}-${arm}"\n`);
  }
}

function writeEnv(rootDir) {
  fs.writeFileSync(path.join(rootDir, '.env'), 'CURSOR_API_KEY=test-key\n');
}

function writeFixtureJob(jobsRoot, {
  taskId = 'pilot-care-circle',
  arm = 'direct',
  ts = '1001',
  reward = 1,
  modelName = HARBOR_MODEL,
  datasetPath = 'benchmarks/lb6/pilot/harbor/tasks',
  forbiddenVerifierRead = false,
} = {}) {
  const jobName = `lb6-pilot-${taskId}-${arm}-${ts}`;
  const jobDir = path.join(jobsRoot, jobName);
  const trialName = `${taskId}-${arm}__abcd`;
  const trialDir = path.join(jobDir, trialName);
  const finalStep = arm === 'lamina' ? 'fix' : 'verify_fix';
  const verifierDir = path.join(trialDir, 'steps', finalStep, 'verifier');
  fs.mkdirSync(verifierDir, { recursive: true });
  fs.writeFileSync(
    path.join(jobDir, 'config.json'),
    JSON.stringify({
      job_name: jobName,
      agents: [{ name: HARBOR_AGENT, model_name: modelName }],
      datasets: [{ path: datasetPath, task_names: [`${taskId}-${arm}`] }],
    }),
  );
  const agentDir = path.join(trialDir, 'steps', finalStep, 'agent');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'cursor-cli.txt'),
    forbiddenVerifierRead
      ? '{"type":"tool_call","tool_call":{"readToolCall":{"args":{"path":"/tests/grade.mjs"},"result":{"success":{"content":"hidden"}}}}}\n'
      : '{"type":"result","subtype":"success"}\n',
  );
  fs.writeFileSync(
    path.join(jobDir, 'result.json'),
    JSON.stringify({
      started_at: '2026-07-23T10:00:00.000Z',
      finished_at: '2026-07-23T10:05:00.000Z',
      stats: { cost_usd: 0.2, n_input_tokens: 10, n_output_tokens: 5, n_cache_tokens: 1 },
    }),
  );
  fs.writeFileSync(
    path.join(trialDir, 'result.json'),
    JSON.stringify({
      task_name: `${taskId}-${arm}`,
      started_at: '2026-07-23T10:00:00.000Z',
      finished_at: '2026-07-23T10:05:00.000Z',
      task_checksum: 'abc123',
      agent_info: {
        name: HARBOR_AGENT,
        model_info: { name: modelName, provider: 'cursor' },
      },
      step_results: [
        {
          step_name: finalStep,
          agent_result: {
            n_input_tokens: 10,
            n_output_tokens: 5,
            cost_usd: 0.2,
          },
          agent_execution: {
            started_at: '2026-07-23T10:00:10.000Z',
            finished_at: '2026-07-23T10:04:50.000Z',
          },
        },
      ],
    }),
  );
  fs.writeFileSync(path.join(verifierDir, 'reward.json'), JSON.stringify({ reward }));
  fs.writeFileSync(
    path.join(verifierDir, 'behavior_report.json'),
    JSON.stringify({ reward, behavior_pass_rate: reward, invalid_treatment: false }),
  );
  const protocolDir = path.join(trialDir, 'protocol');
  fs.mkdirSync(protocolDir, { recursive: true });
  fs.writeFileSync(
    path.join(protocolDir, 'final-seal.json'),
    JSON.stringify({ double_capture_identical: true, candidate_digest: 'candidate-abc' }),
  );
  fs.writeFileSync(
    path.join(protocolDir, 'transition-ledger.jsonl'),
    ['final_sealed', 'agent_environment_removed', 'scoring_complete']
      .map((event, index) => JSON.stringify({ sequence: index + 1, event }))
      .join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(verifierDir, 'verifier-abi.json'),
    JSON.stringify({
      candidate_digest: 'candidate-abc',
      verifier_image_digest: 'sha256:test',
      network_mode: 'none',
      read_only_rootfs: true,
    }),
  );
  return jobName;
}

// --- pure helpers ---
assert.equal(MAX_CONCURRENCY, 6);
assert.equal(ATTEMPTS_PER_ARM, 1);
assert.equal(MAX_RETRIES, 0);
assert.deepEqual(PILOT_ARMS, ['direct', 'plan', 'lamina']);

const defaultConcurrency = resolveConcurrency(undefined, 3);
assert.equal(defaultConcurrency.requested, 3);
assert.equal(defaultConcurrency.effective, 3);
assert.equal(defaultConcurrency.max, 6);

const capped = resolveConcurrency(6, 3);
assert.equal(capped.requested, 6);
assert.equal(capped.effective, 3);

assert.throws(() => resolveConcurrency(7, 3), /hard maximum 6/);
assert.throws(() => resolveConcurrency(0, 3), /between 1 and 6/);

const args = buildHarborArgs({
  arm: 'lamina',
  taskDirName: 'pilot-care-circle-lamina',
  jobName: 'lb6-pilot-pilot-care-circle-lamina-1',
  envFile: '/tmp/.env',
});
assert.ok(args.includes('--agent'));
assert.equal(args[args.indexOf('--agent') + 1], 'cursor-cli');
assert.equal(args[args.indexOf('--model') + 1], 'cursor/composer-2.5');
assert.equal(args[args.indexOf('--n-attempts') + 1], '1');
assert.equal(args[args.indexOf('--max-retries') + 1], '0');
assert.equal(args[args.indexOf('--env-file') + 1], '/tmp/.env');
assert.ok(args.includes('--include-task-name'));

assert.equal(parsePilotJobName('lb6-pilot-pilot-care-circle-direct-99').arm, 'direct');
assert.equal(refuseLegacySource('lamina-v4-sonnet-direct-pilot-care-circle-1').refused, true);
assert.equal(refuseLegacySource('publish-pilot-care-circle-direct-1').refused, true);
assert.equal(refuseLegacySource('benchmarks/harbor/tasks').refused, true);
assert.equal(refuseLegacySource('lb6-pilot-pilot-care-circle-direct-1').refused, false);

assert.throws(
  () => assertDevelopmentCopy('This is a confirmatory success for Lamina'),
  /confirmatory/,
);
assert.throws(
  () => assertDevelopmentCopy('marketing proof that lamina wins'),
  /marketing|lamina/,
);

// --- temp workspace discovery + mocked campaign ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb6-pilot-runner-'));
const tasksRoot = path.join(tmp, 'benchmarks/lb6/pilot/harbor/tasks');
const scriptsDir = path.join(tmp, 'benchmarks/lb6/pilot/scripts');
const jobsRoot = path.join(tmp, 'jobs');
fs.mkdirSync(scriptsDir, { recursive: true });
fs.mkdirSync(jobsRoot, { recursive: true });
writeTaskDirs(tasksRoot);
writeEnv(tmp);

const discovery = discoverPilotTasks(tasksRoot);
assert.equal(discovery.ok, true);
assert.deepEqual(discovery.selectedTaskIds, ['pilot-care-circle']);

fs.writeFileSync(
  path.join(scriptsDir, 'build-pilot-package.mjs'),
  'console.log("build ok")\n',
);
fs.writeFileSync(
  path.join(scriptsDir, 'validate-pilot-package.mjs'),
  'console.log("validate ok")\n',
);

const launched = [];
const spawnImpl = (command, spawnArgs) => {
  launched.push({ command, args: spawnArgs });
  if (command === process.execPath) {
    return mockChild({ exitCode: 0, delayMs: 1 });
  }
  const jobName = spawnArgs[spawnArgs.indexOf('--job-name') + 1];
  const include = spawnArgs[spawnArgs.indexOf('--include-task-name') + 1];
  const arm = PILOT_ARMS.find((value) => include.endsWith(`-${value}`));
  writeFixtureJob(jobsRoot, {
    taskId: 'pilot-care-circle',
    arm,
    ts: jobName.split('-').pop(),
    reward: arm === 'lamina' ? 0 : 1,
  });
  return mockChild({
    exitCode: 0,
    stdout: `mock harbor ok ${arm}\n`,
    delayMs: 10,
  });
};

const campaign = await runThreeArmCampaign({
  root: tmp,
  spawnImpl,
  selectedTaskIds: ['pilot-care-circle'],
  nowMs: 1_700_000_000_000,
  deadlineMs: 60_000,
  stdio: 'pipe',
  aggregateImpl: async (payload) =>
    aggregatePilotCampaign({
      root: tmp,
      jobsRoot,
      ...payload,
      write: true,
    }),
});

assert.equal(campaign.ok, true);
assert.equal(campaign.concurrency.requested, 3);
assert.equal(campaign.concurrency.effective, 3);
assert.equal(campaign.concurrency.max, 6);
assert.equal(campaign.cells.length, 3);
assert.equal(new Set(campaign.cells.map((cell) => cell.jobName)).size, 3);
assert.ok(campaign.cells.every((cell) => cell.args.includes('cursor-cli')));
assert.ok(campaign.cells.every((cell) => cell.args.includes('cursor/composer-2.5')));
assert.ok(campaign.cells.every((cell) => cell.args.includes('--max-retries')));
assert.ok(launched.some((item) => item.command === process.execPath));
assert.equal(launched.filter((item) => item.command === 'harbor').length, 3);
assert.equal(campaign.campaign.child_actual_model_unverified, true);
assert.equal(campaign.campaign.confirmatory, false);
assert.ok(campaign.publication?.outPath);
assert.ok(fs.existsSync(campaign.publication.outPath));
assert.equal(campaign.publication.plan.benchmark_upload_ready, true);
assert.equal(campaign.publication.plan.publication_eligible, false);
assert.ok(campaign.aggregate?.paths?.json);
assert.ok(fs.existsSync(campaign.aggregate.paths.json));
assert.ok(fs.existsSync(campaign.aggregate.paths.markdown));

const report = campaign.aggregate.report;
assert.equal(report.development_only, true);
assert.equal(report.child_actual_model_unverified, true);
assert.equal(report.concurrency.requested, 3);
assert.equal(report.concurrency.effective, 3);
assert.equal(report.cells.length, 3);
assert.ok(report.cells.some((cell) => cell.arm === 'lamina' && cell.reward === 0));
assert.ok(report.limitations.some((item) => /unverified/i.test(item)));
assert.equal(report.campaign.ok, true);
const markdown = fs.readFileSync(campaign.aggregate.paths.markdown, 'utf8');
assert.match(markdown, /Development-only/i);
assert.match(markdown, /Concurrency requested/);
assert.match(markdown, /child_actual_model_unverified/);
assert.doesNotMatch(markdown, /\bLamina wins\b/i);

// missing tasks fail closed
const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lb6-pilot-empty-'));
writeEnv(emptyRoot);
fs.mkdirSync(path.join(emptyRoot, 'benchmarks/lb6/pilot/scripts'), { recursive: true });
const missing = await runThreeArmCampaign({
  root: emptyRoot,
  spawnImpl,
  skipPackageScripts: true,
  selectedTaskIds: ['pilot-care-circle'],
  stdio: 'pipe',
});
assert.equal(missing.ok, false);
assert.equal(missing.gate, 'pilot_tasks_missing');

// rate-limit fail fast
const rateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb6-pilot-rate-'));
writeEnv(rateTmp);
writeTaskDirs(path.join(rateTmp, 'benchmarks/lb6/pilot/harbor/tasks'));
fs.mkdirSync(path.join(rateTmp, 'benchmarks/lb6/pilot/scripts'), { recursive: true });
let harborCalls = 0;
const rateSpawn = (command, spawnArgs) => {
  if (command !== 'harbor') return mockChild({ exitCode: 0, delayMs: 1 });
  harborCalls += 1;
  return mockChild({
    exitCode: 1,
    stderr: 'error 429 rate limit exceeded\n',
    delayMs: 5,
  });
};
const rateCampaign = await runThreeArmCampaign({
  root: rateTmp,
  spawnImpl: rateSpawn,
  skipPackageScripts: true,
  selectedTaskIds: ['pilot-care-circle'],
  nowMs: 1_700_000_000_100,
  deadlineMs: 30_000,
  stdio: 'pipe',
  aggregateImpl: async (payload) =>
    aggregatePilotCampaign({
      root: rateTmp,
      jobsRoot: path.join(rateTmp, 'jobs'),
      ...payload,
      write: false,
    }),
});
assert.equal(rateCampaign.ok, false);
assert.equal(rateCampaign.gate, 'rate_limit_failure');
assert.ok(harborCalls >= 1);

// refuse V4 aggregation
const v4Job = 'lamina-v4-sonnet-direct-pilot-care-circle-1';
await assert.rejects(
  () =>
    aggregatePilotCampaign({
      root: tmp,
      jobsRoot,
      jobNames: [v4Job],
      write: false,
    }),
  /old Harbor V4/,
);

const extractedV4 = extractCellRecord({ jobsRoot, jobName: v4Job });
assert.equal(extractedV4.state, 'refused_legacy_source');

// fixture aggregation with all arms
const aggJobs = PILOT_ARMS.map((arm, index) =>
  writeFixtureJob(jobsRoot, {
    arm,
    ts: String(2000 + index),
    reward: arm === 'plan' ? 1 : arm === 'direct' ? 1 : 0,
  }));
const standalone = await aggregatePilotCampaign({
  root: tmp,
  jobsRoot,
  jobNames: aggJobs,
  selectedTaskIds: ['pilot-care-circle'],
  schedule: schedulePilotCells(['pilot-care-circle']),
  concurrency: { requested: 6, effective: 3, max: 6, pending: 3 },
  campaign: {
    startedAt: '2026-07-23T10:00:00.000Z',
    deadlineAt: '2026-07-23T12:00:00.000Z',
    deadlineMs: 7_200_000,
    ok: true,
    gate: 'three_arm_campaign_complete',
  },
  write: true,
  reportsDir: path.join(tmp, 'benchmarks/lb6/pilot/reports-standalone'),
});
assert.equal(standalone.report.cells.length, 3);
assert.equal(standalone.report.taskClusters.length, 1);
assert.equal(standalone.report.concurrency.requested, 6);
assert.equal(standalone.report.concurrency.effective, 3);
assert.ok(standalone.report.cells.every((cell) => cell.child_actual_model_unverified === true));
assert.match(renderMarkdownReport(standalone.report), /Concurrency effective/);
assert.match(renderMarkdownReport(standalone.report), /Schedule/);

const cluster = buildTaskCluster('pilot-care-circle', standalone.report.cells);
assert.equal(cluster.rewards.direct, 1);
assert.equal(cluster.rewards.plan, 1);
assert.equal(cluster.rewards.lamina, 0);

// evaluator implementation access invalidates the entire report fail-closed
const leakyJob = writeFixtureJob(jobsRoot, {
  arm: 'direct',
  ts: '3001',
  reward: 1,
  forbiddenVerifierRead: true,
});
const leakyCell = extractCellRecord({ jobsRoot, jobName: leakyJob });
assert.equal(detectVerifierIsolationBreach(leakyCell.trialPath).breach, true);
assert.equal(leakyCell.state, 'verifier_isolation_breach');
assert.equal(leakyCell.ok, false);
assert.equal(leakyCell.measurementValid, false);

// job name helper uniqueness
assert.notEqual(
  makeJobName('pilot-care-circle', 'direct', 1),
  makeJobName('pilot-care-circle', 'plan', 1),
);

// dry-run does not spawn harbor
const dryLaunched = [];
const dry = await runThreeArmCampaign({
  root: tmp,
  dryRun: true,
  skipPackageScripts: true,
  selectedTaskIds: ['pilot-care-circle'],
  concurrency: 6,
  spawnImpl: (command, spawnArgs) => {
    dryLaunched.push({ command, args: spawnArgs });
    return mockChild({ exitCode: 0 });
  },
});
assert.equal(dry.ok, true);
assert.equal(dry.gate, 'dry_run');
assert.equal(dryLaunched.length, 0);
assert.equal(dry.cells.length, 3);
assert.equal(dry.concurrency.requested, 6);
assert.equal(dry.concurrency.effective, 3);
assert.equal(dry.schedule.length, 3);

console.log('lb6 pilot runner tests passed');
