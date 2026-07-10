#!/usr/bin/env node
/**
 * Vendor full Outline tree into evals/fixtures/_base/outline/.
 * Usage: node evals/scripts/vendor-outline-fixture.mjs [--ref main]
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { parseRefArg, vendorFixture } from './vendor-fixture-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'evals/fixtures/_base/outline');
const ref = parseRefArg(process.argv, 'main');

vendorFixture({
  root: ROOT,
  repoUrl: 'https://github.com/outline/outline.git',
  repoSlug: 'outline/outline',
  outDir: OUT,
  ref,
  licenseNote: 'License: Business Source License 1.1 (see LICENSE in this directory)',
  cloneSubdir: 'outline',
});
