#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphRequest, stopIncompatibleServer } from '../packages/cli/lib/graph-runtime/client.mjs';
import { runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';
import {
  ensureRetrieval,
  queryRetrieval,
} from '../packages/cli/lib/retrieval-runtime/process.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-retrieval-sync-'));
process.env.LAMINA_TEST_RETRIEVAL_EMBEDDER = 'deterministic';
process.env.LAMINA_TEST_RETRIEVAL_NO_EXTENSIONS = '1';

try {
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
  fs.writeFileSync(path.join(root, 'README.md'), '# Retrieval lifecycle fixture\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(
    path.join(root, 'src', 'schedule.ts'),
    'export function saveSchedule() { return "saved"; }\n',
  );
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });

  const graphBefore = await graphRequest('status', {}, root);
  const first = await ensureRetrieval(root, { force: true });
  assert.equal(first.status.fresh, true);
  assert.equal(first.status.counts.source_chunks, 2);
  const firstGeneration = first.status.generation;
  const firstQuery = await queryRetrieval('save schedule implementation', first, root);
  assert.equal(firstQuery.source_chunks[0].file, 'src/schedule.ts');
  assert.equal(firstQuery.source_chunks[0].symbol, 'saveSchedule');

  const oversized = [
    'export function rebuildSchedule() {\n',
    ...Array.from({ length: 300 }, (_, index) => `  const value${index} = ${index};\n`),
    '  return value299;\n',
    '}\n',
  ].join('');
  fs.renameSync(
    path.join(root, 'src', 'schedule.ts'),
    path.join(root, 'src', 'planner.ts'),
  );
  fs.writeFileSync(path.join(root, 'src', 'planner.ts'), oversized);
  const second = await ensureRetrieval(root);
  assert.notEqual(second.status.generation, firstGeneration);
  assert.equal(second.status.counts.source_chunks, 3,
    'oversized symbols must split deterministically into bounded chunks');
  const secondQuery = await queryRetrieval('rebuild schedule value299', second, root);
  assert.ok(secondQuery.source_chunks.some((item) =>
    item.file === 'src/planner.ts' && item.symbol === 'rebuildSchedule'));
  assert.equal(secondQuery.source_chunks.filter((item) =>
    item.file === 'src/planner.ts' && item.symbol === 'rebuildSchedule').length, 1,
  'overlapping chunks from one symbol must be deduplicated');
  assert.ok(secondQuery.source_chunks.every((item) => item.file !== 'src/schedule.ts'),
    'renamed source paths must not survive in the active generation');

  fs.rmSync(path.join(root, 'src', 'planner.ts'));
  const third = await ensureRetrieval(root);
  assert.equal(third.status.counts.source_chunks, 1);
  const thirdQuery = await queryRetrieval('rebuild schedule value299', third, root);
  assert.ok(thirdQuery.source_chunks.every((item) => item.file !== 'src/planner.ts'),
    'deleted source chunks must not be reported as current');

  const graphAfter = await graphRequest('status', {}, root);
  assert.equal(graphAfter.graph_version, graphBefore.graph_version,
    'retrieval generations must never mutate the canonical graph');
} finally {
  try { await stopIncompatibleServer(runtimePaths(root)); } catch {}
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  delete process.env.LAMINA_TEST_RETRIEVAL_EMBEDDER;
  delete process.env.LAMINA_TEST_RETRIEVAL_NO_EXTENSIONS;
}

console.log('retrieval_sync_test: ok');
