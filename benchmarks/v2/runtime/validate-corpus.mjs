#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
    hash.update(fs.readFileSync(path.join(dir, file)));
  }
  return hash.digest('hex');
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'corpus');
const publish = process.argv.includes('--publish');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const errors = [];
for (const task of manifest.development) {
  const dir = path.join(root, task.package);
  for (const file of ['brief.md', 'founder-intent.json']) if (!fs.existsSync(path.join(dir, file))) errors.push(`${task.id}: missing ${file}`);
  if (task.kind === 'brownfield' && !task.fixture_ref) errors.push(`${task.id}: brownfield task missing fixture_ref`);
}
if (publish) {
  for (const task of manifest.publication) {
    const dir = path.join(root, task.id);
    if (!task.sealed_sha256) errors.push(`${task.id}: missing sealed_sha256`);
    else if (!fs.existsSync(dir)) errors.push(`${task.id}: sealed package missing`);
    else if (hashDir(dir) !== task.sealed_sha256) errors.push(`${task.id}: package hash mismatch`);
    else for (const file of ['brief.md', 'founder-intent.json', 'golden.json']) if (!fs.existsSync(path.join(dir, file))) errors.push(`${task.id}: missing ${file}`);
    if (task.kind === 'brownfield' && !task.fixture_ref) errors.push(`${task.id}: brownfield task missing fixture_ref`);
  }
}
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log(publish ? 'publication corpus sealed' : 'development corpus valid');
