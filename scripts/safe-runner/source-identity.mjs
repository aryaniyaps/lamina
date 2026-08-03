import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnTrustedGit } from './git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function runnerBuildDigest() {
  const hash = crypto.createHash('sha256');
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:mjs|json|sh)$/.test(entry.name)) {
        hash.update(path.relative(HERE, absolute)).update(fs.readFileSync(absolute));
      }
    }
  };
  visit(HERE);
  const graphdClient = path.resolve(HERE, '../../packages/cli/lib/graph-runtime/client.mjs');
  hash.update('packages/cli/lib/graph-runtime/client.mjs').update(fs.readFileSync(graphdClient));
  for (const name of ['safe-runner-context.mjs', 'safe-runner-broker-client.mjs']) {
    const safeRunnerClient = path.resolve(HERE, '../../packages/cli/lib', name);
    hash.update(`packages/cli/lib/${name}`).update(fs.readFileSync(safeRunnerClient));
  }
  const adversary = path.resolve(HERE, '../../tests/fixtures/safe-runner-adversary.mjs');
  hash.update('tests/fixtures/safe-runner-adversary.mjs').update(fs.readFileSync(adversary));
  const controller = path.resolve(HERE, '../../tests/fixtures/safe-runner-controller.mjs');
  hash.update('tests/fixtures/safe-runner-controller.mjs').update(fs.readFileSync(controller));
  return hash.digest('hex');
}

export function repositorySourceDigest(cwd, {
  maxUntrackedBytes = 64 * 1024 * 1024,
  maxUntrackedFiles = 4_096,
} = {}) {
  const root = spawnTrustedGit(cwd, ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3_000, maxBuffer: 64 * 1024,
  });
  if (root.status !== 0 || !String(root.stdout || '').trim()) return null;
  const repository = String(root.stdout).trim();
  const tree = spawnTrustedGit(repository, ['rev-parse', 'HEAD^{tree}'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3_000,
    maxBuffer: 64 * 1024,
  });
  const changes = spawnTrustedGit(repository,
    ['diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--', '.'], {
      encoding: null, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  const untracked = spawnTrustedGit(repository,
    ['ls-files', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  if (tree.status !== 0 || changes.status !== 0 || untracked.status !== 0) return null;
  const hash = crypto.createHash('sha256')
    .update(String(tree.stdout || '').trim())
    .update(changes.stdout || Buffer.alloc(0));
  const untrackedFiles = String(untracked.stdout || '').split('\0').filter(Boolean).sort();
  if (untrackedFiles.length > maxUntrackedFiles) {
    const error = new Error('untracked source file count exceeds the bounded identity budget');
    error.code = 'LAMINA_SAFE_SOURCE_IDENTITY';
    throw error;
  }
  let untrackedBytes = 0n;
  for (const relative of untrackedFiles) {
    const absolute = path.join(repository, relative);
    try {
      const stat = fs.statSync(absolute, { bigint: true });
      if (!stat.isFile()) continue;
      untrackedBytes += stat.size;
      if (untrackedBytes > BigInt(maxUntrackedBytes)) {
        const error = new Error('untracked source bytes exceed the bounded identity budget');
        error.code = 'LAMINA_SAFE_SOURCE_IDENTITY';
        throw error;
      }
      hash.update(relative).update(String(stat.size));
      const descriptor = fs.openSync(absolute, 'r');
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        let offset = 0;
        while (offset < Number(stat.size)) {
          const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
          if (bytes === 0) break;
          hash.update(buffer.subarray(0, bytes));
          offset += bytes;
        }
      } finally { fs.closeSync(descriptor); }
    } catch (error) {
      if (error?.code === 'LAMINA_SAFE_SOURCE_IDENTITY') throw error;
      return null;
    }
  }
  return hash.digest('hex');
}
