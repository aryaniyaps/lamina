#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CLI_PACKAGE_SIZE_CEILING = 300_000;

export const CLI_PACKAGE_FILES = Object.freeze([
  'LICENSE',
  'NOTICE',
  'README.md',
  'bin/lamina.mjs',
  'cocoindex_app.py',
  'lib/doctor.mjs',
  'lib/graph-runtime/client.mjs',
  'lib/graph-runtime/constants.mjs',
  'lib/graph-runtime/engine.mjs',
  'lib/graph-runtime/server.mjs',
  'lib/graph-runtime/util.mjs',
  'lib/observe.mjs',
  'package.json',
  'pyproject.toml',
  'uv.lock',
]);

const FORBIDDEN_SEGMENTS = new Set([
  'skills',
  'benchmarks',
  'fixtures',
  'docs',
  'tests',
  '.github',
  'scripts',
  'evals',
]);

export function auditPackReport(
  report,
  { requireExecutable = process.platform !== 'win32' } = {},
) {
  const entries = Array.isArray(report)
    ? report
    : report?.name
      ? [report]
      : Object.values(report || {});
  const entry = entries[0];
  if (!entry || entry.name !== '@laminadev/cli') {
    throw new Error('npm pack report is not for @laminadev/cli.');
  }
  if (Number(entry.unpackedSize) > CLI_PACKAGE_SIZE_CEILING) {
    throw new Error(
      `CLI package is ${entry.unpackedSize} bytes; ceiling is ${CLI_PACKAGE_SIZE_CEILING}.`,
    );
  }
  const actual = (entry.files || []).map((file) => file.path).sort();
  const expected = [...CLI_PACKAGE_FILES].sort();
  const extra = actual.filter((file) => !expected.includes(file));
  const missing = expected.filter((file) => !actual.includes(file));
  if (extra.length || missing.length) {
    throw new Error(
      `CLI package allowlist mismatch. Extra: ${extra.join(', ') || 'none'}. ` +
      `Missing: ${missing.join(', ') || 'none'}.`,
    );
  }
  for (const file of actual) {
    const segments = file.split('/');
    const forbidden = segments.find((segment) => FORBIDDEN_SEGMENTS.has(segment));
    if (forbidden) throw new Error(`Forbidden package segment "${forbidden}" in ${file}.`);
  }
  const executable = entry.files.find((file) => file.path === 'bin/lamina.mjs');
  if (!executable || (requireExecutable && (Number(executable.mode) & 0o111) === 0)) {
    throw new Error('bin/lamina.mjs is not executable in the npm tarball.');
  }
  return {
    ok: true,
    name: entry.name,
    version: entry.version,
    filename: entry.filename,
    packed_size: entry.size,
    unpacked_size: entry.unpackedSize,
    files: actual,
  };
}

function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node scripts/audit-cli-pack.mjs <npm-pack.json>');
  const result = auditPackReport(JSON.parse(fs.readFileSync(input, 'utf8')));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`CLI package audit failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
