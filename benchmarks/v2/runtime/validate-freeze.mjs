#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { FREEZE_GROUPS, hashTree, runtimeFingerprint } from './freeze-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const freezePath = path.join(ROOT, 'benchmarks', 'v2', 'freeze.json');
if (!fs.existsSync(freezePath)) throw new Error('Missing benchmarks/v2/freeze.json');
const frozen = JSON.parse(fs.readFileSync(freezePath, 'utf8'));
const errors = [];
const release = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmarks', 'v2', 'release.json'), 'utf8'));
if (release.status !== 'frozen') errors.push('release.status must remain frozen');
for (const [name, paths] of Object.entries(FREEZE_GROUPS)) {
  const actual = hashTree(ROOT, paths);
  if (actual.sha256 !== frozen.hashes?.[name]?.sha256) errors.push(`${name}: frozen hash mismatch`);
}
if (JSON.stringify(runtimeFingerprint()) !== JSON.stringify(frozen.runtime_environment)) errors.push('runtime_environment: version or platform mismatch');
const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', frozen.source_commit, 'HEAD'], { cwd: ROOT });
if (ancestor.status !== 0) errors.push('source_commit is not an ancestor of the current checkout');
for (const cohort of [...release.cohorts, release.model_judge].filter(Boolean)) {
  const lock = frozen.model_locks?.[cohort.id];
  if (!cohort.resolved_model || lock?.resolved_model !== cohort.resolved_model) errors.push(`${cohort.id}: frozen model identity mismatch`);
  if (lock?.requested_model !== (cohort.model || cohort.model_alias)) errors.push(`${cohort.id}: frozen requested model mismatch`);
}
if (errors.length) throw new Error(errors.join('\n'));
console.log(`freeze valid for source commit ${frozen.source_commit}`);
