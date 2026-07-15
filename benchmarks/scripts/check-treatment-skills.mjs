#!/usr/bin/env node
/** Verify that treatment Codex sessions contain each required explicit skill invocation. */
import fs from 'node:fs';
import path from 'node:path';
import { HARBOR_JOBS, listJobDirs, listTrialDirs, parseHarborJobName } from './bench-results-lib.mjs';

const requiredFor = (taskToml) => {
  const text = fs.existsSync(taskToml) ? fs.readFileSync(taskToml, 'utf8') : '';
  return /lamina_workflow\s*=\s*"audit"/.test(text)
    ? ['lamina-init', 'lamina-verify']
    : ['lamina-init', 'lamina-design', 'lamina-verify'];
};
const jobsIdx = process.argv.indexOf('--jobs-dir');
const jobsDir = jobsIdx === -1 ? HARBOR_JOBS : path.resolve(process.argv[jobsIdx + 1]);
const rows = [];

for (const jobDir of listJobDirs(jobsDir)) {
  const jobName = path.basename(jobDir);
  const meta = parseHarborJobName(jobName);
  if (!meta || meta.arm !== 'treatment') continue;
  for (const trialDir of listTrialDirs(jobDir)) {
    const sessions = path.join(trialDir, 'agent', 'codex-home', 'sessions');
    const files = fs.existsSync(sessions)
      ? fs.readdirSync(sessions, { recursive: true }).filter((name) => String(name).endsWith('.jsonl'))
      : [];
    const transcript = files.map((name) => fs.readFileSync(path.join(sessions, name), 'utf8')).join('\n');
    const taskToml = path.resolve('benchmarks/harbor/tasks', `${meta.task_id}-treatment`, 'task.toml');
    const required = requiredFor(taskToml);
    const missing = required.filter((skill) => !transcript.includes(`$${skill}`));
    rows.push({ jobName, trialDir, missing });
  }
}

if (!rows.length) {
  console.error('No treatment Codex trials found to check.');
  process.exit(1);
}
for (const row of rows) {
  console.log(`[${row.missing.length ? 'FAIL' : 'OK'}] ${row.jobName}/${path.basename(row.trialDir)}${row.missing.length ? ` missing=${row.missing.join(',')}` : ''}`);
}
if (rows.some((row) => row.missing.length)) process.exit(1);
