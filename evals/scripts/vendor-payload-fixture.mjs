#!/usr/bin/env node
/**
 * Vendor the Payload reusable-content example into evals/fixtures/_base/payload-website/.
 * Usage: node evals/scripts/vendor-payload-fixture.mjs [--ref main]
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { parseRefArg, vendorFixture } from './vendor-fixture-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'evals/fixtures/_base/payload-website');
const ref = parseRefArg(process.argv, 'main');

vendorFixture({
  root: ROOT,
  repoUrl: 'https://github.com/payloadcms/reusable-content-example.git',
  repoSlug: 'payloadcms/reusable-content-example',
  outDir: OUT,
  ref,
  licenseNote: 'License: MIT (see LICENSE in this directory)',
  cloneSubdir: 'reusable-content-example',
});
