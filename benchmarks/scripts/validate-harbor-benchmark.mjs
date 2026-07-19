#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tasksRoot = path.join(ROOT, 'benchmarks/harbor/tasks');
const arms = new Set(['raw', 'plan', 'lamina']);
const errors = [];
const taskDirs = fs.readdirSync(tasksRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
if (taskDirs.length !== 12) errors.push(`expected 12 generated development tasks, found ${taskDirs.length}`);
for (const entry of taskDirs) {
  const match = entry.name.match(/^(.*)-(raw|plan|lamina)$/);
  if (!match || !arms.has(match[2])) { errors.push(`${entry.name}: invalid task/arm name`); continue; }
  const dir = path.join(tasksRoot, entry.name);
  for (const file of ['task.toml', 'environment/Dockerfile']) if (!fs.existsSync(path.join(dir, file))) errors.push(`${entry.name}: missing ${file}`);
  const stepsDir = path.join(dir, 'steps');
  const steps = fs.existsSync(stepsDir) ? fs.readdirSync(stepsDir, { withFileTypes: true }).filter((item) => item.isDirectory()) : [];
  if (!steps.length) errors.push(`${entry.name}: no Harbor steps`);
  for (const step of steps) {
    for (const file of ['instruction.md', 'tests/test.sh', 'tests/grade.py']) if (!fs.existsSync(path.join(stepsDir, step.name, file))) errors.push(`${entry.name}/${step.name}: missing ${file}`);
  }
  const text = fs.readFileSync(path.join(dir, 'task.toml'), 'utf8');
  if (!text.includes(`arm = "${match[2]}"`)) errors.push(`${entry.name}: task metadata arm mismatch`);
  if (/structured|control|treatment|codex|gpt-5\.6-sol/i.test(text)) errors.push(`${entry.name}: legacy arm/model vocabulary remains`);
}
if (errors.length) { for (const error of errors) console.error(error); process.exit(1); }
console.log(`Harbor benchmark valid: ${taskDirs.length} tasks, arms raw/plan/lamina, Claude Code model alias sonnet.`);
