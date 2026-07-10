#!/usr/bin/env node
/**
 * Run a multi-turn Lamina eval case: stage fixture, run agent turns in one workspace, grade.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stageFixture } from './stage-fixture.mjs';
import { invokeAgent } from './invoke-agent.mjs';
import { writeState } from './workspace-state.mjs';
import { judgeAssertions, writeGrading } from './judge-assertions.mjs';
import { checkWriteBoundary } from '../lib/lamina-write-boundary.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv) {
  const opts = { agent: 'claude-code', evals: 'evals/lamina/evals.json', evalId: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--agent' && argv[i + 1]) opts.agent = argv[++i];
    else if (argv[i] === '--evals' && argv[i + 1]) opts.evals = argv[++i];
    else if (argv[i] === '--eval-id' && argv[i + 1]) opts.evalId = argv[++i];
  }
  if (!opts.evalId) {
    console.error('Usage: node evals/scripts/run-multiturn-case.mjs --eval-id <id> [--evals path] [--agent name]');
    process.exit(1);
  }
  return opts;
}

function loadEvalCase(evalsPath, evalId) {
  const abs = path.isAbsolute(evalsPath) ? evalsPath : path.join(ROOT, evalsPath);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const ev = data.evals.find((e) => e.id === evalId);
  if (!ev) throw new Error(`Eval ${evalId} not found in ${evalsPath}`);
  if (!Array.isArray(ev.prompts) || ev.prompts.length < 2) {
    throw new Error(`Eval ${evalId} is not multi-turn (prompts[] required)`);
  }
  return ev;
}

function installSkills(workspace) {
  const result = spawnSync('bash', [path.join(ROOT, 'evals/hooks/install-skill.sh')], {
    cwd: ROOT,
    env: { ...process.env, ASE_WORKSPACE_PATH: workspace },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`install-skill.sh failed: ${result.stderr || result.stdout}`);
  }
}

function runGradeHook({ workspace, outputDir, evalId, preStatePath, postStatePath, gradingPath }) {
  const result = spawnSync('node', [path.join(ROOT, 'evals/hooks/grade-lamina.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      ASE_WORKSPACE_PATH: workspace,
      ASE_OUTPUT_DIR: outputDir,
      ASE_EVAL_ID: evalId,
      ASE_PRE_STATE_PATH: preStatePath,
      ASE_POST_STATE_PATH: postStatePath,
      ASE_GRADING_PATH: gradingPath,
    },
    encoding: 'utf8',
  });
  return result.stdout;
}

async function main() {
  const opts = parseArgs(process.argv);
  const ev = loadEvalCase(opts.evals, opts.evalId);

  const runRoot = path.join(ROOT, 'evals/workspace/multiturn', opts.evalId);
  const workspace = path.join(runRoot, 'workspace');
  const outputDir = path.join(runRoot, 'output');
  const turnsDir = path.join(outputDir, 'turns');

  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(turnsDir, { recursive: true });

  if (ev.fixture) {
    stageFixture(ev.fixture, workspace);
  }

  installSkills(workspace);

  const preStatePath = path.join(runRoot, 'pre-state.json');
  writeState(preStatePath, workspace);

  let history = '';
  let combinedLogs = '';
  const turnOutputs = [];

  for (let i = 0; i < ev.prompts.length; i++) {
    const userPrompt = ev.prompts[i];
    const fullPrompt =
      history.length > 0
        ? `Continue this Lamina workflow session in the same workspace.\n\n${history}\nUser: ${userPrompt}`
        : userPrompt;

    const { output, stdout, stderr } = await invokeAgent(opts.agent, fullPrompt, workspace);
    turnOutputs.push(output);
    combinedLogs += stdout + stderr;

    const turnDir = path.join(turnsDir, String(i + 1));
    fs.mkdirSync(turnDir, { recursive: true });
    fs.writeFileSync(path.join(turnDir, 'output.txt'), output);
    fs.writeFileSync(path.join(turnDir, 'prompt.txt'), userPrompt);

    history += `User: ${userPrompt}\nAssistant: ${output}\n\n`;
  }

  const finalOutput = turnOutputs[turnOutputs.length - 1] ?? '';
  const combinedOutput = turnOutputs.join('\n\n--- turn ---\n\n');
  fs.mkdirSync(path.join(outputDir, 'outputs'), { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'outputs', 'output.txt'), combinedOutput);
  fs.writeFileSync(path.join(outputDir, 'outputs', 'stdout.log'), combinedLogs);

  const postStatePath = path.join(runRoot, 'post-state.json');
  writeState(postStatePath, workspace);

  const preState = JSON.parse(fs.readFileSync(preStatePath, 'utf8'));
  const postState = JSON.parse(fs.readFileSync(postStatePath, 'utf8'));
  const boundary = checkWriteBoundary(preState, postState, workspace);
  if (!boundary.ok) {
    console.error('Write boundary violation (files outside .lamina/ changed):', boundary.violations.join(', '));
  }

  const assertions = ev.assertions ?? [];
  const llmGrading = await judgeAssertions(assertions, combinedOutput, combinedLogs);
  const gradingPath = path.join(outputDir, 'grading.json');
  writeGrading(gradingPath, llmGrading);

  const hookStdout = runGradeHook({
    workspace,
    outputDir,
    evalId: opts.evalId,
    preStatePath,
    postStatePath,
    gradingPath,
  });

  let hookResults = [];
  try {
    hookResults = JSON.parse(hookStdout || '[]');
  } catch {
    hookResults = [];
  }

  const merged = new Map();
  for (const r of llmGrading.assertion_results ?? []) {
    merged.set(r.text, r);
  }
  for (const r of hookResults) {
    merged.set(r.text, { ...r, method: r.method || 'hook' });
  }

  const assertion_results = assertions.map((text) => merged.get(text) ?? { text, passed: false, evidence: 'Not graded' });

  if (!boundary.ok) {
    const boundaryText = 'no writes outside .lamina';
    const existing = assertion_results.find((r) => r.text === boundaryText);
    if (existing) {
      existing.passed = false;
      existing.evidence = `Files changed: ${boundary.violations.join(', ')}`;
    } else {
      assertion_results.push({
        text: boundaryText,
        passed: false,
        evidence: `Files changed: ${boundary.violations.join(', ')}`,
        method: 'hook',
      });
    }
  }

  const passed = assertion_results.filter((r) => r.passed).length;
  const report = {
    eval_id: opts.evalId,
    agent: opts.agent,
    turns: ev.prompts.length,
    assertion_results,
    summary: {
      passed,
      failed: assertion_results.length - passed,
      total: assertion_results.length,
      pass_rate: assertion_results.length ? passed / assertion_results.length : 0,
    },
  };

  fs.writeFileSync(path.join(runRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary, null, 2));
  process.exit(report.summary.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
