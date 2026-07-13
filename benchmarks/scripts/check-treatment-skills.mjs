#!/usr/bin/env node
/**
 * Verify treatment-arm Harbor trials invoked required Lamina slash-command skills.
 *
 * Usage:
 *   node benchmarks/scripts/check-treatment-skills.mjs [--jobs-dir PATH]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import {
  HARBOR_JOBS,
  listJobDirs,
  listTrialDirs,
  parseHarborJobName,
  readJsonSafe,
} from './bench-results-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const REQUIRED_DESIGN = ['lamina-init', 'lamina-design', 'lamina-verify'];
const REQUIRED_AUDIT = ['lamina-init', 'lamina-verify'];

function parseArgs() {
  const opts = { jobsDir: HARBOR_JOBS };
  const idx = process.argv.indexOf('--jobs-dir');
  if (idx !== -1) opts.jobsDir = path.resolve(process.argv[idx + 1]);
  return opts;
}

function findClaudeJson(trialDir) {
  const candidates = [
    path.join(trialDir, 'agent', 'home', '.claude.json'),
    path.join(trialDir, 'environment', 'workspace', '.claude', '.claude.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const root of [trialDir, path.join(trialDir, 'agent')]) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name === '.claude.json') return full;
      }
    }
  }
  return null;
}

function skillUsageFromAgentLog(trialDir) {
  const logPath = path.join(trialDir, 'agent', 'claude-code.txt');
  if (!fs.existsSync(logPath)) return {};
  const usage = {};
  for (const skill of ['lamina-init', 'lamina-design', 'lamina-verify']) {
    let count = 0;
    for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const toolInput = row?.message?.content?.find?.((c) => c.type === 'tool_use')?.input;
      if (toolInput?.skill === skill) {
        const toolUseId = row?.message?.content?.find?.((c) => c.type === 'tool_use')?.id;
        count += 1;
        continue;
      }
      const textBlocks = row?.message?.content?.filter?.((c) => c.type === 'text') ?? [];
      for (const block of textBlocks) {
        if (typeof block.text === 'string' && new RegExp(`/${skill}\\b`).test(block.text)) {
          count += 1;
        }
      }
      if (typeof row?.result === 'string' && new RegExp(`/${skill}\\b`).test(row.result)) {
        count += 1;
      }
    }
    if (count > 0) usage[skill] = { usageCount: count };
  }
  return usage;
}

function skillUsageFromTrial(trialDir) {
  const claudeJson = findClaudeJson(trialDir);
  if (claudeJson) {
    const doc = readJsonSafe(claudeJson) ?? {};
    if (doc.skillUsage && Object.keys(doc.skillUsage).length) {
      return { path: claudeJson, usage: doc.skillUsage };
    }
  }
  const fromLog = skillUsageFromAgentLog(trialDir);
  return {
    path: claudeJson ? path.relative(ROOT, claudeJson) : null,
    usage: fromLog,
  };
}

function workflowForJob(jobMeta) {
  const taskToml = path.join(
    ROOT,
    'benchmarks/harbor/tasks',
    `${jobMeta.task_id}-treatment`,
    'task.toml'
  );
  if (!fs.existsSync(taskToml)) return 'design';
  const text = fs.readFileSync(taskToml, 'utf8');
  const m = text.match(/lamina_workflow\s*=\s*"([^"]+)"/);
  return m?.[1] ?? 'design';
}

function checkTrial({ jobName, trialDir }) {
  const jobMeta = parseHarborJobName(jobName);
  if (!jobMeta || jobMeta.arm !== 'treatment') return null;

  const required =
    workflowForJob(jobMeta) === 'audit' ? REQUIRED_AUDIT : REQUIRED_DESIGN;
  const { path: claudePath, usage } = skillUsageFromTrial(trialDir);
  const missing = required.filter((skill) => !(usage[skill]?.usageCount > 0));
  const counts = Object.fromEntries(
    required.map((skill) => [skill, usage[skill]?.usageCount ?? 0])
  );

  return {
    job: jobName,
    trial: path.basename(trialDir),
    workflow: workflowForJob(jobMeta),
    claude_json: claudePath ? path.relative(ROOT, claudePath) : null,
    required,
    counts,
    ok: missing.length === 0,
    missing,
  };
}

function main() {
  const opts = parseArgs();
  const results = [];

  for (const jobDir of listJobDirs(opts.jobsDir)) {
    const jobName = path.basename(jobDir);
    for (const trialDir of listTrialDirs(jobDir)) {
      const row = checkTrial({ jobName, trialDir });
      if (row) results.push(row);
    }
  }

  if (!results.length) {
    console.error('No treatment trials found to check.');
    process.exit(1);
  }

  let failed = 0;
  for (const row of results) {
    const status = row.ok ? 'OK' : 'FAIL';
    console.log(
      `[${status}] ${row.job}/${row.trial} (${row.workflow}) counts=${JSON.stringify(row.counts)}`
    );
    if (!row.ok) {
      failed++;
      console.log(`       missing: ${row.missing.join(', ')}`);
      if (row.claude_json) console.log(`       claude: ${row.claude_json}`);
      else console.log('       claude: .claude.json not found in trial artifacts');
    }
  }

  if (failed) {
    console.error(`\n${failed}/${results.length} treatment trial(s) missing required skill invocations.`);
    process.exit(1);
  }

  console.log(`\nAll ${results.length} treatment trial(s) invoked required Lamina skills.`);
}

main();
