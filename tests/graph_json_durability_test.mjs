#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GraphEngine } from '../packages/cli/lib/graph-runtime/engine.mjs';
import { repositoryContext, runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-graph-json-durability-'));
const restoredRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-graph-restore-durability-'));

try {
  for (const fixture of [root, restoredRoot]) {
    execFileSync('git', ['init', '-b', 'main'], { cwd: fixture });
    execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: fixture });
    execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: fixture });
    fs.writeFileSync(path.join(fixture, 'README.md'), '# JSON durability fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: fixture });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: fixture });
  }

  const context = repositoryContext(root);
  const paths = runtimePaths(root);
  const backup = path.join(root, 'graph-backup.json');
  const expected = new Map();
  {
    const engine = new GraphEngine(paths);
    const session = engine.startSession({
      branch: context.branch,
      source_revision: context.source_revision,
    });
    for (let index = 0; index < 160; index += 1) {
      const id = `resource.durability.${String(index).padStart(3, '0')}`;
      const data = {
        name: `Durability resource ${index}`,
        description: `payload-${index}-${'x'.repeat(512)}`,
      };
      expected.set(id, { ...data, epistemic_class: 'inferred' });
      engine.stageResource(session.id, { id, kind: 'entity', data });
    }
    const published = engine.publishSession(session.id, context.source_revision);
    assert.equal(published.validation.ok, true);
    engine.backup(backup);
    engine.close();
  }

  {
    const engine = new GraphEngine(paths);
    for (const [id, data] of expected) {
      assert.deepEqual(engine.resource(id)?.data, data, `${id} JSON must survive checkpoint and reopen`);
    }
    engine.close();
  }

  const restoredPaths = runtimePaths(restoredRoot);
  {
    const engine = new GraphEngine(restoredPaths);
    const result = engine.restore(backup);
    assert.equal(result.resources, expected.size);
    assert.equal(
      fs.existsSync(`${restoredPaths.database}.wal`),
      false,
      'an acknowledged restore must be checkpointed rather than depend on WAL replay',
    );
    for (const [id, data] of expected) {
      assert.deepEqual(engine.resource(id)?.data, data, `${id} restored JSON must remain readable`);
    }
    engine.close();
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(restoredRoot, { recursive: true, force: true });
}

console.log('graph_json_durability_test: ok');
