import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

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
  protocol: ['benchmarks/v2/protocol', 'benchmarks/v2/schemas'],
  runtime: ['benchmarks/v2/runtime'],
  scoring: ['benchmarks/v2/scoring'],
  model_locks: ['benchmarks/v2/model-locks'],
  release: ['benchmarks/v2/release.json', 'benchmarks/v2/corpus/manifest.json'],
});

export function runtimeFingerprint() {
  const version = (command, args = ['--version']) => {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Cannot resolve ${command} version`);
    return `${result.stdout || result.stderr}`.trim().split('\n')[0];
  };
  return { node: process.version, platform: process.platform, arch: process.arch, codex: version('codex'), claude: version('claude') };
}
