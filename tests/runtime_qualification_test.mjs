#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fixturesForProfile,
  latencyGate,
  loadManifest,
  profileById,
  PROFILES,
} from '../benchmarks/runtime-qualification-v1/contract.mjs';
import { evaluateQualificationIndex } from '../benchmarks/runtime-qualification-v1/gates.mjs';
import {
  validateManifestFile,
  validateQualificationIndex,
  validateQualificationResult,
} from '../benchmarks/runtime-qualification-v1/validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(HERE, '../benchmarks/runtime-qualification-v1/results/linux-x64-small-partial.json');

const { manifest } = loadManifest();
assert.equal(validateManifestFile(manifest).valid, true);
assert.deepEqual(PROFILES, ['16gb', '8gb']);
assert.deepEqual(fixturesForProfile('8gb'), ['small', 'medium']);
assert.deepEqual(fixturesForProfile('16gb'), ['small', 'medium', 'large']);
assert.equal(profileById('16gb').peak_rss_max_bytes, 1610612736);
assert.equal(latencyGate(manifest, 'warm_preparation_p95_max', 'small'), 3_000_000_000);

const sampleIndex = {
  schema: 'lamina.runtime-qualification-index/v1',
  generated_at: new Date().toISOString(),
  lamina_commit: 'a'.repeat(40),
  manifest_digest: 'b'.repeat(64),
  baseline_manifest_digest: 'c'.repeat(64),
  host: { platform: 'linux', arch: 'x64', release: 'test', memory_bytes: 1 },
  profile: '16gb',
  mode: 'presubmit',
  cells: [{
    profile: '16gb',
    fixture: 'small',
    platform: 'linux-x64',
    baseline_output: '/tmp/example',
    index: { complete: true, scenarios: [{ scenario: 'footprint', status: 'valid' }] },
    scenario_results: [{
      schema: 'lamina.runtime-baseline-result/v1',
      status: 'valid',
      scenario: 'footprint',
      runs: [{
        peak_memory_bytes: 400_000_000,
        peak_pids: 40,
        remaining_descendants: 0,
        remaining_managed_paths: 0,
      }],
      workload: {
        diagnostics: {
          prepared_assets: { bytes: 5_000_000 },
          sealed_model: { bytes: 161_895_621 },
          sealed_worker: { bytes: 88_690_440 },
        },
      },
    }],
    exit_code: 0,
  }],
  oracle_results: manifest.oracle_suites.map((suite) => ({
    id: suite.id,
    command: suite.command,
    exit_code: 0,
    skipped: false,
  })),
  deferred: [{
    id: 'platform.macos',
    blocking: false,
    reason: 'deferred per #78; documented only',
    issue: 78,
  }],
  install_footprint: null,
};

assert.equal(validateQualificationIndex(sampleIndex).valid, true);
const evaluation = evaluateQualificationIndex(sampleIndex);
assert.ok(evaluation.gates.length > 0);
assert.equal(evaluation.summary.overall_pass, true);

if (fs.existsSync(SAMPLE)) {
  const committed = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  assert.equal(validateQualificationResult(committed).valid, true);
  assert.ok(committed.index.cells.length >= 1);
}

console.log('runtime_qualification_test: ok');
