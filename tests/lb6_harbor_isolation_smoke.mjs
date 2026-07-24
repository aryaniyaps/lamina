import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb6-harbor-isolation-'));
const task = path.join(temp, 'task');
const privateRoot = path.join(temp, 'private');
const privateDir = path.join(privateRoot, 'isolation-smoke', 'direct');
const jobs = path.join(temp, 'jobs');
const jobsArg = path.relative(root, jobs);
const sealed = path.join(temp, 'sealed');
const image = 'node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0';
const agentImage = 'lb6-pilot-agent-runtime:cursor-20260720';

for (const dir of [
  path.join(task, 'environment'),
  path.join(task, 'steps/shape_build/tests'),
  path.join(task, 'steps/verify_fix/tests'),
  path.join(task, 'steps/verify_fix/workdir/.lb6-abi'),
  privateDir,
]) fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(path.join(task, 'environment/Dockerfile'), `FROM ${agentImage}\nWORKDIR /app\nCOPY seed.mjs /app/app.mjs\nCOPY index.html /app/index.html\n`);
fs.writeFileSync(path.join(task, 'environment/seed.mjs'), 'export const sealed = true;\n');
fs.writeFileSync(path.join(task, 'environment/index.html'), '<main>sealed</main>\n');
fs.writeFileSync(path.join(task, 'steps/shape_build/instruction.md'), 'Do nothing.');
fs.writeFileSync(path.join(task, 'steps/verify_fix/instruction.md'), 'Do nothing.');
fs.writeFileSync(path.join(task, 'steps/verify_fix/workdir/.lb6-abi/public-abi.json'), '{}\n');
for (const step of ['shape_build', 'verify_fix']) {
  const tripwire = path.join(task, `steps/${step}/tests/test.sh`);
  fs.writeFileSync(tripwire, '#!/bin/sh\necho protocol_invalid >&2\nexit 97\n');
  fs.chmodSync(tripwire, 0o755);
}
fs.writeFileSync(path.join(privateDir, 'grade.mjs'), `
import fs from 'node:fs';
const source = fs.readFileSync('/candidate/app.mjs', 'utf8');
if (!source.includes('sealed = true')) process.exit(2);
fs.writeFileSync('/output/reward.json', JSON.stringify({reward:1,behavior:1,import_ok:1})+'\\n');
fs.writeFileSync('/output/behavior_report.json', JSON.stringify({reward:1,candidate:process.env.LB6_CANDIDATE_DIGEST})+'\\n');
`);
fs.writeFileSync(path.join(task, 'task.toml'), `
schema_version = "1.3"
multi_step_reward_strategy = "final"
[task]
name = "aryaniyaps/isolation-smoke-direct"
description = "no-model LB6 host seal smoke"
authors = [{ name = "LaminaBench" }]
[metadata]
task_id = "isolation-smoke"
arm = "direct"
campaign_id = "lb6-dev-pilot-skill-rerun-v3"
host_sealed_supervisor_required = true
[environment]
network_mode = "public"
build_timeout_sec = 120.0
workdir = "/app"
os = "linux"
cpus = 1
memory_mb = 1024
storage_mb = 2048
[[steps]]
name = "shape_build"
[steps.agent]
timeout_sec = 30.0
[[steps]]
name = "verify_fix"
[steps.agent]
timeout_sec = 30.0
`);

const env = {
  ...process.env,
  PYTHONPATH: path.join(root, 'benchmarks/lb6/harbor-fork'),
  LB6_HOST_SEAL: '1',
  LB6_SEALED_ROOT: sealed,
  LB6_PRIVATE_VERIFIER_ROOT: privateRoot,
  LB6_VERIFIER_IMAGE: image,
  LB6_SKILL_BUNDLE_MANIFEST: path.join(root, 'benchmarks/lb6/pilot/skill-bundle/manifest-v3.json'),
  LB6_SKILL_BUNDLE_ROOT: path.join(root, 'benchmarks/lb6/pilot/skill-bundle/staged'),
  LB6_SKILL_RERUN_CAMPAIGN_ID: 'lb6-dev-pilot-skill-rerun-v3',
};
const result = spawnSync('harbor', [
  'run', '--path', task, '--agent', 'nop', '--job-name', 'lb6-isolation-smoke',
  '--jobs-dir', jobsArg, '--n-attempts', '1', '--n-concurrent', '1',
  '--max-retries', '0', '--yes', '--quiet',
], { cwd: root, env, encoding: 'utf8', timeout: 180_000 });
if (result.status !== 0) {
  throw new Error(`Harbor isolation smoke failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
}

const job = path.join(jobs, 'lb6-isolation-smoke');
const trialName = fs.readdirSync(job, { withFileTypes: true })
  .find((entry) => entry.isDirectory())?.name;
assert.ok(trialName);
const trial = path.join(job, trialName);
const trialResult = JSON.parse(fs.readFileSync(path.join(trial, 'result.json'), 'utf8'));
assert.equal(trialResult.verifier_result.rewards.reward, 1);
assert.equal(trialResult.step_results.at(-1).exception_info, null);
const sealRecord = JSON.parse(fs.readFileSync(path.join(trial, 'protocol/final-seal.json'), 'utf8'));
assert.equal(sealRecord.double_capture_identical, true);
for (const step of ['shape_build', 'verify_fix']) {
  const isolation = JSON.parse(fs.readFileSync(
    path.join(trial, `protocol/agent-isolation-${step}.json`),
    'utf8',
  ));
  assert.equal(isolation.tests_path, 'absent');
  assert.equal(isolation.sealed_store_mounted, false);
  assert.equal(isolation.private_verifier_mounted, false);
}
const verifierAbi = JSON.parse(fs.readFileSync(
  path.join(trial, 'steps/verify_fix/verifier/verifier-abi.json'),
  'utf8',
));
assert.equal(verifierAbi.network_mode, 'none');
assert.equal(verifierAbi.read_only_rootfs, true);
assert.equal(verifierAbi.candidate_digest, sealRecord.candidate_digest);
assert.equal(verifierAbi.campaign_id, 'lb6-dev-pilot-skill-rerun-v3');
assert.equal(verifierAbi.measurement_contract, 'semantic_criteria_v3');
assert.ok(!fs.existsSync(path.join(trial, 'steps/verify_fix/agent/tests')));

console.log('lb6 Harbor isolation smoke passed');
