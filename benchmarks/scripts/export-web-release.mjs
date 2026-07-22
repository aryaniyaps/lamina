#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultPaths,
  exportWebRelease,
  resolveRepoRoot,
  validateWebRelease,
} from '../lib/web-release.mjs';

const ROOT = resolveRepoRoot(import.meta.url);
const defaults = defaultPaths(ROOT);

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const manifestPath = path.resolve(readFlag('--manifest', defaults.manifest));
const outPath = path.resolve(readFlag('--out', defaults.output));

try {
  const { release, protocolFileCount } = exportWebRelease({ root: ROOT, manifestPath, outPath });
  const errors = validateWebRelease(release, { expectedStatus: release.status });
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(
    `Exported ${release.status} release ${release.releaseKey} → ${path.relative(ROOT, outPath)} (${protocolFileCount} protocol files)`
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
