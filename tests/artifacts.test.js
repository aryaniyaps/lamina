import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ARTIFACT_FILES, initArtifacts } from '../src/artifacts.js';

test('initArtifacts creates the complete .lamina artifact set', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-artifacts-'));
  try {
    const result = await initArtifacts(root, {
      now: '2026-07-03T00:00:00.000Z',
      sessionId: 'lamina_test',
    });

    for (const file of ARTIFACT_FILES) {
      assert.equal(existsSync(join(root, '.lamina', file)), true, `${file} should exist`);
    }

    assert.deepEqual(result.existing, []);
    assert.equal(result.created.includes('implementation-tasks.md'), true);

    const tasks = await readFile(join(root, '.lamina', 'implementation-tasks.md'), 'utf8');
    assert.match(tasks, /artifact: implementation-tasks/);
    assert.match(tasks, /# Implementation Tasks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('initArtifacts is idempotent and does not overwrite existing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-artifacts-'));
  try {
    await initArtifacts(root, {
      now: '2026-07-03T00:00:00.000Z',
      sessionId: 'lamina_test',
    });
    await writeFile(join(root, '.lamina', 'decisions.md'), 'keep me');

    const result = await initArtifacts(root, {
      now: '2026-07-03T00:00:00.000Z',
      sessionId: 'lamina_test',
    });

    assert.equal(await readFile(join(root, '.lamina', 'decisions.md'), 'utf8'), 'keep me');
    assert.equal(result.existing.includes('decisions.md'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
