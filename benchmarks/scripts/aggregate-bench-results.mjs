#!/usr/bin/env node
/**
 * Aggregate ingested LaminaBench rewards via dataset metric.py (paired + bootstrap CI).
 *
 * Usage:
 *   node benchmarks/scripts/aggregate-bench-results.mjs [--input PATH] [--output PATH]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';
import {
  AGGREGATED_BENCHMARK,
  AGGREGATED_DIR,
  METRIC_SCRIPT,
  RAW_REWARDS,
} from './bench-results-lib.mjs';
import { evaluateClaimReadiness } from './claim-readiness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs() {
  return {
    input: (() => {
      const idx = process.argv.indexOf('--input');
      return idx !== -1 ? path.resolve(process.argv[idx + 1]) : RAW_REWARDS;
    })(),
    output: (() => {
      const idx = process.argv.indexOf('--output');
      return idx !== -1 ? path.resolve(process.argv[idx + 1]) : AGGREGATED_BENCHMARK;
    })(),
  };
}

function main() {
  const opts = parseArgs();
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));

  if (!fs.existsSync(opts.input)) {
    console.error(`Missing rewards input: ${opts.input}`);
    console.error('Run: npm run bench:ingest');
    process.exit(1);
  }
  if (!fs.existsSync(METRIC_SCRIPT)) {
    console.error(`Missing metric script: ${METRIC_SCRIPT}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(opts.output), { recursive: true });

  const r = spawnSync(
    'uv',
    ['run', METRIC_SCRIPT, '-i', opts.input, '-o', opts.output],
    { cwd: ROOT, encoding: 'utf8' }
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status ?? 1);
  }

  const summary = JSON.parse(fs.readFileSync(opts.output, 'utf8'));
  const rawRows = fs
    .readFileSync(opts.input, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const claimReadiness = evaluateClaimReadiness(rawRows, release);
  const header = {
    release_tag: release.release_tag,
    harness_version: release.harness_version,
    results_contract_version: release.results_contract_version,
    runs_per_arm_config: release.runs_per_arm,
    runs_per_arm_publish: release.runs_per_arm_publish ?? null,
    aggregated_at: new Date().toISOString(),
    input: path.relative(ROOT, opts.input),
    ...claimReadiness,
    ...summary,
  };
  fs.writeFileSync(opts.output, JSON.stringify(header, null, 2) + '\n');

  console.log(`Aggregated benchmark → ${opts.output}`);
  console.log(
    `  paired tasks: ${header.tasks_paired}/${header.tasks_total}, ` +
      `mean Δ ${header.mean_delta_pp}pp ` +
      `(95% CI ${header.bootstrap_95_ci_delta_pp?.join('–')}pp)`
  );
  console.log(`  claim ready: ${header.claim_ready ? 'YES' : 'NO — exploratory only'}`);
  if (!header.claim_ready) {
    for (const reason of header.reasons) console.log(`    - ${reason}`);
  }
}

main();
