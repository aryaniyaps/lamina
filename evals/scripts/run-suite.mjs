#!/usr/bin/env node
/**
 * Run Lamina eval suite: single-turn via agent-skill-eval, multi-turn via run-multiturn-case.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = path.join(ROOT, 'evals/tmp');

function parseArgs(argv) {
  const opts = {
    evals: 'evals/lamina/evals.json',
    agents: [],
    runs: 1,
    baseline: false,
    extraArgs: [],
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--evals' && argv[i + 1]) opts.evals = argv[++i];
    else if (arg === '--agent' && argv[i + 1]) opts.agents.push(argv[++i]);
    else if (arg === '--runs' && argv[i + 1]) opts.runs = Number(argv[++i]);
    else if (arg === '--baseline') opts.baseline = true;
    else opts.extraArgs.push(arg);
  }

  if (opts.agents.length === 0) opts.agents = ['claude-code'];
  return opts;
}

function loadSuite(evalsPath) {
  const abs = path.isAbsolute(evalsPath) ? evalsPath : path.join(ROOT, evalsPath);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function splitSuite(data) {
  const single = [];
  const multi = [];
  for (const ev of data.evals) {
    if (Array.isArray(ev.prompts) && ev.prompts.length >= 2) multi.push(ev);
    else if (ev.prompt) single.push(ev);
  }
  return { single, multi, skill_name: data.skill_name };
}

function writeTempSuite(name, data) {
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return file;
}

function runAgentSkillEval(evalsFile, opts) {
  const args = [
    'run',
    '--skill',
    './skills/lamina',
    '--evals',
    evalsFile,
    ...opts.agents.flatMap((a) => ['--agent', a]),
    '--runs',
    String(opts.runs),
    '--pre-run-command',
    'bash evals/hooks/pre-run-eval.sh',
    '--post-grade-command',
    'node evals/hooks/grade-lamina.mjs',
    ...opts.extraArgs,
  ];
  if (opts.baseline) args.push('--baseline');

  const result = spawnSync('agent-skill-eval', args, { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
  return result.status ?? 1;
}

function runMultiturnBatch(multiEvals, evalsPath, agent) {
  let failed = 0;
  for (const ev of multiEvals) {
    console.log(`\n[multiturn] ${ev.id} (${agent})`);
    const result = spawnSync(
      'node',
      [
        path.join(ROOT, 'evals/scripts/run-multiturn-case.mjs'),
        '--eval-id',
        ev.id,
        '--evals',
        evalsPath,
        '--agent',
        agent,
      ],
      { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' },
    );
    if ((result.status ?? 1) !== 0) failed++;
  }
  return failed;
}

function main() {
  spawnSync('node', [path.join(ROOT, 'evals/scripts/merge-evals.mjs')], { cwd: ROOT, stdio: 'inherit' });

  const opts = parseArgs(process.argv);
  const suite = loadSuite(opts.evals);
  const { single, multi, skill_name } = splitSuite(suite);

  console.log(`Suite: ${single.length} single-turn, ${multi.length} multi-turn`);

  let exitCode = 0;

  if (single.length > 0) {
    const singleFile = writeTempSuite('single-turn.json', { skill_name, evals: single });
    const rel = path.relative(ROOT, singleFile);
    const code = runAgentSkillEval(rel, opts);
    if (code !== 0) exitCode = code;
  }

  if (multi.length > 0) {
    for (const agent of opts.agents) {
      const failed = runMultiturnBatch(multi, opts.evals, agent);
      if (failed > 0) exitCode = 1;
    }
  }

  process.exit(exitCode);
}

main();
