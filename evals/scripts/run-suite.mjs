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
const VENV_ASE = path.join(ROOT, '.venv-eval/bin/agent-skill-eval');

function resolveAgentSkillEval() {
  if (fs.existsSync(VENV_ASE)) return VENV_ASE;
  return 'agent-skill-eval';
}

/** Load repo `.env` into process.env without overriding existing values. */
function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/**
 * ASE defaults grader traffic to OpenRouter. When only OPENAI_API_KEY is
 * present, point the grader at OpenAI so rubric assertions are not skipped.
 */
function graderExtraArgs(existing = []) {
  const hasFlag = (name) => existing.some((a) => a === name || a.startsWith(`${name}=`));
  const args = [];
  if (process.env.OPENROUTER_API_KEY) return args;
  if (!process.env.OPENAI_API_KEY) return args;
  if (!hasFlag('--grader-base-url')) {
    args.push('--grader-base-url', process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  }
  if (!hasFlag('--grader-model')) {
    args.push('--grader-model', process.env.LAMINA_EVAL_GRADER_MODEL || 'gpt-4o-mini');
  }
  return args;
}

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

function resolveSkillPath(evalIds) {
  if (evalIds.length === 1) {
    const id = evalIds[0];
    if (id.startsWith('design-') || id.startsWith('guardrail-design') || id.startsWith('guardrail-no-implement')) {
      return './skills/lamina-design';
    }
    if (id.startsWith('init-') && !id.startsWith('init-gate')) {
      return './skills/lamina-init';
    }
    if (id.startsWith('verify-')) {
      return './skills/lamina-verify';
    }
  }
  return './skills/lamina';
}

function runAgentSkillEval(evalsFile, opts) {
  loadDotEnv();
  const extra = [...opts.extraArgs, ...graderExtraArgs(opts.extraArgs)];
  // Anthropic is usage-capped; route opencode to OpenAI when available.
  if (
    process.env.OPENAI_API_KEY &&
    !extra.some((a) => a === '--agent-model' || String(a).startsWith('opencode='))
  ) {
    extra.push('--agent-model', `opencode=${process.env.LAMINA_EVAL_OPENCODE_MODEL || 'openai/gpt-4o-mini'}`);
  }
  const evalIds = [];
  for (let i = 0; i < extra.length; i++) {
    if (extra[i] === '--eval-id' && extra[i + 1]) evalIds.push(extra[i + 1]);
  }
  const skillPath = resolveSkillPath(evalIds);
  const args = [
    'run',
    '--skill',
    skillPath,
    '--evals',
    evalsFile,
    ...opts.agents.flatMap((a) => ['--agent', a]),
    '--runs',
    String(opts.runs),
    '--pre-run-command',
    'bash evals/hooks/pre-run-eval.sh',
    '--post-grade-command',
    'node evals/hooks/grade-lamina.mjs',
    ...extra,
  ];
  if (opts.baseline) args.push('--baseline');

  const bin = resolveAgentSkillEval();
  const env = { ...process.env };
  // Cap hung without-skill baselines; with-skill design/init often needs longer.
  if (!env.ASE_AGENT_TIMEOUT) env.ASE_AGENT_TIMEOUT = '900';
  // Prefer evals/bin wrappers (e.g. opencode hides .git to avoid inotify ENOSPC;
  // claude routes through local LiteLLM→OpenAI when Anthropic is usage-capped).
  // Always put this process's Node first so post-grade `node evals/hooks/...`
  // keeps working if nvm/global PATH was wiped mid-session.
  env.PATH = [
    path.dirname(process.execPath),
    path.join(ROOT, 'evals/bin'),
    env.PATH || '',
  ].join(path.delimiter);
  if (!env.LITELLM_MASTER_KEY) env.LITELLM_MASTER_KEY = 'sk-lamina-eval-local';
  // Best-effort: ensure Anthropic-compatible OpenAI proxy is up for claude-code.
  spawnSync('bash', [path.join(ROOT, 'evals/bin/ensure-claude-proxy.sh')], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  });
  console.log(`Skill path: ${skillPath}`);
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
    env,
  });
  if (result.error) {
    console.error(`Failed to spawn ${bin}: ${result.error.message}`);
    return 1;
  }
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
    // Only pass single-turn ids to agent-skill-eval. Multi-turn cases (prompts[])
    // are graded by run-multiturn-case.mjs; including them here forces a broken
    // single-prompt run and pollutes smoke/with_skill pass rates.
    const singleIds = single.map((ev) => ev.id);
    const evalArgs = singleIds.length
      ? singleIds.flatMap((id) => ['--eval-id', id])
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
