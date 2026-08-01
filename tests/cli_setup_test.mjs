#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const cli = path.resolve('packages/cli/bin/lamina.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-cli-setup-'));

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

try {
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Existing Codex rules\n');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Existing Claude Code rules\n');

  for (const [agent, relative] of [
    ['codex', 'AGENTS.md'],
    ['claude-code', 'CLAUDE.md'],
    ['opencode', 'AGENTS.md'],
    ['cursor', path.join('.cursor', 'rules', 'lamina.mdc')],
  ]) {
    const installed = run(['setup', '--agent', agent]);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    assert.equal(JSON.parse(installed.stdout).installed, true);
    const target = path.join(root, relative);
    assert.match(fs.readFileSync(target, 'utf8'), /lamina:managed-agent-rules:start/);

    const rerun = run(['setup', '--agent', agent]);
    assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
    assert.equal(
      fs.readFileSync(target, 'utf8').match(/lamina:managed-agent-rules:start/g).length,
      1,
      `${agent} setup must be idempotent`,
    );

    const checked = run(['setup', '--agent', agent, '--check']);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    assert.equal(JSON.parse(checked.stdout).installed, true);

    const removed = run(['setup', '--agent', agent, '--remove']);
    assert.equal(removed.status, 0, removed.stderr || removed.stdout);
    assert.equal(JSON.parse(removed.stdout).removed, true);
    if (agent === 'cursor') assert.equal(fs.existsSync(target), false);
    else assert.doesNotMatch(fs.readFileSync(target, 'utf8'), /lamina:managed-agent-rules:start/);
  }

  const invalid = run(['setup', '--agent', 'not-an-agent']);
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stderr).error.code, 'LAMINA_BAD_REQUEST');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('cli_setup_test: ok');
