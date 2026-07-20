#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  applyBenchEnv,
  pickEnvFile,
  resolveAnthropicCredential,
} from '../lib/load-env.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const SKILLS_MANIFEST = path.join(ROOT, 'benchmarks/corpus/lamina-bench-skills.json');
applyBenchEnv(ROOT);

function readFlag(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const arm = readFlag('--arm');
const task = readFlag('--task', 'pilot-care-circle');
const attempts = Number(readFlag('--attempts', '1'));
const concurrency = Number(readFlag('--concurrency', String(attempts)));
const model = readFlag('--model', 'sonnet');
const skipPreflight = process.argv.includes('--skip-preflight');
const jobName = readFlag('--job-name', `lamina-v4-${model}-${arm}-${task}-${Date.now()}`);

if (!['direct', 'plan', 'checklist', 'lamina'].includes(arm)) {
  throw new Error('--arm must be one of: direct, plan, checklist, lamina');
}
if (!Number.isInteger(attempts) || attempts < 1) throw new Error('--attempts must be a positive integer');
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('--concurrency must be a positive integer');

function resolveBenchSkills() {
  const manifest = JSON.parse(fs.readFileSync(SKILLS_MANIFEST, 'utf8'));
  const skillsRoot = path.join(ROOT, 'skills');
  return manifest.skills
    .map((name) => path.join(skillsRoot, name))
    .filter((skillPath) => fs.existsSync(path.join(skillPath, 'SKILL.md')));
}

function preflightAuth() {
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', env: process.env });
  if (probe.status !== 0) {
    console.error('Preflight failed: `claude` CLI is not available on the host.');
    process.exit(1);
  }

  const credential = resolveAnthropicCredential();
  if (!credential) {
    console.error('Preflight failed: set ANTHROPIC_API_KEY in the repo root .env file.');
    process.exit(1);
  }

  const authProbe = spawnSync(
    'claude',
    ['-p', 'reply with exactly: ok', '--output-format', 'text'],
    { encoding: 'utf8', timeout: 60_000, env: process.env }
  );
  const combined = `${authProbe.stdout || ''}${authProbe.stderr || ''}`;
  if (authProbe.status !== 0 || /not logged in|please run \/login|authentication/i.test(combined)) {
    console.error('Preflight failed: Claude Code rejected ANTHROPIC_API_KEY from the repo root .env.');
    if (combined.trim()) console.error(combined.trim());
    process.exit(1);
  }

  const via = process.env.ANTHROPIC_BASE_URL ? `gateway ${process.env.ANTHROPIC_BASE_URL}` : 'Anthropic API key';
  console.log(`Preflight: Claude Code authenticated via ${via} (repo root .env).`);
  return true;
}

if (!skipPreflight) preflightAuth();
else console.warn('Skipping auth preflight (--skip-preflight).');

const args = [
  'run',
  '--job-name', jobName,
  '--path', 'benchmarks/harbor/tasks',
  '--include-task-name', task === 'all' ? `*-${arm}` : `${task}-${arm}`,
  '--agent', 'claude-code',
  '--model', model,
  '--n-attempts', String(attempts),
  '--n-concurrent', String(concurrency),
  '--n-concurrent-agents', String(concurrency),
  '--yes',
];

const envFile = pickEnvFile(ROOT);
if (envFile) args.push('--env-file', envFile);

if (arm === 'lamina') {
  const skills = resolveBenchSkills();
  for (const skill of skills) args.push('--skills', skill);
  console.log(`Injecting ${skills.length} bench-trimmed Lamina skills into the lamina arm.`);
}

console.log(`Running ${arm} arm with Claude Code adapter and ${model}: harbor ${args.join(' ')}`);
const child = spawn('harbor', args, { cwd: ROOT, stdio: 'inherit', env: process.env });
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
