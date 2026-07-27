#!/usr/bin/env node
import fs from 'node:fs';

const metadata = JSON.parse(
  fs.readFileSync(new URL('../packages/cli/package.json', import.meta.url), 'utf8'),
);
const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const expected = `cli-v${metadata.version}`;

if (tag !== expected) {
  process.stderr.write(
    `Release tag ${JSON.stringify(tag)} does not match package version tag ${expected}.\n`,
  );
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  tag,
  package: metadata.name,
  version: metadata.version,
}, null, 2)}\n`);
