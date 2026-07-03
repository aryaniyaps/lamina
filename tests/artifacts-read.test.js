import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readArtifacts } from '../src/artifacts.js';

test('readArtifacts returns existing artifact text and empty string for missing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-artifacts-read-'));
  try {
    await mkdir(join(root, '.lamina'), { recursive: true });
    await writeFile(join(root, '.lamina', 'insights.md'), '# Insights\n\n## Key Insights\n\n- Reuse this insight\n');
    await writeFile(join(root, '.lamina', 'decisions.md'), '# Decisions\n\n## Active Decisions\n\n- Keep invite flow single-step\n');

    const result = await readArtifacts(root);

    assert.match(result.insights, /Reuse this insight/);
    assert.match(result.decisions, /single-step/);
    assert.equal(result.requirements, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
