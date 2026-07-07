#!/usr/bin/env node
/**
 * Snapshot workspace file paths for eval pre/post state diffing.
 */
import fs from 'node:fs';
import path from 'node:path';

export function listWorkspaceFiles(workspace, prefix = '') {
  const results = [];
  if (!fs.existsSync(workspace)) return results;
  for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(workspace, entry.name);
    if (entry.isDirectory()) {
      results.push(...listWorkspaceFiles(abs, rel));
    } else {
      results.push(rel.replace(/\\/g, '/'));
    }
  }
  return results;
}

export function writeState(filePath, workspace) {
  const state = { files: listWorkspaceFiles(workspace) };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n');
  return state;
}
