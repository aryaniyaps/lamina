import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

export function hashTree(root, relativePaths) {
  const hash = createHash('sha256');
  const files = [];
  const visit = (absolute, relative) => {
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).toSorted()) visit(path.join(absolute, name), path.join(relative, name));
    } else if (stat.isFile()) files.push({ absolute, relative: relative.split(path.sep).join('/') });
  };
  for (const relative of relativePaths.toSorted()) visit(path.join(root, relative), relative);
  for (const file of files.toSorted((a, b) => a.relative.localeCompare(b.relative))) {
    hash.update(file.relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file.absolute));
    hash.update('\0');
  }
  return { sha256: hash.digest('hex'), file_count: files.length };
}

export const FREEZE_GROUPS = Object.freeze({
  skills: ['skills'],
  protocol: ['benchmarks/v2/protocol', 'benchmarks/v2/schemas', 'benchmarks/v2/METHODOLOGY.md', 'benchmarks/v2/EXECUTION_CUSTODY.md', 'benchmarks/v2/JUDGING.md', 'benchmarks/v2/HUMAN_STUDY.md', 'benchmarks/v2/corpus/AUTHORING.md'],
  runtime: ['benchmarks/v2/runtime'],
  scoring: ['benchmarks/v2/scoring'],
  model_locks: ['benchmarks/v2/model-locks'],
  release: ['benchmarks/v2/release.json', 'benchmarks/v2/corpus/manifest.json', 'benchmarks/v2/CHANGE_LEDGER.md', 'benchmarks/v2/change-ledger.jsonl'],
  shared_tooling: ['package.json', 'pnpm-lock.yaml', 'scripts/check_lamina_init.mjs', 'benchmarks/scripts/stage-bench-fixture.mjs'],
});

export function runtimeFingerprint() {
  const version = (command, args = ['--version']) => {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Cannot resolve ${command} version`);
    return `${result.stdout || result.stderr}`.trim().split('\n')[0];
  };
  const osRelease = fs.existsSync('/etc/os-release') ? Object.fromEntries(fs.readFileSync('/etc/os-release', 'utf8').split('\n').filter((line) => line.includes('=')).map((line) => {
    const [key, ...parts] = line.split('=');
    return [key, parts.join('=').replace(/^"|"$/g, '')];
  })) : {};
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    kernel: os.release(),
    os: { id: osRelease.ID || null, version_id: osRelease.VERSION_ID || null },
    codex: version('codex'),
    bubblewrap: version('bwrap'),
    docker: version('docker'),
    git: version('git'),
    npm: version('npm'),
    pnpm: version('pnpm'),
  };
}
