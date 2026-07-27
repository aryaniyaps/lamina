#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runtimePaths } from '../skills/lamina-orchestrator/lib/graph-runtime/util.mjs';
import { gradeAssertion } from '../evals/hooks/grade-lamina.mjs';

const root = path.resolve('.');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-eval-runtime-'));
const env = {
  ...process.env,
  ASE_WORKSPACE_PATH: workspace,
  ASE_AGENT: 'codex',
  ASE_EVAL_ID: 'router-concept-01',
  PATH: `${path.join(root, 'evals/bin')}:${process.env.PATH || ''}`,
};

try {
  let result = spawnSync('bash', [path.join(root, 'evals/hooks/install-all-skills.sh')], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = spawnSync('bash', [path.join(root, 'evals/hooks/pre-run-eval.sh')], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = spawnSync('lamina', ['graph', 'status'], { cwd: workspace, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const status = JSON.parse(result.stdout);
  assert.equal(status.branch, 'main');
  assert.match(status.graph_version, /^version_/);
  assert.ok(status.source_revision);

  const input = path.join(workspace, 'product.json');
  fs.writeFileSync(input, JSON.stringify({
    id: 'product.eval',
    kind: 'product',
    data: { name: 'Eval product' },
  }));
  result = spawnSync('lamina', ['session', 'start'], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const session = JSON.parse(result.stdout).id;
  result = spawnSync('lamina', [
    'graph', 'propose', 'resource.add', '--input', input, '--session', session,
  ], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const stagedOutput = result.stdout;
  result = spawnSync('lamina', ['graph', 'query', '--at', session, '--kind', 'product'], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(result.stdout).resources[0].id, 'product.eval');
  result = spawnSync('lamina', ['session', 'publish', session], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const mutationOutput = [
    `lamina graph propose resource.add --input product.json --session ${session}`,
    stagedOutput,
    `lamina session publish ${session}`,
    result.stdout,
  ].join('\n');
  const snapshot = { files: [], tracked_files: [], file_hashes: {} };
  const grade = gradeAssertion('transactional graph workflow', {
    output: mutationOutput,
    workspace,
    preState: snapshot,
    postState: snapshot,
    logs: '',
    evalMeta: {},
    turnOutputs: [],
  });
  assert.equal(grade.passed, true, grade.evidence);
} finally {
  try {
    const paths = runtimePaths(workspace);
    const pid = Number(fs.readFileSync(paths.lock, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 1) process.kill(pid, 'SIGTERM');
  } catch {}
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log('eval_graph_runtime_install_test: ok');
