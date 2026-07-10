#!/usr/bin/env node
/**
 * Vendor full Plane tree into evals/fixtures/_base/plane/.
 * Usage: node evals/scripts/vendor-plane-fixture.mjs [--ref preview]
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { parseRefArg, vendorFixture } from './vendor-fixture-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'evals/fixtures/_base/plane');
const ref = parseRefArg(process.argv, 'preview');

vendorFixture({
  root: ROOT,
  repoUrl: 'https://github.com/makeplane/plane.git',
  repoSlug: 'makeplane/plane',
  outDir: OUT,
  ref,
  licenseNote: 'License: AGPL-3.0 (see LICENSE in this directory)',
  cloneSubdir: 'plane',
});
