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

function resolveSkillSource(evalId) {
  if (
    evalId.startsWith('design-') ||
    evalId.startsWith('guardrail-design') ||
    evalId.startsWith('guardrail-no-implement')
  ) {
    return path.join(ROOT, 'skills/lamina-design');
  }
  if (evalId.startsWith('init-') && !evalId.startsWith('init-gate')) {
    return path.join(ROOT, 'skills/lamina-init');
  }
  if (evalId.startsWith('verify-') || evalId.startsWith('audit-')) {
    return path.join(ROOT, 'skills/lamina-verify');
  }
  return path.join(ROOT, 'skills/lamina');
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

function installSkills(workspace, evalId, agent) {
  const result = spawnSync('bash', [path.join(ROOT, 'evals/hooks/install-skill.sh')], {
    cwd: ROOT,
    env: { ...process.env, ASE_WORKSPACE_PATH: workspace, ASE_AGENT: agent },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`install-skill.sh failed: ${result.stderr || result.stdout}`);
  }

  // Mirror ASE: install the eval-specific skill under the agent skill root so
  // `/lamina-design` (etc.) resolves with EXEC NOW / seed scripts available.
  const skillSrc = resolveSkillSource(evalId);
  const skillName = path.basename(skillSrc);
  const agentRoots = {
    'claude-code': ['.claude/skills'],
    codex: ['.codex/skills', '.agents/skills'],
    opencode: ['.opencode/skills', '.agents/skills'],
  };
  for (const root of agentRoots[agent] || ['.agents/skills']) {
    const dest = path.join(workspace, root, skillName);
    fs.rmSync(dest, { recursive: true, force: true });
    copyTree(skillSrc, dest);
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

  const runRoot = path.join(ROOT, 'evals/workspace/multiturn', opts.evalId, opts.agent);
  const workspace = path.join(runRoot, 'workspace');
  const outputDir = path.join(runRoot, 'output');
  const turnsDir = path.join(outputDir, 'turns');

  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(turnsDir, { recursive: true });

  if (ev.fixture) {
    stageFixture(ev.fixture, workspace);
  }
  // merge-evals expands fixtures into files[] and drops fixture — stage those too
  if (Array.isArray(ev.files) && ev.files.length) {
    for (const rel of ev.files) {
      const src = path.join(ROOT, 'evals/lamina', rel);
      if (!fs.existsSync(src)) {
        throw new Error(`Missing staged fixture file: ${src}`);
      }
      const destRel = rel.replace(/^files\/[^/]+\//, '');
      const dest = path.join(workspace, destRel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  installSkills(workspace, opts.evalId, opts.agent);

  const preStatePath = path.join(runRoot, 'pre-state.json');
  writeState(preStatePath, workspace);

  let history = '';
  let combinedLogs = '';
  const turnOutputs = [];

  // Mirror ASE _build_prompt force_skill_invocation: `Use the $<skill> skill. …`
  const skillName = path.basename(resolveSkillSource(opts.evalId));
  const forcePrefix =
    ev.force_skill_invocation === true ? `Use the $${skillName} skill. ` : '';

  for (let i = 0; i < ev.prompts.length; i++) {
    const userPrompt = ev.prompts[i];
    const forcedUser = `${forcePrefix}${userPrompt}`;
    // Keep reminders short: long "read the skill" prompts make opencode tool-thrash/hang.
    const isVerify = /verify/i.test(skillName);
    const gateReminder =
      i === 0
        ? [
            `Follow $${skillName}. Init is already satisfied if .lamina/business-context.md exists.`,
            'This brief is vague → reply with ONLY the clarification contract below (no tools, no seed, no run.json):',
            '## Lamina: clarification needed',
            '### Status',
            '### Clarifying questions',
            '### Why these block the artifact',
            '### How to proceed',
            '### Do not',
            '',
          ].join('\n')
        : isVerify
          ? [
              `Follow $${skillName}. Clarification was answered — EXEC NOW verify seed:`,
              'From workspace root run seed-verify-run.mjs (not seed-ready-run; do not hand-write run.json).',
              'Then emit VERIFY headings only (not design headings):',
              '### Executive summary / ### Findings / ### Open questions',
              'Mention audit, findings, prioritized improvements, empty/failure/permission, and full-flow lenses.',
              '',
            ].join('\n')
          : [
              `Follow $${skillName}. Clarification was answered — EXEC NOW:`,
              'From workspace root run seed-ready-run.mjs (do not hand-write run.json), then emit design headings:',
              '### Domain and invariants / ### Actors and permissions / ### Workflows / ### Scenarios / ### Implement brief / ### Open questions',
              'Mention lamina-edge-cases, flows, edge cases, empty/failure/permission.',
              '',
            ].join('\n');
    const fullPrompt =
      history.length > 0
        ? `${gateReminder}Continue this Lamina workflow session in the same workspace.\n\n${history}\nUser: ${forcedUser}`
        : `${gateReminder}${forcedUser}`;

    const timeoutMs = process.env.ASE_AGENT_TIMEOUT
      ? Number(process.env.ASE_AGENT_TIMEOUT) * 1000
      : process.env.BENCH_PHASE_TIMEOUT_MS
        ? Number(process.env.BENCH_PHASE_TIMEOUT_MS)
        : undefined;
    let output = '';
    let stdout = '';
    let stderr = '';
    try {
      const result = await invokeAgent(opts.agent, fullPrompt, workspace, {
        model:
          opts.agent === 'opencode'
            ? process.env.LAMINA_EVAL_OPENCODE_MODEL || 'openai/gpt-4o-mini'
            : undefined,
        timeoutMs,
      });
      output = result.output;
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err) {
      stderr = String(err?.message || err);
      output = stderr;
      console.error(`turn ${i + 1} invoke failed:`, stderr);
    }
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
