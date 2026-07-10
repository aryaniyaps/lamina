#!/usr/bin/env node
/**
 * Import Google Form / Google Sheets CSV export into human-scores.json.
 *
 * Expects wide format: one row per (rater, task) with A/B columns.
 * Question titles must match form-spec.json (see benchmarks/human/google-form/SETUP.md).
 *
 * Usage:
 *   npm run bench:import-google-form -- --csv "Form Responses 1.csv"
 *   npm run bench:import-google-form -- --csv responses.csv --publish-audit
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import {
  CRITERIA,
  PACKET_DIR,
  SCORED_DIR,
  loadAnswerKey,
  loadManifest,
  parseCsv,
  ratingsFromLongRows,
  sha256,
  sha256File,
  writeHumanScores,
} from './human-eval-lib.mjs';
import { formQuestionTitle } from './human-eval-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FORM_SPEC = path.join(ROOT, 'benchmarks/human/google-form/form-spec.json');

function parseArgs() {
  const csvs = [];
  let publishAudit = false;
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--csv' && process.argv[i + 1]) {
      csvs.push(path.resolve(process.argv[++i]));
    }
    if (process.argv[i] === '--publish-audit') publishAudit = true;
  }
  return { csvs, publishAudit };
}

function normalizeHeader(h) {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function findColumn(headers, candidates) {
  const norm = headers.map((h) => ({ raw: h, n: normalizeHeader(h) }));
  for (const c of candidates) {
    const hit = norm.find((h) => h.n === normalizeHeader(c) || h.n.includes(normalizeHeader(c)));
    if (hit) return hit.raw;
  }
  return null;
}

function wideRowsToLong(rows, headers) {
  const longRows = [];
  const evalCol = findColumn(headers, ['Evaluation ID (do not edit)', 'Evaluation ID', 'eval_id']);
  const raterCol = findColumn(headers, ['Rater code', 'rater', 'Rater']);
  const taskCol = findColumn(headers, ['Task ID', 'task_id']);

  for (const row of rows) {
    const taskId = taskCol ? row[taskCol]?.trim() : '';
    const rater = raterCol ? row[raterCol]?.trim() : '';
    const evalId = evalCol ? row[evalCol]?.trim() : '';

    for (const label of ['A', 'B']) {
      const entry = {
        task_id: taskId,
        artifact_label: label,
        rater,
        eval_id: evalId,
      };
      let hasScore = false;
      for (const c of CRITERIA) {
        const title = formQuestionTitle(label, c);
        const col = findColumn(headers, [title, `${label} — ${c}`, `${label} - ${c}`]);
        if (col && row[col] !== '') {
          entry[c] = row[col];
          if (c === 'overall_product_behavior') hasScore = true;
        }
      }
      const notesTitle = `${label} — Notes (optional; required if any score ≤2 or ≥4)`;
      const notesCol = findColumn(headers, [notesTitle, `${label} — Notes (optional)`, `${label} notes`]);
      if (notesCol) entry.notes = row[notesCol];

      if (hasScore) longRows.push(entry);
    }
  }
  return longRows;
}

function buildVerification({ csvPaths, ratings, manifest }) {
  const sourceFiles = csvPaths.map((p) => ({
    path: p,
    sha256: sha256File(p),
    bytes: fs.statSync(p).size,
  }));

  const ratingsFingerprint = sha256(
    JSON.stringify(
      ratings
        .map((r) => ({
          task_id: r.task_id,
          label: r.label,
          rater: r.rater,
          overall: r.overall_product_behavior,
        }))
        .sort((a, b) =>
          `${a.task_id}-${a.label}-${a.rater}`.localeCompare(`${b.task_id}-${b.label}-${b.rater}`)
        )
    )
  );

  const evalIds = [...new Set(ratings.map((r) => r.eval_id).filter(Boolean))];
  const manifestMatch =
    manifest && evalIds.length === 1 ? evalIds[0] === manifest.eval_id : null;

  return {
    imported_at: new Date().toISOString(),
    source_files: sourceFiles,
    ratings_fingerprint_sha256: ratingsFingerprint,
    n_ratings: ratings.length,
    raters: [...new Set(ratings.map((r) => String(r.rater)))],
    tasks: [...new Set(ratings.map((r) => r.task_id))].sort(),
    manifest_eval_id: manifest?.eval_id ?? null,
    submitted_eval_ids: evalIds,
    manifest_eval_id_match: manifestMatch,
    synthetic: false,
  };
}

function main() {
  const { csvs, publishAudit } = parseArgs();
  if (!csvs.length) {
    console.error('Usage: npm run bench:import-google-form -- --csv "Form Responses 1.csv"');
    process.exit(1);
  }

  const { armMap } = loadAnswerKey();
  const manifest = loadManifest();

  const allLong = [];
  for (const csvPath of csvs) {
    if (!fs.existsSync(csvPath)) {
      console.error(`CSV not found: ${csvPath}`);
      process.exit(1);
    }
    const { headers, rows } = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    allLong.push(...wideRowsToLong(rows, headers));
  }

  const ratings = ratingsFromLongRows(allLong, armMap);
  if (!ratings.length) {
    console.error('No valid ratings found. Check column titles match form-spec.json / SETUP.md');
    if (fs.existsSync(FORM_SPEC)) {
      console.error(`See ${FORM_SPEC}`);
    }
    process.exit(1);
  }

  const verification = buildVerification({ csvPaths: csvs, ratings, manifest });

  if (manifest && verification.manifest_eval_id_match === false) {
    console.warn(
      `WARNING: Evaluation ID mismatch. Manifest=${manifest.eval_id}, submitted=${verification.submitted_eval_ids.join(',')}`
    );
  }

  const { outPath, kappa, human } = writeHumanScores(ratings, {
    source: 'google_form_import',
    note: 'Imported from Google Form / Sheets export. Publish human-eval-audit.json for external verification.',
    verification,
  });

  const auditPath = path.join(SCORED_DIR, 'human-eval-audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(verification, null, 2) + '\n');

  console.log(`Imported ${ratings.length} ratings → ${outPath}`);
  console.log(`Audit trail → ${auditPath}`);
  console.log(`Fleiss' κ: ${kappa ?? 'N/A'}; control=${human.control_mean.toFixed(2)} treatment=${human.treatment_mean.toFixed(2)}`);

  if (publishAudit) {
    const pubDir = path.join(ROOT, 'benchmarks/releases/v2.0.0');
    fs.mkdirSync(pubDir, { recursive: true });
    fs.copyFileSync(auditPath, path.join(pubDir, 'human-eval-audit.json'));
    if (manifest) {
      fs.copyFileSync(
        path.join(PACKET_DIR, 'human-eval-manifest.json'),
        path.join(pubDir, 'human-eval-manifest.json')
      );
    }
    console.log(`Published audit artifacts → ${pubDir}`);
  }

  if (verification.manifest_eval_id_match === false) {
    process.exit(1);
  }
}

main();
