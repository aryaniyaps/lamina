#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FREEZE_GROUPS, hashTree, runtimeFingerprint } from './freeze-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const V2 = path.join(ROOT, 'benchmarks', 'v2');
const release = JSON.parse(fs.readFileSync(path.join(V2, 'release.json'), 'utf8'));
if (release.status !== 'frozen') throw new Error('Set release.status to "frozen" and commit all protocol inputs before creating freeze.json');
const locks = {};
const modelConfigs = [...release.cohorts, release.model_judge];
if (!release.model_judge?.id) throw new Error('Frozen release requires model_judge');
for (const cohort of modelConfigs) {
  const lockPath = path.join(V2, 'model-locks', `${cohort.id}.json`);
  if (!fs.existsSync(lockPath)) throw new Error(`Missing model lock: ${path.relative(ROOT, lockPath)}`);
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (!lock.resolved_model) throw new Error(`Model lock ${cohort.id} has no resolved_model`);
  const requested = cohort.model || cohort.model_alias;
  if (lock.requested_model !== requested) throw new Error(`Model lock ${cohort.id} requested_model does not match release`);
  if (!cohort.resolved_model) throw new Error(`Frozen model config ${cohort.id} must declare resolved_model in release.json`);
  if (lock.resolved_model !== cohort.resolved_model) throw new Error(`Model lock ${cohort.id} resolved_model does not match release`);
  locks[cohort.id] = lock;
}
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
if (git.status !== 0) throw new Error('Cannot resolve git commit');
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
if (dirty.status !== 0 || dirty.stdout.trim()) throw new Error('Freeze requires a clean worktree');
const hashes = Object.fromEntries(Object.entries(FREEZE_GROUPS).map(([name, paths]) => [name, hashTree(ROOT, paths)]));
const document = { protocol_version: release.protocol_version, frozen_at: new Date().toISOString(), source_commit: git.stdout.trim(), hashes, model_locks: locks, runtime_environment: runtimeFingerprint() };
fs.writeFileSync(path.join(V2, 'freeze.json'), `${JSON.stringify(document, null, 2)}\n`);
console.log('Wrote benchmarks/v2/freeze.json. Commit the freeze record without changing any frozen inputs.');
