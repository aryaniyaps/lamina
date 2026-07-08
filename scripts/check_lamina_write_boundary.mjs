#!/usr/bin/env node
/**
 * Check that a Lamina command did not write outside `.lamina/`.
 * Usage:
 *   node scripts/check_lamina_write_boundary.mjs --pre pre-state.json --post post-state.json
 *   node scripts/check_lamina_write_boundary.mjs --workspace /path/to/workspace  # compares cwd snapshot (testing)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkWriteBoundary } from '../evals/lib/lamina-write-boundary.mjs';
import { writeState } from '../evals/scripts/workspace-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = { pre: null, post: null, workspace: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--pre' && argv[i + 1]) opts.pre = argv[++i];
    else if (argv[i] === '--post' && argv[i + 1]) opts.post = argv[++i];
    else if (argv[i] === '--workspace' && argv[i + 1]) opts.workspace = argv[++i];
  }
  return opts;
}

function readState(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function main() {
  const opts = parseArgs(process.argv);

  if (!opts.pre || !opts.post) {
    console.error(
      'Usage: node scripts/check_lamina_write_boundary.mjs --pre <pre-state.json> --post <post-state.json>',
    );
    process.exit(2);
  }

  const preState = readState(opts.pre);
  const postState = readState(opts.post);
  const workspace = opts.workspace ?? process.cwd();
  const result = checkWriteBoundary(preState, postState, workspace);

  if (result.ok) {
    console.log('OK: no writes outside .lamina/');
    process.exit(0);
  }

  console.error('FAIL: writes outside .lamina/ detected:');
  for (const v of result.violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}

export { writeState };
