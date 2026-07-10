#!/usr/bin/env node
/**
 * Analyst pass (Anthropic skill-creator pattern): find non-discriminating
 * golden checklist items and probes that always pass (or always fail) on
 * both arms — they add noise without measuring treatment lift.
 *
 * Usage: node benchmarks/scripts/analyst-pass.mjs
 * Writes: benchmarks/results/scored/analyst-report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCORED = path.join(ROOT, 'benchmarks/results/scored');

function loadJson(name) {
  const p = path.join(SCORED, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function analyzeChecks(rows, itemKey = 'item') {
  /** Map item -> { control: [bool], treatment: [bool] } */
  const buckets = new Map();
  for (const row of rows || []) {
    for (const c of row.checks || []) {
      const key = c[itemKey] ?? c.id ?? c.item;
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, { control: [], treatment: [] });
      const arm = row.arm === 'treatment' ? 'treatment' : 'control';
      buckets.get(key)[arm].push(Boolean(c.pass));
    }
  }

  const always_pass_both = [];
  const always_fail_both = [];
  const discriminating = [];

  for (const [key, arms] of buckets) {
    if (!arms.control.length || !arms.treatment.length) continue;
    const cAllPass = arms.control.every(Boolean);
    const tAllPass = arms.treatment.every(Boolean);
    const cAllFail = arms.control.every((x) => !x);
    const tAllFail = arms.treatment.every((x) => !x);
    const cRate = arms.control.filter(Boolean).length / arms.control.length;
    const tRate = arms.treatment.filter(Boolean).length / arms.treatment.length;

    if (cAllPass && tAllPass) {
      always_pass_both.push({ item: key, control_rate: 1, treatment_rate: 1 });
    } else if (cAllFail && tAllFail) {
      always_fail_both.push({ item: key, control_rate: 0, treatment_rate: 0 });
    } else if (Math.abs(tRate - cRate) >= 0.15) {
      discriminating.push({
        item: key,
        control_rate: Math.round(cRate * 100) / 100,
        treatment_rate: Math.round(tRate * 100) / 100,
        delta: Math.round((tRate - cRate) * 100) / 100,
      });
    }
  }

  return {
    n_items: buckets.size,
    always_pass_both,
    always_fail_both,
    discriminating: discriminating.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
  };
}

function main() {
  const coverage = loadJson('coverage-summary.json');
  const probes = loadJson('probes-summary.json');

  if (!coverage && !probes) {
    console.error('No coverage-summary.json or probes-summary.json. Run bench:score first.');
    process.exit(1);
  }

  const report = {
    generated: new Date().toISOString(),
    note: 'Non-discriminating items always pass or always fail on both arms — consider removing or hardening them.',
    golden_coverage: coverage ? analyzeChecks(coverage, 'item') : null,
    behavior_probes: probes ? analyzeChecks(probes, 'id') : null,
  };

  if (report.golden_coverage) {
    const g = report.golden_coverage;
    report.golden_coverage.non_discriminating_rate =
      g.n_items > 0
        ? Math.round(
            ((g.always_pass_both.length + g.always_fail_both.length) / g.n_items) * 1000
          ) / 1000
        : 0;
  }
  if (report.behavior_probes) {
    const p = report.behavior_probes;
    report.behavior_probes.non_discriminating_rate =
      p.n_items > 0
        ? Math.round(
            ((p.always_pass_both.length + p.always_fail_both.length) / p.n_items) * 1000
          ) / 1000
        : 0;
  }

  fs.mkdirSync(SCORED, { recursive: true });
  const out = path.join(SCORED, 'analyst-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');

  console.log(`Analyst report → ${out}`);
  if (report.golden_coverage) {
    console.log(
      `  Golden: ${report.golden_coverage.always_pass_both.length} always-pass-both, ` +
        `${report.golden_coverage.always_fail_both.length} always-fail-both, ` +
        `${report.golden_coverage.discriminating.length} discriminating (≥15pp arm gap)`
    );
  }
  if (report.behavior_probes) {
    console.log(
      `  Probes: ${report.behavior_probes.always_pass_both.length} always-pass-both, ` +
        `${report.behavior_probes.always_fail_both.length} always-fail-both, ` +
        `${report.behavior_probes.discriminating.length} discriminating`
    );
  }
}

main();
