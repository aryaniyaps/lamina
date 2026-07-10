#!/usr/bin/env node
/**
 * Vendor full Vercel Commerce tree into evals/fixtures/_base/nextjs-commerce/.
 * Usage: node evals/scripts/vendor-nextjs-fixture.mjs [--ref main]
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { parseRefArg, vendorFixture } from './vendor-fixture-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'evals/fixtures/_base/nextjs-commerce');
const ref = parseRefArg(process.argv, 'main');

vendorFixture({
  root: ROOT,
  repoUrl: 'https://github.com/vercel/commerce.git',
  repoSlug: 'vercel/commerce',
  outDir: OUT,
  ref,
  licenseNote: 'License: MIT (see license.md or LICENSE in this directory)',
  cloneSubdir: 'commerce',
});
