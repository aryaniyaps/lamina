#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRepoRoot, validateReleaseFile, validateWebRelease } from '../lib/web-release.mjs';

const ROOT = resolveRepoRoot(import.meta.url);

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const file = readFlag('--file', null);
const expectStatus = readFlag('--expect-status', null);

if (process.argv.includes('--stdin')) {
  const release = JSON.parse(fs.readFileSync(0, 'utf8'));
  const errors = validateWebRelease(release, {
    expectedStatus: expectStatus ?? undefined,
  });
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log('Valid release payload from stdin');
  process.exit(0);
}

if (!file) {
  console.error('Usage: validate-web-release.mjs --file <path> [--expect-status running]');
  console.error('       validate-web-release.mjs --stdin [--expect-status running]');
  process.exit(1);
}

const errors = validateReleaseFile(path.resolve(file), {
  expectedStatus: expectStatus ?? undefined,
  root: ROOT,
  verifyGitArtifacts: true,
});

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`Valid release fixture: ${file}`);
