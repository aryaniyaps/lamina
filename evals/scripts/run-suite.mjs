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
    evalIds: [],
    smoke: false,
    evalIdsFile: null,
    extraArgs: [],
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--evals' && argv[i + 1]) opts.evals = argv[++i];
    else if (arg === '--agent' && argv[i + 1]) opts.agents.push(argv[++i]);
    else if (arg === '--runs' && argv[i + 1]) opts.runs = Number(argv[++i]);
    else if (arg === '--eval-id' && argv[i + 1]) opts.evalIds.push(argv[++i]);
    else if (arg === '--eval-ids-file' && argv[i + 1]) opts.evalIdsFile = argv[++i];
    else if (arg === '--smoke') opts.smoke = true;
    else if (arg === '--baseline') opts.baseline = true;
    else if (arg === '--no-baseline') opts.extraArgs.push(arg);
    else opts.extraArgs.push(arg);
  }

  if (opts.smoke) {
    opts.evals = 'evals/lamina/evals.json';
    if (!opts.evalIdsFile) opts.evalIdsFile = 'evals/smoke/ids.json';
  }

  if (opts.agents.length === 0) opts.agents = ['claude-code'];
  return opts;
}

function filterEvals(evals, evalIds) {
  if (!evalIds.length) return evals;
  const wanted = new Set(evalIds);
  return evals.filter((ev) => wanted.has(ev.id));
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

function writeTempSuite(name, data, evalIds = []) {
  fs.mkdirSync(TMP, { recursive: true });
  const suffix = evalIds.length ? `-${evalIds.join('-')}-${process.pid}` : '';
  const file = path.join(TMP, `${name}${suffix}.json`);
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

  let evalIds = opts.evalIds;
  if (opts.evalIdsFile) {
    const idsPath = path.isAbsolute(opts.evalIdsFile)
      ? opts.evalIdsFile
      : path.join(ROOT, opts.evalIdsFile);
    const { ids } = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
    evalIds = [...evalIds, ...ids];
  }

  const filtered = filterEvals(suite.evals, evalIds);
  const { single, multi, skill_name } = splitSuite({ ...suite, evals: filtered });

  console.log(`Suite: ${single.length} single-turn, ${multi.length} multi-turn`);

  let exitCode = 0;

  if (single.length > 0) {
    const evalsAbs = path.isAbsolute(opts.evals) ? opts.evals : path.join(ROOT, opts.evals);
    const rel = path.relative(ROOT, evalsAbs);
    const evalArgs = evalIds.length
      ? evalIds.flatMap((id) => ['--eval-id', id])
      : [];
    const code = runAgentSkillEval(rel, { ...opts, extraArgs: [...opts.extraArgs, ...evalArgs] });
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
