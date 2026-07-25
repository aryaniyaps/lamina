#!/usr/bin/env node
/**
 * Freeze the live Issue #18 collect output into publication/seeds/seed-N-*.
 *
 * Usage:
 *   node benchmarks/lb6/pilot/scripts/archive-issue18-seed.mjs --seed 2
 *
 * Copies (does not delete) live collect files. Refuses to overwrite an existing seed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const PUB = path.join(ROOT, 'benchmarks/lb6/pilot/publication');
const SEEDS = path.join(PUB, 'seeds');

const LIVE = [
  'local-v3-issue18-rewardkit.md',
  'local-v3-issue18-rewardkit.json',
  'local-v3-issue18-rewardkit.campaign.json',
];

function parseSeed(argv) {
  const idx = argv.indexOf('--seed');
  if (idx < 0 || !argv[idx + 1]) {
    throw new Error('Usage: archive-issue18-seed.mjs --seed <N>');
  }
  const n = Number(argv[idx + 1]);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid --seed ${argv[idx + 1]}`);
  }
  return n;
}

function main(argv = process.argv.slice(2)) {
  const n = parseSeed(argv);
  fs.mkdirSync(SEEDS, { recursive: true });
  for (const liveName of LIVE) {
    const src = path.join(PUB, liveName);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing live collect file: ${path.relative(ROOT, src)}`);
    }
    const suffix = liveName.replace('local-v3-issue18-rewardkit', '');
    const dest = path.join(SEEDS, `seed-${n}-issue18-rewardkit${suffix}`);
    if (fs.existsSync(dest) && !argv.includes('--force')) {
      throw new Error(`Refusing to overwrite ${path.relative(ROOT, dest)} (pass --force)`);
    }
    fs.copyFileSync(src, dest);
    console.log(`Archived ${path.relative(ROOT, dest)}`);
  }
  const json = JSON.parse(
    fs.readFileSync(path.join(SEEDS, `seed-${n}-issue18-rewardkit.json`), 'utf8'),
  );
  if (json.measurement_valid_cells !== 12) {
    console.warn(
      `Warning: seed-${n} has ${json.measurement_valid_cells}/12 valid cells — fix before median.`,
    );
  } else {
    console.log(`seed-${n}: 12/12 measurement-valid`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
