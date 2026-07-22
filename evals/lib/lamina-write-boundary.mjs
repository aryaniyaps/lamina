#!/usr/bin/env node
/**
 * Lamina write boundary — allowlist-based diff for eval and CI.
 * Only `.lamina/` is writable during Lamina commands; everything else is read-only.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

/** True when path is under `.lamina/` (the only writable zone during Lamina commands). */
export function isLaminaArtifactPath(relPath) {
  const norm = normalizePath(relPath);
  return norm === '.lamina' || norm.startsWith('.lamina/');
}

/** Agent harness / skill install noise — ignore for write-boundary grading. */
export function isAgentHarnessPath(relPath) {
  const norm = normalizePath(relPath);
  const roots = ['.opencode/', '.codex/', '.claude/', '.agents/', '.cursor/'];
  return roots.some((r) => norm === r.slice(0, -1) || norm.startsWith(r));
}

export function hashFileContent(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Build a map of relative path → sha256 for all files under workspace.
 * @param {string} workspace
 * @param {(rel: string) => boolean} [include] optional filter (default: all files)
 */
export function buildFileHashMap(workspace, include = () => true) {
  const hashes = {};
  for (const rel of listWorkspaceFiles(workspace)) {
    if (!include(rel)) continue;
    const hash = hashFileContent(path.join(workspace, rel));
    if (hash) hashes[rel] = hash;
  }
  return hashes;
}

function listWorkspaceFiles(workspace, prefix = '') {
  const results = [];
  if (!fs.existsSync(workspace)) return results;
  for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(workspace, entry.name);
    if (entry.isDirectory()) {
      results.push(...listWorkspaceFiles(abs, rel));
    } else {
      results.push(normalizePath(rel));
    }
  }
  return results;
}

/**
 * Diff pre/post workspace states. Returns paths outside `.lamina/` that were created or modified.
 * @param {{ files?: string[], file_hashes?: Record<string,string> }} preState
 * @param {{ files?: string[], file_hashes?: Record<string,string> }} postState
 * @param {string} [workspace] required when state lacks file_hashes (legacy file-list only)
 */
export function diffOutsideLamina(preState, postState, workspace = '') {
  const preHashes = preState?.file_hashes ?? {};
  const postHashes = postState?.file_hashes ?? {};

  const hasHashes = Object.keys(preHashes).length > 0 || Object.keys(postHashes).length > 0;

  if (hasHashes) {
    const allPaths = new Set([...Object.keys(preHashes), ...Object.keys(postHashes)]);
    const changed = [];
    for (const rel of allPaths) {
      if (isLaminaArtifactPath(rel) || isAgentHarnessPath(rel)) continue;
      const pre = preHashes[rel];
      const post = postHashes[rel];
      if (pre !== post) changed.push(rel);
    }
    return changed;
  }

  // Legacy: file-list only — detect new files outside .lamina/
  const pre = new Set((preState?.files ?? preState?.tracked_files ?? []).map(normalizePath));
  const post = new Set((postState?.files ?? postState?.tracked_files ?? []).map(normalizePath));
  const added = [];
  for (const f of post) {
    if (!pre.has(f) && !isLaminaArtifactPath(f) && !isAgentHarnessPath(f)) added.push(f);
  }

  // Without hashes we cannot detect modifications — caller should use file_hashes snapshots
  if (workspace && added.length === 0) {
    const livePre = buildFileHashMap(workspace);
    const livePost = buildFileHashMap(workspace);
    return diffOutsideLamina({ file_hashes: livePre }, { file_hashes: livePost });
  }

  return added;
}

/**
 * Check pre/post state; returns { ok, violations }.
 */
export function checkWriteBoundary(preState, postState, workspace = '') {
  const violations = diffOutsideLamina(preState, postState, workspace);
  return { ok: violations.length === 0, violations };
}
