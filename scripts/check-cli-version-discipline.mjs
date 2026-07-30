#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const metadata = JSON.parse(fs.readFileSync('packages/cli/package.json', 'utf8'));
const tag = `cli-v${metadata.version}`;
const criticalPaths = [
  'packages/cli',
  'scripts/build-standalone-cli.mjs',
  'scripts/install.sh',
  'scripts/install.ps1',
  'tests/cli_binary_smoke_test.mjs',
  'tests/release_artifact_smoke_test.mjs',
  '.github/workflows/publish-cli.yml',
];

function git(args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

const tagLookup = git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
if (tagLookup.status !== 0) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    version: metadata.version,
    tag,
    released: false,
  }, null, 2)}\n`);
  process.exit(0);
}

const changed = git(['diff', '--name-only', tag, '--', ...criticalPaths]);
if (changed.status !== 0) {
  process.stderr.write(changed.stderr || changed.stdout);
  process.exit(changed.status || 1);
}

const files = changed.stdout.trim().split(/\r?\n/).filter(Boolean);
if (files.length > 0) {
  process.stderr.write(
    `CLI release-critical files changed after ${tag}, but packages/cli/package.json still declares ${metadata.version}.\n` +
    `Bump the CLI version before publishing or documenting the changed standalone CLI:\n${files.map((file) => `- ${file}`).join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  version: metadata.version,
  tag,
  released: true,
}, null, 2)}\n`);
