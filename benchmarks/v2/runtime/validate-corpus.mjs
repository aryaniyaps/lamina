#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TOPICS } from './oracle.mjs';

export function hashDir(dir) {
  const hash = createHash('sha256');
  const files = [];
  const walk = (current, prefix = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
    }
  };
  walk(dir);
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(dir, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function parseJson(file, errors, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { errors.push(`${label}: invalid JSON: ${error.message}`); return null; }
}

function validateFounderIntent(intent, taskId, errors) {
  if (!intent || intent.task_id !== taskId) errors.push(`${taskId}: founder-intent task_id mismatch`);
  if (!Array.isArray(intent?.facts)) errors.push(`${taskId}: founder-intent requires facts[]`);
  const ids = new Set();
  for (const fact of intent?.facts || []) {
    if (!fact.id || ids.has(fact.id)) errors.push(`${taskId}: founder fact id missing or duplicated`);
    ids.add(fact.id);
    if (!TOPICS.has(fact.topic)) errors.push(`${taskId}: founder fact ${fact.id || '?'} has invalid topic`);
    if (!fact.answer || typeof fact.answer !== 'string') errors.push(`${taskId}: founder fact ${fact.id || '?'} has no answer`);
  }
}

function safePackage(root, packageName, taskId, errors) {
  if (!packageName || packageName.includes('..') || path.isAbsolute(packageName)) {
    errors.push(`${taskId}: invalid package path`);
    return null;
  }
  const dir = path.resolve(root, packageName);
  if (!dir.startsWith(`${path.resolve(root)}${path.sep}`)) {
    errors.push(`${taskId}: package escapes corpus root`);
    return null;
  }
  return dir;
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'corpus');
const v2 = path.resolve(root, '..');
const publish = process.argv.includes('--publish');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const release = JSON.parse(fs.readFileSync(path.join(v2, 'release.json'), 'utf8'));
const errors = [];
if (manifest.development?.length !== release.development_tasks) errors.push(`development task count must be ${release.development_tasks}`);
if (manifest.publication?.length !== release.publication_tasks) errors.push(`publication task count must be ${release.publication_tasks}`);
const allIds = [...(manifest.development || []), ...(manifest.publication || [])].map((task) => task.id);
if (new Set(allIds).size !== allIds.length) errors.push('corpus task IDs must be unique');

for (const task of manifest.development || []) {
  const dir = safePackage(root, task.package, task.id, errors);
  if (!dir) continue;
  for (const file of ['brief.md', 'founder-intent.json']) if (!fs.existsSync(path.join(dir, file))) errors.push(`${task.id}: missing ${file}`);
  if (fs.existsSync(path.join(dir, 'brief.md')) && fs.readFileSync(path.join(dir, 'brief.md'), 'utf8').trim().length < 40) errors.push(`${task.id}: brief is implausibly short`);
  if (fs.existsSync(path.join(dir, 'founder-intent.json'))) validateFounderIntent(parseJson(path.join(dir, 'founder-intent.json'), errors, task.id), task.id, errors);
  if (task.kind === 'brownfield' && !task.fixture_ref) errors.push(`${task.id}: brownfield task missing fixture_ref`);
}

if (publish) {
  for (const task of manifest.publication || []) {
    const dir = safePackage(root, task.package || task.id, task.id, errors);
    if (!task.sealed_sha256) errors.push(`${task.id}: missing sealed_sha256`);
    else if (!dir || !fs.existsSync(dir)) errors.push(`${task.id}: sealed package missing`);
    else if (hashDir(dir) !== task.sealed_sha256) errors.push(`${task.id}: package hash mismatch`);
    if (!dir || !fs.existsSync(dir)) continue;
    for (const file of ['task.json', 'brief.md', 'founder-intent.json', 'golden.json']) if (!fs.existsSync(path.join(dir, file))) errors.push(`${task.id}: missing ${file}`);
    if (fs.existsSync(path.join(dir, 'founder-intent.json'))) validateFounderIntent(parseJson(path.join(dir, 'founder-intent.json'), errors, task.id), task.id, errors);
    if (fs.existsSync(path.join(dir, 'task.json'))) {
      const metadata = parseJson(path.join(dir, 'task.json'), errors, task.id);
      if (metadata?.task_id !== task.id || metadata?.kind !== task.kind) errors.push(`${task.id}: task.json identity mismatch`);
      if (task.kind === 'brownfield' && (!metadata?.fixture_ref || !/^[a-f0-9]{64}$/.test(metadata?.fixture_sha256 || ''))) errors.push(`${task.id}: brownfield task.json requires fixture_ref and recursive fixture_sha256`);
    }
    if (fs.existsSync(path.join(dir, 'golden.json'))) {
      const golden = parseJson(path.join(dir, 'golden.json'), errors, task.id);
      if (golden?.task_id !== task.id) errors.push(`${task.id}: golden task_id mismatch`);
      for (const key of ['critical_promises', 'structural_hazards', 'open_policy_decisions', 'acceptable_alternatives']) if (!Array.isArray(golden?.[key])) errors.push(`${task.id}: golden requires ${key}[]`);
    }
  }
}
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log(publish ? 'publication corpus sealed' : 'development corpus valid');
