import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/cli.js';

function captureIo(cwd) {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      cwd: () => cwd,
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: (text) => { stderr += text; } },
    },
    output: () => ({ stdout, stderr }),
  };
}

test('lamina tasks prints implementation task artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-tasks-'));
  try {
    await mkdir(join(root, '.lamina'), { recursive: true });
    await writeFile(join(root, '.lamina', 'implementation-tasks.md'), '# Implementation Tasks\n\n## P0 Tasks\n');
    const { io, output } = captureIo(root);
    const code = await runCli(['tasks'], io);
    assert.equal(code, 0);
    assert.match(output().stdout, /# Implementation Tasks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lamina tasks returns code 1 when tasks artifact is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-tasks-missing-'));
  try {
    const { io, output } = captureIo(root);
    const code = await runCli(['tasks'], io);
    assert.equal(code, 1);
    assert.match(output().stderr, /Run `lamina init` or `lamina start` first/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lamina doctor reports setup status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-doctor-'));
  try {
    const { io, output } = captureIo(root);
    const code = await runCli(['doctor'], io);
    assert.equal(code, 0);
    assert.match(output().stdout, /Lamina doctor/);
    assert.match(output().stdout, /.lamina artifacts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
