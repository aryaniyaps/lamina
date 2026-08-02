#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';
import { parseDaemonLock, runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';
import { removeTemporaryTree, throwLifecycleErrors } from './test-util.mjs';

const cli = path.resolve('packages/cli/bin/lamina.mjs');

export async function exerciseGreenfieldCli({ afterGraphStatus = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-greenfield-'));
  let daemonPid = null;
  let graphStatusCompleted = false;
  let primaryError = null;
  const run = (args) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root });
    fs.writeFileSync(path.join(root, 'README.md'), '# Greenfield\n');
    const doctor = run(['doctor', '--json']);
    assert.equal(doctor.git.is_project, true);
    assert.equal(doctor.git.unborn, true);
    assert.equal(doctor.git.branch, 'main');
    assert.equal(doctor.git.revision, null);
    assert.match(doctor.git.source_revision, /^unborn:tree_/);
    assert.notEqual(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root }).status, 0);

    const status = run(['graph', 'status']);
    assert.equal(status.branch, 'main');
    graphStatusCompleted = true;
    await afterGraphStatus?.({ root });
    daemonPid = parseDaemonLock(fs.readFileSync(
      path.join(root, '.git', 'lamina', 'graphd.lock'), 'utf8',
    ))?.pid;
    assert.ok(daemonPid, 'graph status must immediately yield a captured cleanup identity');
    const session = run(['session', 'start']);
    const published = run(['session', 'publish', session.id]);
    assert.ok(published.graph_version);
    assert.notEqual(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root }).status, 0);
  } catch (error) {
    primaryError = error;
  } finally {
    let identityError = null;
    if (graphStatusCompleted && !daemonPid) {
      try {
        daemonPid = parseDaemonLock(fs.readFileSync(
          path.join(root, '.git', 'lamina', 'graphd.lock'), 'utf8',
        ))?.pid;
      } catch (error) { identityError = error; }
    }
    let stopError = null;
    if (daemonPid) {
      try { await stopIncompatibleServer(runtimePaths(root), daemonPid); }
      catch (error) { stopError = error; }
    }
    let removeError = null;
    try { removeTemporaryTree(root); } catch (error) { removeError = error; }
    throwLifecycleErrors(primaryError, [identityError, stopError, removeError], 'greenfield CLI lifecycle');
  }
}

async function main() {
  await exerciseGreenfieldCli();
  let capturedPid = null;
  await assert.rejects(
    exerciseGreenfieldCli({ afterGraphStatus: ({ root }) => {
      capturedPid = parseDaemonLock(fs.readFileSync(
        path.join(root, '.git', 'lamina', 'graphd.lock'), 'utf8',
      ))?.pid;
      throw new Error('injected failure immediately after graph status');
    } }),
    /injected failure immediately after graph status/,
  );
  assert.ok(capturedPid);
  assert.throws(() => process.kill(capturedPid, 0),
    'the immediately captured graphd identity is stopped on an intervening failure');
  console.log('greenfield_cli_test: ok');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
