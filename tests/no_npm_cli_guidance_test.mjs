#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const publicFiles = [
  'README.md', 'packages/cli/README.md', 'docs/content/index.mdx',
  'docs/content/getting-started/quickstart.mdx', 'docs/content/getting-started/installation.mdx',
  'docs/content/getting-started/troubleshooting.mdx', 'docs/lib/site-data.mjs',
  'skills/lamina-orchestrator/prerequisites/cli-required.md', 'skills/lamina-orchestrator/SKILL.md',
];
for (const file of publicFiles) {
  let text = fs.readFileSync(path.resolve(file), 'utf8');
  // A clearly labelled one-time legacy removal is permitted; it is not an
  // installation surface.
  text = text.replace(/npm uninstall -g @laminadev\/cli/g, 'legacy removal');
  assert.doesNotMatch(text, /npm install(?:\s+-g|\s+--global).*lamina|@laminadev\/cli|lamina-cli\.tgz/i, `${file} retains npm CLI installation guidance`);
}
console.log('no_npm_cli_guidance_test: ok');
