#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  graphRequest,
  stopIncompatibleServer,
} from '../packages/cli/lib/graph-runtime/client.mjs';
import {
  parseDaemonLock,
  runtimePaths,
} from '../packages/cli/lib/graph-runtime/util.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-worktree-'));
const root = path.join(base, 'primary');
const worktree = path.join(base, 'feature-worktree');
fs.mkdirSync(root);
execFileSync('git', ['init', '-b', 'main'], { cwd: root });
execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
fs.writeFileSync(path.join(root, 'README.md'), '# Worktree fixture\n');
execFileSync('git', ['add', 'README.md'], { cwd: root });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });
execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree], { cwd: root });

let daemonPid = null;
try {
  const primaryPaths = runtimePaths(root);
  const worktreePaths = runtimePaths(worktree);
  assert.equal(worktreePaths.common, primaryPaths.common);
  assert.equal(worktreePaths.runtime_dir, primaryPaths.runtime_dir);
  assert.equal(worktreePaths.database, primaryPaths.database);

  const primary = await graphRequest('status', {}, root);
  const feature = await graphRequest('status', {}, worktree);
  assert.equal(primary.branch, 'main');
  assert.equal(feature.branch, 'feature');
  assert.equal(primary.database, feature.database);
  daemonPid = parseDaemonLock(fs.readFileSync(primaryPaths.lock, 'utf8'))?.pid;
} finally {
  if (daemonPid) {
    try { await stopIncompatibleServer(runtimePaths(root), daemonPid); } catch {}
  }
  fs.rmSync(base, { recursive: true, force: true });
}

console.log('graphd_worktree_test: ok');
