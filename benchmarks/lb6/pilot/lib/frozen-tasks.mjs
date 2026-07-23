import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PILOT_ARMS } from './constants.mjs';

export function parseSelectedTaskIds(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--tasks');
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value) throw new Error('--tasks requires a comma-separated task id list');
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function parseMigrateFrozen(argv = process.argv.slice(2)) {
  return argv.includes('--migrate-frozen');
}

export function publishedFrozenTaskIds(manifest) {
  return [...(manifest.pilot?.published_frozen_task_ids || manifest.published_frozen_task_ids || [])];
}

export function assertBuildSelectionAllowed(selectedTaskIds, manifest, { migrateFrozen = false } = {}) {
  const frozen = new Set(publishedFrozenTaskIds(manifest));
  const blocked = selectedTaskIds.filter((taskId) => frozen.has(taskId));
  if (blocked.length && !migrateFrozen) {
    throw new Error(
      `refusing to build published frozen task(s) without --migrate-frozen: ${blocked.join(', ')}`,
    );
  }
}

export function assertCampaignSelectionAllowed(selectedTaskIds, manifest) {
  assertBuildSelectionAllowed(selectedTaskIds, manifest, { migrateFrozen: false });
}

function listFilesRecursive(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFilesRecursive(full, out);
    else out.push(full);
  }
  return out;
}

export function listFrozenArtifactRelPaths(root, manifest) {
  const relPaths = [];
  for (const taskId of publishedFrozenTaskIds(manifest)) {
    for (const arm of PILOT_ARMS) {
      const taskDir = path.join(root, 'benchmarks/lb6/pilot/harbor/tasks', `${taskId}-${arm}`);
      for (const file of listFilesRecursive(taskDir)) {
        relPaths.push(path.relative(root, file).replaceAll('\\', '/'));
      }
    }
    const privateDir = path.join(root, 'benchmarks/lb6/pilot/private-verifier', taskId);
    for (const file of listFilesRecursive(privateDir)) {
      relPaths.push(path.relative(root, file).replaceAll('\\', '/'));
    }
  }
  relPaths.push('benchmarks/lb6/pilot/publication/publication-result.json');
  return [...new Set(relPaths)].sort();
}

export function snapshotFrozenArtifacts(root, manifest) {
  return new Map(
    listFrozenArtifactRelPaths(root, manifest).map((rel) => [rel, fs.readFileSync(path.join(root, rel))]),
  );
}

export function assertFrozenArtifactsUnchanged(root, manifest, beforeSnapshot) {
  const after = snapshotFrozenArtifacts(root, manifest);
  assertSnapshotsEqual(beforeSnapshot, after, root);
}

export function assertSnapshotsEqual(beforeSnapshot, afterSnapshot, root = '') {
  for (const [rel, beforeBytes] of beforeSnapshot) {
    const afterBytes = afterSnapshot.get(rel);
    if (!afterBytes) {
      throw new Error(`frozen artifact missing after operation: ${rel}`);
    }
    if (!beforeBytes.equals(afterBytes)) {
      throw new Error(`frozen artifact drifted: ${rel}`);
    }
  }
  if (afterSnapshot.size !== beforeSnapshot.size) {
    throw new Error('frozen artifact path set changed');
  }
}

export function frozenPathsMatchHead(root, manifest) {
  for (const rel of listFrozenArtifactRelPaths(root, manifest)) {
    const head = spawnSync('git', ['show', `HEAD:${rel}`], { cwd: root, encoding: 'buffer' });
    if (head.status !== 0) continue;
    const current = fs.readFileSync(path.join(root, rel));
    if (!head.stdout.equals(current)) return false;
  }
  return true;
}
