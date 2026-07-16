/**
 * Content-address the complete LaminaBench protocol and record its git state.
 * Publish runs require a clean worktree; the digest makes the exact evaluated
 * contract independently comparable even when unrelated commits differ.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const PROTOCOL_PATHS = [
  'benchmarks/release.yaml',
  'benchmarks/methodology.json',
  'benchmarks/harbor/registry.yaml',
  'benchmarks/harbor/tasks',
  'benchmarks/harbor/verifier',
  'benchmarks/goldens',
  'benchmarks/fixtures',
  'benchmarks/scripts',
  'evals/fixtures',
  'skills',
];

function git(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: args.includes('-z') ? null : 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

export function benchmarkProtocolSha256() {
  const output = git(['ls-files', '-z', '--', ...PROTOCOL_PATHS]);
  const files = output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((rel) => !rel.startsWith('benchmarks/results/'))
    .sort();
  const digest = createHash('sha256');
  for (const rel of files) {
    const absolute = path.join(ROOT, rel);
    digest.update(rel);
    digest.update('\0');
    if (!fs.existsSync(absolute)) {
      digest.update('deleted');
      digest.update('\0');
      continue;
    }
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      digest.update(`symlink:${fs.readlinkSync(absolute)}`);
    } else if (stat.isDirectory()) {
      // Git submodules are represented by a tracked gitlink directory.
      digest.update(`gitlink:${String(git(['ls-files', '--stage', '--', rel])).trim()}`);
    } else {
      digest.update(fs.readFileSync(absolute));
    }
    digest.update('\0');
  }
  return { sha256: digest.digest('hex'), file_count: files.length };
}

export function benchmarkProvenance() {
  const commit = String(git(['rev-parse', 'HEAD'])).trim();
  const trackedDirty = String(git(['status', '--porcelain', '--untracked-files=no']))
    .split('\n')
    .filter(Boolean);
  const protocolUntracked = String(
    git(['status', '--porcelain', '--untracked-files=all', '--', ...PROTOCOL_PATHS])
  )
    .split('\n')
    .filter((line) => line.startsWith('?? '));
  const dirty = [...new Set([...trackedDirty, ...protocolUntracked])];
  const protocol = benchmarkProtocolSha256();
  return {
    git_commit: commit,
    worktree_clean: dirty.length === 0,
    dirty_tracked_files: dirty,
    protocol_sha256: protocol.sha256,
    protocol_file_count: protocol.file_count,
  };
}

export function assertPublishableWorktree(provenance) {
  if (!provenance.worktree_clean) {
    throw new Error(
      `Publish runs require a clean benchmark worktree; found: ${provenance.dirty_tracked_files.join(', ')}`
    );
  }
}
