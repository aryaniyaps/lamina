#!/usr/bin/env node
/**
 * Import rater CSV into human-scores.json (optional appendix — not in composite).
 *
 * Usage: npm run bench:import-human -- --csv scores.csv
 */
import fs from 'node:fs';
import {
  parseCsv,
  loadAnswerKey,
  ratingsFromLongRows,
  writeHumanScores,
} from './human-eval-lib.mjs';

function parseArgs() {
  const csvs = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--csv' && process.argv[i + 1]) {
      csvs.push(process.argv[++i]);
    }
  }
  return { csvs };
}

function main() {
  const { csvs } = parseArgs();
  if (!csvs.length) {
    console.error('Usage: npm run bench:import-human -- --csv scores.csv');
    process.exit(1);
  }

  const { armMap } = loadAnswerKey();
  const ratings = [];
  let raterDefault = 1;

  for (const csvPath of csvs) {
    if (!fs.existsSync(csvPath)) {
      console.error(`CSV not found: ${csvPath}`);
      process.exit(1);
    }
    const { rows } = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    ratings.push(...ratingsFromLongRows(rows, armMap, raterDefault));
    raterDefault++;
  }

  if (!ratings.length) {
    console.error('No valid rating rows imported.');
    process.exit(1);
  }

  const { outPath, kappa } = writeHumanScores(ratings, {
    note: 'Imported from rater CSV. Optional appendix only — not in claim composite.',
    source: 'csv_import',
  });
  console.log(`Imported ${ratings.length} ratings → ${outPath}`);
  console.log(`Fleiss' κ: ${kappa ?? 'N/A'}`);
}

main();
