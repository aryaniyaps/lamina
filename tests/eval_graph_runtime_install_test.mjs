#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseDaemonLock,
  runtimePaths,
} from '../packages/cli/lib/graph-runtime/util.mjs';
import { stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';
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
  assert.match(
    fs.readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8'),
    /lamina work prepare/,
    'eval treatment must install the same passive provider rule as real setup',
  );
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

  // CLI + skills state: exercise the init evidence, design transaction, and
  // isolated verify Mission lifecycle through the independent source CLI.
  fs.mkdirSync(path.join(workspace, '.lamina'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, '.lamina', 'business-context.md'),
    '# Problem statement\nEval product\n',
  );
  fs.writeFileSync(
    path.join(workspace, '.lamina', 'personas.json'),
    JSON.stringify([{ id: 'persona.owner', name: 'Owner' }]),
  );
  const designInputs = {
    'persona.json': {
      id: 'persona.owner',
      kind: 'persona',
      data: { name: 'Owner' },
    },
    'operation.json': {
      id: 'operation.checkout',
      kind: 'operation',
      data: { name: 'Checkout' },
    },
    'workflow.json': {
      id: 'workflow.checkout',
      kind: 'workflow',
      data: { name: 'Checkout' },
    },
    'step.json': {
      subject: 'workflow.checkout',
      predicate: 'lamina:hasStep',
      object: 'operation.checkout',
      qualifiers: { position: 1 },
    },
  };
  for (const [name, value] of Object.entries(designInputs)) {
    fs.writeFileSync(path.join(workspace, name), JSON.stringify(value));
  }
  const eventsPath = path.join(workspace, 'events.json');
  fs.writeFileSync(eventsPath, JSON.stringify([
    { type: 'action_attempted' },
    { type: 'oracle_passed' },
  ]));

  result = spawnSync('lamina', ['session', 'start'], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const designSession = JSON.parse(result.stdout).id;
  for (const name of ['persona.json', 'operation.json', 'workflow.json', 'step.json']) {
    result = spawnSync('lamina', [
      'graph',
      'propose',
      '--input',
      path.join(workspace, name),
      '--session',
      designSession,
    ], {
      cwd: workspace,
      env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  result = spawnSync('lamina', ['graph', 'validate', '--at', designSession], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).ok, true);
  result = spawnSync('lamina', ['session', 'publish', designSession], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = spawnSync('lamina', [
    'mission',
    'compile',
    '--workflow',
    'workflow.checkout',
  ], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const mission = JSON.parse(result.stdout).missions[0].id;
  result = spawnSync('lamina', [
    'mission',
    'run',
    mission,
    '--events',
    eventsPath,
  ], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const run = JSON.parse(result.stdout);
  result = spawnSync('lamina', ['session', 'publish', run.session], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = spawnSync('lamina', ['graph', 'query', '--kind', 'run'], {
    cwd: workspace,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(JSON.parse(result.stdout).resources.some((item) => item.id === run.run));
} finally {
  try {
    const paths = runtimePaths(workspace);
    const pid = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'))?.pid;
    if (Number.isInteger(pid) && pid > 1) await stopIncompatibleServer(paths, pid);
  } catch {}
  fs.rmSync(workspace, { recursive: true, force: true });
}

const passiveWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-eval-passive-seed-'));
const passiveEnv = {
  ...process.env,
  ASE_WORKSPACE_PATH: passiveWorkspace,
  ASE_AGENT: 'codex',
  ASE_EVAL_ID: 'passive-feature-implementation',
  PATH: `${path.join(root, 'evals/bin')}:${process.env.PATH || ''}`,
};
try {
  let result = spawnSync('bash', [path.join(root, 'evals/hooks/install-all-skills.sh')], {
    cwd: root,
    env: passiveEnv,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = spawnSync('bash', [path.join(root, 'evals/hooks/pre-run-eval.sh')], {
    cwd: root,
    env: passiveEnv,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = spawnSync('lamina', ['graph', 'query', '--kind', 'workflow'], {
    cwd: passiveWorkspace,
    env: passiveEnv,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(
    JSON.parse(result.stdout).resources.some((item) => item.id === 'workflow.eval.wishlist-sharing'),
    'passive ready eval must begin with a relevant product workflow',
  );
  const passiveWorkDir = runtimePaths(passiveWorkspace).work;
  fs.mkdirSync(passiveWorkDir, { recursive: true });
  const requestFile = path.join(passiveWorkDir, 'passive-request.txt');
  const packetFile = path.join(passiveWorkDir, 'passive-packet.json');
  fs.writeFileSync(requestFile, 'Add conflict-safe wishlist sharing to the storefront and verify it.');
  result = spawnSync('lamina', ['graph', 'status'], {
    cwd: passiveWorkspace,
    env: passiveEnv,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    JSON.parse(result.stdout).stale,
    false,
    'writing request/receipt files must not stale the seeded product graph',
  );
  result = spawnSync('lamina', [
    'work',
    'prepare',
    '--request-file',
    requestFile,
    '--output',
    packetFile,
  ], {
    cwd: passiveWorkspace,
    env: passiveEnv,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.schema, 'lamina.implementation-packet/v2');
  assert.deepEqual(packet.scope, ['workflow.eval.wishlist-sharing']);
  assert.ok(packet.experience_cases.length > 0, 'surface work must compile deterministic Experience Cases');
  result = spawnSync('lamina', [
    'mission',
    'compile',
    '--workflow',
    'wishlist-sharing',
  ], {
    cwd: passiveWorkspace,
    env: passiveEnv,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    JSON.parse(result.stdout).missions.length,
    2,
    'ready passive context must include every independently relevant Persona',
  );
  assert.ok(packet.obligations.length > 0);
} finally {
  try {
    await stopIncompatibleServer(runtimePaths(passiveWorkspace));
  } catch {}
  fs.rmSync(passiveWorkspace, { recursive: true, force: true });
}

console.log('eval_graph_runtime_install_test: ok');
